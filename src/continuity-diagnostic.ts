import type { ContinuityRequest } from "./continuity-contract.js";
import { contentDigest } from "./content-digest.js";
import { SourceReadError } from "./source-client.js";

export type SourceDiagnostic = {
  code: "source_changed" | "source_state_changed" | "source_unavailable" | "publication_unavailable";
  expectedSourceSha256: string;
  observedSourceSha256?: string;
  changedSourceIds: string[];
  changedFields: Array<"membership" | "hierarchy" | "title" | "description" | "dependencies" | "milestone" | "references" | "status" | "archive">;
};

export class ContinuitySourceError extends Error {
  constructor(readonly diagnostic: SourceDiagnostic) { super(diagnostic.code); }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function issues(value: unknown) {
  const rows = record(value).issues;
  return new Map((Array.isArray(rows) ? rows : []).map(row => [String(record(row).uuid), record(row)]));
}

function issueDifference(left?: Record<string, unknown>, right?: Record<string, unknown>): SourceDiagnostic["changedFields"] {
  if (!left || !right) return ["membership"];
  const names = { title: "title", description: "description", parentId: "hierarchy", relations: "dependencies",
    projectMilestone: "milestone", projectId: "membership", teamId: "membership" } as const;
  return Object.entries(names).filter(([key]) => contentDigest(left[key] ?? null) !== contentDigest(right[key] ?? null))
    .map(([, label]) => label);
}

function changedIssues(original: unknown, observed: unknown) {
  const before = issues(original), after = issues(observed), changedSourceIds: string[] = [];
  const fields = new Set<SourceDiagnostic["changedFields"][number]>();
  const selected = new Set([...before.keys(), ...after.keys()]);
  for (const id of selected) {
    const changed = issueDifference(before.get(id), after.get(id));
    for (const field of changed) fields.add(field);
    if (changed.length) changedSourceIds.push(id);
  }
  return { changedSourceIds, fields };
}

function referenceDifference(leftCampaign: Record<string, unknown>, rightCampaign: Record<string, unknown>): SourceDiagnostic["changedFields"] {
  const names = { milestone: "milestone", referenceContents: "references" } as const;
  return Object.entries(names).filter(([key]) => contentDigest(leftCampaign[key] ?? null) !== contentDigest(rightCampaign[key] ?? null))
    .map(([, label]) => label);
}

/** Only field names and source UUIDs leave the reader, never changed text or upstream errors. */
export function materialDiagnostic(original: unknown, observed: unknown, request: ContinuityRequest): SourceDiagnostic {
  const { changedSourceIds, fields } = changedIssues(original, observed);
  const leftCampaign = record(record(original).campaign), rightCampaign = record(record(observed).campaign);
  for (const field of referenceDifference(leftCampaign, rightCampaign)) fields.add(field);
  return { code: "source_changed", expectedSourceSha256: request.sourceSha256,
    observedSourceSha256: String(rightCampaign.materialSourceSha256),
    changedSourceIds: changedSourceIds.filter(id => /^[a-f0-9-]{36}$/i.test(id)).sort().slice(0, 33), changedFields: [...fields].sort() };
}

export function continuityDiagnostic(error: unknown, request: ContinuityRequest): SourceDiagnostic {
  if (error instanceof ContinuitySourceError) return error.diagnostic;
  const stateChanged = error instanceof SourceReadError && ["campaign_state_incompatible", "campaign_work_already_started", "source_state_changed"].includes(error.code);
  return { code: stateChanged ? "source_state_changed" : error instanceof SourceReadError ? "source_unavailable" : "publication_unavailable",
    expectedSourceSha256: request.sourceSha256, changedSourceIds: [], changedFields: stateChanged ? ["status"] : [] };
}
