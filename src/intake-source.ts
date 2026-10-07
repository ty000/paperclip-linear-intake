import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { openSourceClient, SourceReadError } from "./source-client.js";
import { readSourceFamily } from "./source-family.js";
import type { GatewayReadGuard } from "./gateway.js";

const eligibilityFields = ["uuid", "teamId", "projectId", "archivedAt", "stateHistory"];
const rootSchema = z.object({
  uuid: z.uuid(), teamId: z.uuid(), projectId: z.uuid().nullable(), archivedAt: z.string().nullable(),
  stateHistory: z.array(z.object({ state: z.object({ id: z.uuid() }),
    startedAt: z.iso.datetime({ offset: true }), endedAt: z.string().nullable() })).min(1),
});

type RetainedSource = { issueId: string; revision: string };
type Scope = { teamId: string; projectId: string; todoStateId: string };

function rootObservation(payload: unknown, issueId: string) {
  const parsed = rootSchema.safeParse(payload);
  if (!parsed.success) throw new SourceReadError("source_eligibility_invalid");
  const root = parsed.data;
  if (root.uuid !== issueId) throw new SourceReadError("source_issue_identity_mismatch");
  const current = root.stateHistory.filter(state => state.endedAt === null);
  if (current.length !== 1) throw new SourceReadError("source_state_unknown");
  return { root, current: current[0]! };
}

function eligible(payload: unknown, source: RetainedSource, scope: Scope) {
  const { root, current } = rootObservation(payload, source.issueId);
  // A newer Todo interval proves withdrawal of the retained request even if
  // the exit/re-entry webhooks were lost or the new actor was not authorized.
  return [root.teamId === scope.teamId, root.projectId === scope.projectId,
    root.archivedAt === null, current.state.id === scope.todoStateId,
    Date.parse(current.startedAt) <= Date.parse(source.revision)].every(Boolean);
}

async function currentlyEligible(ctx: PluginContext, companyId: string, source: RetainedSource, guard: GatewayReadGuard) {
  const client = await openSourceClient(ctx, companyId, source.issueId, false, guard);
  const payload = await client.call("getIssue", { id: source.issueId, fields: eligibilityFields });
  return eligible(payload, source, client.scope);
}

export async function readRetainedFamily(ctx: PluginContext, companyId: string, source: RetainedSource, guard: GatewayReadGuard) {
  if (!await currentlyEligible(ctx, companyId, source, guard)) return { status: "withdrawn" as const };
  const result = await readSourceFamily(ctx, companyId, source.issueId, false, guard);
  const root = result.family.issues.find(issue => issue.uuid === source.issueId);
  if (!eligible(root, source, result.family)) return { status: "withdrawn" as const };
  return { status: "source_observed" as const, family: result.family };
}
