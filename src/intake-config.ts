import { z } from "@paperclipai/plugin-sdk";

export const intakeConfigSchema = z.strictObject({
  webhookId: z.uuid(),
  webhookSecretRef: z.strictObject({
    type: z.literal("secret_ref"), secretId: z.uuid(),
    version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
  }),
  targetProjectId: z.uuid(),
  allowedActors: z.array(z.strictObject({ id: z.uuid(), type: z.string().min(1).max(128) })).min(1).max(50),
});

type IntakeConfig = z.infer<typeof intakeConfigSchema>;

type Settings = { enabled: boolean; intake?: IntakeConfig | undefined; sourceReader?: unknown };

function requireEnabledSettings(config: Settings) {
  if (!config.enabled) return;
  if (!config.intake || !config.sourceReader) throw new Error("intake_configuration_missing");
}

export function validateIntakeSettings(config: Settings) {
  requireEnabledSettings(config);
  if (!config.intake) return;
  const actors = config.intake.allowedActors.map(actor => `${actor.type}:${actor.id}`);
  if (new Set(actors).size !== actors.length) throw new Error("intake_actors_duplicated");
}
