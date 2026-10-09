import { createHash } from "node:crypto";
import { z } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";

export const CAMPAIGN_MODE = "milestone-fixed-v1" as const;
const CAMPAIGN_MARKER_SCHEMA = "linear-milestone-campaign.v1" as const;
const CAMPAIGN_READINESS_SCHEMA = "linear-milestone-campaign-readiness.v1" as const;

const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceReference = z.string().min(1).max(256);
const httpsUrl = z.url().max(2048).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
}, "Campaign references require a bounded HTTPS URL without credentials or fragments");

const campaignReferenceSchema = z.strictObject({
  url: httpsUrl,
  version: z.string().trim().min(1).max(64),
  sha256: digest,
});

const campaignMarkerSchema = z.strictObject({
  schema: z.literal(CAMPAIGN_MARKER_SCHEMA),
  milestoneId: uuid,
  prd: campaignReferenceSchema,
  tad: campaignReferenceSchema,
});

export const campaignReferenceContentSchema = campaignReferenceSchema.extend({
  content: z.string().min(1).max(1_000_000),
}).strict();

const campaignNativeMappingSchema = z.strictObject({
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

export const campaignSourceExtensionSchema = campaignReadinessSchema.extend({
  marker: campaignMarkerSchema,
  milestone: z.strictObject({ id: uuid, name: z.string().min(1), description: z.string().nullable() }),
  referenceContents: z.strictObject({
    prd: campaignReferenceContentSchema,
    tad: campaignReferenceContentSchema,
  }),
}).strict();

export type CampaignReference = z.infer<typeof campaignReferenceSchema>;
export type CampaignReferenceContent = z.infer<typeof campaignReferenceContentSchema>;
export type CampaignMarker = z.infer<typeof campaignMarkerSchema>;
export type CampaignReadiness = z.infer<typeof campaignReadinessSchema>;
export type CampaignSourceExtension = z.infer<typeof campaignSourceExtensionSchema>;
export type CampaignNativeMapping = z.infer<typeof campaignNativeMappingSchema>;

export class CampaignContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CampaignContractError"; }
}

function campaignError(code: string): never {
  throw new CampaignContractError(code);
}

function markerJson(source: string) {
  const openings = [...source.matchAll(/```paperclip-campaign\b/g)];
  const matches = [...source.matchAll(/^```paperclip-campaign[\t ]*\r?\n([\s\S]*?)\r?\n```[\t ]*$/gm)];
  if (openings.length !== 1 || matches.length !== 1) return campaignError("campaign_marker_invalid");
  try { return JSON.parse(matches[0]![1]!) as unknown; }
  catch { return campaignError("campaign_marker_invalid"); }
}

/** Returns undefined only when no campaign fence exists. Any malformed or repeated fence fails closed. */
export function parseCampaignMarker(description: string | null): CampaignMarker | undefined {
  const source = description ?? "";
  if (!source.includes("```paperclip-campaign")) return undefined;
  const parsed = campaignMarkerSchema.safeParse(markerJson(source));
  if (!parsed.success) return campaignError("campaign_marker_invalid");
  return parsed.data;
}

export function textSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

type MaterialIssue = {
  id: string; uuid: string; title: string; description: string | null; parentId: string | null;
  teamId: string; projectId: string | null; projectMilestone?: unknown; relations: unknown;
};
type StateIssue = MaterialIssue & {
  currentStateId: string; statusType: string; archivedAt: string | null;
  completedAt: string | null; canceledAt: string | null;
};

function milestoneId(issue: MaterialIssue) {
  const parsed = z.object({ id: uuid }).passthrough().nullable().safeParse(issue.projectMilestone);
  if (!parsed.success) return campaignError("campaign_milestone_shape_unqualified");
  return parsed.data?.id ?? null;
}

function materialIssue(issue: MaterialIssue) {
  return { id: issue.id, uuid: issue.uuid, title: issue.title, description: issue.description,
    parentId: issue.parentId, teamId: issue.teamId, projectId: issue.projectId,
    projectMilestoneId: milestoneId(issue), relations: issue.relations };
}

export function campaignMaterialSourceSha256(ticket: MaterialIssue, issues: MaterialIssue[],
  campaign: Pick<CampaignSourceExtension, "milestone" | "referenceContents" | "nativeMapping">): string {
  return contentDigest({ ticket: materialIssue(ticket), milestone: campaign.milestone,
    references: campaign.referenceContents,
    issues: issues.map(materialIssue).sort((a, b) => a.uuid.localeCompare(b.uuid)),
    nativeMapping: campaign.nativeMapping });
}

export function campaignStateObservationSha256(issues: StateIssue[]): string {
  const observation = issues.map(issue => ({ sourceId: issue.uuid, currentStateId: issue.currentStateId,
    statusType: issue.statusType, archived: issue.archivedAt !== null,
    completed: issue.completedAt !== null, canceled: issue.canceledAt !== null }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return contentDigest(observation);
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

