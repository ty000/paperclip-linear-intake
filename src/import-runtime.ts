import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { currentConfig, sourceGuard, activeEpoch } from "./intake-authority.js";
import { createIntakeStore } from "./intake-store.js";
import type { IntakeBinding, IntakeRequest } from "./intake-state.js";
import { readRetainedFamily } from "./intake-source.js";
import { CAMPAIGN_SOURCE_SCHEMA } from "./campaign-source.js";
import { buildImportPlan, ImportPlanError } from "./import-plan.js";
import { prepareNativeFamily } from "./import-engine.js";
import { reconcileNativeEffects } from "./import-effects.js";
import { createImportStore } from "./import-store.js";
import { assertImport, ImportStoreError, type ImportCandidate, type ImportEffect, type StoredImportPlan } from "./import-state.js";

type Store = ReturnType<typeof createImportStore>;
type Candidate = Omit<ImportCandidate, "snapshot">;

async function importConfig(ctx: PluginContext, binding: IntakeBinding) {
  const config = await currentConfig(ctx, binding);
  assertImport(config.nativeImportEnabled && config.intake !== undefined, "import_disabled");
  return config;
}

function candidateGuard(ctx: PluginContext, store: Store, binding: IntakeBinding, candidate: Candidate) {
  return async () => {
    await activeEpoch(createIntakeStore(ctx.db), binding);
    await importConfig(ctx, binding);
    assertImport(await store.isCurrentCandidate(candidate), "import_candidate_changed");
  };
}

function sourceVerifier(ctx: PluginContext, binding: IntakeBinding, request: IntakeRequest, guard: () => Promise<void>) {
  const authorize = sourceGuard(ctx, createIntakeStore(ctx.db), binding);
  return async () => {
    await guard();
    const observed = await readRetainedFamily(ctx, binding.companyId, request, async selected => {
      await authorize(selected);
      await guard();
    });
    assertImport(observed.status === "source_observed", "import_source_withdrawn");
    const expected = request.snapshot;
    if (expected?.schema === CAMPAIGN_SOURCE_SCHEMA) {
      const current = observed.family!;
      if (current.schema !== CAMPAIGN_SOURCE_SCHEMA) throw new ImportStoreError("import_source_changed");
      const expectedCampaign = expected.campaign as Record<string, unknown> | undefined;
      assertImport(current.campaign.materialSourceSha256 === expectedCampaign?.materialSourceSha256,
        "import_source_changed");
      assertImport(current.campaign.stateCompatibility.status === "compatible", "import_source_state_incompatible");
    } else {
      assertImport(observed.family!.sourceSha256 === request.snapshotSha256, "import_source_changed");
    }
    await guard();
  };
}

async function validPlan(store: Store, binding: IntakeBinding, candidate: ImportCandidate, request: IntakeRequest,
  targetProjectId: string) {
  try { buildImportPlan(binding, request, targetProjectId); }
  catch (error) {
    await store.blockCandidate(candidate, error instanceof ImportPlanError ? error.code : "import_plan_invalid");
    return false;
  }
  return true;
}

async function prepareCandidate(ctx: PluginContext, store: Store, binding: IntakeBinding, candidate: ImportCandidate) {
  const guard = candidateGuard(ctx, store, binding, candidate);
  await guard();
  const config = await importConfig(ctx, binding);
  const request = await createIntakeStore(ctx.db).getRequest(binding.companyId, candidate.intakeId);
  assertImport(request !== undefined, "import_request_missing");
  await guard();
  if (!await validPlan(store, binding, candidate, request!, config.intake!.targetProjectId)) return;
  return prepareNativeFamily(ctx, binding, request!, { targetProjectId: config.intake!.targetProjectId,
    guard, verifySource: sourceVerifier(ctx, binding, request!, guard) });
}

async function processingBinding(ctx: PluginContext) {
  const binding = await createIntakeStore(ctx.db).getBinding();
  if (!binding?.active) return undefined;
  try { await importConfig(ctx, binding); }
  catch { return undefined; }
  return binding;
}

function effectSummary(effect: ImportEffect) {
  const resultId = z.uuid().safeParse(effect.result?.nativeId);
  return { effectKey: effect.effectKey, kind: effect.kind, state: effect.state, dispatchCount: effect.dispatchCount,
    intentSha256: effect.intentSha256, resultSha256: effect.resultSha256,
    ...(resultId.success ? { nativeId: resultId.data } : {}) };
}

