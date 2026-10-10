import { z } from "@paperclipai/plugin-sdk";
import { readCampaignSource } from "./campaign-source.js";
import { campaignReadinessSchema, campaignSourceExtensionSchema } from "./campaign-contract.js";
import { requirePublication, type ContinuityRequest } from "./continuity-contract.js";
import { guardHandoff, type HandoffSession } from "./council-handoff-ledger.js";
import { currentConfig, fingerprint } from "./intake-authority.js";
import { confirmedPublicationStates } from "./publication-engine.js";
import type { PublicationStore } from "./publication-store.js";
import { ContinuitySourceError, materialDiagnostic } from "./continuity-diagnostic.js";

const issueSchema = z.object({ uuid: z.uuid(), id: z.string(), title: z.string(), currentStateId: z.uuid(), statusType: z.string(), archivedAt: z.string().nullable() });

export function campaignSourceIdentity(session: HandoffSession, request: ContinuityRequest, paperclipBaseUrl?: string) {
  const campaign = campaignReadinessSchema.parse(session.plan.plan.campaign);
  requirePublication(campaign.materialSourceSha256 === request.sourceSha256
    && campaign.ticketSourceId === request.binding.sourceRootId && session.request.issueId === campaign.ticketSourceId,
  "continuity_source_binding_changed");
  const original = z.array(issueSchema).min(1).max(33).parse(session.request.snapshot?.issues);
  const { milestone } = campaignSourceExtensionSchema.parse(session.request.snapshot?.campaign);
  const active = original.filter(i => i.archivedAt === null && !["completed", "canceled"].includes(i.statusType));
  const presentation = { sources: original.map(issue => ({ sourceId: issue.uuid, label: `${issue.id} — ${issue.title}` })),
    references: [{ label: "PRD", ...campaign.references.prd }, { label: "TAD", ...campaign.references.tad }],
    objective: { title: milestone.name, description: milestone.description },
    sourceSha256: request.sourceSha256,
    ...(paperclipBaseUrl ? { campaignUrl: new URL(`/issues/${request.binding.nativeRootId}`, paperclipBaseUrl).href } : {}) };
  return { campaign, original, presentation, activeSourceIds: new Set(active.map(i => i.uuid)) };
}

export async function guardContinuity(session: HandoffSession) {
  await guardHandoff(session);
  const config = await currentConfig(session.ctx, session.binding);
  requirePublication(config.councilContinuityEnabled && config.publisher, "continuity_disabled");
  return config;
}

/** Ongoing observation is separate from the strict Todo admission path. */
export async function observeCampaign(session: HandoffSession, request: ContinuityRequest, store: PublicationStore) {
  const identity = campaignSourceIdentity(session, request);
  const trusted = confirmedPublicationStates(await store.list(request.binding.companyId, request.binding.missionId));
  const config = await guardContinuity(session);
  const observed = await readCampaignSource(session.ctx, request.binding.companyId, request.binding.sourceRootId, false,
    async selected => {
      requirePublication(fingerprint(selected) === session.binding.fingerprint, "continuity_configuration_changed");
      await guardContinuity(session);
    }, { trustedContinuationStateIds: trusted, publisherStateIds: config.publisher!.states });
  if (observed.family.campaign.materialSourceSha256 !== request.sourceSha256) {
    throw new ContinuitySourceError(materialDiagnostic(session.request.snapshot, observed.family, request));
  }
  verifyObservedStates(identity.original, observed.family.issues, trusted, request);
  return observed.family.campaign.materialSourceSha256;
}

function changedState(before: z.infer<typeof issueSchema>, after: z.infer<typeof issueSchema> | undefined, expected: string) {
  if (!after || after.archivedAt !== before.archivedAt) return "archive" as const;
  if (after.currentStateId !== expected) return "status" as const;
  return undefined;
}

function verifyObservedStates(original: Array<z.infer<typeof issueSchema>>, issues: Array<z.infer<typeof issueSchema>>, trusted: ReadonlyMap<string, string>, request: ContinuityRequest) {
  const actual = new Map(issues.map(issue => [issue.uuid, issue]));
  for (const before of original) {
    const field = changedState(before, actual.get(before.uuid), trusted.get(before.uuid) ?? before.currentStateId);
    if (field) {
      throw new ContinuitySourceError({ code: "source_state_changed", expectedSourceSha256: request.sourceSha256,
        changedSourceIds: [before.uuid], changedFields: [field] });
    }
  }
}
