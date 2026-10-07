import { z, type PluginEvent } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";

export const COUNCIL_REQUEST_EVENT = "plugin.private.paperclip-council.linear-intake-revalidation-request";
export const COUNCIL_RESULT_NAME = "linear-intake-revalidation-result";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const requestSchema = z.strictObject({
  schema: z.literal("linear-intake-revalidation-request.v1"), challengeId: z.uuid(), nonce: hash,
  stage: z.enum(["preparation", "admission"]), companyId: z.uuid(), admissionId: z.uuid(), mandateId: z.uuid(),
  mandateRevisionSha256: hash, intakeId: z.string().regex(/^linear-intake-[a-f0-9]{64}$/),
  activationId: z.uuid(), configurationFingerprint: hash, requestVersion: z.number().int().positive().max(2_147_483_647),
  nativeRootId: z.uuid(), targetProjectId: z.uuid(), readinessDocumentId: z.uuid(), readinessRevisionId: z.uuid(),
  readinessSha256: hash, sourceSha256: hash, planSha256: hash, requestedAt: timestamp, expiresAt: timestamp,
});
const envelopeSchema = z.object({
  eventId: z.uuid(), eventType: z.literal(COUNCIL_REQUEST_EVENT), actorType: z.literal("plugin"),
  actorId: z.literal("private.paperclip-council"), companyId: z.uuid(), occurredAt: timestamp,
});
export type CouncilChallenge = z.infer<typeof requestSchema>;

export class HandoffError extends Error {
  constructor(readonly code: string) { super(code); this.name = "HandoffError"; }
}

export function requireHandoff(condition: unknown, code: string): asserts condition {
  if (!condition) throw new HandoffError(code);
}

export function requireFreshChallenge(request: CouncilChallenge, now = Date.now()) {
  const start = Date.parse(request.requestedAt), end = Date.parse(request.expiresAt);
  requireHandoff(start <= now && now < end, "handoff_request_expired");
  requireHandoff(end - start <= 300_000, "handoff_request_expired");
}

/** Invalid or unattributed input is ignored before configuration, DB or secret I/O. */
export function parseCouncilChallenge(event: PluginEvent): CouncilChallenge | undefined {
  try {
    requireHandoff(Buffer.byteLength(JSON.stringify(event)) <= 8192, "handoff_request_invalid");
    const envelope = envelopeSchema.parse(event), request = requestSchema.parse(event.payload);
    requireFreshChallenge(request);
    requireHandoff(envelope.companyId === request.companyId, "handoff_request_invalid");
    const occurredAt = Date.parse(envelope.occurredAt);
    requireHandoff(occurredAt >= Date.parse(request.requestedAt) && occurredAt <= Date.now(), "handoff_request_invalid");
    return request;
  } catch { return undefined; }
}

export function handoffResult(request: CouncilChallenge, reason: string) {
  const now = Date.now();
  return { schema: "linear-intake-revalidation-result.v1" as const, request,
    requestSha256: contentDigest(request), status: reason === "handoff_confirmed" ? "confirmed" as const : "blocked" as const,
    reason, observedAt: new Date(now).toISOString(), validUntil: new Date(now + 120_000).toISOString() };
}
