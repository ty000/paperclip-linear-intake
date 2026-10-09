import { request } from "node:http";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig, parseLocalGatewayUrl } from "./config.js";

type GatewayConfig = ReturnType<typeof parseConfig>;
interface GatewayReply {
  contentType: string | null;
  body: string;
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const NATIVE_CALL_PATH = "/api/tool-gateway/tools/call";
const mcpTimeoutSchema = z.number().int().min(100).max(10_000);

/** Only called with a parsed config and a natively resolved, request-local token. */
export async function postGateway(
  ctx: PluginContext, config: GatewayConfig, token: string, body: string,
  purpose: "read" | "publication" = "read",
): Promise<GatewayReply> {
  return postRequest(ctx, config, token, body, false, purpose);
}

/** The original named gateway is still validated; the REST endpoint is fixed. */
export async function postNativeGatewayCall(
  ctx: PluginContext, config: GatewayConfig, token: string, body: string,
  purpose: "read" | "publication" = "read",
): Promise<GatewayReply> {
  const validated = parseConfig(config);
  if (validated.gatewayToolCallMode !== "native_rest") throw new Error("invalid_configuration");
  return postRequest(ctx, validated, token, body, true, purpose);
}

function requestHeaders(token: string, nativeCall: boolean) {
  // REST authenticates the same gateway credential via its dedicated header.
  // A Bearer header there would instead enter the board/agent auth middleware.
  const credential = nativeCall
    ? { "x-paperclip-tool-gateway-token": token }
    : { authorization: `Bearer ${token}` };
  return {
    ...credential, "content-type": "application/json", accept: "application/json",
    "MCP-Protocol-Version": "2025-03-26",
  };
}

async function postRequest(
  ctx: PluginContext, config: GatewayConfig, token: string, body: string, nativeCall: boolean,
  purpose: "read" | "publication",
): Promise<GatewayReply> {
  const headers = requestHeaders(token, nativeCall);
  if (config.gatewayTransport === "local_loopback") {
    return postLoopback(ctx, config, headers, body, nativeCall, purpose);
  }
  const gatewayUrl = purpose === "publication" ? config.publisher!.gatewayUrl : config.gatewayUrl!;
  const url = nativeCall ? new URL(NATIVE_CALL_PATH, gatewayUrl).href : gatewayUrl;
  return postHostRequest(ctx, url, headers, body);
}

async function postHostRequest(ctx: PluginContext, url: string, headers: Record<string, string>, body: string) {
  let response: Response;
  try {
    response = await ctx.http.fetch(url, {
      method: "POST", redirect: "error", headers, body,
    });
  } catch { throw new Error("gateway_transport_failed"); }
  // Preserve host policy and SDK semantics; no fallback to local transport.
  if (!response.ok) throw new Error("gateway_http_rejected");
  return readHostResponse(response);
}

async function readHostResponse(response: Response): Promise<GatewayReply> {
  let raw: string;
  try { raw = await response.text(); }
  catch { throw new Error("gateway_response_unreadable"); }
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("gateway_response_too_large");
  return { contentType: response.headers.get("content-type"), body: raw };
}

function loopbackTarget(config: GatewayConfig, nativeCall: boolean, purpose: "read" | "publication") {
  // Recheck at the effect boundary as well as during config parsing. A caller
  // cannot accidentally use this transport with a normalized/remote URL.
  const target = parseLocalGatewayUrl(purpose === "publication" ? config.publisher!.gatewayUrl : config.gatewayUrl);
  if (nativeCall) {
    return { port: target.port, path: NATIVE_CALL_PATH, timeoutMs: (config.nativeToolTimeoutMs ?? 20_000) + 2000 };
  }
  return { ...target, timeoutMs: mcpLocalTimeout(config) };
}

function mcpLocalTimeout(config: GatewayConfig) {
  const timeout = mcpTimeoutSchema.safeParse(config.localGatewayTimeoutMs ?? 5000);
  if (!timeout.success) throw new Error("invalid_configuration");
  return timeout.data;
}

function postLoopback(
  ctx: PluginContext, config: GatewayConfig, headers: Record<string, string>, body: string, nativeCall: boolean,
  purpose: "read" | "publication",
): Promise<GatewayReply> {
  const target = loopbackTarget(config, nativeCall, purpose);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let settled = false;
    let bytes = 0;
    let status: number | undefined;
    let req: ReturnType<typeof request> | undefined;
    const chunks: Buffer[] = [];
    const finish = (outcome: string, reply?: GatewayReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      // Deliberately omit URL, token, body, headers and upstream error text.
      try {
        ctx.logger.info("Local gateway request completed", {
          transport: "local_loopback", outcome, status, responseBytes: bytes,
          durationMs: Math.round(performance.now() - started),
        });
      } catch { /* Logging failures must never surface upstream content. */ }
      if (reply) resolve(reply);
      else reject(new Error(outcome));
    };
    // Absolute deadline includes connecting, response headers and body streaming.
    const timer = setTimeout(() => finish("gateway_request_timeout"), target.timeoutMs);
    try {
      req = request({
        hostname: "127.0.0.1", family: 4, port: target.port, path: target.path,
        method: "POST", headers, agent: false,
        // node:http with an explicit direct agent does not use proxy env vars,
        // perform redirects or decompress responses. No custom DNS lookup.
      }, (res) => {
        res.once("error", () => finish("gateway_response_unreadable"));
        res.once("aborted", () => finish("gateway_response_unreadable"));
        status = res.statusCode;
        if (status === undefined || status < 200 || status >= 300) {
          finish("gateway_http_rejected");
          return;
        }
        const length = res.headers["content-length"];
        if (length !== undefined && Number(length) > MAX_RESPONSE_BYTES) {
          finish("gateway_response_too_large");
          return;
        }
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) finish("gateway_response_too_large");
          else chunks.push(chunk);
        });
        res.once("end", () => finish("ok", {
          contentType: res.headers["content-type"] ?? null,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      req.once("error", () => finish("gateway_transport_failed"));
      req.end(body);
    } catch { finish("gateway_transport_failed"); }
  });
}
