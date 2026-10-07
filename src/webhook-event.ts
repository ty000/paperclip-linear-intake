import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "@paperclipai/plugin-sdk";

// Linear webhook contract and SDK schema checked 2026-10-07:
// https://linear.app/developers/webhooks
// linear/linear@7d2bc4279f1887cf763c59f9a173d9c590620023,
// packages/sdk/src/_generated_documents.ts: IssueWebhookPayload uses flat IDs.
const timestamp = z.iso.datetime({ offset: true });
const actorSchema = z.object({ id: z.uuid(), type: z.string().min(1).max(128) });
const authoritySchema = z.object({
  organizationId: z.uuid(), teamId: z.uuid(), projectId: z.uuid(),
  todoStateId: z.uuid(), webhookId: z.uuid(), activationAt: timestamp,
  allowedActors: z.array(actorSchema).min(1),
});
const envelopeSchema = z.object({
  organizationId: z.uuid(), webhookId: z.uuid(), type: z.string().min(1),
  action: z.string().min(1), createdAt: timestamp,
  actor: actorSchema.nullable().optional(), data: z.unknown(),
  webhookTimestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedFrom: z.record(z.string(), z.unknown()).nullable().optional(),
});
const issueSchema = z.object({
  id: z.uuid(), teamId: z.uuid(), projectId: z.uuid().nullable().optional(),
  stateId: z.uuid(), updatedAt: timestamp, archivedAt: timestamp.nullable().optional(),
});
const previousSchema = z.object({
  stateId: z.uuid().nullable().optional(), teamId: z.uuid().optional(),
  projectId: z.uuid().nullable().optional(), archivedAt: timestamp.nullable().optional(),
});
export type WebhookAuthority = z.infer<typeof authoritySchema>;
type Authority = WebhookAuthority;
type Envelope = z.infer<typeof envelopeSchema>;
type Issue = z.infer<typeof issueSchema>;
type Previous = z.infer<typeof previousSchema>;
type Headers = Record<string, string | string[] | undefined>;

function validated<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(code);
  return result.data;
}

function rawBytes(rawBody: string | Uint8Array) {
  if (typeof rawBody === "string") {
    checkBodySize(Buffer.byteLength(rawBody, "utf8"));
    return Buffer.from(rawBody, "utf8");
  }
  if (!(rawBody instanceof Uint8Array)) throw new Error("webhook_body_invalid");
  checkBodySize(rawBody.byteLength);
  return Buffer.from(rawBody);
}

function checkBodySize(length: number) {
  if (length > 2 * 1024 * 1024) throw new Error("webhook_body_too_large");
}

function uniqueHeaders(headers: Headers) {
  const values = validated(z.record(z.string(), z.string().optional()), headers, "webhook_headers_invalid");
  const unique = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    const key = name.toLowerCase();
    if (unique.has(key)) throw new Error("webhook_headers_invalid");
    unique.set(key, value);
  }
  return unique;
}

function verifySignature(bytes: Buffer, signature: unknown, secret: string) {
  const encoded = validated(z.string().regex(/^[a-fA-F0-9]{64}$/), signature, "webhook_signature_invalid");
  const signingSecret = validated(z.string().min(1), secret, "webhook_secret_invalid");
  const expected = createHmac("sha256", signingSecret).update(bytes).digest();
  if (!timingSafeEqual(expected, Buffer.from(encoded, "hex"))) throw new Error("webhook_signature_invalid");
}

function parseEnvelope(bytes: Buffer) {
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new Error("webhook_envelope_invalid"); }
  return validated(envelopeSchema, body, "webhook_envelope_invalid");
}

function checkClock(envelope: Envelope, nowMs: number) {
  validated(z.number().int().nonnegative().max(8_640_000_000_000_000), nowMs, "webhook_clock_invalid");
  if (Math.abs(envelope.webhookTimestamp - nowMs) > 60_000) throw new Error("webhook_timestamp_invalid");
}

function matchOptionalHeader(value: string | undefined, expected: string) {
  if (value === undefined) return;
  if (value !== expected) throw new Error("webhook_headers_invalid");
}

function checkEnvelopeHeaders(envelope: Envelope, headers: Map<string, string | undefined>) {
  matchOptionalHeader(headers.get("linear-timestamp"), String(envelope.webhookTimestamp));
  matchOptionalHeader(headers.get("linear-event"), envelope.type);
}

function ignored(reason: string) {
  return { classification: "ignored" as const, reason };
}

function envelopeFilter(envelope: Envelope, authority: Authority) {
  if (envelope.organizationId !== authority.organizationId) return ignored("organization_mismatch");
  if (envelope.webhookId !== authority.webhookId) return ignored("webhook_mismatch");
  if (envelope.type !== "Issue") return ignored("unsupported_type");
  return actionFilter(envelope, authority);
}