function nextAction(plan: StoredImportPlan, effects: ImportEffect[]) {
  if (effects.some(effect => ["dispatched", "outcome_unknown"].includes(effect.state))) return "reconcile-import";
  const actions = { prepared: "await_receiving_contract", blocked: "review_blocker",
    outcome_unknown: "reconcile-import", preparing: "scheduled_preparation" };
  return actions[plan.state];
}

async function planSummary(store: Store, plan: StoredImportPlan | undefined) {
  if (!plan) return { status: "not_planned" as const };
  const effects = await store.listEffects(plan);
  return { intakeId: plan.intakeId, status: plan.state, planSha256: plan.planSha256,
    sourceSha256: plan.sourceSha256, requestVersion: plan.requestVersion,
    readinessSha256: plan.readinessSha256, reason: plan.errorCode, admissionAllowed: false,
    effects: effects.map(effectSummary), nextAction: nextAction(plan, effects) };
}

async function inspectedSummary(ctx: PluginContext, store: Store, companyId: string, intakeId: string) {
  const plan = await store.getPlan(companyId, intakeId);
  if (plan) return planSummary(store, plan);
  const request = await createIntakeStore(ctx.db).getRequest(companyId, intakeId);
  if (!request) return { status: "not_planned" as const };
  const actions = { received: "await_source", fetching: "await_source", source_observed: "await_preparation",
    withdrawn: "inspect-intake", blocked: "review_blocker" };
  return { status: "not_planned" as const, requestStatus: request.status, reason: request.errorCode,
    nextAction: actions[request.status] };
}

async function inspect(ctx: PluginContext, companyId: string, intakeId?: string) {
  const store = createImportStore(ctx.db);
  if (intakeId) return { ...await inspectedSummary(ctx, store, companyId, intakeId), importPerformed: false, admissionAllowed: false };
  const requests = await createIntakeStore(ctx.db).listRequests(companyId, 20);
  const plans = await Promise.all(requests.map(async request => ({ intakeId: request.intakeId,
    ...await inspectedSummary(ctx, store, companyId, request.intakeId) })));
  return { status: "import_observed", plans, importPerformed: false, admissionAllowed: false };
}

function resumableBinding(binding: IntakeBinding | undefined, plan: StoredImportPlan) {
  if (!binding) return undefined;
  if (binding.activationId !== plan.activationId) return undefined;
  if (binding.fingerprint !== plan.fingerprint) return undefined;
  return binding;
}

async function resume(ctx: PluginContext, store: Store, plan: StoredImportPlan) {
  const unavailable = { resumed: false, readyToResume: false };
  const binding = resumableBinding(await createIntakeStore(ctx.db).getBinding(plan.companyId), plan);
  if (!binding) return unavailable;
  try { await candidateGuard(ctx, store, binding, plan)(); }
  catch { return unavailable; }
  if (plan.state === "preparing") return { resumed: false, readyToResume: true };
  const resumed = await store.resumePlan(plan);
  return { resumed, readyToResume: resumed };
}

async function reconcile(ctx: PluginContext, companyId: string, intakeId: string) {
  const store = createImportStore(ctx.db), plan = await store.getPlan(companyId, intakeId);
  assertImport(plan !== undefined, "import_plan_missing");
  // Readback uses the original company's persisted intents even when suspended.
  // Only a still-authorized plan can resume, and no effect is rearmed here.
  const result = await reconcileNativeEffects(ctx, store, plan!);
  const resumed = result.unresolved === 0 ? await resume(ctx, store, plan!) : { resumed: false, readyToResume: false };
  return { ...await planSummary(store, await store.getPlan(companyId, intakeId)), ...result, ...resumed,
    importPerformed: false, admissionAllowed: false };
}

/** Construction is inert; the scheduled job chooses only the durable company binding. */
export function createImportRuntime(ctx: PluginContext) {
  return {
    async drain() {
      const binding = await processingBinding(ctx);
      if (!binding) return;
      const store = createImportStore(ctx.db);
      const [candidate] = await store.listCandidates(binding.companyId, binding.activationId, 1);
      if (candidate) return prepareCandidate(ctx, store, binding, candidate);
    },
    inspect: (companyId: string, intakeId?: string) => inspect(ctx, companyId, intakeId),
    reconcile: (companyId: string, intakeId: string) => reconcile(ctx, companyId, intakeId),
  };
}

export type ImportRuntime = ReturnType<typeof createImportRuntime>;
