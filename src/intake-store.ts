import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import type { NormalizedWebhookEvent, WebhookAuthority } from "./webhook-event.js";
import { INTAKE_DATABASE_NAMESPACE, IntakeStoreError, projectEvent, validateSnapshot,
  type IntakeBinding, type IntakeRequest } from "./intake-state.js";

const bindings = `${INTAKE_DATABASE_NAMESPACE}.intake_binding`;
const deliveries = `${INTAKE_DATABASE_NAMESPACE}.intake_deliveries`;
const requests = `${INTAKE_DATABASE_NAMESPACE}.intake_requests`;
const bindingColumns = `company_id AS "companyId", activation_id AS "activationId", activated_at AS "activatedAt",
  fingerprint, authority, active, version`;
const requestColumns = `company_id AS "companyId", organization_id AS "organizationId", issue_id AS "issueId",
  intake_id AS "intakeId", activation_id AS "activationId", accepted, status, version, revision, event_at AS "eventAt",
  classification, delivery_id AS "deliveryId", accepted_at AS "acceptedAt", attempts, lease_owner AS "leaseOwner",
  lease_until AS "leaseUntil", snapshot, snapshot_sha256 AS "snapshotSha256", error_code AS "errorCode"`;
const activeBinding = `EXISTS (SELECT 1 FROM ${bindings} b WHERE b.singleton = true AND b.company_id = $1
  AND b.activation_id = $2 AND b.active = true)`;
const noPendingEvent = `NOT EXISTS (SELECT 1 FROM ${deliveries} d WHERE d.company_id = $1
  AND d.activation_id = $2 AND d.applied = false
  AND d.normalized_event ->> 'issueId' = r.issue_id::text
  AND d.normalized_event ->> 'organizationId' = r.organization_id::text)`;

type Activation = {
  companyId: string; activationId: string; activatedAt: string; fingerprint: string; authority: WebhookAuthority;
};
type Claim = {
  companyId: string; intakeId: string; activationId: string; fingerprint: string;
  owner: string; now: string; leaseMs: number; maxAttempts: number;
};
type Completion = Omit<Claim, "leaseMs" | "maxAttempts"> & {
  revision: number; status: "source_observed" | "withdrawn" | "blocked";
  snapshot?: Record<string, unknown>; snapshotSha256?: string; errorCode?: string;
};
type Delivery = { activationId: string; rawBodySha256: string; event: NormalizedWebhookEvent; applied: boolean };

function iso(value: string): string { return new Date(value).toISOString(); }
function requestDates(row: IntakeRequest): IntakeRequest {
  return { ...row, revision: iso(row.revision), eventAt: iso(row.eventAt),
    acceptedAt: row.acceptedAt === null ? null : iso(row.acceptedAt),
    leaseUntil: row.leaseUntil === null ? null : iso(row.leaseUntil) };
}
function bound(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new IntakeStoreError("intake_invalid_bound");
  return value;
}

function boundCompany(row: IntakeBinding | undefined, companyId: string): IntakeBinding {
  if (!row) throw new IntakeStoreError("intake_company_already_bound");
  if (row.companyId !== companyId) throw new IntakeStoreError("intake_company_already_bound");
  return row;
}

function repeatedActivation(row: IntakeBinding, fingerprint: string): IntakeBinding {
  if (row.fingerprint !== fingerprint) throw new IntakeStoreError("intake_deactivation_required");
  return row;
}

function activationReceipt(row: IntakeBinding | undefined, input: Activation): IntakeBinding {
  const observed = boundCompany(row, input.companyId);
  if (!observed.active || observed.activationId !== input.activationId || observed.fingerprint !== input.fingerprint) {
    throw new IntakeStoreError("intake_activation_conflict");
  }
  return observed;
}

function visibleRequest(row: IntakeRequest | undefined): IntakeRequest | undefined {
  return row?.accepted ? row : undefined;
}

function validateClaim(input: Claim): string {
  bound(input.maxAttempts, 10);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.owner)) throw new IntakeStoreError("intake_invalid_lease_owner");
  return new Date(Date.parse(iso(input.now)) + bound(input.leaseMs, 600_000)).toISOString();
}

function ownsLease(row: IntakeRequest, owner: string, until: string): boolean {
  return row.status === "fetching" && row.leaseOwner === owner && row.leaseUntil === until;
}

function validateSourceCompletion(input: Completion, row: IntakeRequest): void {
  if (!input.snapshot || !input.snapshotSha256) throw new IntakeStoreError("intake_invalid_snapshot");
  validateSnapshot(input.snapshot, input.snapshotSha256, row);
}

