import { randomUUID } from "node:crypto";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { fingerprint, currentConfig, sourceGuard } from "./intake-authority.js";
import { createIntakeStore } from "./intake-store.js";
import { MAX_SOURCE_ATTEMPTS, IntakeStoreError, type IntakeBinding, type IntakeRequest } from "./intake-state.js";
import { verifyLinearEvent, verifyCampaignChange } from "./webhook-event.js";
import { retainCampaignChange, projectCampaignChanges } from "./source-invalidation.js";
import { retrySourceRead, sourceRecoveryStatus } from "./intake-recovery.js";
import { readRetainedFamily } from "./intake-source.js";

type Config = ReturnType<typeof parseConfig>;
type Store = ReturnType<typeof createIntakeStore>;

function authority(config: Config, activationAt: string) {
  const scope = config.sourceReader, intake = config.intake;
  if (!config.enabled || !scope || !intake) throw new IntakeStoreError("intake_configuration_missing");
  return { organizationId: scope.organizationId, teamId: scope.teamId, projectId: scope.projectId,
    todoStateId: scope.todoStateId, webhookId: intake.webhookId, allowedActors: intake.allowedActors, activationAt };
}

function bindingSummary(binding: IntakeBinding | undefined) {
  if (!binding) return { enrolled: false as const };
  return { enrolled: true as const, active: binding.active, activationId: binding.activationId,
    activatedAt: binding.activatedAt, fingerprint: binding.fingerprint };
}

async function activate(ctx: PluginContext, store: Store, companyId: string) {
  const config = parseConfig(await ctx.config.get(companyId));
  const activatedAt = new Date().toISOString();
  const binding = await store.activateBinding({ companyId, activationId: randomUUID(), activatedAt,
    fingerprint: fingerprint(config), authority: authority(config, activatedAt) });
  await currentConfig(ctx, binding);
  return { status: "intake_enrolled", ...bindingSummary(binding), importPerformed: false };
}

async function deactivate(store: Store, companyId: string) {
  const current = await store.getBinding(companyId);
  if (!current) return { status: "intake_not_enrolled", importPerformed: false };
  const binding = await store.deactivateBinding(companyId, current.activationId);
  return { status: "intake_deactivated", ...bindingSummary(binding), importPerformed: false };
}

async function receive(ctx: PluginContext, store: Store, input: PluginWebhookInput) {
  if (input.endpointKey !== "linear-todo") throw new Error("webhook_endpoint_invalid");
  const binding = await store.getBinding();
  if (!binding) throw new Error("intake_not_enrolled");
  const config = await currentConfig(ctx, binding);
  const secret = await webhookSecret(ctx, binding.companyId, config);
  const event = verifyLinearEvent(input.rawBody, input.headers, secret, binding.authority, Date.now());
  const change = verifyCampaignChange(input.rawBody, input.headers, secret, binding.authority, Date.now());
  if (change && config.councilContinuityEnabled) await retainCampaignChange(ctx.db, binding, change);
  if (event.classification === "ignored") return;
  await currentConfig(ctx, binding);
  // Receipt and request projection finish before resolving the native webhook.
  // No source HTTP or job execution takes place in this callback.
  await store.retainDelivery(binding.companyId, binding.activationId, event);
}

function webhookSecret(ctx: PluginContext, companyId: string, config: Config) {
  const ref = config.intake!.webhookSecretRef;
  return ctx.secrets.resolve({ type: "secret_ref", secretId: ref.secretId,
    ...(ref.version === undefined ? {} : { version: ref.version }) },
    { companyId, configPath: "intake.webhookSecretRef" });
}

function completion(binding: IntakeBinding, request: IntakeRequest, owner: string) {
  return { companyId: binding.companyId, intakeId: request.intakeId, activationId: binding.activationId,
    fingerprint: binding.fingerprint, owner, revision: request.version, now: new Date().toISOString() };
}

async function fetchRequest(ctx: PluginContext, store: Store, binding: IntakeBinding, request: IntakeRequest) {
  const owner = randomUUID();
  const claimed = await store.claimRequest({ ...completion(binding, request, owner), leaseMs: 240_000, maxAttempts: MAX_SOURCE_ATTEMPTS });
  if (!claimed) return;
  // Read failures wait for an explicit bounded operator retry. A lost worker
  // reclaims the original request after its lease, without replacing its ID.
  let result: Awaited<ReturnType<typeof readRetainedFamily>>;
  try { result = await readRetainedFamily(ctx, binding.companyId, claimed, sourceGuard(ctx, store, binding)); }
  catch {
    await currentConfig(ctx, binding);
    await store.finishRequest({ ...completion(binding, claimed, owner), status: "blocked", errorCode: "source_read_failed" });
    return;
  }
  await currentConfig(ctx, binding);
  const done = completion(binding, claimed, owner);
  if (result.status === "withdrawn") {
    await store.finishRequest({ ...done, status: "withdrawn" });
    return;
  }
  await store.finishRequest({ ...done, status: "source_observed", snapshot: result.family, snapshotSha256: result.family.sourceSha256 });
}

async function drain(ctx: PluginContext, store: Store) {
  const binding = await processingBinding(ctx, store);
  if (!binding) return;
  await projectCampaignChanges(ctx, binding);
  await store.replayPending(binding.companyId, binding.activationId, 20);
  const pending = await store.listPendingRequests(binding.companyId, binding.activationId, new Date().toISOString(), 1);
  for (const request of pending) {
    await currentConfig(ctx, binding);
    await fetchRequest(ctx, store, binding, request);
  }
}

async function processingBinding(ctx: PluginContext, store: Store) {
  const binding = await store.getBinding();
  if (!binding?.active) return undefined;
  if (!await processingEnabled(ctx, binding)) return undefined;
  return binding;
}

async function processingEnabled(ctx: PluginContext, binding: IntakeBinding) {
  try { await currentConfig(ctx, binding); }
  catch (error) {
    if (error instanceof IntakeStoreError) return false;
    throw new Error("intake_job_configuration_failed");
  }
  return true;
}

/** Construction is inert; all authority and configuration are read durably. */
export function createIntakeRuntime(ctx: PluginContext) {
  const store = () => createIntakeStore(ctx.db);
  return {
    activate: (companyId: string) => activate(ctx, store(), companyId),
    deactivate: (companyId: string) => deactivate(store(), companyId),
    retrySourceRead: (companyId: string, actorUserId: string, params: unknown) => retrySourceRead(ctx, companyId, actorUserId, params),
    async status(companyId: string) {
      const ledger = store();
      const binding = await ledger.getBinding(companyId);
      const requests = await ledger.listRequests(companyId, 20);
      return { ...bindingSummary(binding), importPerformed: false,
        requests: requests.map(sourceRecoveryStatus) };
    },
    receive: (input: PluginWebhookInput) => receive(ctx, store(), input),
    drain: () => drain(ctx, store()),
  };
}

export type IntakeRuntime = ReturnType<typeof createIntakeRuntime>;
