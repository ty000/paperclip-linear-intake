import { contentDigest } from "./content-digest.js";
import { requirePublication, type ContinuityRequest, type PublicationPayload } from "./continuity-contract.js";
import type { PublicationClient } from "./publication-client.js";
import type { PublicationEffect, PublicationRecord, PublicationStore } from "./publication-store.js";

export function publicationEffects(request: ContinuityRequest, intentId: string, payload: PublicationPayload,
  activeSourceIds: ReadonlySet<string>, states: PublicationClient["publisher"]["states"]): PublicationEffect[] {
  requirePublication(contentDigest(payload.binding) === contentDigest(request.binding) && payload.sourceSha256 === request.sourceSha256, "publication_binding_changed");
  const root = request.binding.sourceRootId, updates = payload.statusUpdates ?? [];
  requirePublication(new Set(updates.map(u => u.sourceId)).size === updates.length, "publication_duplicate_status");
  for (const update of updates) requirePublication(activeSourceIds.has(update.sourceId), "publication_source_outside_campaign");
  const { protocol: _protocol, binding: _binding, sourceSha256: _source, mode: _mode, statusUpdates: _statuses, kind, ...content } = payload;
  const label = { progress: "Progression", blocker: "Blocage", question: "Question", decision: "Décision", closure: "Bilan", cancellation: "Annulation" }[kind];
  const marker = `<!-- paperclip-linear:${intentId}:${contentDigest(payload)} -->`;
  const body = `## Council — ${label}\n\n${JSON.stringify(content, null, 2)}\n\n${marker}`;
  requirePublication(Buffer.byteLength(body) <= 24_000, "publication_content_bound");
  // The terminal campaign-root status is last, after all other effects read back.
  const ordered = [...updates].sort((a,b) => Number(a.sourceId === root && a.state !== "started") - Number(b.sourceId === root && b.state !== "started"));
  return [{ kind: "comment", sourceId: root, body, state: "pending" },
    ...ordered.map(update => ({ kind: "status" as const, sourceId: update.sourceId, stateId: states[update.state], state: "pending" as const }))];
}

async function observeStatus(client: PublicationClient, effect: PublicationEffect) {
  const issue = await client.issue(effect.sourceId);
  const protectedSha256 = effect.before?.protectedSha256;
  requirePublication([!protectedSha256, issue.protectedSha256 === protectedSha256].some(Boolean), "publication_protected_fields_changed");
  return issue.stateId === effect.stateId ? issue : undefined;
}

async function observe(client: PublicationClient, effect: PublicationEffect, intentId: string, payloadSha256: string) {
  if (effect.kind === "status") return observeStatus(client, effect);
  const marker = `<!-- paperclip-linear:${intentId}:${payloadSha256} -->`;
  const matches = (await client.comments(effect.sourceId)).filter(c => c.body.includes(marker));
  requirePublication(matches.length <= 1, "publication_comment_ambiguous");
  if (matches.length === 0) return undefined;
  const comment = matches[0]!;
  requirePublication(comment.body === effect.body, "publication_comment_changed");
  return { sourceId: effect.sourceId, commentId: comment.id, bodySha256: contentDigest(comment.body) };
}

async function confirm(store: PublicationStore, row: PublicationRecord, index: number, readback: Record<string, unknown>) {
  return store.save(row, row.effects.map((e,i) => i === index ? { ...e, state: "confirmed", readback, confirmedAt: new Date().toISOString() } : e));
}

/** Claimed effects only read. Even an empty complete readback never authorizes a second send. */
export async function reconcilePublication(store: PublicationStore, client: PublicationClient, initial: PublicationRecord) {
  let row = initial;
  // Dispatch is strictly sequential: at most one claimed effect can exist.
  const i = row.effects.findIndex(effect => effect.state !== "confirmed");
  if (row.effects[i]?.state === "claimed") row = await reconcileClaim(store, client, row, i);
  await store.release(row);
  return row;
}

