import type { PluginContext } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { IntakeStoreError, type IntakeBinding, type IntakeRequest } from "./intake-state.js";
import { buildImportPlan, type ImportPlan, type ImportNode } from "./import-plan.js";
import { createImportStore } from "./import-store.js";
import { assertImport, ImportStoreError, type ImportEffect } from "./import-state.js";
import { ImportEffectPending, performNativeEffect, type EffectContext } from "./import-effects.js";
import { issueOperation, documentOperation, relationOperation, verifyNativeProject, type NativeOperation } from "./import-native.js";

type Controls = { targetProjectId: string; guard: () => Promise<void>; verifySource: () => Promise<void> };
type Session = { ctx: PluginContext; plan: ImportPlan; effects: EffectContext; controls: Controls;
  nativeIds: Map<string, string>; operations: Map<string, NativeOperation> };

function mapped(session: Session, sourceId: string) {
  const id = session.nativeIds.get(sourceId);
  assertImport(id !== undefined, "import_correspondence_incomplete");
  return id!;
}

async function effect(session: Session, key: string, kind: string, operation: NativeOperation) {
  session.operations.set(key, operation);
  return performNativeEffect(session.effects, key, kind, operation);
}

async function createIssues(session: Session) {
  const { companyId, targetProjectId, originKind } = session.plan;
  for (const node of session.plan.nodes) {
    const parentId = node.parentSourceId === null ? null : mapped(session, node.parentSourceId);
    const result = await effect(session, node.keys.issue, "issue", issueOperation(session.ctx, {
      companyId, projectId: targetProjectId, originKind, originId: node.originId, parentId,
      title: node.source.title, description: node.source.description ?? "", status: node.status,
    }));
    assertImport(typeof result.nativeId === "string", "import_native_identity_invalid");
    session.nativeIds.set(node.sourceId, result.nativeId as string);
  }
}

async function createSourceDocument(session: Session, node: ImportNode) {
  return effect(session, node.keys.document, "document", documentOperation(session.ctx, {
    companyId: session.plan.companyId, issueId: mapped(session, node.sourceId), key: "linear-source-v1",
    title: "Linear source", format: "markdown", body: node.sourceDocumentBody,
  }));
}

async function createRelations(session: Session, node: ImportNode) {
  const blockerIds = node.blockedBySourceIds.map(id => mapped(session, id)).sort();
  return effect(session, node.keys.relations, "relations", relationOperation(session.ctx, {
    companyId: session.plan.companyId, issueId: mapped(session, node.sourceId), blockerIds,
  }));
}

async function readback(session: Session) {
  for (const [key, operation] of session.operations) {
    await session.controls.guard();
    const result = await operation.read();
    assertImport(result !== undefined, "import_readback_incomplete");
    const ref = { ...session.effects.plan, effectKey: key, intentSha256: contentDigest(operation.intent) };
    await session.effects.store.observeEffect({ ...ref, result: result! });
  }
}

function receipt(effects: ImportEffect[], key: string) {
  const found = effects.find(value => value.effectKey === key);
  assertImport(found?.state === "observed", "import_readback_incomplete");
  return { effectKey: key, intentSha256: found!.intentSha256, result: found!.result, resultSha256: found!.resultSha256 };
}

async function readinessBody(session: Session) {
  const { plan } = session;
  const effects = await session.effects.store.listEffects(session.effects.plan);
  return {
    schema: "linear-native-readiness.v1", companyId: plan.companyId, intakeId: plan.intakeId,
    activationId: plan.activationId, configurationFingerprint: plan.fingerprint,
    requestVersion: plan.requestVersion, planSha256: plan.planSha256, sourceSha256: plan.sourceSha256,
    targetProjectId: plan.targetProjectId, originKind: plan.originKind,
    nativeRootId: mapped(session, plan.rootSourceId), sourceRootId: plan.rootSourceId,
    correspondence: plan.nodes.map(node => ({ sourceId: node.sourceId, nativeId: mapped(session, node.sourceId),
      originId: node.originId, sourceRevision: node.source.updatedAt, status: node.status })),
    effects: plan.expectedEffectKeys.filter(key => key !== plan.readinessKey).map(key => receipt(effects, key)),
    externalBlockers: plan.externalBlockers, importStatus: "prepared", admissionAllowed: false,
    implementationStarted: false, receivingContract: "unqualified",
    requiresCurrentSourceAndMandateRevalidation: true,
  };
}