function actionFilter(envelope: Envelope, authority: Authority) {
  if (!["update", "remove"].includes(envelope.action)) return ignored("unsupported_action");
  if (Date.parse(envelope.createdAt) < Date.parse(authority.activationAt)) return ignored("before_activation");
  return undefined;
}

function matchesScope(scope: { teamId: string; projectId?: string | null | undefined }, authority: Authority) {
  return scope.teamId === authority.teamId && scope.projectId === authority.projectId;
}

function previousScope(issue: Issue, previous: Previous) {
  return {
    teamId: previous.teamId ?? issue.teamId,
    projectId: Object.hasOwn(previous, "projectId") ? previous.projectId : issue.projectId,
  };
}

function isWithdrawal(envelope: Envelope, issue: Issue, authority: Authority) {
  if (envelope.action === "remove") return true;
  if (issue.archivedAt) return true;
  if (issue.stateId !== authority.todoStateId) return true;
  return !matchesScope(issue, authority);
}

function actorAllowed(actor: Envelope["actor"], authority: Authority) {
  if (!actor) return false;
  return authority.allowedActors.some(allowed => allowed.id === actor.id && allowed.type === actor.type);
}

function entryClassification(envelope: Envelope, issue: Issue, previous: Previous, authority: Authority) {
  if (!Object.hasOwn(previous, "stateId")) return ignored("no_todo_transition");
  if (previous.stateId === issue.stateId) return ignored("no_todo_transition");
  if (!actorAllowed(envelope.actor, authority)) return ignored("actor_not_allowed");
  return { classification: "received" as const };
}

function classify(envelope: Envelope, issue: Issue, previous: Previous, authority: Authority) {
  const relevant = [issue, previousScope(issue, previous)].some(scope => matchesScope(scope, authority));
  if (!relevant) return ignored("source_scope_mismatch");
  if (isWithdrawal(envelope, issue, authority)) return { classification: "withdrawal" as const };
  return entryClassification(envelope, issue, previous, authority);
}

function sourceFacts(envelope: Envelope, issue: Issue, previous: Previous) {
  return {
    organizationId: envelope.organizationId, webhookId: envelope.webhookId, issueId: issue.id,
    action: envelope.action, eventAt: new Date(envelope.createdAt).toISOString(),
    revision: new Date(issue.updatedAt).toISOString(), teamId: issue.teamId,
    projectId: issue.projectId ?? null, stateId: issue.stateId,
    archivedAt: issue.archivedAt ?? null, actor: envelope.actor ?? null, previous,
  };
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function classifyIssue(envelope: Envelope, authority: Authority) {
  const issue = validated(issueSchema, envelope.data, "webhook_envelope_invalid");
  const previous = validated(previousSchema, envelope.updatedFrom ?? {}, "webhook_envelope_invalid");
  return { decision: classify(envelope, issue, previous, authority), facts: sourceFacts(envelope, issue, previous),
    sourceScopeWasAuthorized: matchesScope(previousScope(issue, previous), authority),
    currentScopeMatches: matchesScope(issue, authority) };
}

export type NormalizedWebhookEvent = ReturnType<typeof sourceFacts> & {
  classification: "received" | "withdrawal";
  providerDeliveryId: string; rawBodySha256: string; sourceEventId: string;
  webhookTimestamp: number; receivedAt: string;
  sourceScopeWasAuthorized: boolean; currentScopeMatches: boolean;
};

/** Pure validation only. Withdrawal signals must never initiate source work. */
export function verifyLinearEvent(rawBody: string | Uint8Array, headers: Headers, secret: string,
  authority: Authority, nowMs: number): NormalizedWebhookEvent | ReturnType<typeof ignored> {
  const bytes = rawBytes(rawBody);
  const unique = uniqueHeaders(headers);
  verifySignature(bytes, unique.get("linear-signature"), secret);
  const providerDeliveryId = validated(z.uuid({ version: "v4" }), unique.get("linear-delivery"), "webhook_delivery_invalid");
  const envelope = parseEnvelope(bytes);
  checkClock(envelope, nowMs);
  checkEnvelopeHeaders(envelope, unique);
  const scope = validated(authoritySchema, authority, "webhook_authority_invalid");
  const filtered = envelopeFilter(envelope, scope);
  if (filtered) return filtered;
  const { decision, facts, sourceScopeWasAuthorized, currentScopeMatches } = classifyIssue(envelope, scope);
  if (decision.classification === "ignored") return decision;
  return { ...facts, ...decision, providerDeliveryId, rawBodySha256: sha256(bytes),
    sourceEventId: sha256(JSON.stringify(facts)), webhookTimestamp: envelope.webhookTimestamp,
    receivedAt: new Date(nowMs).toISOString(), sourceScopeWasAuthorized, currentScopeMatches };
}
