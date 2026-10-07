import { z, type PluginContext, type PluginPerformActionContext } from "@paperclipai/plugin-sdk";
import { ImportStoreError } from "./import-state.js";
import type { ImportRuntime } from "./import-runtime.js";

const intakeId = z.string().regex(/^linear-intake-[a-f0-9]{64}$/);

function operatorCompany(context: PluginPerformActionContext | undefined) {
  if (context?.actor.type !== "user" || !context.actor.userId) return undefined;
  return matchingCompany(context);
}

function matchingCompany(context: PluginPerformActionContext) {
  if (!context.companyId || context.actor.companyId !== context.companyId) return undefined;
  return context.companyId;
}

function invokeAction(runtime: ImportRuntime, action: "inspect-import" | "reconcile-import", companyId: string, params: unknown) {
  // Host company/renderEnvironment fields are ignored; only the native context is authoritative.
  const schema = z.object({ intakeId: action === "reconcile-import" ? intakeId : intakeId.optional() });
  const input = schema.parse(params);
  return action === "reconcile-import" ? runtime.reconcile(companyId, input.intakeId!)
    : runtime.inspect(companyId, input.intakeId);
}

function failure(error: unknown) {
  return { status: "blocked", reason: error instanceof ImportStoreError ? error.code : "import_action_failed",
    importPerformed: false, admissionAllowed: false };
}

export function registerImportActions(ctx: PluginContext, runtime: ImportRuntime) {
  for (const action of ["inspect-import", "reconcile-import"] as const) {
    ctx.actions.register(action, async (params, context) => {
      const companyId = operatorCompany(context);
      if (!companyId) return { status: "blocked", reason: "import_operator_required", importPerformed: false, admissionAllowed: false };
      try {
        return await invokeAction(runtime, action, companyId, params);
      } catch (error) { return failure(error); }
    });
  }
}
