import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { contentDigest } from "./content-digest.js";
import { CONTINUITY_PROTOCOL, CONTINUITY_MODE, CONTINUITY_REQUEST_EVENT, CONTINUITY_RESULT_NAME,
  parseContinuityNotice, validateContinuityRequest, requirePublication,
  type ContinuityRequest } from "./continuity-contract.js";
import { ensureContinuityDocument, readContinuityDocument, readPublicationDocument } from "./continuity-documents.js";
import { openHandoff, verifyHandoffReadiness, type HandoffSession } from "./council-handoff-ledger.js";
import { campaignSourceIdentity, guardContinuity, observeCampaign } from "./continuity-source.js";
import { createPublicationStore, type PublicationStore } from "./publication-store.js";
import { openPublicationClient, type PublicationClient } from "./publication-client.js";
import { publicationEffects, validatePublicationScope, controlComment, reconcilePublication, dispatchPublication, verifyConfirmedComments, type PublicationGuards } from "./publication-engine.js";
import { publicationReceipt } from "./publication-receipt.js";
import { ContinuitySourceError, continuityDiagnostic, type SourceDiagnostic } from "./continuity-diagnostic.js";
import { continuityResponseCache } from "./continuity-response-cache.js";
import { readbackContinuity } from "./continuity-readback.js";

async function openSession(ctx: PluginContext, request: ContinuityRequest, store: PublicationStore) {
  const retained = await store.retainedRequest(request);
  const session = await openHandoff(ctx, { ...request.binding.subject, requestedAt: request.requestedAt, expiresAt: request.expiresAt }, retained);
  campaignSourceIdentity(session, request);
  await verifyHandoffReadiness(session);
  await store.bind(request, session.request);
  await store.observeResume(request);
  session.ongoing = true;
  return session;
}

function statusControlAllows(request: ContinuityRequest, states: Array<{ state: string }>) {
  const allowed = request.control === "running" || states.length === 0
    || (["cancel_requested", "cancelled"].includes(request.control) && states.every(u => u.state === "cancelled"));
  return allowed;
}

async function journalIntents(session: HandoffSession, request: ContinuityRequest, store: PublicationStore, client: PublicationClient) {
  const { activeSourceIds, presentation } = campaignSourceIdentity(session, request, client.publisher.paperclipBaseUrl), rows = [];
  const history = await store.list(request.binding.companyId, request.binding.missionId);
  for (const reference of request.publications.slice(0, 32)) {
    const document = await readPublicationDocument(session.ctx, request, reference);
    validatePublicationScope(request, document.payload, activeSourceIds);
    // Rendering evolves; original journal effects remain the only retry identity.
    const existing = await store.get(request.binding.companyId, reference.intentId);
    const context = { ...presentation, previousComments: previousComments(history, reference.intentId) };
    const effects = existing?.effects ?? publicationEffects(request, reference.intentId, document.payload, activeSourceIds, client.publisher.states, context);
    rows.push(await store.ensure(request, reference.intentId, document.payload, effects));
  }
  return rows;
}

function previousComments(rows: import("./publication-store.js").PublicationRecord[], currentIntentId: string) {
  return rows.filter(row => row.intentId !== currentIntentId).flatMap(row => row.effects
    .filter(effect => effect.kind === "comment" && effect.state === "confirmed" && typeof effect.readback?.commentId === "string")
    .map(effect => ({ kind: row.payload.kind, commentId: effect.readback!.commentId as string,
      ...(typeof effect.readback!.commentUrl === "string" ? { url: effect.readback!.commentUrl } : {}) })));
}

async function dispatchIfEnabled(session: HandoffSession, store: PublicationStore, client: PublicationClient,
  row: import("./publication-store.js").PublicationRecord, guards: PublicationGuards, request: ContinuityRequest) {
  if (!statusControlAllows(request, row.payload.statusUpdates ?? [])) return row;
  const config = await guardContinuity(session);
  return config.publisher!.enabled ? dispatchPublication(store, client, row, guards) : row;
}

function isUnreconciledStatusDiagnostic(diagnostic: SourceDiagnostic, unreconciledStatusIds: ReadonlySet<string>) {
  return unreconciledStatusIds.size > 0 && diagnostic.code === "source_state_changed"
    && diagnostic.changedFields.length === 1 && diagnostic.changedFields[0] === "status"
    && diagnostic.changedSourceIds.every(id => unreconciledStatusIds.has(id));
}

