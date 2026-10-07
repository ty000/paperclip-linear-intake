import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { INTAKE_DATABASE_NAMESPACE } from "./intake-state.js";
import { assertImport, importBound, importJson, planContent, validateEffectKey, validateImportCode,
  type ImportCandidate, type ImportCompletion, type ImportEffect, type ImportEffectInput, type ImportEffectRef,
  type StoredImportPlan, type ImportPlanInput, type ImportPlanRef } from "./import-state.js";

const plans = `${INTAKE_DATABASE_NAMESPACE}.import_plans`;
const effects = `${INTAKE_DATABASE_NAMESPACE}.import_effects`;
const links = `${INTAKE_DATABASE_NAMESPACE}.import_plan_effects`;
const bindings = `${INTAKE_DATABASE_NAMESPACE}.intake_binding`;
const requests = `${INTAKE_DATABASE_NAMESPACE}.intake_requests`;
const deliveries = `${INTAKE_DATABASE_NAMESPACE}.intake_deliveries`;
const planColumns = `company_id AS "companyId", intake_id AS "intakeId", activation_id AS "activationId",
  fingerprint, request_version AS "requestVersion", source_sha256 AS "sourceSha256", plan_sha256 AS "planSha256",
  plan, effect_keys AS "expectedEffectKeys", state, version, readiness, readiness_sha256 AS "readinessSha256", error_code AS "errorCode"`;
const effectColumns = `e.company_id AS "companyId", e.effect_key AS "effectKey", e.kind, e.intent,
  e.intent_sha256 AS "intentSha256", e.state, e.dispatch_count AS "dispatchCount", e.dispatch_owner AS "dispatchOwner",
  e.result, e.result_sha256 AS "resultSha256", e.error_code AS "errorCode"`;
const noPendingEvent = `NOT EXISTS (SELECT 1 FROM ${deliveries} d WHERE d.company_id = r.company_id
  AND d.activation_id = r.activation_id AND d.applied = false
  AND d.normalized_event ->> 'issueId' = r.issue_id::text
  AND d.normalized_event ->> 'organizationId' = r.organization_id::text)`;

type SqlGuard = { company: string; intake: string; activation: string; fingerprint: string; version: string; source: string };
function sourceGuard(values: SqlGuard): string {
  return `EXISTS (SELECT 1 FROM ${bindings} b JOIN ${requests} r ON r.company_id = b.company_id
    WHERE b.singleton = true AND b.active = true AND b.company_id = ${values.company}
    AND b.activation_id = ${values.activation} AND b.fingerprint = ${values.fingerprint}
    AND r.intake_id = ${values.intake} AND r.activation_id = ${values.activation} AND r.accepted = true
    AND r.status = 'source_observed' AND r.version = ${values.version} AND r.snapshot_sha256 = ${values.source}
    AND ${noPendingEvent})`;
}
const planGuard = sourceGuard({ company: "p.company_id", intake: "p.intake_id", activation: "p.activation_id",
  fingerprint: "p.fingerprint", version: "p.request_version", source: "p.source_sha256" });
const inputGuard = sourceGuard({ company: "$1", intake: "$2", activation: "$3", fingerprint: "$4", version: "$5", source: "$6" });
const associatedPlan = `EXISTS (SELECT 1 FROM ${plans} p JOIN ${links} l
  ON l.company_id = p.company_id AND l.intake_id = p.intake_id
  WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3 AND l.effect_key = $4)`;
const dispatchPlan = `EXISTS (SELECT 1 FROM ${plans} p JOIN ${links} l
  ON l.company_id = p.company_id AND l.intake_id = p.intake_id
  WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3 AND l.effect_key = $4
  AND p.state = 'preparing' AND ${planGuard})`;
const allEffectsObserved = `NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.effect_keys) expected(effect_key)
  WHERE NOT EXISTS (SELECT 1 FROM ${links} l JOIN ${effects} e ON e.company_id = l.company_id AND e.effect_key = l.effect_key
    WHERE l.company_id = p.company_id AND l.intake_id = p.intake_id
    AND l.effect_key = expected.effect_key AND e.state = 'observed'))`;