async function reconcileClaim(store: PublicationStore, client: PublicationClient, row: PublicationRecord, index: number) {
  const observed = await observe(client, row.effects[index]!, row.intentId, row.payloadSha256);
  return observed ? confirm(store, row, index, observed) : row;
}

async function observeRepeatedStatus(store: PublicationStore, row: PublicationRecord, index: number,
  before: Awaited<ReturnType<PublicationClient["issue"]>> | undefined) {
  if (!before) return undefined;
  const effect = row.effects[index]!;
  if (before.stateId === effect.stateId) {
    const trusted = confirmedPublicationStates(await store.list(row.companyId, row.missionId));
    requirePublication(trusted.get(effect.sourceId) === effect.stateId, "publication_preexisting_status");
    return confirm(store, row, index, before);
  }
  requirePublication(!["completed", "canceled"].includes(before.statusType), "publication_terminal_state");
  return undefined;
}

async function sendEffect(client: PublicationClient, effect: PublicationEffect) {
  if (effect.kind === "comment") await client.comment(effect.sourceId, effect.body!);
  else await client.status(effect.sourceId, effect.stateId!);
}

async function dispatchEffect(store: PublicationStore, client: PublicationClient, row: PublicationRecord,
  index: number, guardWrite: () => Promise<void>) {
  const effect = row.effects[index]!;
  await guardWrite();
  const before = effect.kind === "status" ? await client.issue(effect.sourceId) : undefined;
  const repeated = await observeRepeatedStatus(store, row, index, before);
  if (repeated) return repeated;
  // A pre-existing matching comment is never adopted before our original send claim.
  requirePublication(!await observe(client, effect, row.intentId, row.payloadSha256), "publication_preexisting_effect");
  const claimed: PublicationEffect = { ...effect, state: "claimed", ...(before ? { before } : {}) };
  row = await store.save(row, row.effects.map((e,n) => n === index ? claimed : e));
  await guardWrite();
  await sendEffect(client, effect);
  return reconcileClaim(store, client, row, index);
}

export async function dispatchPublication(store: PublicationStore, client: PublicationClient, initial: PublicationRecord,
  guardWrite: () => Promise<void>) {
  let row = await reconcilePublication(store, client, initial);
  await store.acquire(row);
  for (let i = 0; i < row.effects.length; i++) {
    const effect = row.effects[i]!;
    if (effect.state === "confirmed") continue;
    requirePublication(effect.state === "pending", "publication_readback_pending");
    row = await dispatchEffect(store, client, row, i, guardWrite);
    if (row.effects[i]!.state !== "confirmed") break;
  }
  await store.release(row);
  return row;
}

function confirmedStateEffects(rows: PublicationRecord[]) {
  return rows.flatMap(row => row.effects.filter(e => e.kind === "status" && e.state === "confirmed")
    .map(effect => ({ effect, updates: row.payload.statusUpdates ?? [] })));
}

function retainConfirmedState(states: Map<string, string>, terminal: Set<string>, effect: PublicationEffect, semantic: string) {
  if (terminal.has(effect.sourceId)) {
    requirePublication(semantic === "started" || states.get(effect.sourceId) === effect.stateId, "publication_terminal_receipts_conflict");
    return;
  }
  states.set(effect.sourceId, effect.stateId!);
  if (semantic !== "started") terminal.add(effect.sourceId);
}

export function confirmedPublicationStates(rows: PublicationRecord[]) {
  const states = new Map<string, string>(), terminal = new Set<string>();
  // The writer never reopens a terminal state. This order is independent of wall clocks.
  for (const { effect, updates } of confirmedStateEffects(rows)) {
    const semantic = updates.find(update => update.sourceId === effect.sourceId)?.state;
    requirePublication(semantic, "publication_state_receipt_invalid");
    requirePublication(effect.readback, "publication_state_receipt_invalid");
    retainConfirmedState(states, terminal, effect, semantic);
  }
  return states;
}
