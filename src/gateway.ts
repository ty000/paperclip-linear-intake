import { createHash } from "node:crypto";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { postGateway } from "./gateway-transport.js";
import { callNativeGateway } from "./gateway-native-call.js";

const toolSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().optional(),
  inputSchema: z.object({ type: z.literal("object") }).catchall(z.unknown()),
}).passthrough();
const catalogSchema = z.object({
  tools: z.array(toolSchema).max(1000),
  nextCursor: z.string().min(1).max(4096).optional(),
});
type GatewayConfig = ReturnType<typeof parseConfig>;
export type GatewayReadGuard = (config: GatewayConfig) => Promise<void>;
type GatewayTool = z.infer<typeof toolSchema>;
type GatewayRpc = (method: "initialize" | "notifications/initialized" | "tools/list" | "tools/call",
  params: Record<string, unknown>, notification?: boolean) => Promise<unknown>;

async function readGatewayConfig(ctx: PluginContext, companyId: string) {
  try { return parseConfig(await ctx.config.get(companyId)); }
  catch { throw new Error("configuration_unavailable_or_invalid"); }
}

async function resolveGatewaySecret(ctx: PluginContext, companyId: string, secretRef: NonNullable<GatewayConfig["gatewayTokenRef"]>) {
  try {
    return await ctx.secrets.resolve({
      type: secretRef.type, secretId: secretRef.secretId,
      ...(secretRef.version === undefined ? {} : { version: secretRef.version }),
    }, { companyId, configPath: "gatewayTokenRef" });
  } catch { throw new Error("gateway_secret_unavailable"); }
}

function validateGatewaySecret(token: string) {
  if (!token || /[\r\n]/.test(token)) throw new Error("gateway_secret_unavailable");
}

async function readCatalogPage(rpc: GatewayRpc, cursor: string | undefined) {
  const result = catalogSchema.safeParse(await rpc("tools/list", cursor ? { cursor } : {}));
  if (!result.success) throw new Error("gateway_catalog_incomplete");
  return result.data;
}

function appendCatalogTools(tools: GatewayTool[], page: GatewayTool[], seenNames: Set<string>) {
  for (const tool of page) {
    if (seenNames.has(tool.name)) throw new Error("gateway_catalog_duplicate_tool");
    seenNames.add(tool.name);
    tools.push(tool);
    if (tools.length > 1000) throw new Error("gateway_catalog_bound_exceeded");
  }
}

async function readCatalog(rpc: GatewayRpc) {
  const tools: GatewayTool[] = [];
  const seenNames = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await readCatalogPage(rpc, cursor);
    appendCatalogTools(tools, result.tools, seenNames);
    cursor = result.nextCursor;
    if (!cursor) return tools;
    if (cursors.has(cursor)) throw new Error("gateway_catalog_cursor_repeated");
    cursors.add(cursor);
  }
  throw new Error("gateway_catalog_page_bound_exceeded");
}

function configuredRpc(mode: GatewayConfig["gatewayToolCallMode"], mcp: GatewayRpc,
  nativeCall: (params: Record<string, unknown>) => Promise<unknown>): GatewayRpc {
  if (mode !== "native_rest") return mcp;
  return (method, params, notification) => {
    if (method === "tools/call") return nativeCall(params);
    return mcp(method, params, notification);
  };
}

// Native config/secrets and named gateway. Explicit loopback transport is opt-in.
// Catalog discovery and bounded qualification share native authentication.
// Only explicitly configured source readers call tools/call.
export async function openGateway(ctx: PluginContext, companyId: string, guard: GatewayReadGuard = async () => {}) {
  if (!z.uuid().safeParse(companyId).success) throw new Error("company_scope_required");
  const config = await readGatewayConfig(ctx, companyId);
  if (!config.gatewayDiscoveryEnabled) return undefined;
  await guard(config);
  const token = await resolveGatewaySecret(ctx, companyId, config.gatewayTokenRef!);
  validateGatewaySecret(token);

  function assertCredentialAbsent(value: unknown) {
    if (JSON.stringify(value).includes(JSON.stringify(token).slice(1, -1))) {
      throw new Error("gateway_response_rejected");
    }
  }

  let sequence = 0;
  async function rpc(method: "initialize" | "notifications/initialized" | "tools/list" | "tools/call", params: Record<string, unknown>, notification = false) {
    await guard(config);
    const id = ++sequence;
    const response = await postGateway(ctx, config, token,
      JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }));
    if (notification) return undefined;
    if (!response.contentType?.toLowerCase().startsWith("application/json")) {
      throw new Error("gateway_transport_unsupported");
    }
    const raw = response.body;
    // A provider echoing the credential must not leak it through catalog output.
    let envelope;
    try { envelope = JSON.parse(raw); }
    catch { throw new Error("gateway_response_invalid"); }
    const serializedToken = JSON.stringify(token).slice(1, -1);
    if (raw.includes(token) || JSON.stringify(envelope).includes(serializedToken)) throw new Error("gateway_response_rejected");
    if (!envelope || envelope.jsonrpc !== "2.0" || envelope.id !== id || envelope.error
        || !Object.hasOwn(envelope, "result")) throw new Error("gateway_rpc_rejected");
    return envelope.result as unknown;
  }

  const initialized = await rpc("initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "paperclip-linear-intake", version: "0.2.0" },
  });
  const init = z.object({
    protocolVersion: z.literal("2025-03-26"),
    capabilities: z.object({ tools: z.object({}).passthrough() }).passthrough(),
  }).safeParse(initialized);
  if (!init.success) throw new Error("gateway_protocol_unsupported");
  await rpc("notifications/initialized", {}, true);
  const tools = await readCatalog(rpc);
  // Expose REST dispatch only after the named MCP gateway authenticated and
  // returned its complete catalog. Callers still validate all source role pins.
  const sessionRpc = configuredRpc(config.gatewayToolCallMode, rpc,
    async params => {
      await guard(config);
      return callNativeGateway(ctx, config, token, params, assertCredentialAbsent);
    });
  return {
    rpc: sessionRpc, assertCredentialAbsent, config, protocolVersion: init.data.protocolVersion,
    catalogSha256: createHash("sha256").update(JSON.stringify(tools)).digest("hex"), tools,
  };
}

export async function inspectGateway(ctx: PluginContext, companyId: string) {
  const session = await openGateway(ctx, companyId);
  if (!session) return { status: "disabled" as const, importEnabled: false };
  return {
    status: "catalog_observed" as const, importEnabled: false,
    sourceCoverage: "unqualified" as const, protocolVersion: session.protocolVersion,
    catalogSha256: session.catalogSha256, tools: session.tools,
  };
}
