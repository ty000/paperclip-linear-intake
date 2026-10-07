import { createHash } from "node:crypto";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";

const toolSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().optional(),
  inputSchema: z.object({ type: z.literal("object") }).catchall(z.unknown()),
}).passthrough();
const catalogSchema = z.object({
  tools: z.array(toolSchema).max(1000),
  nextCursor: z.string().min(1).max(4096).optional(),
});
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// Only native SDK surfaces. This is catalog discovery, not a Linear adapter.
// No tools/call implementation exists until actual Linear schemas are verified.
export async function inspectGateway(ctx: PluginContext, companyId: string) {
  if (!z.uuid().safeParse(companyId).success) throw new Error("company_scope_required");
  let config;
  try { config = parseConfig(await ctx.config.get(companyId)); }
  catch { throw new Error("configuration_unavailable_or_invalid"); }
  if (!config.gatewayDiscoveryEnabled) return { status: "disabled" as const, intakeEnabled: false };
  const gatewayUrl = config.gatewayUrl!;
  const secretRef = config.gatewayTokenRef!;
  let token: string;
  try {
    token = await ctx.secrets.resolve({
      type: secretRef.type, secretId: secretRef.secretId,
      ...(secretRef.version === undefined ? {} : { version: secretRef.version }),
    }, { companyId, configPath: "gatewayTokenRef" });
  } catch { throw new Error("gateway_secret_unavailable"); }
  if (!token || /[\r\n]/.test(token)) throw new Error("gateway_secret_unavailable");

  let sequence = 0;
  async function rpc(method: string, params: Record<string, unknown>, notification = false) {
    const id = ++sequence;
    let response: Response;
    try {
      response = await ctx.http.fetch(gatewayUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          "MCP-Protocol-Version": "2025-03-26",
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
      });
    } catch { throw new Error("gateway_transport_failed"); }
    if (!response.ok) throw new Error("gateway_http_rejected");
    if (notification) return undefined;
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new Error("gateway_transport_unsupported");
    }
    let raw: string;
    try { raw = await response.text(); }
    catch { throw new Error("gateway_response_unreadable"); }
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("gateway_response_too_large");
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
    clientInfo: { name: "paperclip-linear-intake", version: "0.1.0" },
  });
  const init = z.object({
    protocolVersion: z.literal("2025-03-26"),
    capabilities: z.object({ tools: z.object({}).passthrough() }).passthrough(),
  }).safeParse(initialized);
  if (!init.success) throw new Error("gateway_protocol_unsupported");
  await rpc("notifications/initialized", {}, true);
  const tools: z.infer<typeof toolSchema>[] = [];
  const seenNames = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = catalogSchema.safeParse(await rpc("tools/list", cursor ? { cursor } : {}));
    if (!result.success) throw new Error("gateway_catalog_incomplete");
    for (const tool of result.data.tools) {
      if (seenNames.has(tool.name)) throw new Error("gateway_catalog_duplicate_tool");
      seenNames.add(tool.name);
      tools.push(tool);
      if (tools.length > 1000) throw new Error("gateway_catalog_bound_exceeded");
    }
    cursor = result.data.nextCursor;
    if (!cursor) {
      return {
        status: "catalog_observed" as const,
        intakeEnabled: false,
        sourceCoverage: "unqualified" as const,
        protocolVersion: init.data.protocolVersion,
        catalogSha256: createHash("sha256").update(JSON.stringify(tools)).digest("hex"),
        tools,
      };
    }
    if (cursors.has(cursor)) throw new Error("gateway_catalog_cursor_repeated");
    cursors.add(cursor);
  }
  throw new Error("gateway_catalog_page_bound_exceeded");
}
