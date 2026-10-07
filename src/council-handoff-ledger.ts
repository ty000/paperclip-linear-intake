import type { PluginContext } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { currentConfig } from "./intake-authority.js";
import { createIntakeStore } from "./intake-store.js";
import { createImportStore } from "./import-store.js";
import { buildImportPlan } from "./import-plan.js";
import { documentOperation, type NativeDocumentIntent } from "./import-native.js";
import type { IntakeBinding, IntakeRequest } from "./intake-state.js";
import type { ImportEffect, StoredImportPlan } from "./import-state.js";
import { requireFreshChallenge, requireHandoff, type CouncilChallenge } from "./council-handoff-contract.js";

export type HandoffSession = { ctx: PluginContext; challenge: CouncilChallenge; binding: IntakeBinding;
  request: IntakeRequest; plan: StoredImportPlan };

function matchingIdentity(plan: StoredImportPlan, challenge: CouncilChallenge) {
  const actual = [plan.companyId, plan.intakeId, plan.activationId, plan.fingerprint, plan.requestVersion,
    plan.sourceSha256, plan.planSha256, plan.readinessSha256, plan.plan.targetProjectId];
  const expected = [challenge.companyId, challenge.intakeId, challenge.activationId, challenge.configurationFingerprint,
    challenge.requestVersion, challenge.sourceSha256, challenge.planSha256, challenge.readinessSha256, challenge.targetProjectId];
  requireHandoff(contentDigest(actual) === contentDigest(expected), "handoff_identity_mismatch");
  requireHandoff(plan.state === "prepared", "handoff_ledger_not_prepared");
}

async function currentBinding(ctx: PluginContext, challenge: CouncilChallenge) {
  const binding = await createIntakeStore(ctx.db).getBinding(challenge.companyId);
  requireHandoff(binding?.active, "handoff_authority_inactive");
  requireHandoff(binding.companyId === challenge.companyId, "handoff_identity_mismatch");
  requireHandoff(binding.activationId === challenge.activationId, "handoff_authority_inactive");
  requireHandoff(binding.fingerprint === challenge.configurationFingerprint, "handoff_authority_inactive");
  const config = await currentConfig(ctx, binding);
  requireHandoff(config.councilHandoffEnabled && config.nativeImportEnabled, "handoff_disabled");
  requireHandoff(config.intake?.targetProjectId === challenge.targetProjectId, "handoff_identity_mismatch");
  return binding;
}

export async function guardHandoff(session: HandoffSession) {
  const { ctx, challenge } = session;
  requireFreshChallenge(challenge);
  await currentBinding(ctx, challenge);
  const store = createImportStore(ctx.db);
  const plan = await store.getPlan(challenge.companyId, challenge.intakeId);
  requireHandoff(plan !== undefined, "handoff_ledger_missing");
  matchingIdentity(plan, challenge);
  requireHandoff(await store.isCurrentCandidate(plan), "handoff_request_changed");
}

export async function openHandoff(ctx: PluginContext, challenge: CouncilChallenge): Promise<HandoffSession> {
  const binding = await currentBinding(ctx, challenge);
  const request = await createIntakeStore(ctx.db).getRequest(challenge.companyId, challenge.intakeId);
  const plan = await createImportStore(ctx.db).getPlan(challenge.companyId, challenge.intakeId);
  requireHandoff(request !== undefined && plan !== undefined, "handoff_ledger_missing");
  matchingIdentity(plan, challenge);
  const rebuilt = buildImportPlan(binding, request, challenge.targetProjectId);
  requireHandoff(contentDigest(rebuilt) === contentDigest(plan.plan), "handoff_identity_mismatch");
  const session = { ctx, challenge, binding, request, plan };
  await guardHandoff(session);
  return session;
}

function verifyEffect(effect: ImportEffect, session: HandoffSession) {
  requireHandoff(effect.companyId === session.challenge.companyId, "handoff_effects_invalid");
  requireHandoff(effect.state === "observed", "handoff_effects_unresolved");
  requireHandoff(effect.intent.companyId === effect.companyId, "handoff_effects_invalid");
  requireHandoff(contentDigest(effect.intent) === effect.intentSha256, "handoff_effects_invalid");
  requireHandoff(effect.result !== null, "handoff_effects_invalid");
  requireHandoff(contentDigest(effect.result) === effect.resultSha256, "handoff_effects_invalid");
}