function planParameters(input: ImportPlanInput, encoded: string, keys: string): unknown[] {
  return [input.companyId, input.intakeId, input.activationId, input.fingerprint, input.requestVersion,
    input.sourceSha256, input.planSha256, encoded, keys];
}
function effectParameters(input: ImportEffectRef): unknown[] {
  return [input.companyId, input.intakeId, input.planSha256, input.effectKey, input.intentSha256];
}
function requirePlan(row: StoredImportPlan | undefined): StoredImportPlan {
  assertImport(row !== undefined, "import_plan_missing_or_inactive");
  return row!;
}
function requireEffect(row: ImportEffect | undefined): ImportEffect {
  assertImport(row !== undefined, "import_effect_missing_or_inactive");
  return row!;
}
function samePlan(row: StoredImportPlan, input: ImportPlanInput): void {
  assertImport(row.planSha256 === input.planSha256, "import_plan_conflict");
  assertImport(row.activationId === input.activationId, "import_plan_conflict");
  assertImport(row.fingerprint === input.fingerprint, "import_plan_conflict");
  assertImport(row.requestVersion === input.requestVersion, "import_plan_conflict");
  assertImport(row.sourceSha256 === input.sourceSha256, "import_plan_conflict");
  assertImport(contentDigest(row.expectedEffectKeys) === contentDigest(input.expectedEffectKeys), "import_plan_conflict");
}
function sameIntent(row: ImportEffect, input: ImportEffectInput): void {
  assertImport(row.intentSha256 === input.intentSha256, "import_intent_conflict");
  assertImport(row.kind === input.kind, "import_intent_conflict");
}
function readinessContent(input: ImportCompletion): { encoded: string | null; hash: string | null } {
  if (input.state === "prepared") {
    assertImport(input.readiness !== undefined, "import_readiness_missing");
    return importJson(input.readiness!);
  }
  assertImport(input.readiness === undefined, "import_unexpected_readiness");
  return { encoded: null, hash: null };
}
function completionMatches(row: StoredImportPlan, state: string, hash: string | null, errorCode: string | null): boolean {
  return row.state === state && row.readinessSha256 === hash && row.errorCode === errorCode;
}

class ImportStore {
  constructor(private readonly db: PluginDatabaseClient) {
    assertImport(db.namespace === INTAKE_DATABASE_NAMESPACE, "import_namespace_mismatch");
  }

  async getPlan(companyId: string, intakeId: string): Promise<StoredImportPlan | undefined> {
    const [row] = await this.db.query<StoredImportPlan>(`SELECT ${planColumns} FROM ${plans}
      WHERE company_id = $1 AND intake_id = $2`, [companyId, intakeId]);
    return row;
  }

  async isCurrentCandidate(input: Omit<ImportCandidate, "snapshot">): Promise<boolean> {
    const [row] = await this.db.query<{ current: boolean }>(`SELECT ${inputGuard} AS current`,
    [input.companyId, input.intakeId, input.activationId, input.fingerprint, input.requestVersion, input.sourceSha256]);
    return row?.current === true;
  }

  async ensurePlan(input: ImportPlanInput): Promise<StoredImportPlan> {
    const content = planContent(input);
    await this.db.execute(`INSERT INTO ${plans} (company_id, intake_id, activation_id, fingerprint, request_version,
      source_sha256, plan_sha256, plan, effect_keys, state)
      SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'preparing' WHERE ${inputGuard}
      ON CONFLICT (company_id, intake_id) DO NOTHING`, planParameters(input, content.encoded, content.keys));
    const observed = requirePlan(await this.getPlan(input.companyId, input.intakeId));
    samePlan(observed, input);
    return observed;
  }

  async listCandidates(companyId: string, activationId: string, limit = 5): Promise<ImportCandidate[]> {
    return this.db.query<ImportCandidate>(`SELECT r.company_id AS "companyId", r.intake_id AS "intakeId",
      r.activation_id AS "activationId", b.fingerprint, r.version AS "requestVersion",
      r.snapshot_sha256 AS "sourceSha256", r.snapshot FROM ${requests} r
      JOIN ${bindings} b ON b.company_id = r.company_id
      LEFT JOIN ${plans} p ON p.company_id = r.company_id AND p.intake_id = r.intake_id
      WHERE r.company_id = $1 AND r.activation_id = $2 AND b.activation_id = $2 AND b.active = true
      AND r.accepted = true AND r.status = 'source_observed' AND ${noPendingEvent}
      AND (p.intake_id IS NULL OR (p.state = 'preparing' AND p.activation_id = $2
        AND p.fingerprint = b.fingerprint AND p.request_version = r.version AND p.source_sha256 = r.snapshot_sha256))
      AND NOT EXISTS (SELECT 1 FROM ${links} pending_link JOIN ${effects} pending_effect
        ON pending_effect.company_id = pending_link.company_id AND pending_effect.effect_key = pending_link.effect_key
        WHERE pending_link.company_id = r.company_id AND pending_link.intake_id = r.intake_id
        AND pending_effect.state IN ('dispatched', 'outcome_unknown'))
      ORDER BY r.accepted_at, r.intake_id LIMIT $3`, [companyId, activationId, importBound(limit, 20)]);
  }

