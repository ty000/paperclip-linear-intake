import { definePlugin, runWorker, z, type PluginPerformActionContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { probeSource } from "./source-probe.js";
import { inspectGateway } from "./gateway.js";
import { readSourceFamily } from "./source-family.js";
import { readCampaignSource } from "./campaign-source.js";
import { SourceReadError } from "./source-client.js";
import { createIntakeRuntime, type IntakeRuntime } from "./intake-runtime.js";
import { registerIntakeActions } from "./intake-actions.js";
import { createImportRuntime } from "./import-runtime.js";
import { registerImportActions } from "./import-actions.js";
import { registerCouncilHandoff } from "./council-handoff.js";

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
    const imports = createImportRuntime(ctx);
    registerImportActions(ctx, imports);
    registerCouncilHandoff(ctx);
    const runtime = intakeRuntime;
    ctx.jobs.register("drain-intake", async () => {
      try { await runtime.drain(); }
      catch { throw new Error("intake_job_failed"); }
    });
    ctx.jobs.register("prepare-import", async () => {
      try { await imports.drain(); }
      catch { throw new Error("import_job_failed"); }
    });
    ctx.actions.register("read-source-family", async (params, actionContext) => {
      if (!isAuthenticatedOperator(actionContext) || !hasMatchingCompany(actionContext)) {
        return { status: "blocked", reason: "source_reader_operator_required", importPerformed: false };
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
    ctx.actions.register("read-campaign-source", async (params, actionContext) => {
      if (!isAuthenticatedOperator(actionContext) || !hasMatchingCompany(actionContext)) {
        return { status: "blocked", reason: "source_reader_operator_required", importPerformed: false };
      }
      try {
        const input = z.object({ issueId: z.uuid() }).parse(params);
        return await readCampaignSource(ctx, actionContext.companyId, input.issueId);
      } catch (error) {
        return familyReadFailure(error);
      }
    });
    // Explicit invocation only. Setup and health perform no network/secret reads.
    ctx.actions.register("probe-source", async (_params, actionContext) => {
      // The bridge permits company agents too. Only an authenticated operator
      // may inspect raw source observations; params cannot supply this actor.
      if (!isAuthenticatedOperator(actionContext) || !hasMatchingCompany(actionContext)) {
        return { status: "blocked", reason: "source_probe_operator_required", importPerformed: false };
      }
      try {
        return await probeSource(ctx, actionContext.companyId);
      } catch {
        return { status: "blocked", reason: "source_probe_failed", importPerformed: false };
      }
    });
    ctx.actions.register("inspect-gateway", async (params) => {
      try {
        return await inspectGateway(ctx, typeof params.companyId === "string" ? params.companyId : "");
      } catch (error) {
        // inspectGateway returns only fixed error codes, never upstream messages.
        return { status: "blocked", reason: (error as Error).message, importPerformed: false };
      }
    });
  },
  async onValidateConfig(config) {
    try {
      parseConfig(config);
      return { ok: true, warnings: ["Retention, import and optional Council source revalidation require explicit enrollment. Council owns admission under its project mandate."] };
    } catch {
      return { ok: false, errors: ["Invalid configuration; enabled request retention needs scoped source settings and a webhook secret reference."] };
    }
  },
  async onHealth() {
    return { status: "degraded", message: "Explicit enrollment is required; native import and Council source revalidation default off. Admission requires the separate Council receiver." };
  },
  async onWebhook(input) {
    if (!intakeRuntime) throw new Error("intake_not_initialized");
    try { await intakeRuntime.receive(input); }
    catch { throw new Error("intake_webhook_rejected"); }
  },
});

function familyReadFailure(error: unknown) {
  if (error instanceof SourceReadError) return { status: "blocked", reason: error.code, importPerformed: false };
  return { status: "blocked", reason: "source_read_failed", importPerformed: false };
}
export default plugin;
runWorker(plugin, import.meta.url);
