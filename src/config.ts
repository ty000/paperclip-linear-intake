import { isIP } from "node:net";
import { z } from "@paperclipai/plugin-sdk";

// Intake activation is deliberately impossible until source access is qualified.
export const configSchema = z.strictObject({
  enabled: z.literal(false).default(false),
  gatewayDiscoveryEnabled: z.boolean().default(false),
  gatewayUrl: z.string().max(2048).optional(),
  gatewayTokenRef: z.strictObject({
    type: z.literal("secret_ref"),
    secretId: z.uuid(),
    version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
  }).optional(),
});

export function parseConfig(raw: unknown) {
  const result = configSchema.safeParse(raw);
  // Never forward validation errors: they can quote untrusted config values.
  if (!result.success) throw new Error("invalid_configuration");
  const config = result.data;
  if (config.gatewayUrl !== undefined) {
    let url: URL;
    try { url = new URL(config.gatewayUrl); }
    catch { throw new Error("invalid_gateway_url"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
        || isIP(url.hostname) || url.hostname.includes(":")
        || !url.hostname.includes(".") || url.hostname.endsWith(".localhost")
        || url.hostname.endsWith(".local")
        || !/^\/mcp\/gateways\/[a-zA-Z0-9_-]+$/.test(url.pathname)) {
      throw new Error("invalid_gateway_url");
    }
  }
  if (config.gatewayDiscoveryEnabled && (!config.gatewayUrl || !config.gatewayTokenRef)) {
    throw new Error("gateway_configuration_missing");
  }
  return config;
}