async function publishReadiness(session: Session) {
  // Source and native readback are separate observations, never a cross-system
  // transaction. The receiver must revalidate these bindings before admission.
  await session.controls.verifySource();
  await verifyNativeProject(session.ctx, session.plan.companyId, session.plan.targetProjectId);
  await readback(session);
  const body = await readinessBody(session);
  const document = await effect(session, session.plan.readinessKey, "readiness", documentOperation(session.ctx, {
    companyId: session.plan.companyId, issueId: body.nativeRootId, key: "linear-intake-readiness-v1",
    title: "Linear intake readiness", format: "markdown", body: JSON.stringify(body),
  }));
  await session.controls.guard();
  const readiness = { ...document, nativeRootId: body.nativeRootId,
    planSha256: session.plan.planSha256, sourceSha256: session.plan.sourceSha256 };
  const finished = await session.effects.store.finishPlan({ ...session.effects.plan, state: "prepared", readiness });
  assertImport(finished, "import_readiness_not_committed");
  return { status: "prepared" as const, planSha256: session.plan.planSha256, readiness, admissionAllowed: false };
}

async function run(session: Session) {
  await session.controls.verifySource();
  await verifyNativeProject(session.ctx, session.plan.companyId, session.plan.targetProjectId);
  await createIssues(session);
  for (const node of session.plan.nodes) await createSourceDocument(session, node);
  for (const node of session.plan.nodes) await createRelations(session, node);
  return publishReadiness(session);
}

function suspensionError(error: unknown) {
  return error instanceof IntakeStoreError && error.code === "intake_suspended";
}

async function isSuspended(session: Session, error: unknown) {
  // A transport may wrap an authority error during source revalidation. An
  // intentional suspension before dispatch must not permanently block a plan.
  if (error instanceof ImportEffectPending) return false;
  try { await session.controls.guard(); }
  catch (current) { return suspensionError(current); }
  return suspensionError(error);
}

function failureState(error: unknown) {
  const state = error instanceof ImportEffectPending ? "outcome_unknown" as const : "blocked" as const;
  const errorCode = error instanceof ImportStoreError ? error.code : "import_not_complete";
  return { state, errorCode };
}

async function persistFailure(session: Session, error: unknown) {
  const { state, errorCode } = failureState(error);
  const finished = await session.effects.store.finishPlan({ ...session.effects.plan, state, errorCode });
  if (!finished) {
    const current = await session.effects.store.getPlan(session.plan.companyId, session.plan.intakeId);
    return { status: "ineligible" as const, durableState: current?.state,
      planSha256: session.plan.planSha256, reason: errorCode, admissionAllowed: false };
  }
  return { status: state, planSha256: session.plan.planSha256, reason: errorCode, admissionAllowed: false };
}

async function failure(session: Session, error: unknown) {
  if (await isSuspended(session, error)) {
    return { status: "suspended" as const, planSha256: session.plan.planSha256, admissionAllowed: false };
  }
  if (error instanceof ImportEffectPending && !error.uncertain) {
    return { status: "reconciling" as const, planSha256: session.plan.planSha256, admissionAllowed: false };
  }
  return persistFailure(session, error);
}

export async function prepareNativeFamily(ctx: PluginContext, binding: IntakeBinding, request: IntakeRequest, controls: Controls) {
  await controls.guard();
  const plan = buildImportPlan(binding, request, controls.targetProjectId);
  const store = createImportStore(ctx.db);
  const saved = await store.ensurePlan({ ...plan, plan });
  if (saved.state !== "preparing") return { status: saved.state, planSha256: plan.planSha256, admissionAllowed: false };
  const ref = { companyId: plan.companyId, intakeId: plan.intakeId, planSha256: plan.planSha256 };
  const session: Session = { ctx, plan, controls, nativeIds: new Map(), operations: new Map(),
    effects: { store, plan: ref, guard: controls.guard } };
  try { return await run(session); }
  catch (error) { return failure(session, error); }
}
