import { z } from "@paperclipai/plugin-sdk";

const pin = z.strictObject({ name: z.string().min(1).max(256), inputSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const publisherSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Display only: enrolled origin, never inferred from the gateway or request headers.
  paperclipBaseUrl: z.string().url().max(2048).refine(raw => {
    const url = new URL(raw);
    return ![url.username, url.password, url.search, url.hash].some(Boolean) && url.pathname === "/"
      && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }).optional(),
  gatewayUrl: z.string().max(2048),
  gatewayTokenRef: z.strictObject({ type: z.literal("secret_ref"), secretId: z.uuid(), version: z.union([z.literal("latest"), z.number().int().positive()]).optional() }),
  tools: z.strictObject({ saveComment: pin, listComments: pin, saveIssue: pin, getIssue: pin }),
  states: z.strictObject({ started: z.uuid(), completed: z.uuid(), cancelled: z.uuid() }),
  maxCommentPages: z.number().int().min(1).max(20).default(10),
  pageSize: z.number().int().min(1).max(250).default(100),
});
