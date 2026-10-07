import { definePlugin, runWorker, z, type PluginPerformActionContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { probeSource } from "./source-probe.js";
import { inspectGateway } from "./gateway.js";
import { readSourceFamily } from "./source-family.js";
import { SourceReadError } from "./source-client.js";
import { createIntakeRuntime, type IntakeRuntime } from "./intake-runtime.js";
import { registerIntakeActions } from "./intake-actions.js";

let intakeRuntime: IntakeRuntime | undefined;

function isAuthenticatedOperator(context: PluginPerformActionContext | undefined) {
  return context?.actor.type === "user" && Boolean(context.actor.userId);
}

function hasMatchingCompany(context: PluginPerformActionContext): context is PluginPerformActionContext & { companyId: string } {
  return Boolean(context.companyId) && context.actor.companyId === context.companyId;
}

const plugin = definePlugin({
  async setup(ctx) {
    intakeRuntime = createIntakeRuntime(ctx);
    registerIntakeActions(ctx, intakeRuntime);
    const runtime = intakeRuntime;
    ctx.jobs.register("drain-intake", async () => {
      try { await runtime.drain(); }
      catch { throw new Error("intake_job_failed"); }
    });
    ctx.actions.register("read-source-family", async (params, actionContext) => {
      if (!isAuthenticatedOperator(actionContext) || !hasMatchingCompany(actionContext)) {
        return { status: "blocked", reason: "source_reader_operator_required", importEnabled: false };
      }
      try {
        // The native bridge adds companyId/renderEnvironment. Only issueId is
        // caller input; authority comes exclusively from the action context.
        const input = z.object({ issueId: z.uuid() }).parse(params);
        return await readSourceFamily(ctx, actionContext.companyId, input.issueId);
      } catch (error) {
        return familyReadFailure(error);
      }
    });
    // Explicit invocation only. Setup and health perform no network/secret reads.
    ctx.actions.register("probe-source", async (_params, actionContext) => {
      // The bridge permits company agents too. Only an authenticated operator
      // may inspect raw source observations; params cannot supply this actor.
      if (!isAuthenticatedOperator(actionContext) || !hasMatchingCompany(actionContext)) {
        return { status: "blocked", reason: "source_probe_operator_required", importEnabled: false };
      }
      try {
        return await probeSource(ctx, actionContext.companyId);
      } catch {
        return { status: "blocked", reason: "source_probe_failed", importEnabled: false };
      }
    });
    ctx.actions.register("inspect-gateway", async (params) => {
      try {
        return await inspectGateway(ctx, typeof params.companyId === "string" ? params.companyId : "");
      } catch (error) {
        // inspectGateway returns only fixed error codes, never upstream messages.
        return { status: "blocked", reason: (error as Error).message, importEnabled: false };
      }
    });
  },
  async onValidateConfig(config) {
    try {
      parseConfig(config);
      return { ok: true, warnings: ["Request retention requires explicit operator enrollment. Import and admission are unavailable."] };
    } catch {
      return { ok: false, errors: ["Invalid configuration; enabled request retention needs scoped source settings and a webhook secret reference."] };
    }
  },
  async onHealth() {
    return { status: "degraded", message: "Request retention requires explicit enrollment; import and admission are unavailable." };
  },
  async onWebhook(input) {
    if (!intakeRuntime) throw new Error("intake_not_initialized");
    try { await intakeRuntime.receive(input); }
    catch { throw new Error("intake_webhook_rejected"); }
  },
});

function familyReadFailure(error: unknown) {
  if (error instanceof SourceReadError) return { status: "blocked", reason: error.code, importEnabled: false };
  return { status: "blocked", reason: "source_read_failed", importEnabled: false };
}
export default plugin;
runWorker(plugin, import.meta.url);
