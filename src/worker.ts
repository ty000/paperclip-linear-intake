import { definePlugin, runWorker, z, type PluginPerformActionContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { probeSource } from "./source-probe.js";
import { inspectGateway } from "./gateway.js";
import { readSourceFamily } from "./source-family.js";
import { SourceReadError } from "./source-client.js";

function isAuthenticatedOperator(context: PluginPerformActionContext | undefined) {
  return context?.actor.type === "user" && Boolean(context.actor.userId);
}

function hasMatchingCompany(context: PluginPerformActionContext): context is PluginPerformActionContext & { companyId: string } {
  return Boolean(context.companyId) && context.actor.companyId === context.companyId;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.actions.register("read-source-family", async (params, actionContext) => {
      if (!isAuthenticatedOperator(actionContext) || !hasMatchingCompany(actionContext)) {
        return { status: "blocked", reason: "source_reader_operator_required", intakeEnabled: false };
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
        return { status: "blocked", reason: "source_probe_operator_required", intakeEnabled: false };
      }
      try {
        return await probeSource(ctx, actionContext.companyId);
      } catch {
        return { status: "blocked", reason: "source_probe_failed", intakeEnabled: false };
      }
    });
    ctx.actions.register("inspect-gateway", async (params) => {
      try {
        return await inspectGateway(ctx, typeof params.companyId === "string" ? params.companyId : "");
      } catch (error) {
        // inspectGateway returns only fixed error codes, never upstream messages.
        return { status: "blocked", reason: (error as Error).message, intakeEnabled: false };
      }
    });
  },
  async onValidateConfig(config) {
    try {
      parseConfig(config);
      return { ok: true, warnings: ["Source access is unqualified; intake activation is unavailable."] };
    } catch {
      return { ok: false, errors: ["Invalid configuration; intake must remain disabled and discovery needs a gateway URL and secret reference."] };
    }
  },
  async onHealth() {
    return { status: "degraded", message: "Intake disabled; native Linear source access remains unqualified." };
  },
});

function familyReadFailure(error: unknown) {
  if (error instanceof SourceReadError) return { status: "blocked", reason: error.code, intakeEnabled: false };
  return { status: "blocked", reason: "source_read_failed", intakeEnabled: false };
}
export default plugin;
runWorker(plugin, import.meta.url);
