import { createHash } from "node:crypto";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { openGateway, type GatewayReadGuard } from "./gateway.js";
import { parseConfig } from "./config.js";
import { unwrapManagedPayload } from "./source-payload.js";

const suffixes = {
  getWorkspace: "get-workspace", getProject: "get-project", getTeam: "get-team",
  listStatuses: "list-issue-statuses", listIssues: "list-issues", getIssue: "get-issue",
} as const;
type Role = keyof typeof suffixes;
type Session = NonNullable<Awaited<ReturnType<typeof openGateway>>>;
type ReaderScope = NonNullable<Session["config"]["sourceReader"]>;

export class SourceReadError extends Error {
  constructor(readonly code: string) { super(code); }
}

function requireReader(session: Awaited<ReturnType<typeof openGateway>>) {
  const scope = session?.config.sourceReader;
  if (!session || !scope) throw new SourceReadError("source_reader_disabled");
  return { session, scope };
}

function verifyEnrollment(scope: ReaderScope, rootIssueId: string, qualificationOnly: boolean) {
  if (qualificationOnly && !scope.qualificationRootIssueIds.includes(rootIssueId)) throw new SourceReadError("source_root_not_enrolled");
}

async function readScope(ctx: PluginContext, companyId: string, rootIssueId: string, qualificationOnly: boolean) {
  const identity = z.object({ companyId: z.uuid(), rootIssueId: z.uuid() }).safeParse({ companyId, rootIssueId });
  if (!identity.success) throw new SourceReadError("source_scope_required");
  const scope = parseConfig(await ctx.config.get(companyId)).sourceReader;
  if (!scope) throw new SourceReadError("source_reader_disabled");
  verifyEnrollment(scope, rootIssueId, qualificationOnly);
  return scope;
}

function verifyPin(session: Session, role: Role, pin: ReaderScope["tools"][Role]) {
  const tool = session.tools.find(item => item.name === pin.name);
  if (!tool || !pin.name.endsWith(`:${suffixes[role]}`)) throw new SourceReadError("source_catalog_changed");
  const digest = createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex");
  if (digest !== pin.inputSchemaSha256) throw new SourceReadError("source_catalog_changed");
}

function verifyCatalog(session: Session, scope: ReaderScope) {
  const namespace = connectionNamespace(scope.tools.getWorkspace.name);
  for (const role of Object.keys(suffixes) as Role[]) {
    const pin = scope.tools[role];
    if (connectionNamespace(pin.name) !== namespace) throw new SourceReadError("source_connection_mismatch");
    verifyPin(session, role, pin);
  }
}

function connectionNamespace(name: string) {
  return name.slice(0, name.lastIndexOf(":"));
}

function requestBudget(scope: ReaderScope) {
  let requests = 0;
  const deadline = Date.now() + scope.deadlineMs;
  return {
    before() {
      if (++requests > scope.maxRequests) throw new SourceReadError("source_request_bound_exceeded");
      this.after();
    },
    after() {
      if (Date.now() > deadline) throw new SourceReadError("source_deadline_exceeded");
    },
    count: () => requests,
  };
}

function boundPayload(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) throw new SourceReadError("source_size_bound_exceeded");
  return value;
}

export async function openSourceClient(ctx: PluginContext, companyId: string, rootIssueId: string,
  qualificationOnly: boolean, guard?: GatewayReadGuard) {
  const expectedScope = await readScope(ctx, companyId, rootIssueId, qualificationOnly);
  const { session, scope } = requireReader(await openGateway(ctx, companyId, guard));
  if (JSON.stringify(scope) !== JSON.stringify(expectedScope)) throw new SourceReadError("source_configuration_changed");
  verifyCatalog(session, scope);
  const budget = requestBudget(scope);
  return {
    scope, catalogSha256: session.catalogSha256, requests: budget.count,
    async call(role: Role, args: Record<string, unknown>) {
      budget.before();
      const result = await session.rpc("tools/call", { name: scope.tools[role].name, arguments: args });
      budget.after();
      const payload = unwrapManagedPayload(result);
      session.assertCredentialAbsent(payload);
      return boundPayload(payload);
    },
  };
}

export type SourceClient = Awaited<ReturnType<typeof openSourceClient>>;