async function sourceObservation(session: HandoffSession, request: ContinuityRequest, store: PublicationStore,
  unreconciledStatusIds: ReadonlySet<string> = new Set()) {
  try { await observeCampaign(session, request, store); }
  catch (error) {
    // The original source remains pinned, including when it is later restored.
    const diagnostic = continuityDiagnostic(error, request);
    // A lost own write is still unknown while the writer cannot reconcile it.
    if (isUnreconciledStatusDiagnostic(diagnostic, unreconciledStatusIds)) {
      return continuityDiagnostic(new Error("publication_status_unreconciled"), request);
    }
    await store.holdSource(request, diagnostic);
    return diagnostic;
  }
  return undefined;
}

async function publicationClaimGuard(session: HandoffSession, request: ContinuityRequest,
  client: PublicationClient, commentOnly: boolean) {
  const config = await guardContinuity(session);
  requirePublication(config.publisher?.enabled, "publication_disabled");
  await verifyHandoffReadiness(session);
  if (commentOnly) {
    // A scoped diagnostic must still be publishable when a member changed.
    // No status or terminal-success comment passes this branch.
    await client.issue(request.binding.sourceRootId);
  }
}

async function publicationGuard(session: HandoffSession, request: ContinuityRequest, store: PublicationStore,
  client: PublicationClient, commentOnly: boolean) {
  await publicationClaimGuard(session, request, client, commentOnly);
  if (!commentOnly) {
    const diagnostic = await sourceObservation(session, request, store);
    if (diagnostic) throw new ContinuitySourceError(diagnostic);
    requirePublication(await store.sourceAllows(request), "publication_source_resume_required");
  }
}

function terminalReference(request: ContinuityRequest, row: import("./publication-store.js").PublicationRecord) {
  const reference = request.publications.find(p => p.intentId === row.intentId)!;
  requirePublication(row.payload.kind === "closure" || !reference.terminalClaim, "publication_terminal_claim_invalid");
  return reference;
}

type ClaimRequest = { intentId: string; payloadSha256: string };
async function requestTerminalClaim(session: HandoffSession, request: ContinuityRequest, store: PublicationStore,
  client: PublicationClient, row: import("./publication-store.js").PublicationRecord): Promise<ClaimRequest | undefined> {
  if (request.control !== "running" || !client.publisher.enabled) return undefined;
  await publicationGuard(session, request, store, client, false);
  await verifyConfirmedComments(store, client, row);
  return { intentId: row.intentId, payloadSha256: row.payloadSha256 };
}

async function publishRow(session: HandoffSession, request: ContinuityRequest, store: PublicationStore,
  client: PublicationClient, row: import("./publication-store.js").PublicationRecord) {
  const commentOnly = controlComment(row), reference = terminalReference(request, row);
  if (!commentOnly && !await store.sourceAllows(request)) return {};
  if (row.payload.kind === "closure" && !reference.terminalClaim) {
    // Readiness for Council's CAS gives no permission to claim or send.
    return { claim: await requestTerminalClaim(session, request, store, client, row) };
  }
  // Native authority and readiness precede the durable claim; the complete
  // double source observation remains immediately before its only send.
  const guards = {
    beforeClaim: async () => {
      await publicationClaimGuard(session, request, client, commentOnly);
      if (!commentOnly) requirePublication(await store.sourceAllows(request), "publication_source_resume_required");
    },
    beforeSend: () => publicationGuard(session, request, store, client, commentOnly),
  };
  const current = await dispatchIfEnabled(session, store, client, row, guards, request);
  if (!current.effects.every(effect => effect.state === "confirmed")) return {};
  await verifyConfirmedComments(store, client, current);
  return { acknowledgement: await publicationReceipt(session.ctx, store, current) };
}

async function publishRows(session: HandoffSession, request: ContinuityRequest, store: PublicationStore, client: PublicationClient) {
  const rows = await journalIntents(session, request, store, client), acknowledgements = [];
  let terminalClaimRequest: ClaimRequest | undefined;
  for (const row of rows) {
    const result = await publishRow(session, request, store, client, row);
    if (result.acknowledgement) acknowledgements.push(result.acknowledgement);
    if (!result.claim) continue;
    requirePublication(!terminalClaimRequest, "publication_multiple_terminal_intents");
    terminalClaimRequest = result.claim;
  }
  return { acknowledgements, terminalClaimRequest };
}

