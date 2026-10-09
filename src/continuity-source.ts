import { z } from "@paperclipai/plugin-sdk";
import { readCampaignSource } from "./campaign-source.js";
import { campaignReadinessSchema } from "./campaign-contract.js";
import { requirePublication, type ContinuityRequest } from "./continuity-contract.js";
import { guardHandoff, type HandoffSession } from "./council-handoff-ledger.js";
import { currentConfig, fingerprint } from "./intake-authority.js";
import { confirmedPublicationStates } from "./publication-engine.js";
import type { PublicationStore } from "./publication-store.js";

const issueSchema = z.object({ uuid: z.uuid(), id: z.string(), title: z.string(), currentStateId: z.uuid(), statusType: z.string(), archivedAt: z.string().nullable() });

export function campaignSourceIdentity(session: HandoffSession, request: ContinuityRequest) {
  const campaign = campaignReadinessSchema.parse(session.plan.plan.campaign);
  requirePublication(campaign.materialSourceSha256 === request.sourceSha256
    && campaign.ticketSourceId === request.binding.sourceRootId && session.request.issueId === campaign.ticketSourceId,
  "continuity_source_binding_changed");
  const original = z.array(issueSchema).min(1).max(33).parse(session.request.snapshot?.issues);
  const active = original.filter(i => i.archivedAt === null && !["completed", "canceled"].includes(i.statusType));
  const presentation = { sources: original.map(issue => ({ sourceId: issue.uuid, label: `${issue.id} — ${issue.title}` })),
    references: [{ label: "PRD", url: campaign.references.prd.url }, { label: "TAD", url: campaign.references.tad.url }] };
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
  requirePublication(observed.family.campaign.materialSourceSha256 === request.sourceSha256, "continuity_material_source_changed");
  verifyObservedStates(identity.original, observed.family.issues, trusted);
  return observed.family.campaign.materialSourceSha256;
}

function verifyObservedStates(original: Array<z.infer<typeof issueSchema>>, issues: Array<z.infer<typeof issueSchema>>, trusted: ReadonlyMap<string, string>) {
  const actual = new Map(issues.map(issue => [issue.uuid, issue]));
  for (const before of original) {
    const after = actual.get(before.uuid);
    requirePublication(after, "continuity_state_changed_outside_publisher");
    const expected = trusted.get(before.uuid) ?? before.currentStateId;
    requirePublication([after.currentStateId === expected, after.archivedAt === before.archivedAt].every(Boolean),
      "continuity_state_changed_outside_publisher");
  }
}
