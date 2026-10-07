import { contentDigest } from "./content-digest.js";

export type ImportPlanState = "preparing" | "prepared" | "blocked" | "outcome_unknown";
export type ImportEffectState = "intended" | "dispatched" | "observed" | "outcome_unknown";
export type ImportPlanRef = { companyId: string; intakeId: string; planSha256: string };
export type ImportPlanInput = ImportPlanRef & {
  activationId: string; fingerprint: string; requestVersion: number; sourceSha256: string;
  plan: Record<string, unknown>; expectedEffectKeys: string[];
};
export type StoredImportPlan = ImportPlanInput & {
  state: ImportPlanState; version: number; readiness: Record<string, unknown> | null;
  readinessSha256: string | null; errorCode: string | null;
};
export type ImportCandidate = {
  companyId: string; intakeId: string; activationId: string; fingerprint: string;
  requestVersion: number; sourceSha256: string; snapshot: Record<string, unknown>;
};
export type ImportEffectRef = ImportPlanRef & { effectKey: string; intentSha256: string };
export type ImportEffectInput = ImportEffectRef & { kind: string; intent: Record<string, unknown> };
export type ImportEffect = {
  companyId: string; effectKey: string; kind: string; intent: Record<string, unknown>; intentSha256: string;
  state: ImportEffectState; dispatchCount: number; dispatchOwner: string | null;
  result: Record<string, unknown> | null; resultSha256: string | null; errorCode: string | null;
};
export type ImportCompletion = ImportPlanRef & {
  state: Exclude<ImportPlanState, "preparing">; readiness?: Record<string, unknown>; errorCode?: string;
};

export class ImportStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ImportStoreError"; }
}

export function assertImport(invariant: boolean, code: string): void {
  if (!invariant) throw new ImportStoreError(code);
}

function serialize(value: Record<string, unknown>): string {
  try { return JSON.stringify(value); }
  catch { throw new ImportStoreError("import_invalid_json"); }
}

export function importJson(value: Record<string, unknown>): { encoded: string; hash: string } {
  assertImport(value !== null, "import_invalid_json");
  assertImport(typeof value === "object", "import_invalid_json");
  assertImport(!Array.isArray(value), "import_invalid_json");
  const encoded = serialize(value);
  assertImport(typeof encoded === "string", "import_invalid_json");
  assertImport(Buffer.byteLength(encoded) <= 8 * 1024 * 1024, "import_json_bound_exceeded");
  return { encoded, hash: contentDigest(JSON.parse(encoded)) };
}

export function importBound(value: number, maximum: number): number {
  assertImport(Number.isInteger(value), "import_invalid_bound");
  assertImport(value >= 1, "import_invalid_bound");
  assertImport(value <= maximum, "import_invalid_bound");
  return value;
}

export function validateEffectKey(key: string): void {
  assertImport(/^[A-Za-z0-9_.:/-]{1,300}$/.test(key), "import_invalid_effect_key");
}

function validatePlanHash(input: ImportPlanInput, fullHash: string): void {
  if (!Object.hasOwn(input.plan, "planSha256")) {
    assertImport(fullHash === input.planSha256, "import_plan_hash_mismatch");
    return;
  }
  const { planSha256, ...body } = input.plan;
  assertImport(planSha256 === input.planSha256, "import_plan_hash_mismatch");
  assertImport(contentDigest(body) === input.planSha256, "import_plan_hash_mismatch");
}

export function planContent(input: ImportPlanInput): { encoded: string; keys: string } {
  const plan = importJson(input.plan);
  validatePlanHash(input, plan.hash);
  assertImport(Array.isArray(input.expectedEffectKeys), "import_invalid_effect_keys");
  importBound(input.expectedEffectKeys.length, 500);
  input.expectedEffectKeys.forEach(validateEffectKey);
  assertImport(new Set(input.expectedEffectKeys).size === input.expectedEffectKeys.length, "import_duplicate_effect_key");
  assertImport(Array.isArray(input.plan.expectedEffectKeys), "import_effect_keys_mismatch");
  assertImport(contentDigest(input.plan.expectedEffectKeys) === contentDigest(input.expectedEffectKeys), "import_effect_keys_mismatch");
  importBound(input.requestVersion, 2_147_483_647);
  return { encoded: plan.encoded, keys: JSON.stringify(input.expectedEffectKeys) };
}

export function validateImportCode(code: string | undefined): void {
  if (code === undefined) return;
  assertImport(/^[a-z][a-z0-9_]{0,79}$/.test(code), "import_invalid_error_code");
}
