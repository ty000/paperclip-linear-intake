import { createHash } from "node:crypto";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { openGateway } from "./gateway.js";

const roles = {
  getWorkspace: "get-workspace",
  getProject: "get-project", getTeam: "get-team", listStatuses: "list-issue-statuses",
  listIssues: "list-issues", getIssue: "get-issue",
} as const;
const fields = ["id", "uuid", "description", "parentId", "teamId", "projectId", "status",
  "statusType", "createdAt", "updatedAt", "completedAt", "canceledAt", "archivedAt"];
type ProbeScope = NonNullable<ReturnType<typeof parseConfig>["sourceProbe"]>;
type GatewaySession = NonNullable<Awaited<ReturnType<typeof openGateway>>>;
type ProbeCall = { role: keyof typeof roles; arguments: Record<string, unknown> };

function requireProbeSession(session: Awaited<ReturnType<typeof openGateway>>) {
  const scope = session?.config.sourceProbe;
  if (!session || !scope) throw new Error("source_probe_disabled");
  return { session, scope };
}

async function openProbeSession(ctx: PluginContext, companyId: string) {
  if (!z.uuid().safeParse(companyId).success) throw new Error("company_scope_required");
  const initial = parseConfig(await ctx.config.get(companyId));
  if (!initial.sourceProbe) return undefined;
  return requireProbeSession(await openGateway(ctx, companyId));
}

function validateToolPin(session: GatewaySession, role: keyof typeof roles, pin: NonNullable<ProbeScope["tools"][keyof typeof roles]>) {
  const tool = session.tools.find(t => t.name === pin.name);
  if (!tool || !pin.name.endsWith(`:${roles[role]}`)
      || createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex") !== pin.inputSchemaSha256) {
    throw new Error("source_probe_catalog_changed");
  }
}

function validateProbeCatalog(session: GatewaySession, scope: ProbeScope) {
  // Bind the actual catalog inputs, including its connection-qualified names.
  // A provider/catalog change requires explicit review of new pins.
  for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
    const pin = scope.tools[role];
    if (pin) validateToolPin(session, role, pin);
  }
}

function probeCalls(scope: ProbeScope): ProbeCall[] {
  return [
    ...(scope.tools.getWorkspace ? [{ role: "getWorkspace" as const, arguments: {} }] : []),
    { role: "getProject", arguments: { query: scope.projectId } },
    { role: "getTeam", arguments: { query: scope.teamId } },
    { role: "listStatuses", arguments: { team: scope.teamId } },
    { role: "listIssues", arguments: {
      project: scope.projectId, team: scope.teamId, limit: 2, orderBy: "createdAt",
      includeArchived: true, includeSubTeams: false, fields,
    } },
    ...scope.sampleIssueIds.map(id => ({ role: "getIssue" as const, arguments: {
      id, fields: [...fields, "relations", "stateHistory"],
    } })),
  ];
}

function hasToolContent(data: { content?: unknown[] | undefined; structuredContent?: unknown }) {
  return Array.isArray(data.content) || data.structuredContent !== undefined;
}

async function observeSourceCall(session: GatewaySession, scope: ProbeScope, call: ProbeCall) {
  const result = await session.rpc("tools/call", { name: scope.tools[call.role]!.name, arguments: call.arguments });
  const envelope = z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()).optional(),
    structuredContent: z.unknown().optional() }).passthrough().safeParse(result);
  if (!envelope.success || envelope.data.isError === true || !hasToolContent(envelope.data)) {
    throw new Error("source_probe_call_failed");
  }
  // Raw operator observations, not a claimed complete source contract.
  return { role: call.role, result };
}

// A bounded observation, never a family snapshot or an eligibility verdict.
// No caller-supplied queries, pagination, tool names or issue IDs are accepted.
export async function probeSource(ctx: PluginContext, companyId: string) {
  const probe = await openProbeSession(ctx, companyId);
  if (!probe) return { status: "disabled" as const, importEnabled: false };
  const { session, scope } = probe;
  validateProbeCatalog(session, scope);
  const observations = [];
  for (const call of probeCalls(scope)) {
    observations.push(await observeSourceCall(session, scope, call));
  }
  return {
    status: "source_probe_observed" as const, sourceCoverage: "unqualified" as const,
    importEnabled: false, catalogSha256: session.catalogSha256, observations,
  };
}
