import { isIP } from "node:net";
import { z } from "@paperclipai/plugin-sdk";

// Intake activation is deliberately impossible until source access is qualified.
export const configSchema = z.strictObject({
  enabled: z.literal(false).default(false),
  gatewayDiscoveryEnabled: z.boolean().default(false),
  gatewayTransport: z.enum(["host_http", "local_loopback"]).default("host_http"),
  gatewayUrl: z.string().max(2048).optional(),
  localGatewayTimeoutMs: z.number().int().min(100).max(10_000).optional(),
  gatewayTokenRef: z.strictObject({
    type: z.literal("secret_ref"),
    secretId: z.uuid(),
    version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
  }).optional(),
});

export function parseLocalGatewayUrl(raw: string | undefined) {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})(\/mcp\/gateways\/[a-zA-Z0-9_-]+)$/.exec(raw ?? "");
  if (!match || match[0] !== raw || Number(match[1]) > 65535) {
    throw new Error("invalid_local_gateway_url");
  }
  return { port: Number(match[1]), path: match[2]! };
}

export function parseConfig(raw: unknown) {
  const result = configSchema.safeParse(raw);
  // Never forward validation errors: they can quote untrusted config values.
  if (!result.success) throw new Error("invalid_configuration");
  const config = result.data;
  if (config.gatewayTransport === "local_loopback") {
    // Match the raw spelling, before WHATWG URL normalization. No aliases,
    // DNS, credentials, query, fragments, traversal or alternative endpoints.
    parseLocalGatewayUrl(config.gatewayUrl);
  } else if (config.localGatewayTimeoutMs !== undefined) {
    throw new Error("invalid_configuration");
  }
  if (config.gatewayTransport === "host_http" && config.gatewayUrl !== undefined) {
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
