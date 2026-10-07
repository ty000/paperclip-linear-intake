import { isIP } from "node:net";
import { z } from "@paperclipai/plugin-sdk";

const toolPin = z.strictObject({
  name: z.string().min(1).max(256),
  inputSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

// Intake activation is deliberately impossible until source access is qualified.
export const configSchema = z.strictObject({
  enabled: z.literal(false).default(false),
  gatewayDiscoveryEnabled: z.boolean().default(false),
  gatewayTransport: z.enum(["host_http", "local_loopback"]).default("host_http"),
  sourceProbe: z.strictObject({
    teamId: z.uuid(),
    projectId: z.uuid(),
    // Optional issue reads must be enrolled explicitly after scoped discovery.
    sampleIssueIds: z.array(z.uuid()).max(2).default([]),
    tools: z.strictObject({
      getWorkspace: toolPin.optional(),
      getProject: toolPin, getTeam: toolPin, listStatuses: toolPin,
      listIssues: toolPin, getIssue: toolPin,
    }),
  }).optional(),
  sourceReader: z.strictObject({
    organizationId: z.uuid(), teamId: z.uuid(), projectId: z.uuid(), todoStateId: z.uuid(),
    qualificationRootIssueIds: z.array(z.uuid()).max(2).default([]),
    tools: z.strictObject({
      getWorkspace: toolPin, getProject: toolPin, getTeam: toolPin,
      listStatuses: toolPin, listIssues: toolPin, getIssue: toolPin,
    }),
    maxIssues: z.number().int().min(1).max(100).default(50),
    maxPagesPerParent: z.number().int().min(1).max(20).default(10),
    pageSize: z.number().int().min(1).max(100).default(50),
    maxRequests: z.number().int().min(1).max(500).default(250),
    deadlineMs: z.number().int().min(1000).max(120_000).default(60_000),
  }).optional(),
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

type Config = z.infer<typeof configSchema>;

function isLocalHostname(hostname: string) {
  return hostname.includes(":") || hostname.endsWith(".localhost") || hostname.endsWith(".local");
}

function validateGatewayHostname(hostname: string) {
  if (isIP(hostname) || !hostname.includes(".") || isLocalHostname(hostname)) {
    throw new Error("invalid_gateway_url");
  }
}

function validateHostGatewayUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("invalid_gateway_url"); }
  // None of these optional URL components belongs in a gateway address.
  if ([url.username, url.password, url.search, url.hash].some(Boolean)) throw new Error("invalid_gateway_url");
  validateGatewayHostname(url.hostname);
  validateGatewayEndpoint(url);
}

function validateGatewayEndpoint(url: URL) {
  if (url.protocol !== "https:" || !/^\/mcp\/gateways\/[a-zA-Z0-9_-]+$/.test(url.pathname)) {
    throw new Error("invalid_gateway_url");
  }
}

function validateGatewayTransport(config: Config) {
  if (config.gatewayTransport === "local_loopback") {
    // Match the raw spelling before WHATWG URL normalization.
    parseLocalGatewayUrl(config.gatewayUrl);
    return;
  }
  if (config.localGatewayTimeoutMs !== undefined) throw new Error("invalid_configuration");
  if (config.gatewayUrl !== undefined) validateHostGatewayUrl(config.gatewayUrl);
}

function validateProbeEnrollment(config: Config) {
  if (!config.sourceProbe) return;
  if (!config.gatewayDiscoveryEnabled) throw new Error("gateway_configuration_missing");
  const ids = config.sourceProbe.sampleIssueIds;
  if (new Set(ids).size !== ids.length) throw new Error("invalid_configuration");
}

function validateGatewayDiscovery(config: Config) {
  if (!config.gatewayDiscoveryEnabled) return;
  if (!config.gatewayUrl || !config.gatewayTokenRef) throw new Error("gateway_configuration_missing");
}

function validateReaderEnrollment(config: Config) {
  if (!config.sourceReader) return;
  if (!config.gatewayDiscoveryEnabled) throw new Error("gateway_configuration_missing");
  const ids = config.sourceReader.qualificationRootIssueIds;
  if (new Set(ids).size !== ids.length) throw new Error("invalid_configuration");
}

export function parseConfig(raw: unknown) {
  const result = configSchema.safeParse(raw);
  // Never forward validation errors: they can quote untrusted config values.
  if (!result.success) throw new Error("invalid_configuration");
  const config = result.data;
  validateGatewayTransport(config);
  validateProbeEnrollment(config);
  validateReaderEnrollment(config);
  validateGatewayDiscovery(config);
  return config;
}