  async blockCandidate(input: ImportCandidate, errorCode: string): Promise<boolean> {
    validateImportCode(errorCode);
    const result = await this.db.execute(`UPDATE ${requests} r SET status = 'blocked', error_code = $7, version = version + 1
      WHERE r.company_id = $1 AND r.intake_id = $2 AND r.activation_id = $3
      AND r.version = $5 AND r.snapshot_sha256 = $6 AND r.status = 'source_observed' AND ${inputGuard}
      AND NOT EXISTS (SELECT 1 FROM ${plans} p WHERE p.company_id = $1 AND p.intake_id = $2)`,
    [input.companyId, input.intakeId, input.activationId, input.fingerprint, input.requestVersion, input.sourceSha256, errorCode]);
    return result.rowCount === 1;
  }

  async getEffect(companyId: string, effectKey: string): Promise<ImportEffect | undefined> {
    const [row] = await this.db.query<ImportEffect>(`SELECT ${effectColumns} FROM ${effects} e
      WHERE e.company_id = $1 AND e.effect_key = $2`, [companyId, effectKey]);
    return row;
  }

  async ensureEffect(input: ImportEffectInput): Promise<ImportEffect> {
    validateEffectKey(input.effectKey);
    assertImport(/^[a-z_]{1,40}$/.test(input.kind), "import_invalid_effect_kind");
    const intent = importJson(input.intent);
    assertImport(intent.hash === input.intentSha256, "import_intent_hash_mismatch");
    await this.db.execute(`INSERT INTO ${effects} (company_id, effect_key, kind, intent, intent_sha256, state)
      SELECT $1, $4, $6, $7::jsonb, $5, 'intended' WHERE EXISTS (SELECT 1 FROM ${plans} p
        WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3
        AND p.state = 'preparing' AND p.effect_keys ? $4 AND ${planGuard})
      ON CONFLICT (company_id, effect_key) DO NOTHING`, [...effectParameters(input), input.kind, intent.encoded]);
    const observed = requireEffect(await this.getEffect(input.companyId, input.effectKey));
    sameIntent(observed, input);
    await this.associateEffect(input);
    return observed;
  }

  private async associateEffect(input: ImportEffectRef): Promise<void> {
    await this.db.execute(`INSERT INTO ${links} (company_id, intake_id, effect_key)
      SELECT $1, $2, $4 WHERE EXISTS (SELECT 1 FROM ${plans} p
        WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3
        AND p.state = 'preparing' AND p.effect_keys ? $4 AND ${planGuard})
      AND EXISTS (SELECT 1 FROM ${effects} e WHERE e.company_id = $1 AND e.effect_key = $4 AND e.intent_sha256 = $5)
      ON CONFLICT (company_id, intake_id, effect_key) DO NOTHING`, effectParameters(input));
    await this.verifyAssociation(input);
  }

  private async verifyAssociation(input: ImportEffectRef): Promise<void> {
    const [row] = await this.db.query<{ present: boolean }>(`SELECT ${associatedPlan} AS present`, effectParameters(input).slice(0, 4));
    assertImport(row?.present === true, "import_effect_not_associated");
  }

  async listEffects(input: ImportPlanRef): Promise<ImportEffect[]> {
    return this.db.query<ImportEffect>(`SELECT ${effectColumns} FROM ${effects} e JOIN ${links} l
      ON l.company_id = e.company_id AND l.effect_key = e.effect_key
      JOIN ${plans} p ON p.company_id = l.company_id AND p.intake_id = l.intake_id
      WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3 ORDER BY e.effect_key LIMIT 500`,
    [input.companyId, input.intakeId, input.planSha256]);
  }