function readinessEffect(effects: ImportEffect[], session: HandoffSession) {
  const expected = [...session.plan.expectedEffectKeys].sort();
  requireHandoff(contentDigest(effects.map(effect => effect.effectKey).sort()) === contentDigest(expected), "handoff_effects_incomplete");
  for (const effect of effects) verifyEffect(effect, session);
  const readiness = effects.find(effect => effect.effectKey === session.plan.plan.readinessKey);
  requireHandoff(readiness?.kind === "readiness", "handoff_readiness_invalid");
  const { challenge } = session;
  requireHandoff(readiness.intent.issueId === challenge.nativeRootId, "handoff_readiness_invalid");
  requireHandoff(readiness.intent.key === "linear-intake-readiness-v1", "handoff_readiness_invalid");
  verifyReadinessBody(readiness, effects, session);
  return readiness;
}

function boundReadinessFields(session: HandoffSession) {
  const { challenge } = session;
  return { schema: "linear-native-readiness.v1", companyId: challenge.companyId, intakeId: challenge.intakeId,
    activationId: challenge.activationId, configurationFingerprint: challenge.configurationFingerprint,
    requestVersion: challenge.requestVersion, planSha256: challenge.planSha256, sourceSha256: challenge.sourceSha256,
    targetProjectId: challenge.targetProjectId, originKind: "plugin:ty000.linear-intake",
    nativeRootId: challenge.nativeRootId, sourceRootId: session.request.issueId,
    importStatus: "prepared", admissionAllowed: false, implementationStarted: false, receivingContract: "unqualified",
    requiresCurrentSourceAndMandateRevalidation: true };
}

function effectReceipt(effect: ImportEffect) {
  return { effectKey: effect.effectKey, intentSha256: effect.intentSha256, result: effect.result, resultSha256: effect.resultSha256 };
}

function verifyReadinessBody(readiness: ImportEffect, effects: ImportEffect[], session: HandoffSession) {
  const body = JSON.parse(readiness.intent.body as string) as Record<string, unknown>;
  const expected = boundReadinessFields(session);
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key, body[key]]));
  requireHandoff(contentDigest(actual) === contentDigest(expected), "handoff_readiness_invalid");
  const byKey = new Map(effects.map(effect => [effect.effectKey, effect]));
  const receipts = session.plan.expectedEffectKeys.filter(key => key !== readiness.effectKey)
    .map(key => effectReceipt(byKey.get(key)!));
  requireHandoff(contentDigest(body.effects) === contentDigest(receipts), "handoff_effects_changed");
}

function verifyReadinessReceipt(session: HandoffSession, found: Record<string, unknown> | undefined) {
  const { challenge, plan } = session;
  requireHandoff(found !== undefined, "handoff_readiness_missing");
  requireHandoff(found.nativeId === challenge.readinessDocumentId, "handoff_readiness_changed");
  requireHandoff(found.revisionId === challenge.readinessRevisionId, "handoff_readiness_changed");
  const receipt = { ...found, nativeRootId: challenge.nativeRootId,
    planSha256: challenge.planSha256, sourceSha256: challenge.sourceSha256 };
  requireHandoff(contentDigest(receipt) === challenge.readinessSha256, "handoff_readiness_changed");
  requireHandoff(contentDigest(plan.readiness) === challenge.readinessSha256, "handoff_readiness_changed");
}

/** Only immutable readiness is read natively here. Council owns current work/assignment readback. */
export async function verifyHandoffReadiness(session: HandoffSession) {
  await guardHandoff(session);
  const effects = await createImportStore(session.ctx.db).listEffects(session.plan);
  const effect = readinessEffect(effects, session);
  const found = await documentOperation(session.ctx, effect.intent as NativeDocumentIntent).read();
  verifyReadinessReceipt(session, found);
  requireHandoff(contentDigest(found) === effect.resultSha256, "handoff_readiness_changed");
  await guardHandoff(session);
}
