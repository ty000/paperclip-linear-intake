import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { openSourceClient, SourceReadError } from "./source-client.js";
import { readSourceFamily } from "./source-family.js";
import { readCampaignSource, CAMPAIGN_SOURCE_SCHEMA } from "./campaign-source.js";
import { CampaignContractError, parseCampaignMarker } from "./campaign-contract.js";
import type { GatewayReadGuard } from "./gateway.js";

const eligibilityFields = ["uuid", "teamId", "projectId", "archivedAt", "stateHistory"];
const rootSchema = z.object({
  uuid: z.uuid(), teamId: z.uuid(), projectId: z.uuid().nullable(), description: z.string().nullable().optional(), archivedAt: z.string().nullable(),
  stateHistory: z.array(z.object({ state: z.object({ id: z.uuid(), type: z.string() }),
    startedAt: z.iso.datetime({ offset: true }), endedAt: z.string().nullable() })).min(1),
});
const markerObservationSchema = z.object({ uuid: z.uuid(), description: z.string().nullable() });

type RetainedSource = { issueId: string; revision: string; snapshot?: Record<string, unknown> | null };
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

function marker(description: string | null) {
  try { return parseCampaignMarker(description); }
  catch (error) {
    if (error instanceof CampaignContractError) throw new SourceReadError(error.code);
    throw error;
  }
}

async function currentRoot(ctx: PluginContext, companyId: string, source: RetainedSource, guard: GatewayReadGuard) {
  const client = await openSourceClient(ctx, companyId, source.issueId, false, guard);
  const payload = await client.call("getIssue", { id: source.issueId, fields: eligibilityFields });
  return { client, payload, scope: client.scope };
}

async function currentMarker(current: Awaited<ReturnType<typeof currentRoot>>, source: RetainedSource) {
  const parsed = markerObservationSchema.safeParse(await current.client.call("getIssue", {
    id: source.issueId, fields: ["uuid", "description"],
  }));
  if (!parsed.success) throw new SourceReadError("source_eligibility_invalid");
  if (parsed.data.uuid !== source.issueId) throw new SourceReadError("source_issue_identity_mismatch");
  return marker(parsed.data.description);
}

function finalEligibility(family: Awaited<ReturnType<typeof readCampaignSource>>["family"]
  | Awaited<ReturnType<typeof readSourceFamily>>["family"], source: RetainedSource) {
  const finalRoot = family.issues.find(issue => issue.uuid === source.issueId);
  return eligible(finalRoot, source, family);
}

async function markerObserved(current: Awaited<ReturnType<typeof currentRoot>>, source: RetainedSource) {
  return source.snapshot ? undefined : currentMarker(current, source);
}

async function observeFamily(ctx: PluginContext, companyId: string, source: RetainedSource,
  guard: GatewayReadGuard, campaign: boolean) {
  if (campaign) return readCampaignSource(ctx, companyId, source.issueId, false, guard);
  return readSourceFamily(ctx, companyId, source.issueId, false, guard);
}

export async function readRetainedFamily(ctx: PluginContext, companyId: string, source: RetainedSource, guard: GatewayReadGuard) {
  const current = await currentRoot(ctx, companyId, source, guard);
  const retainedCampaign = retainedCampaignSource(source);
  // This path serves import and pre-admission handoff only. Post-admission
  // publication states are observed separately by observeCampaign.
  if (!eligible(current.payload, source, current.scope)) return { status: "withdrawn" as const };
  const observedMarker = await markerObserved(current, source);
  const campaign = retainedCampaign || observedMarker !== undefined;
  const result = await observeFamily(ctx, companyId, source, guard, campaign);
  if (!finalEligibility(result.family, source)) return { status: "withdrawn" as const };
  return { status: "source_observed" as const, family: result.family };
}

function retainedCampaignSource(source: RetainedSource) {
  return source.snapshot?.schema === CAMPAIGN_SOURCE_SCHEMA;
}
