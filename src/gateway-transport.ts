import { request } from "node:http";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { parseLocalGatewayUrl, type parseConfig } from "./config.js";

type GatewayConfig = ReturnType<typeof parseConfig>;
interface GatewayReply {
  contentType: string | null;
  body: string;
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Only called with a parsed config and a natively resolved, request-local token. */
export async function postGateway(
  ctx: PluginContext, config: GatewayConfig, token: string, body: string,
): Promise<GatewayReply> {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
    "MCP-Protocol-Version": "2025-03-26",
  };
  if (config.gatewayTransport === "local_loopback") {
    return postLoopback(ctx, config, headers, body);
  }
  let response: Response;
  try {
    response = await ctx.http.fetch(config.gatewayUrl!, {
      method: "POST", redirect: "error", headers, body,
    });
  } catch { throw new Error("gateway_transport_failed"); }
  // Preserve host policy and SDK semantics; no fallback to local transport.
  if (!response.ok) throw new Error("gateway_http_rejected");
  let raw: string;
  try { raw = await response.text(); }
  catch { throw new Error("gateway_response_unreadable"); }
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("gateway_response_too_large");
  return { contentType: response.headers.get("content-type"), body: raw };
}

function postLoopback(
  ctx: PluginContext, config: GatewayConfig, headers: Record<string, string>, body: string,
): Promise<GatewayReply> {
  // Recheck at the effect boundary as well as during config parsing. A caller
  // cannot accidentally use this transport with a normalized/remote URL.
  const target = parseLocalGatewayUrl(config.gatewayUrl);
  const timeoutMs = config.localGatewayTimeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("invalid_configuration");
  }
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
    const timer = setTimeout(() => finish("gateway_request_timeout"), timeoutMs);
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
