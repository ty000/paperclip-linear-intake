import type { PluginContext, PluginPerformActionContext } from "@paperclipai/plugin-sdk";
import type { IntakeRuntime } from "./intake-runtime.js";
import { IntakeStoreError } from "./intake-state.js";

function operatorCompany(context: PluginPerformActionContext | undefined) {
  if (context?.actor.type !== "user" || !context.actor.userId) return undefined;
  return matchingCompany(context);
}

function matchingCompany(context: PluginPerformActionContext) {
  if (!context.companyId || context.actor.companyId !== context.companyId) return undefined;
  return context.companyId;
}

function safeFailure(error: unknown) {
  if (error instanceof IntakeStoreError) return { status: "blocked", reason: error.code };
  return { status: "blocked", reason: "intake_action_failed" };
}

export function registerIntakeActions(ctx: PluginContext, runtime: IntakeRuntime) {
  ctx.actions.register("retry-source-read", async (params, context) => {
    const companyId = operatorCompany(context);
    if (!companyId || context?.actor.type !== "user") return { status: "blocked", reason: "intake_operator_required" };
    try { return await runtime.retrySourceRead(companyId, context.actor.userId!, params); }
    catch (error) { return safeFailure(error); }
  });
  const actions = { "activate-intake": runtime.activate, "deactivate-intake": runtime.deactivate,
    "inspect-intake": runtime.status };
  for (const [name, action] of Object.entries(actions)) {
    ctx.actions.register(name, async (_params, context) => {
      const companyId = operatorCompany(context);
      if (!companyId) return { status: "blocked", reason: "intake_operator_required" };
      try { return await action(companyId); }
      catch (error) { return safeFailure(error); }
    });
  }
}
