import type { PluginContext } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { ensureContinuityDocument, readContinuityDocument } from "./continuity-documents.js";
import { requirePublication } from "./continuity-contract.js";
import type { PublicationRecord, PublicationStore } from "./publication-store.js";

export async function publicationReceipt(ctx: PluginContext, store: PublicationStore, initial: PublicationRecord) {
  let row = initial;
  requirePublication(row.effects.length > 0 && row.effects.every(e => e.state === "confirmed" && e.readback), "publication_readback_pending");
  const payload = { protocol: "linear-publication-readback-v1", intentId: row.intentId, payloadSha256: row.payloadSha256,
    bindingSha256: contentDigest(row.payload.binding), sourceSha256: row.payload.sourceSha256, status: "confirmed",
    effects: row.effects.map(e => ({ sourceId: e.sourceId, kind: e.kind, readbackSha256: contentDigest(e.readback) })) };
  if (row.receipt) {
    const existing = await readContinuityDocument(ctx,row.companyId,row.payload.binding.nativeRootId,row.receipt);
    requireReceipt(existing, payload, enrichedPayload(row, payload));
  } else {
    const key = `linear-publication-${row.intentId}`;
    const existing = await ctx.issues.documents.get(row.payload.binding.nativeRootId, key, row.companyId);
    let selected: unknown = enrichedPayload(row, payload);
    if (existing) {
      try { selected = JSON.parse(existing.body); } catch { throw new Error("publication_receipt_changed"); }
      requireReceipt(selected, payload, enrichedPayload(row, payload));
    }
    const receipt = await ensureContinuityDocument(ctx,row.companyId,row.payload.binding.nativeRootId,key,selected);
    row = await store.save(row,row.effects,receipt);
  }
  return { intentId: row.intentId, payloadSha256: row.payloadSha256, status: "confirmed" as const, publicationReceipt: row.receipt! };
}

function enrichedPayload(row: PublicationRecord, legacy: { effects: Array<Record<string, unknown>> }) {
  return { ...legacy, effects: legacy.effects.map((effect, index) => {
    const saved = row.effects[index]!;
    if (saved.kind !== "comment") return effect;
    requirePublication(typeof saved.readback?.commentId === "string", "publication_comment_identity_missing");
    return { ...effect, commentId: saved.readback.commentId,
      ...(typeof saved.readback.commentUrl === "string" ? { commentUrl: saved.readback.commentUrl } : {}) };
  }) };
}

function requireReceipt(existing: unknown, legacy: unknown, enriched: unknown) {
  const digest = contentDigest(existing);
  requirePublication(digest === contentDigest(legacy) || digest === contentDigest(enriched), "publication_receipt_changed");
}
