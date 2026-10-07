import { createHash } from "node:crypto";
import type { NormalizedWebhookEvent, WebhookAuthority } from "./webhook-event.js";
import { contentDigest } from "./content-digest.js";

export const INTAKE_DATABASE_NAMESPACE = "plugin_linear_intake_e8c339297d";

export type IntakeBinding = {
  companyId: string; activationId: string; activatedAt: string; fingerprint: string;
  authority: WebhookAuthority; active: boolean; version: number;
};

export type IntakeStatus = "received" | "fetching" | "source_observed" | "withdrawn" | "blocked";
export type IntakeRequest = {
  companyId: string; organizationId: string; issueId: string; intakeId: string;
  activationId: string; accepted: boolean; status: IntakeStatus; version: number;
  revision: string; eventAt: string; classification: NormalizedWebhookEvent["classification"];
  deliveryId: string; acceptedAt: string | null; attempts: number;
  leaseOwner: string | null; leaseUntil: string | null;
  snapshot: Record<string, unknown> | null; snapshotSha256: string | null; errorCode: string | null;
};

export class IntakeStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = "IntakeStoreError"; }
}

export function intakeIdentity(companyId: string, organizationId: string, issueId: string): string {
  return `linear-intake-${createHash("sha256").update(JSON.stringify([companyId, organizationId, issueId])).digest("hex")}`;
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new IntakeStoreError("intake_invalid_timestamp");
  return result;
}

function newer(event: NormalizedWebhookEvent, prior: IntakeRequest): boolean {
  const revision = timestamp(event.revision) - timestamp(prior.revision);
  if (revision !== 0) return revision > 0;
  // A withdrawal at a shared source revision is always the safer observation,
  // even if the two delivery timestamps disagree.
  if (event.classification !== prior.classification) return event.classification === "withdrawal";
  return timestamp(event.eventAt) > timestamp(prior.eventAt);
}

const terminalStatuses = new Set<IntakeStatus>(["source_observed", "blocked"]);

function nextStatus(prior: IntakeRequest, event: NormalizedWebhookEvent): IntakeStatus {
  if (event.classification === "withdrawal") return "withdrawn";
  if (!prior.accepted) return "received";
  // A new Todo entry proves an intervening withdrawal. Terminal results are
  // historical evidence and cannot authorize another source attempt.
  return terminalStatuses.has(prior.status) ? prior.status : "withdrawn";
}

function initialRequest(companyId: string, activationId: string, event: NormalizedWebhookEvent): IntakeRequest {
  return {
    companyId, organizationId: event.organizationId, issueId: event.issueId,
    intakeId: intakeIdentity(companyId, event.organizationId, event.issueId),
    activationId, accepted: false, status: "withdrawn", version: 0,
    revision: event.revision, eventAt: event.eventAt, classification: event.classification,
    deliveryId: event.providerDeliveryId, acceptedAt: null, attempts: 0, leaseOwner: null, leaseUntil: null,
    snapshot: null, snapshotSha256: null, errorCode: null,
  };
}

function acceptance(prior: IntakeRequest, activationId: string, event: NormalizedWebhookEvent) {
  if (prior.accepted) return { accepted: true, acceptedAt: prior.acceptedAt, activationId: prior.activationId };
  const accepted = event.classification === "received";
  return { accepted, acceptedAt: accepted ? event.receivedAt : null, activationId };
}

export function projectEvent(companyId: string, activationId: string, event: NormalizedWebhookEvent,
  prior?: IntakeRequest): IntakeRequest | undefined {
  if (prior && !newer(event, prior)) return undefined;
  const previous = prior ?? initialRequest(companyId, activationId, event);
  return {
    ...previous, ...acceptance(previous, activationId, event), status: nextStatus(previous, event),
    version: previous.version + 1, revision: event.revision, eventAt: event.eventAt,
    classification: event.classification, deliveryId: event.providerDeliveryId, leaseOwner: null, leaseUntil: null,
  };
}

function assertSnapshot(invariant: boolean): void {
  if (!invariant) throw new IntakeStoreError("intake_invalid_snapshot");
}

export function validateSnapshot(snapshot: Record<string, unknown>, hash: string, request: IntakeRequest): void {
  const { sourceSha256, ...body } = snapshot;
  assertSnapshot(sourceSha256 === hash);
  assertSnapshot(contentDigest(body) === hash);
  assertSnapshot(snapshot.rootIssueId === request.issueId);
  assertSnapshot(snapshot.organizationId === request.organizationId);
  assertSnapshot(Buffer.byteLength(JSON.stringify(snapshot)) <= 2 * 1024 * 1024);
}
