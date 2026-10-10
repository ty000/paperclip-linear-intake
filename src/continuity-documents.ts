import type { PluginContext } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { continuityDocumentKeySchema, publicationDocumentSchema, requirePublication, type ProofReference, type ContinuityRequest } from "./continuity-contract.js";

export async function readPublicationDocument(ctx: PluginContext, request: ContinuityRequest, reference: ContinuityRequest["publications"][number]) {
  const value = await readContinuityDocument(ctx, request.binding.companyId, request.binding.nativeRootId, reference.document);
  const document = publicationDocumentSchema.parse(value);
  requirePublication([document.intentId === reference.intentId, document.payloadSha256 === reference.payloadSha256,
    contentDigest(document.payload) === reference.payloadSha256].every(Boolean), "publication_document_changed");
  return document;
}

export async function readContinuityDocument(ctx: PluginContext, companyId: string, issueId: string, reference: ProofReference) {
  requirePublication(continuityDocumentKeySchema.safeParse(reference.key).success, "continuity_document_key");
  const document = await ctx.issues.documents.get(issueId,reference.key,companyId);
  requirePublication(document, "continuity_document_changed");
  requirePublication([document.id === reference.documentId, document.latestRevisionId === reference.revisionId,
    contentDigest(document.body) === reference.bodySha256, Buffer.byteLength(document.body) <= 128_000].every(Boolean), "continuity_document_changed");
  try { return JSON.parse(document.body) as unknown; }
  catch { throw new Error("continuity_document_invalid"); }
}

/** Stable document keys and exact-body readback; upsert never replaces differing content. */
export async function ensureContinuityDocument(ctx: PluginContext, companyId: string, issueId: string, key: string, payload: unknown): Promise<ProofReference> {
  requirePublication(continuityDocumentKeySchema.safeParse(key).success, "continuity_document_key");
  const body = JSON.stringify(payload);
  requirePublication(Buffer.byteLength(body) <= 128_000, "continuity_document_bound");
  let document = await ctx.issues.documents.get(issueId,key,companyId);
  if (!document) {
    await ctx.issues.documents.upsert({ companyId, issueId, key, title: "Linear — observation de campagne", format: "markdown", body });
    document = await ctx.issues.documents.get(issueId,key,companyId);
  }
  requirePublication(document?.latestRevisionId && document.body === body, "continuity_document_unknown");
  return { key, documentId: document.id, revisionId: document.latestRevisionId, bodySha256: contentDigest(body) };
}
