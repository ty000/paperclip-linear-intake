import { createHash } from "node:crypto";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { openGateway } from "./gateway.js";

const roles = {
  getProject: "get-project", getTeam: "get-team", listStatuses: "list-issue-statuses",
  listIssues: "list-issues", getIssue: "get-issue",
} as const;
const fields = ["id", "uuid", "description", "parentId", "teamId", "projectId", "status",
  "statusType", "createdAt", "updatedAt", "completedAt", "canceledAt", "archivedAt"];

// A bounded observation, never a family snapshot or an eligibility verdict.
// No caller-supplied queries, pagination, tool names or issue IDs are accepted.
export async function probeSource(ctx: PluginContext, companyId: string) {
  if (!z.uuid().safeParse(companyId).success) throw new Error("company_scope_required");
  const initial = parseConfig(await ctx.config.get(companyId));
  if (!initial.sourceProbe) return { status: "disabled" as const, intakeEnabled: false };
  const session = await openGateway(ctx, companyId);
  const scope = session?.config.sourceProbe;
  if (!session || !scope) throw new Error("source_probe_disabled");
  // Bind the actual catalog inputs, including its connection-qualified names.
  // A provider/catalog change requires explicit review of new pins.
  for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
    const pin = scope.tools[role];
    const tool = session.tools.find(t => t.name === pin.name);
    if (!tool || !pin.name.endsWith(`:${roles[role]}`)
        || createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex") !== pin.inputSchemaSha256) {
      throw new Error("source_probe_catalog_changed");
    }
  }
  const calls: { role: keyof typeof roles; arguments: Record<string, unknown> }[] = [
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
  const observations: { role: keyof typeof roles; result: unknown }[] = [];
  for (const call of calls) {
    const result = await session.rpc("tools/call", { name: scope.tools[call.role].name, arguments: call.arguments });
    const envelope = z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()).optional(),
      structuredContent: z.unknown().optional() }).passthrough().safeParse(result);
    if (!envelope.success || envelope.data.isError === true
        || (!Array.isArray(envelope.data.content) && envelope.data.structuredContent === undefined)) {
      throw new Error("source_probe_call_failed");
    }
    // These are raw provider observations for the authorized operator. They are
    // deliberately not normalized into a claimed complete source contract.
    observations.push({ role: call.role, result });
  }
  return {
    status: "source_probe_observed" as const, sourceCoverage: "unqualified" as const,
    intakeEnabled: false, catalogSha256: session.catalogSha256, observations,
  };
}
