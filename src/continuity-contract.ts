import { z, type PluginEvent } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";

export const CONTINUITY_PROTOCOL = "council-linear-continuity-v1" as const;
export const CONTINUITY_MODE = "milestone-fixed-v1" as const;
export const CONTINUITY_REQUEST_EVENT = "plugin.private.paperclip-council.linear-continuity-request";
export const CONTINUITY_RESULT_NAME = "council-continuity-result";
const hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const proofReferenceSchema = z.strictObject({ key: z.string().min(1).max(200), documentId: z.uuid(), revisionId: z.uuid(), bodySha256: hash });
const subjectSchema = z.strictObject({ companyId: z.uuid(), intakeId: z.string().regex(/^linear-intake-[a-f0-9]{64}$/),
  activationId: z.uuid(), configurationFingerprint: hash, requestVersion: z.number().int().positive().max(2_147_483_647),
  nativeRootId: z.uuid(), targetProjectId: z.uuid(), readinessDocumentId: z.uuid(), readinessRevisionId: z.uuid(),
  readinessSha256: hash, sourceSha256: hash, planSha256: hash });
export const continuityBindingSchema = z.strictObject({ companyId: z.uuid(), projectId: z.uuid(), missionId: z.uuid(),
  nativeRootId: z.uuid(), campaignId: z.uuid(), sourceRootId: z.uuid(), authoritySha256: hash, subject: subjectSchema });
export const publicationReferenceSchema = z.strictObject({ intentId: z.uuid(), payloadSha256: hash, document: proofReferenceSchema });
export const continuityRequestSchema = z.strictObject({ protocol: z.literal(CONTINUITY_PROTOCOL), mode: z.literal(CONTINUITY_MODE),
  binding: continuityBindingSchema, challengeId: z.uuid(), nonce: hash, requestedAt: time, expiresAt: time, sourceSha256: hash,
  consumedSequence: z.literal(0), control: z.enum(["running", "pause_requested", "paused", "cancel_requested", "cancelled"]),
  publications: z.array(publicationReferenceSchema).max(64) });
const noticeSchema = z.strictObject({ protocol: z.literal(CONTINUITY_PROTOCOL), companyId: z.uuid(), missionId: z.uuid(),
  nativeRootId: z.uuid(), challengeId: z.uuid(), requestSha256: hash, request: proofReferenceSchema });
const envelopeSchema = z.object({ eventId: z.uuid(), eventType: z.literal(CONTINUITY_REQUEST_EVENT), actorType: z.literal("plugin"),
  actorId: z.literal("private.paperclip-council"), companyId: z.uuid(), occurredAt: time });
export const statusUpdateSchema = z.strictObject({ sourceId: z.uuid(), state: z.enum(["started", "completed", "cancelled"]) });
export const publicationPayloadSchema = z.object({ protocol: z.literal(CONTINUITY_PROTOCOL), mode: z.literal(CONTINUITY_MODE),
  binding: continuityBindingSchema, sourceSha256: hash, kind: z.enum(["progress", "blocker", "question", "decision", "closure", "cancellation"]),
  statusUpdates: z.array(statusUpdateSchema).max(33).optional() }).catchall(z.unknown());
export const publicationDocumentSchema = z.strictObject({ intentId: z.uuid(), payloadSha256: hash, payload: publicationPayloadSchema });
export type ContinuityRequest = z.infer<typeof continuityRequestSchema>;
export type ContinuityBinding = z.infer<typeof continuityBindingSchema>;
export type ContinuityNotice = z.infer<typeof noticeSchema>;
export type ProofReference = z.infer<typeof proofReferenceSchema>;
export type PublicationPayload = z.infer<typeof publicationPayloadSchema>;

export class PublicationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PublicationError"; }
}
export function requirePublication(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PublicationError(code);
}
export function requireContinuityFresh(request: ContinuityRequest, now = Date.now()) {
  const start = Date.parse(request.requestedAt), end = Date.parse(request.expiresAt);
  requirePublication(start <= now && now < end && end > start && end - start <= 300_000, "continuity_request_expired");
}
/** Authentic native envelope is checked before any source/config/secret I/O. */
export function parseContinuityNotice(event: PluginEvent): ContinuityNotice | undefined {
  try {
    requirePublication(Buffer.byteLength(JSON.stringify(event)) <= 16_384, "continuity_notice_invalid");
    const envelope = envelopeSchema.parse(event), notice = noticeSchema.parse(event.payload);
    requirePublication(envelope.companyId === notice.companyId && Date.parse(envelope.occurredAt) <= Date.now(), "continuity_notice_invalid");
    return notice;
  } catch { return undefined; }
}
export function validateContinuityRequest(notice: ContinuityNotice, value: unknown): ContinuityRequest {
  const parsed = continuityRequestSchema.safeParse(value);
  requirePublication(parsed.success, "continuity_request_invalid");
  const request = parsed.data, b = request.binding, s = b.subject;
  requireContinuityFresh(request);
  requirePublication(request.challengeId === notice.challengeId && contentDigest(request) === notice.requestSha256,
    "continuity_request_changed");
  requirePublication(b.companyId === notice.companyId && b.missionId === notice.missionId && b.nativeRootId === notice.nativeRootId
    && b.campaignId === b.missionId && s.companyId === b.companyId && s.targetProjectId === b.projectId && s.nativeRootId === b.nativeRootId,
  "continuity_binding_invalid");
  requirePublication(new Set(request.publications.map(p => p.intentId)).size === request.publications.length, "publication_duplicate_intent");
  return request;
}
