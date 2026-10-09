import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { contentDigest } from "./content-digest.js";
import { CONTINUITY_PROTOCOL, CONTINUITY_MODE, CONTINUITY_REQUEST_EVENT, CONTINUITY_RESULT_NAME,
  parseContinuityNotice, validateContinuityRequest, publicationDocumentSchema, requirePublication,
  type ContinuityRequest } from "./continuity-contract.js";
import { ensureContinuityDocument, readContinuityDocument } from "./continuity-documents.js";
import { openHandoff, verifyHandoffReadiness, type HandoffSession } from "./council-handoff-ledger.js";
import { campaignSourceIdentity, guardContinuity, observeCampaign } from "./continuity-source.js";
import { createPublicationStore, type PublicationStore } from "./publication-store.js";
import { openPublicationClient, type PublicationClient } from "./publication-client.js";
import { publicationEffects, reconcilePublication, dispatchPublication } from "./publication-engine.js";
import { publicationReceipt } from "./publication-receipt.js";

async function openSession(ctx: PluginContext, request: ContinuityRequest, store: PublicationStore) {
  const retained = await store.retainedRequest(request);
  const session = await openHandoff(ctx, { ...request.binding.subject, requestedAt: request.requestedAt, expiresAt: request.expiresAt }, retained);
  campaignSourceIdentity(session, request);
  await verifyHandoffReadiness(session);
  await store.bind(request, session.request);
  session.ongoing = true;
  return session;
}

function statusControlAllows(request: ContinuityRequest, states: Array<{ state: string }>) {
  const allowed = request.control === "running" || states.length === 0
    || (["cancel_requested", "cancelled"].includes(request.control) && states.every(u => u.state === "cancelled"));
  return allowed;
}

async function journalIntents(session: HandoffSession, request: ContinuityRequest, store: PublicationStore, client: PublicationClient) {
  const { activeSourceIds, presentation } = campaignSourceIdentity(session, request), rows = [];
  for (const reference of request.publications.slice(0, 32)) {
    const value = await readContinuityDocument(session.ctx, request.binding.companyId, request.binding.nativeRootId, reference.document);
    const document = publicationDocumentSchema.parse(value);
    requirePublication([document.intentId === reference.intentId, document.payloadSha256 === reference.payloadSha256,
      contentDigest(document.payload) === reference.payloadSha256].every(Boolean), "publication_document_changed");
    const effects = publicationEffects(request, reference.intentId, document.payload, activeSourceIds, client.publisher.states, presentation);
    rows.push(await store.ensure(request, reference.intentId, document.payload, effects));
  }
  return rows;
}

async function dispatchIfEnabled(session: HandoffSession, store: PublicationStore, client: PublicationClient,
  row: import("./publication-store.js").PublicationRecord, guardWrite: () => Promise<void>, request: ContinuityRequest) {
  if (!statusControlAllows(request, row.payload.statusUpdates ?? [])) return row;
  const config = await guardContinuity(session);
  return config.publisher!.enabled ? dispatchPublication(store, client, row, guardWrite) : row;
}

async function publish(session: HandoffSession, request: ContinuityRequest, store: PublicationStore) {
  const client = await openPublicationClient(session.ctx, request.binding.companyId, async () => { await guardContinuity(session); });
  // A lost status response must be reconciled before the ongoing state check can trust it.
  for (const row of await store.list(request.binding.companyId, request.binding.missionId)) {
    await reconcilePublication(store, client, row);
  }
  await observeCampaign(session, request, store);
  const rows = await journalIntents(session, request, store, client), acknowledgements = [];
  const guardWrite = async () => {
    const config = await guardContinuity(session);
    requirePublication(config.publisher?.enabled, "publication_disabled");
    await verifyHandoffReadiness(session);
    await observeCampaign(session, request, store);
  };
  for (const row of rows) {
    const current = await dispatchIfEnabled(session, store, client, row, guardWrite, request);
    if (current.effects.every(effect => effect.state === "confirmed")) {
      acknowledgements.push(await publicationReceipt(session.ctx, store, current));
    }
  }
  await observeCampaign(session, request, store);
  return acknowledgements;
}

async function answer(ctx: PluginContext, request: ContinuityRequest) {
  const store = createPublicationStore(ctx.db), session = await openSession(ctx, request, store);
  let availability: "available" | "unavailable" = "unavailable";
  let acknowledgements: Awaited<ReturnType<typeof publish>> = [];
  try {
    acknowledgements = await publish(session, request, store);
    availability = "available";
  } catch { /* No diagnostic can contain source content, upstream credentials, or an inferred receipt. */ }
  await guardContinuity(session);
  const now = Date.now();
  const response = { protocol: CONTINUITY_PROTOCOL, mode: CONTINUITY_MODE, binding: request.binding,
    challengeId: request.challengeId, nonce: request.nonce, requestSha256: contentDigest(request),
    observedAt: new Date(now).toISOString(), validUntil: new Date(now + 120_000).toISOString(),
    capabilities: ["fixed-source", "publication-readback"], sourceSha256: request.sourceSha256,
    availability, changes: [], acknowledgements };
  const proof = await ensureContinuityDocument(ctx, request.binding.companyId, request.binding.nativeRootId,
    `linear-continuity-${request.challengeId}-${contentDigest(response)}`, response);
  await guardContinuity(session);
  await ctx.events.emit(CONTINUITY_RESULT_NAME, request.binding.companyId, { protocol: CONTINUITY_PROTOCOL,
    companyId: request.binding.companyId, missionId: request.binding.missionId, challengeId: request.challengeId, response: proof });
}

async function receiveNotice(ctx: PluginContext, notice: NonNullable<ReturnType<typeof parseContinuityNotice>>) {
  if (!parseConfig(await ctx.config.get(notice.companyId)).councilContinuityEnabled) return;
  const raw = await readContinuityDocument(ctx, notice.companyId, notice.nativeRootId, notice.request);
  await answer(ctx, validateContinuityRequest(notice, raw));
}

/** The SQL claims, not this local coalescing slot, own effect concurrency and restart recovery. */
export function registerCouncilContinuity(ctx: PluginContext) {
  let busy = false;
  ctx.events.on(CONTINUITY_REQUEST_EVENT, async (event: PluginEvent) => {
    const notice = parseContinuityNotice(event);
    if (!notice || busy) return;
    busy = true;
    try { await receiveNotice(ctx, notice); }
    catch { /* Council retains the same pending intent and owns transport retry. */ }
    finally { busy = false; }
  });
}
