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
    requirePublication(contentDigest(existing) === contentDigest(payload), "publication_receipt_changed");
  } else {
    const receipt = await ensureContinuityDocument(ctx,row.companyId,row.payload.binding.nativeRootId,`linear-publication-${row.intentId}`,payload);
    row = await store.save(row,row.effects,receipt);
  }
  return { intentId: row.intentId, payloadSha256: row.payloadSha256, status: "confirmed" as const, publicationReceipt: row.receipt! };
}
