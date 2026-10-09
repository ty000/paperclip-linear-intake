import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import type { parseConfig } from "./config.js";
import { postNativeGatewayCall } from "./gateway-transport.js";
import { unwrapManagedPayload } from "./source-payload.js";

const callSchema = z.strictObject({
  name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}),
});
const resultSchema = z.object({ content: z.string(), data: z.unknown() }).passthrough()
  .refine(value => !Object.hasOwn(value, "error"));
const completedSchema = z.object({
  invocationId: z.uuid(), status: z.literal("completed"), tool: z.string().min(1), result: resultSchema,
});
type AssertCredentialAbsent = (value: unknown) => void;

function parseResponse(raw: string, assertCredentialAbsent: AssertCredentialAbsent) {
  assertCredentialAbsent(raw);
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("gateway_response_invalid"); }
  assertCredentialAbsent(value);
  const parsed = completedSchema.safeParse(value);
  if (!parsed.success) throw new Error("gateway_native_response_rejected");
  return parsed.data;
}

function normalizedResult(data: unknown, assertCredentialAbsent: AssertCredentialAbsent) {
  const result = { isError: false, structuredContent: data };
  // Validate the managed envelope and detect unicode escapes in its JSON text.
  const payload = unwrapManagedPayload(result);
  assertCredentialAbsent(payload);
  return result;
}

function requireJson(contentType: string | null) {
  if (!contentType?.toLowerCase().startsWith("application/json")) throw new Error("gateway_transport_unsupported");
}

export async function callNativeGateway(
  ctx: PluginContext, config: ReturnType<typeof parseConfig>, token: string,
  params: Record<string, unknown>, assertCredentialAbsent: AssertCredentialAbsent,
  purpose: "read" | "publication" = "read",
) {
  const call = callSchema.safeParse(params);
  if (!call.success) throw new Error("gateway_native_call_invalid");
  const response = await postNativeGatewayCall(ctx, config, token, JSON.stringify({
    tool: call.data.name, parameters: call.data.arguments, timeoutMs: config.nativeToolTimeoutMs ?? 20_000,
  }), purpose);
  requireJson(response.contentType);
  const completed = parseResponse(response.body, assertCredentialAbsent);
  if (completed.tool !== call.data.name) throw new Error("gateway_native_tool_mismatch");
  return normalizedResult(completed.result.data, assertCredentialAbsent);
}
