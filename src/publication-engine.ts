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

async function observe(client: PublicationClient, effect: PublicationEffect, intentId: string, payloadSha256: string) {
  if (effect.kind === "status") {
    const issue = await client.issue(effect.sourceId);
    const protectedSha256 = effect.before?.protectedSha256;
    requirePublication(!protectedSha256 || issue.protectedSha256 === protectedSha256, "publication_protected_fields_changed");
    return issue.stateId === effect.stateId ? issue : undefined;
  }
  const marker = `<!-- paperclip-linear:${intentId}:${payloadSha256} -->`;
  const matches = (await client.comments(effect.sourceId)).filter(c => c.body.includes(marker));
  requirePublication(matches.length <= 1, "publication_comment_ambiguous");
  requirePublication(!matches.length || matches[0]!.body === effect.body, "publication_comment_changed");
  return matches[0] ? { sourceId: effect.sourceId, commentId: matches[0].id, bodySha256: contentDigest(matches[0].body) } : undefined;
}

async function confirm(store: PublicationStore, row: PublicationRecord, index: number, readback: Record<string, unknown>) {
  return store.save(row, row.effects.map((e,i) => i === index ? { ...e, state: "confirmed", readback, confirmedAt: new Date().toISOString() } : e));
}

/** Claimed effects only read. Even an empty complete readback never authorizes a second send. */
export async function reconcilePublication(store: PublicationStore, client: PublicationClient, initial: PublicationRecord) {
  let row = initial;
  for (let i = 0; i < row.effects.length; i++) {
    const effect = row.effects[i]!;
    if (effect.state === "pending") break;
    if (effect.state === "confirmed") continue;
    const observed = await observe(client, effect, row.intentId, row.payloadSha256);
    if (observed && effect.state === "claimed") row = await confirm(store,row,i,observed);
    if (!observed) break;
  }
  await store.release(row);
  return row;
}

export async function dispatchPublication(store: PublicationStore, client: PublicationClient, initial: PublicationRecord,
  guardWrite: () => Promise<void>) {
  let row = await reconcilePublication(store,client,initial);
  await store.acquire(row);
  for (let i = 0; i < row.effects.length; i++) {
    const effect = row.effects[i]!;
    if (effect.state === "confirmed") continue;
    if (effect.state === "claimed") break;
    await guardWrite();
    const before = effect.kind === "status" ? await client.issue(effect.sourceId) : undefined;
    requirePublication(!before || before.stateId !== effect.stateId, "publication_preexisting_status");
    // A pre-existing matching comment is never adopted before our original send claim.
    requirePublication(!await observe(client,effect,row.intentId,row.payloadSha256), "publication_preexisting_effect");
    row = await store.save(row,row.effects.map((e,n) => n === i ? { ...e, state: "claimed", ...(before ? { before } : {}) } : e));
    await guardWrite();
    if (effect.kind === "comment") await client.comment(effect.sourceId,effect.body!);
    else await client.status(effect.sourceId,effect.stateId!);
    const observed = await observe(client,row.effects[i]!,row.intentId,row.payloadSha256);
    if (!observed) break;
    row = await confirm(store,row,i,observed);
  }
  await store.release(row);
  return row;
}

export function confirmedPublicationStates(rows: PublicationRecord[]) {
  const states = new Map<string, string>();
  const effects = rows.flatMap(row => row.effects).filter(e => e.kind === "status" && e.state === "confirmed")
    .sort((a,b) => (a.confirmedAt ?? "").localeCompare(b.confirmedAt ?? ""));
  for (const effect of effects) states.set(effect.sourceId,effect.stateId!);
  return states;
}
