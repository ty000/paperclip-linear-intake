import { createHash } from "node:crypto";
import { z } from "@paperclipai/plugin-sdk";

export const CAMPAIGN_MODE = "milestone-fixed-v1" as const;
export const CAMPAIGN_MARKER_SCHEMA = "linear-milestone-campaign.v1" as const;
export const CAMPAIGN_READINESS_SCHEMA = "linear-milestone-campaign-readiness.v1" as const;

const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceReference = z.string().min(1).max(256);
const httpsUrl = z.url().max(2048).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
}, "Campaign references require a bounded HTTPS URL without credentials or fragments");

export const campaignReferenceSchema = z.strictObject({
  url: httpsUrl,
  version: z.string().trim().min(1).max(64),
  sha256: digest,
});

export const campaignMarkerSchema = z.strictObject({
  schema: z.literal(CAMPAIGN_MARKER_SCHEMA),
  milestoneId: uuid,
  prd: campaignReferenceSchema,
  tad: campaignReferenceSchema,
});

export const campaignReferenceContentSchema = campaignReferenceSchema.extend({
  content: z.string().min(1).max(1_000_000),
}).strict();

export const campaignNativeMappingSchema = z.strictObject({
  sourceId: uuid,
  sourceParentId: sourceReference.nullable(),
  nativeParentSourceId: uuid.nullable(),
  role: z.enum(["campaign-root", "milestone-root", "milestone-node"]),
});

export const campaignReadinessSchema = z.strictObject({
  schema: z.literal(CAMPAIGN_READINESS_SCHEMA),
  mode: z.literal(CAMPAIGN_MODE),
  projectId: uuid,
  ticketSourceId: uuid,
  milestoneId: uuid,
  references: z.strictObject({ prd: campaignReferenceSchema, tad: campaignReferenceSchema }),
  materialSourceSha256: digest,
  stateCompatibility: z.strictObject({
    status: z.literal("compatible"),
    observationSha256: digest,
  }),
  nativeMapping: z.array(campaignNativeMappingSchema).min(2).max(33),
});

export type CampaignReference = z.infer<typeof campaignReferenceSchema>;
export type CampaignReferenceContent = z.infer<typeof campaignReferenceContentSchema>;
export type CampaignMarker = z.infer<typeof campaignMarkerSchema>;
export type CampaignReadiness = z.infer<typeof campaignReadinessSchema>;
export type CampaignNativeMapping = z.infer<typeof campaignNativeMappingSchema>;

export class CampaignContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CampaignContractError"; }
}

function campaignError(code: string): never {
  throw new CampaignContractError(code);
}

/** Returns undefined only when no campaign fence exists. Any malformed or repeated fence fails closed. */
export function parseCampaignMarker(description: string | null): CampaignMarker | undefined {
  const source = description ?? "";
  if (!source.includes("```paperclip-campaign")) return undefined;
  const openings = [...source.matchAll(/```paperclip-campaign\b/g)];
  if (openings.length !== 1) return campaignError("campaign_marker_invalid");
  const matches = [...source.matchAll(/^```paperclip-campaign[\t ]*\r?\n([\s\S]*?)\r?\n```[\t ]*$/gm)];
  if (matches.length !== 1) return campaignError("campaign_marker_invalid");
  let value: unknown;
  try { value = JSON.parse(matches[0]![1]!); }
  catch { return campaignError("campaign_marker_invalid"); }
  const parsed = campaignMarkerSchema.safeParse(value);
  if (!parsed.success) return campaignError("campaign_marker_invalid");
  return parsed.data;
}

export function textSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function resolveCampaignReference(reference: CampaignReference,
  enrolled: readonly CampaignReferenceContent[]): CampaignReferenceContent {
  const matches = enrolled.filter(candidate => candidate.url === reference.url
    && candidate.version === reference.version && candidate.sha256 === reference.sha256);
  if (matches.length !== 1) return campaignError("campaign_reference_missing");
  const parsed = campaignReferenceContentSchema.safeParse(matches[0]);
  if (!parsed.success || textSha256(parsed.data.content) !== parsed.data.sha256) {
    return campaignError("campaign_reference_invalid");
  }
  return parsed.data;
}

