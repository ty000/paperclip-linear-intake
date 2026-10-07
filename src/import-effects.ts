import { randomUUID } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { createImportStore } from "./import-store.js";
import { assertImport, type ImportEffect, type ImportEffectRef, type ImportPlanRef } from "./import-state.js";
import { issueOperation, documentOperation, relationOperation,
  type NativeOperation, type NativeIssueIntent, type NativeDocumentIntent, type NativeRelationIntent } from "./import-native.js";

type Store = ReturnType<typeof createImportStore>;
export type EffectContext = { store: Store; plan: ImportPlanRef; guard: () => Promise<void> };

export class ImportEffectPending extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? "import_effect_uncertain" : "import_effect_pending"); }
}

async function observe(store: Store, ref: ImportEffectRef, operation: NativeOperation) {
  const result = await operation.read();
  if (!result) return undefined;
  await store.observeEffect({ ...ref, result });
  return result;
}

async function dispatch(context: EffectContext, ref: ImportEffectRef, operation: NativeOperation) {
  try {
    await context.guard();
    await operation.dispatch();
    const result = await observe(context.store, ref, operation);
    if (!result) throw new ImportEffectPending(true);
    return result;
  } catch {
    const saved = await context.store.markUnknown({ ...ref, errorCode: "native_effect_uncertain" });
    if (saved.state === "observed") return saved.result!;
    throw new ImportEffectPending(true);
  }
}

export async function performNativeEffect(context: EffectContext, effectKey: string, kind: string, operation: NativeOperation) {
  await context.guard();
  assertImport(operation.intent.companyId === context.plan.companyId, "import_company_mismatch");
  const ref = { ...context.plan, effectKey, intentSha256: contentDigest(operation.intent) };
  const saved = await context.store.ensureEffect({ ...ref, kind, intent: operation.intent });
  const result = await observe(context.store, ref, operation);
  if (result) return result;
  assertImport(saved.state !== "observed", "import_native_readback_missing");
  if (saved.state === "outcome_unknown") throw new ImportEffectPending(true);
  const claimed = await context.store.claimDispatch({ ...ref, owner: randomUUID() });
  if (!claimed) throw new ImportEffectPending(false);
  return dispatch(context, ref, operation);
}

function operationForReceipt(ctx: PluginContext, effect: ImportEffect): NativeOperation {
  assertImport(effect.intent.companyId === effect.companyId, "import_company_mismatch");
  assertImport(["issue", "relations", "document", "readiness"].includes(effect.kind), "import_effect_kind_unknown");
  if (effect.kind === "issue") return issueOperation(ctx, effect.intent as NativeIssueIntent);
  if (effect.kind === "relations") return relationOperation(ctx, effect.intent as NativeRelationIntent);
  return documentOperation(ctx, effect.intent as NativeDocumentIntent);
}

/** Read-only native reconciliation. It never dispatches or rearms an effect. */
export async function reconcileNativeEffects(ctx: PluginContext, store: Store, plan: ImportPlanRef) {
  const effects = await store.listEffects(plan);
  let unresolved = 0;
  for (const effect of effects) {
    const ref = { ...plan, effectKey: effect.effectKey, intentSha256: effect.intentSha256 };
    const result = await observe(store, ref, operationForReceipt(ctx, effect));
    if (!result && effect.state !== "intended") unresolved++;
  }
  return { unresolved, effectCount: effects.length };
}
