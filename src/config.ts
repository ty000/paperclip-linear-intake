import { isIP } from "node:net";
import { intakeConfigSchema, validateIntakeSettings } from "./intake-config.js";
import { z } from "@paperclipai/plugin-sdk";
import { campaignReferenceContentSchema } from "./campaign-contract.js";

const toolPin = z.strictObject({
  name: z.string().min(1).max(256),
  inputSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

// Configuration starts suspended; durable operator enrollment is separate.
export const configSchema = z.strictObject({
  enabled: z.boolean().default(false),
  nativeImportEnabled: z.boolean().default(false),
  // Changing this opt-in changes the enrollment fingerprint; an old binding is never silently upgraded.
  councilHandoffEnabled: z.boolean().default(false),
  intake: intakeConfigSchema.optional(),
  gatewayDiscoveryEnabled: z.boolean().default(false),
  gatewayTransport: z.enum(["host_http", "local_loopback"]).default("host_http"),
  gatewayToolCallMode: z.enum(["mcp", "native_rest"]).default("mcp"),
  nativeToolTimeoutMs: z.number().int().min(1000).max(30_000).optional(),
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
  campaignSource: z.strictObject({
    projectMetadataScope: z.literal("enrolled"),
    adapterQualification: z.strictObject({
      adapter: z.literal("linear-get-project-milestones.v1"),
      catalogSha256: z.string().regex(/^[a-f0-9]{64}$/),
      observedShapeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    referenceDocuments: z.array(campaignReferenceContentSchema).min(2).max(20),
    compatibleCampaignStateIds: z.array(z.uuid()).min(1).max(20),
    maxProjectPages: z.number().int().min(1).max(20).default(10),
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

function validateCampaignEnrollment(config: Config) {
  const campaign = config.campaignSource;
  if (!campaign) return;
  if (!config.sourceReader || !config.gatewayDiscoveryEnabled) throw new Error("campaign_configuration_missing");
  if (!campaign.compatibleCampaignStateIds.includes(config.sourceReader.todoStateId)) {
    throw new Error("campaign_configuration_invalid");
  }
  if (new Set(campaign.compatibleCampaignStateIds).size !== campaign.compatibleCampaignStateIds.length) {
    throw new Error("campaign_configuration_invalid");
  }
  const references = campaign.referenceDocuments.map(reference => `${reference.url}\u0000${reference.version}\u0000${reference.sha256}`);
  if (new Set(references).size !== references.length) throw new Error("campaign_configuration_invalid");
}

function validateToolCallMode(config: Config) {
  if (config.gatewayToolCallMode === "native_rest") return;
  if (config.nativeToolTimeoutMs !== undefined) throw new Error("invalid_configuration");
}

function validateNativeImport(config: Config) {
  if (config.nativeImportEnabled && (!config.intake || !config.sourceReader)) throw new Error("import_configuration_missing");
}

function validateCouncilHandoff(config: Config) {
  if (!config.councilHandoffEnabled) return;
  if (!config.nativeImportEnabled) throw new Error("handoff_configuration_missing");
}

export function parseConfig(raw: unknown) {
  const result = configSchema.safeParse(raw);
  // Never forward validation errors: they can quote untrusted config values.
  if (!result.success) throw new Error("invalid_configuration");
  const config = result.data;
  validateGatewayTransport(config);
  validateToolCallMode(config);
  validateProbeEnrollment(config);
  validateReaderEnrollment(config);
  validateCampaignEnrollment(config);
  validateGatewayDiscovery(config);
  validateIntakeSettings(config);
  validateNativeImport(config);
  validateCouncilHandoff(config);
  return config;
}
