import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { currentConfig } from "./intake-authority.js";
import { createIntakeStore } from "./intake-store.js";
import { MAX_SOURCE_ATTEMPTS, IntakeStoreError, type IntakeRequest } from "./intake-state.js";

const retrySchema = z.strictObject({ intakeId: z.string().regex(/^linear-intake-[a-f0-9]{64}$/),
  expectedVersion: z.number().int().positive(),
  // Native bridge metadata is accepted but never used as authority.
  companyId: z.unknown().optional(), renderEnvironment: z.unknown().optional() });

export async function retrySourceRead(ctx: PluginContext, companyId: string, actorUserId: string, params: unknown) {
  const parsed = retrySchema.safeParse(params);
  if (!parsed.success) throw new IntakeStoreError("intake_retry_invalid_request");
  if (!actorUserId || actorUserId.length > 200) throw new IntakeStoreError("intake_operator_required");
  const store = createIntakeStore(ctx.db), binding = await store.getBinding(companyId);
  if (!binding) throw new IntakeStoreError("intake_not_enrolled");
  await currentConfig(ctx, binding);
  const retry = await store.retrySourceRead({ ...parsed.data, companyId, actorUserId, activationId: binding.activationId,
    fingerprint: binding.fingerprint, now: new Date().toISOString() });
  return { status: "source_retry_requested", intakeId: parsed.data.intakeId, retry, importPerformed: false };
}

export function sourceRecoveryStatus(row: IntakeRequest) {
  const remainingAttempts = Math.max(0, MAX_SOURCE_ATTEMPTS - row.attempts);
  const nextAction = row.status !== "blocked" ? null : remainingAttempts === 0 ? "source_attempt_limit"
    : row.errorCode === "source_read_failed" ? "retry-source-read" : "operator_investigation_required";
  return { intakeId: row.intakeId, status: row.status, version: row.version, attempts: row.attempts,
    errorCode: row.errorCode, remainingAttempts, nextAction, sourceRetryHistory: row.sourceRetryHistory ?? [] };
}