  async claimDispatch(input: ImportEffectRef & { owner: string }): Promise<boolean> {
    assertImport(/^[A-Za-z0-9_-]{1,100}$/.test(input.owner), "import_invalid_dispatch_owner");
    const result = await this.db.execute(`UPDATE ${effects} e SET state = 'dispatched', dispatch_count = 1, dispatch_owner = $6
      WHERE e.company_id = $1 AND e.effect_key = $4 AND e.intent_sha256 = $5
      AND e.state = 'intended' AND e.dispatch_count = 0 AND ${dispatchPlan}`, [...effectParameters(input), input.owner]);
    return result.rowCount === 1;
  }

  async observeEffect(input: ImportEffectRef & { result: Record<string, unknown> }): Promise<ImportEffect> {
    const result = importJson(input.result);
    await this.verifyAssociation(input);
    await this.db.execute(`UPDATE ${effects} e SET state = 'observed', result = $6::jsonb, result_sha256 = $7, error_code = NULL
      WHERE e.company_id = $1 AND e.effect_key = $4 AND e.intent_sha256 = $5
      AND e.state IN ('intended', 'dispatched', 'outcome_unknown') AND ${associatedPlan}`,
    [...effectParameters(input), result.encoded, result.hash]);
    const observed = requireEffect(await this.getEffect(input.companyId, input.effectKey));
    assertImport(observed.intentSha256 === input.intentSha256, "import_intent_conflict");
    assertImport(observed.state === "observed", "import_effect_not_observed");
    assertImport(observed.resultSha256 === result.hash, "import_observation_conflict");
    return observed;
  }

  async markUnknown(input: ImportEffectRef & { errorCode: string }): Promise<ImportEffect> {
    validateImportCode(input.errorCode);
    await this.verifyAssociation(input);
    await this.db.execute(`UPDATE ${effects} e SET state = 'outcome_unknown', error_code = $6
      WHERE e.company_id = $1 AND e.effect_key = $4 AND e.intent_sha256 = $5
      AND e.state IN ('intended', 'dispatched') AND ${associatedPlan}`, [...effectParameters(input), input.errorCode]);
    const observed = requireEffect(await this.getEffect(input.companyId, input.effectKey));
    assertImport(observed.intentSha256 === input.intentSha256, "import_intent_conflict");
    assertImport(observed.state !== "intended", "import_unknown_not_recorded");
    assertImport(observed.state !== "dispatched", "import_unknown_not_recorded");
    return observed;
  }

  async resumePlan(input: ImportPlanRef): Promise<boolean> {
    const result = await this.db.execute(`UPDATE ${plans} p SET state = 'preparing', error_code = NULL, version = version + 1
      WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3 AND p.state = 'outcome_unknown'
      AND ${planGuard} AND NOT EXISTS (SELECT 1 FROM ${links} l JOIN ${effects} e
        ON e.company_id = l.company_id AND e.effect_key = l.effect_key
        WHERE l.company_id = p.company_id AND l.intake_id = p.intake_id AND e.state IN ('dispatched', 'outcome_unknown'))`,
    [input.companyId, input.intakeId, input.planSha256]);
    return result.rowCount === 1;
  }

  async finishPlan(input: ImportCompletion): Promise<boolean> {
    validateImportCode(input.errorCode);
    const readiness = readinessContent(input), errorCode = input.errorCode ?? null;
    await this.db.execute(`UPDATE ${plans} p SET state = $4, readiness = $5::jsonb, readiness_sha256 = $6,
      error_code = $7, version = version + 1
      WHERE p.company_id = $1 AND p.intake_id = $2 AND p.plan_sha256 = $3
      AND p.state IN ('preparing', 'outcome_unknown') AND ${planGuard}
      AND (p.state IS DISTINCT FROM $4 OR p.readiness_sha256 IS DISTINCT FROM $6 OR p.error_code IS DISTINCT FROM $7)
      AND ($4 <> 'prepared' OR ${allEffectsObserved})`,
    [input.companyId, input.intakeId, input.planSha256, input.state, readiness.encoded, readiness.hash, errorCode]);
    const observed = requirePlan(await this.getPlan(input.companyId, input.intakeId));
    assertImport(observed.planSha256 === input.planSha256, "import_plan_conflict");
    return completionMatches(observed, input.state, readiness.hash, errorCode);
  }
}

export function createImportStore(db: PluginDatabaseClient) { return new ImportStore(db); }
