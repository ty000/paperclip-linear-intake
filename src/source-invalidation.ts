import type { PluginContext, PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import { INTAKE_DATABASE_NAMESPACE as ns, type IntakeBinding, type IntakeRequest } from "./intake-state.js";
import type { CampaignChange } from "./webhook-event.js";
import { contentDigest } from "./content-digest.js";
import { requirePublication, type ContinuityRequest } from "./continuity-contract.js";
import { campaignSourceExtensionSchema } from "./campaign-contract.js";
import { createPublicationStore } from "./publication-store.js";

const bindings = `${ns}.campaign_publication_bindings`, changes = `${ns}.campaign_source_changes`;
const key = "linear-source-invalidation", protocol = "council-linear-source-invalidation-v1";
type Campaign = { binding: ContinuityRequest["binding"]; sourceSha256: string; retainedRequest: IntakeRequest };
const columns = `binding, source_sha256 AS "sourceSha256", retained_request AS "retainedRequest"`;

async function* enrolledCampaigns(db: PluginDatabaseClient, binding: IntakeBinding) {
  let cursor = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = await db.query<Campaign>(`SELECT ${columns} FROM ${bindings}
      WHERE company_id=$1 AND retained_request->>'activationId'=$2 AND mission_id>$3 ORDER BY mission_id LIMIT 64`,
    [binding.companyId,binding.activationId,cursor]);
    for (const row of rows) yield row;
    if (rows.length < 64) return;
    cursor = rows.at(-1)!.binding.missionId;
  }
}

function related(campaign: Campaign, event: CampaignChange, binding: IntakeBinding) {
  const request = campaign.retainedRequest;
  if (![request.activationId === binding.activationId, request.organizationId === event.organizationId].every(Boolean)) return false;
  const source = campaignSourceExtensionSchema.parse(request.snapshot?.campaign);
  const members = new Set(source.nativeMapping.map(item => item.sourceId));
  if (members.has(event.issueId)) return true;
  // New descendants and new direct milestone members invalidate the fixed selection.
  const selected = [event.parentId, event.previousParentId].some(parent => parent !== null && members.has(parent));
  const milestone = [event.milestoneId, event.previousMilestoneId].includes(source.milestoneId);
  return [event.teamId === binding.authority.teamId, event.projectId === binding.authority.projectId,
    selected || milestone].every(Boolean);
}

async function publicationEcho(db: PluginDatabaseClient, campaign: Campaign, event: CampaignChange) {
  if (event.changedFields.length !== 1 || event.changedFields[0] !== "status") return false;
  const rows = await createPublicationStore(db).list(campaign.binding.companyId, campaign.binding.missionId);
  return rows.some(row => row.effects.some(effect => effect.kind === "status" && effect.state === "confirmed"
    && effect.sourceId === event.issueId && effect.stateId === event.stateId && effect.readback?.updatedAt === event.revision));
}

async function retainChange(db: PluginDatabaseClient, campaign: Campaign, binding: IntakeBinding, event: CampaignChange) {
  await db.execute(`INSERT INTO ${changes} (company_id,mission_id,provider_delivery_id,source_event_id,raw_body_sha256,event)
    SELECT $1,$2,$3,$4,$5,$6::jsonb FROM (SELECT company_id FROM ${bindings}
      WHERE company_id=$1 AND mission_id=$2 FOR UPDATE) locked_campaign
    WHERE EXISTS (SELECT 1 FROM ${ns}.intake_binding
      WHERE company_id=$1 AND activation_id=$7 AND active=TRUE) ON CONFLICT DO NOTHING`,
  [binding.companyId,campaign.binding.missionId,event.providerDeliveryId,event.sourceEventId,event.rawBodySha256,JSON.stringify(event),binding.activationId]);
  const rows = await db.query<{ source_event_id: string; raw_body_sha256: string; provider_delivery_id: string }>(
    `SELECT source_event_id,raw_body_sha256,provider_delivery_id FROM ${changes}
      WHERE company_id=$1 AND mission_id=$2 AND (source_event_id=$3 OR provider_delivery_id=$4)`,
    [binding.companyId,campaign.binding.missionId,event.sourceEventId,event.providerDeliveryId]);
  requirePublication(rows.length === 1 && rows[0]!.source_event_id === event.sourceEventId
    && (rows[0]!.provider_delivery_id !== event.providerDeliveryId || rows[0]!.raw_body_sha256 === event.rawBodySha256), "source_invalidation_retention_failed");
}

/** Retention only: no HTTP, documents, event emission, or execution wakes before ACK. */
export async function retainCampaignChange(db: PluginDatabaseClient, binding: IntakeBinding, event: CampaignChange) {
  for await (const campaign of enrolledCampaigns(db, binding)) {
    if (related(campaign, event, binding) && !await publicationEcho(db, campaign, event)) await retainChange(db, campaign, binding, event);
  }
}

async function projectCampaign(ctx: PluginContext, campaign: Campaign) {
  const b = campaign.binding;
  const events = await ctx.db.query<{ generation: string; event: CampaignChange }>(`SELECT generation,event FROM ${changes}
    WHERE company_id=$1 AND mission_id=$2 ORDER BY generation DESC LIMIT 33`, [b.companyId,b.missionId]);
  if (!events.length) return;
  const payload = { protocol, binding: b, sourceSha256: campaign.sourceSha256, generation: Number(events[0]!.generation),
    sourceIds: [...new Set(events.map(row => row.event.issueId))].sort(),
    changedFields: [...new Set(events.flatMap(row => row.event.changedFields))].sort() };
  const body = JSON.stringify(payload);
  let document = await ctx.issues.documents.get(b.nativeRootId,key,b.companyId);
  if (document?.body === body) return;
  await ctx.issues.documents.upsert({ companyId: b.companyId, issueId: b.nativeRootId, key,
    title: "Linear — changements source retenus", format: "markdown", body });
  document = await ctx.issues.documents.get(b.nativeRootId,key,b.companyId);
  requirePublication(document?.body === body && document.latestRevisionId, "source_invalidation_document_unknown");
  await ctx.events.emit("council-source-invalidated", b.companyId, { protocol, companyId:b.companyId, missionId:b.missionId,
    nativeRootId:b.nativeRootId,bindingSha256:contentDigest(b),generation:payload.generation,
    invalidation:{key,documentId:document.id,revisionId:document.latestRevisionId,bodySha256:contentDigest(body)} });
}

/** Local durable reconciliation only. Council owns whether a retained signal warrants a source read. */
export async function projectCampaignChanges(ctx: PluginContext, binding: IntakeBinding) {
  for await (const campaign of enrolledCampaigns(ctx.db, binding)) await projectCampaign(ctx, campaign);
}
