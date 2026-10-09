import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { readRetainedFamily } from "./intake-source.js";
import { fingerprint } from "./intake-authority.js";
import { openHandoff, guardHandoff, verifyHandoffReadiness } from "./council-handoff-ledger.js";
import { COUNCIL_REQUEST_EVENT, COUNCIL_RESULT_NAME, HandoffError, handoffResult,
  parseCouncilChallenge, requireFreshChallenge, requireHandoff, type CouncilChallenge } from "./council-handoff-contract.js";
import { CAMPAIGN_SOURCE_SCHEMA } from "./campaign-source.js";

async function revalidate(ctx: PluginContext, challenge: CouncilChallenge) {
  const session = await openHandoff(ctx, challenge);
  await verifyHandoffReadiness(session);
  const result = await readRetainedFamily(ctx, challenge.companyId, session.request, async selected => {
    requireHandoff(selected.enabled, "handoff_authority_inactive");
    requireHandoff(fingerprint(selected) === challenge.configurationFingerprint, "handoff_authority_inactive");
    await guardHandoff(session);
  });
  requireHandoff(result.status === "source_observed", "handoff_source_withdrawn");
  const campaign = session.plan.plan.campaign as Record<string, unknown> | undefined;
  if (campaign) {
    requireHandoff(result.family.schema === CAMPAIGN_SOURCE_SCHEMA, "handoff_source_changed");
    if (result.family.schema === CAMPAIGN_SOURCE_SCHEMA) {
      requireHandoff(result.family.campaign.materialSourceSha256 === campaign.materialSourceSha256,
        "handoff_source_changed");
      requireHandoff(result.family.campaign.stateCompatibility.status === "compatible",
        "handoff_source_state_incompatible");
    }
  } else requireHandoff(result.family.sourceSha256 === challenge.sourceSha256, "handoff_source_changed");
  await verifyHandoffReadiness(session);
}

async function response(ctx: PluginContext, challenge: CouncilChallenge) {
  try {
    await revalidate(ctx, challenge);
    requireFreshChallenge(challenge);
    return handoffResult(challenge, "handoff_confirmed");
  } catch (error) {
    return handoffResult(challenge, error instanceof HandoffError ? error.code : "handoff_verification_failed");
  }
}

/** No startup I/O. A single process-local read slot also coalesces concurrent duplicate challenges.
 * Events have no durable delivery guarantee; Council owns pending state, expiry and retries.
 */
export function registerCouncilHandoff(ctx: PluginContext) {
  let reading = false;
  ctx.events.on(COUNCIL_REQUEST_EVENT, async (event: PluginEvent) => {
    const challenge = parseCouncilChallenge(event);
    if (!challenge || reading) return;
    reading = true;
    try {
      const result = await response(ctx, challenge);
      await ctx.events.emit(COUNCIL_RESULT_NAME, challenge.companyId, result);
    } catch {
      // Failed notification has unknown delivery. Never expose upstream diagnostics or retry effects.
    } finally { reading = false; }
  });
}