async function publish(session: HandoffSession, request: ContinuityRequest, store: PublicationStore) {
  const client = await openPublicationClient(session.ctx, request.binding.companyId, async () => { await guardContinuity(session); })
    .catch(async error => {
      // A revoked writer must not prevent the independently authorized reader.
      const history = await store.list(request.binding.companyId, request.binding.missionId);
      const claimed = new Set(history.flatMap(row => row.effects
        .filter(effect => effect.kind === "status" && effect.state === "claimed").map(effect => effect.sourceId)));
      const diagnostic = await sourceObservation(session, request, store, claimed);
      if (diagnostic) throw new ContinuitySourceError(diagnostic);
      throw error;
    });
  // A lost status response must be reconciled before the ongoing state check can trust it.
  for (const row of await store.list(request.binding.companyId, request.binding.missionId)) {
    await reconcilePublication(store, client, row);
  }
  let sourceDiagnostic = await sourceObservation(session, request, store);
  const { acknowledgements, terminalClaimRequest } = await publishRows(session, request, store, client);
  // Without requested publications there is no intervening send to observe.
  // The first observation still reads the complete source twice, after recovery.
  if (request.publications.length) sourceDiagnostic ??= await sourceObservation(session, request, store);
  const diagnostic = await store.heldDiagnostic(request);
  return { acknowledgements, diagnostic, available: !sourceDiagnostic, terminalClaimRequest: diagnostic ? undefined : terminalClaimRequest };
}

async function answer(ctx: PluginContext, request: ContinuityRequest) {
  const store = createPublicationStore(ctx.db), session = await openSession(ctx, request, store);
  const cache = continuityResponseCache(ctx.db, request), retained = await cache.get();
  if (retained) {
    for (const reference of request.publications) await readPublicationDocument(ctx, request, reference);
    await emitResponse(ctx, request, session, retained); return;
  }
  let availability: "available" | "unavailable" = "unavailable";
  let acknowledgements: Awaited<ReturnType<typeof publish>>["acknowledgements"] = [];
  let diagnostic: SourceDiagnostic | undefined;
  let terminalClaimRequest: Awaited<ReturnType<typeof publish>>["terminalClaimRequest"];
  try {
    const result = await processRequest(session, request, store);
    ({ acknowledgements, diagnostic, terminalClaimRequest } = result);
    availability = result.available ? "available" : "unavailable";
  } catch (error) { diagnostic = continuityDiagnostic(error, request); }
  await guardContinuity(session);
  const now = Date.now();
  const response = { protocol: CONTINUITY_PROTOCOL, mode: CONTINUITY_MODE, binding: request.binding,
    challengeId: request.challengeId, nonce: request.nonce, requestSha256: contentDigest(request),
    observedAt: new Date(now).toISOString(), validUntil: new Date(now + 120_000).toISOString(),
    capabilities: ["fixed-source", "publication-readback", "terminal-publication-claim",
      ...(request.sourceObservationProtocol ? ["event-driven-source"] : [])], sourceSha256: request.sourceSha256,
    ...(request.sourceObservationProtocol ? { sourceObservationProtocol: request.sourceObservationProtocol,
      sourceInvalidationVersion: request.sourceInvalidationVersion, observationPurpose: request.observationPurpose } : {}),
    availability, changes: [], acknowledgements, ...(diagnostic ? { diagnostic } : {}), ...(terminalClaimRequest ? { terminalClaimRequest } : {}) };
  await emitResponse(ctx, request, session, await cache.save(response));
}

async function processRequest(session: HandoffSession, request: ContinuityRequest, store: PublicationStore) {
  if (request.observationPurpose === "readback") return readbackContinuity(session, request, store);
  if (request.observationPurpose === "event" && request.control !== "running" && !request.publications.length) {
    return { acknowledgements: [], diagnostic: undefined, available: false, terminalClaimRequest: undefined };
  }
  return publish(session, request, store);
}

async function emitResponse(ctx: PluginContext, request: ContinuityRequest, session: HandoffSession, response: Record<string, unknown>) {
  // The full digest includes challenge and binding; no truncated identity or oversized prefix.
  const proof = await ensureContinuityDocument(ctx, request.binding.companyId, request.binding.nativeRootId,
    contentDigest(response), response);
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
