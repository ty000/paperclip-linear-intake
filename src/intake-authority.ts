import type { PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { contentDigest } from "./content-digest.js";
import type { createIntakeStore } from "./intake-store.js";
import { IntakeStoreError, type IntakeBinding } from "./intake-state.js";

type Config = ReturnType<typeof parseConfig>;
type Store = ReturnType<typeof createIntakeStore>;

export function fingerprint(config: Config) {
  // The suspension gate does not change the explicitly enrolled authority.
  return contentDigest({ ...config, enabled: false });
}

export async function currentConfig(ctx: PluginContext, binding: IntakeBinding) {
  if (!binding.active) throw new IntakeStoreError("intake_binding_inactive");
  const config = parseConfig(await ctx.config.get(binding.companyId));
  if (!config.enabled) throw new IntakeStoreError("intake_suspended");
  if (fingerprint(config) !== binding.fingerprint) throw new IntakeStoreError("intake_configuration_changed");
  return config;
}

export function sourceGuard(ctx: PluginContext, store: Store, binding: IntakeBinding) {
  return async (selected: Config) => {
    if (!selected.enabled || fingerprint(selected) !== binding.fingerprint) throw new IntakeStoreError("intake_configuration_changed");
    await activeEpoch(store, binding);
    await currentConfig(ctx, binding);
  };
}

export async function activeEpoch(store: Store, binding: IntakeBinding) {
  const latest = await store.getBinding(binding.companyId);
  if (!latest?.active || latest.activationId !== binding.activationId) throw new IntakeStoreError("intake_binding_inactive");
}