function validateCompletion(input: Completion, row: IntakeRequest): void {
  if (input.status === "source_observed") validateSourceCompletion(input, row);
  else if (input.snapshot !== undefined || input.snapshotSha256 !== undefined) throw new IntakeStoreError("intake_invalid_snapshot");
}

function validateErrorCode(code: string | undefined): void {
  if (code === undefined) return;
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(code)) throw new IntakeStoreError("intake_invalid_error_code");
}

function optionalJson(value: Record<string, unknown> | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

class IntakeStore {
  constructor(private readonly db: PluginDatabaseClient) {
    if (db.namespace !== INTAKE_DATABASE_NAMESPACE) throw new IntakeStoreError("intake_namespace_mismatch");
  }

  async getBinding(companyId?: string): Promise<IntakeBinding | undefined> {
    const [row] = await this.db.query<IntakeBinding>(`SELECT ${bindingColumns} FROM ${bindings}
      WHERE singleton = true${companyId === undefined ? "" : " AND company_id = $1"}`, companyId === undefined ? [] : [companyId]);
    return row && { ...row, activatedAt: iso(row.activatedAt) };
  }

  async activateBinding(input: Activation): Promise<IntakeBinding> {
    if (iso(input.activatedAt) !== input.authority.activationAt) throw new IntakeStoreError("intake_activation_boundary_mismatch");
    await this.db.execute(`INSERT INTO ${bindings}
      (singleton, company_id, activation_id, activated_at, fingerprint, authority, active, version)
      VALUES (true, $1, $2, $3, $4, $5::jsonb, true, 1) ON CONFLICT (singleton) DO NOTHING`,
    [input.companyId, input.activationId, input.activatedAt, input.fingerprint, JSON.stringify(input.authority)]);
    const current = boundCompany(await this.getBinding(), input.companyId);
    if (current.active) return repeatedActivation(current, input.fingerprint);
    return this.reactivateBinding(input, current);
  }

  private async reactivateBinding(input: Activation, current: IntakeBinding): Promise<IntakeBinding> {
    if (current.activationId === input.activationId) throw new IntakeStoreError("intake_activation_identity_retired");
    await this.db.execute(`UPDATE ${bindings} SET activation_id = $2, activated_at = $3, fingerprint = $4,
      authority = $5::jsonb, active = true, version = version + 1
      WHERE singleton = true AND company_id = $1 AND active = false AND version = $6`,
    [input.companyId, input.activationId, input.activatedAt, input.fingerprint, JSON.stringify(input.authority), current.version]);
    return activationReceipt(await this.getBinding(input.companyId), input);
  }

  async deactivateBinding(companyId: string, activationId: string): Promise<IntakeBinding> {
    await this.db.execute(`UPDATE ${bindings} SET active = false, version = version + 1
      WHERE singleton = true AND company_id = $1 AND activation_id = $2 AND active = true`, [companyId, activationId]);
    const observed = await this.getBinding(companyId);
    if (!observed || observed.activationId !== activationId || observed.active) throw new IntakeStoreError("intake_deactivation_conflict");
    return observed;
  }

  private async requireActive(companyId: string, activationId: string): Promise<IntakeBinding> {
    const binding = await this.getBinding(companyId);
    if (!binding?.active || binding.activationId !== activationId) throw new IntakeStoreError("intake_binding_inactive");
    return binding;
  }

  private async delivery(companyId: string, deliveryId: string): Promise<Delivery | undefined> {
    const [row] = await this.db.query<Delivery>(`SELECT activation_id AS "activationId", raw_body_sha256 AS "rawBodySha256",
      normalized_event AS event, applied FROM ${deliveries} WHERE company_id = $1 AND provider_delivery_id = $2`, [companyId, deliveryId]);
    return row;
  }

  async retainDelivery(companyId: string, activationId: string, event: NormalizedWebhookEvent): Promise<IntakeRequest | undefined> {
    await this.db.execute(`INSERT INTO ${deliveries}
      (company_id, activation_id, provider_delivery_id, raw_body_sha256, source_event_id, normalized_event, received_at)
      SELECT $1, $2, $3, $4, $5, $6::jsonb, $7 WHERE ${activeBinding}
      ON CONFLICT (company_id, provider_delivery_id) DO NOTHING`,
    [companyId, activationId, event.providerDeliveryId, event.rawBodySha256, event.sourceEventId, JSON.stringify(event), event.receivedAt]);
    const saved = await this.delivery(companyId, event.providerDeliveryId);
    if (!saved) throw new IntakeStoreError("intake_binding_inactive");
    if (saved.rawBodySha256 !== event.rawBodySha256) throw new IntakeStoreError("intake_delivery_collision");
    if (saved.activationId !== activationId) throw new IntakeStoreError("intake_delivery_activation_mismatch");
    return this.applyDelivery(companyId, event.providerDeliveryId);
  }

  private async issueRequest(companyId: string, organizationId: string, issueId: string): Promise<IntakeRequest | undefined> {
    const [row] = await this.db.query<IntakeRequest>(`SELECT ${requestColumns} FROM ${requests}
      WHERE company_id = $1 AND organization_id = $2 AND issue_id = $3`, [companyId, organizationId, issueId]);
    return row && requestDates(row);
  }

  async getRequest(companyId: string, intakeId: string): Promise<IntakeRequest | undefined> {
    const [row] = await this.db.query<IntakeRequest>(`SELECT ${requestColumns} FROM ${requests}
      WHERE company_id = $1 AND intake_id = $2 AND accepted = true`, [companyId, intakeId]);
    return row && requestDates(row);
  }

  private async writeProjection(row: IntakeRequest, prior: IntakeRequest | undefined, activationId: string): Promise<number> {
    const values = [row.companyId, row.activationId, row.organizationId, row.issueId, row.intakeId, row.accepted,
      row.status, row.version, row.revision, row.eventAt, row.classification, row.deliveryId, row.acceptedAt, row.attempts, activationId];
    const currentActivation = activeBinding.replace("b.activation_id = $2", "b.activation_id = $15");
    const result = prior
      ? await this.db.execute(`UPDATE ${requests} SET activation_id = $2, accepted = $6, status = $7, version = $8,
          revision = $9, event_at = $10, classification = $11, delivery_id = $12, accepted_at = $13,
          lease_owner = NULL, lease_until = NULL, snapshot = $17::jsonb, snapshot_sha256 = $18, error_code = $19
          WHERE company_id = $1 AND organization_id = $3 AND issue_id = $4 AND intake_id = $5 AND attempts = $14
          AND version = $16 AND ${currentActivation}`,
        [...values, prior.version, row.snapshot ? JSON.stringify(row.snapshot) : null, row.snapshotSha256, row.errorCode])
      : await this.db.execute(`INSERT INTO ${requests} (company_id, activation_id, organization_id, issue_id, intake_id,
          accepted, status, version, revision, event_at, classification, delivery_id, accepted_at, attempts)
          SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14 WHERE ${currentActivation}
          ON CONFLICT (company_id, organization_id, issue_id) DO NOTHING`, values);
    return result.rowCount;
  }

  private async applyDelivery(companyId: string, deliveryId: string): Promise<IntakeRequest | undefined> {
    const saved = await this.requiredDelivery(companyId, deliveryId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const prior = await this.issueRequest(companyId, saved.event.organizationId, saved.event.issueId);
      if (saved.applied) return visibleRequest(prior);
      await this.requireActive(companyId, saved.activationId);
      if (!await this.projectDelivery(companyId, saved, prior)) continue;
      await this.acknowledgeProjection(companyId, saved.activationId, deliveryId);
      return visibleRequest(await this.issueRequest(companyId, saved.event.organizationId, saved.event.issueId));
    }
    throw new IntakeStoreError("intake_projection_contended");
  }

  private async requiredDelivery(companyId: string, deliveryId: string): Promise<Delivery> {
    const saved = await this.delivery(companyId, deliveryId);
    if (!saved) throw new IntakeStoreError("intake_delivery_missing");
    return saved;
  }

  private async projectDelivery(companyId: string, saved: Delivery, prior: IntakeRequest | undefined): Promise<boolean> {
    const next = projectEvent(companyId, saved.activationId, saved.event, prior);
    if (!next) return true;
    return await this.writeProjection(next, prior, saved.activationId) !== 0;
  }

  private async acknowledgeProjection(companyId: string, activationId: string, deliveryId: string): Promise<void> {
    await this.db.execute(`UPDATE ${deliveries} SET applied = true
      WHERE company_id = $1 AND activation_id = $2 AND provider_delivery_id = $3 AND ${activeBinding}`,
    [companyId, activationId, deliveryId]);
    const receipt = await this.delivery(companyId, deliveryId);
    if (!receipt?.applied) throw new IntakeStoreError("intake_binding_inactive");
  }

  async replayPending(companyId: string, activationId: string, limit = 20): Promise<number> {
    await this.requireActive(companyId, activationId);
    const pending = await this.db.query<{ id: string }>(`SELECT provider_delivery_id AS id FROM ${deliveries}
      WHERE company_id = $1 AND activation_id = $2 AND applied = false ORDER BY received_at, provider_delivery_id LIMIT $3`,
    [companyId, activationId, bound(limit, 100)]);
    for (const row of pending) await this.applyDelivery(companyId, row.id);
    return pending.length;
  }

  async listRequests(companyId: string, limit = 20): Promise<IntakeRequest[]> {
    const rows = await this.db.query<IntakeRequest>(`SELECT ${requestColumns} FROM ${requests}
      WHERE company_id = $1 AND accepted = true ORDER BY accepted_at, intake_id LIMIT $2`, [companyId, bound(limit, 100)]);
    return rows.map(requestDates);
  }

  async listPendingRequests(companyId: string, activationId: string, now: string, limit = 20): Promise<IntakeRequest[]> {
    const rows = await this.db.query<IntakeRequest>(`SELECT ${requestColumns} FROM ${requests} r
      WHERE company_id = $1 AND activation_id = $2 AND accepted = true
      AND (status = 'received' OR (status = 'fetching' AND lease_until <= $3)) AND ${activeBinding} AND ${noPendingEvent}
      ORDER BY accepted_at, intake_id LIMIT $4`, [companyId, activationId, iso(now), bound(limit, 100)]);
    return rows.map(requestDates);
  }

  async claimRequest(input: Claim): Promise<IntakeRequest | undefined> {
    const until = validateClaim(input);
    const result = await this.db.execute(`UPDATE ${requests} r SET
      status = CASE WHEN attempts < $8 THEN 'fetching' ELSE 'blocked' END,
      lease_owner = CASE WHEN attempts < $8 THEN $6 ELSE NULL END,
      lease_until = CASE WHEN attempts < $8 THEN $7::timestamptz ELSE NULL END,
      error_code = CASE WHEN attempts < $8 THEN NULL ELSE 'source_attempt_limit' END,
      attempts = CASE WHEN attempts < $8 THEN attempts + 1 ELSE attempts END, version = version + 1
      WHERE company_id = $1 AND activation_id = $2 AND intake_id = $3 AND accepted = true
      AND (status = 'received' OR (status = 'fetching' AND lease_until <= $5)) AND ${noPendingEvent}
      AND EXISTS (SELECT 1 FROM ${bindings} b WHERE b.singleton = true AND b.company_id = $1
        AND b.activation_id = $2 AND b.fingerprint = $4 AND b.active = true)`,
    [input.companyId, input.activationId, input.intakeId, input.fingerprint, iso(input.now), input.owner, until, input.maxAttempts]);
    if (result.rowCount === 0) return undefined;
    const row = await this.getRequest(input.companyId, input.intakeId);
    if (!row) return undefined;
    return ownsLease(row, input.owner, until) ? row : undefined;
  }

  async finishRequest(input: Completion): Promise<boolean> {
    const row = await this.getRequest(input.companyId, input.intakeId);
    if (!row) return false;
    validateCompletion(input, row);
    validateErrorCode(input.errorCode);
    const result = await this.persistCompletion(input);
    if (result.rowCount === 0) return false;
    return this.completionReceipt(input);
  }

  private async persistCompletion(input: Completion): Promise<{ rowCount: number }> {
    return this.db.execute(`UPDATE ${requests} r SET status = $8, snapshot = $9::jsonb,
      snapshot_sha256 = $10, error_code = $11, lease_owner = NULL, lease_until = NULL, version = version + 1
      WHERE company_id = $1 AND activation_id = $2 AND intake_id = $3 AND version = $7
      AND status = 'fetching' AND lease_owner = $5 AND lease_until > $6 AND ${noPendingEvent}
      AND EXISTS (SELECT 1 FROM ${bindings} b WHERE b.singleton = true AND b.company_id = $1
        AND b.activation_id = $2 AND b.fingerprint = $4 AND b.active = true)`,
    [input.companyId, input.activationId, input.intakeId, input.fingerprint, input.owner, iso(input.now), input.revision,
      input.status, optionalJson(input.snapshot), input.snapshotSha256 ?? null, input.errorCode ?? null]);
  }

  private async completionReceipt(input: Completion): Promise<boolean> {
    const observed = await this.getRequest(input.companyId, input.intakeId);
    if (!observed) return false;
    return observed.version === input.revision + 1 && observed.status === input.status;
  }
}

export function createIntakeStore(db: PluginDatabaseClient) { return new IntakeStore(db); }
