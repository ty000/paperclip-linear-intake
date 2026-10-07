import { z, type PluginContext, type Issue } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { assertImport } from "./import-state.js";

export type NativeIssueIntent = {
  companyId: string; projectId: string; parentId: string | null; title: string;
  description: string; status: "blocked" | "done" | "cancelled"; originKind: "plugin:ty000.linear-intake"; originId: string;
};
export type NativeDocumentIntent = {
  companyId: string; issueId: string; key: string; title: string; format: "markdown"; body: string;
};
export type NativeRelationIntent = { companyId: string; issueId: string; blockerIds: string[] };
export type NativeOperation = {
  intent: Record<string, unknown>;
  read: () => Promise<Record<string, unknown> | undefined>;
  dispatch: () => Promise<void>;
};

function same(actual: unknown, expected: unknown) {
  assertImport(contentDigest(actual) === contentDigest(expected), "import_native_readback_mismatch");
}

function nativeId(value: unknown) {
  assertImport(z.uuid().safeParse(value).success, "import_native_identity_invalid");
  return value as string;
}

function issueFields(issue: Issue): NativeIssueIntent {
  return { companyId: issue.companyId, projectId: issue.projectId!, parentId: issue.parentId,
    title: issue.title, description: issue.description!, status: issue.status as NativeIssueIntent["status"],
    originKind: issue.originKind as NativeIssueIntent["originKind"], originId: issue.originId! };
}

function issueResult(issue: Issue, intent: NativeIssueIntent) {
  same(issueFields(issue), intent);
  same([issue.assigneeAgentId, issue.assigneeUserId, issue.executionRunId, issue.checkoutRunId,
    issue.executionLockedAt, issue.archivedAt], [null, null, null, null, null, null]);
  return { nativeId: nativeId(issue.id), contentSha256: contentDigest(intent) };
}

async function readIssue(ctx: PluginContext, intent: NativeIssueIntent) {
  // The host applies offsets twice; exact origin lookup needs only the first
  // two matches. More than one is ambiguous and never authorizes another create.
  const matches = await ctx.issues.list({ companyId: intent.companyId, originKind: intent.originKind,
    originId: intent.originId, includePluginOperations: true, limit: 2, offset: 0 });
  if (matches.length === 0) return undefined;
  assertImport(matches.length === 1, "import_native_identity_ambiguous");
  const id = nativeId(matches[0]!.id);
  const issue = await ctx.issues.get(id, intent.companyId);
  assertImport(issue !== null, "import_native_issue_missing");
  return issueResult(issue!, intent);
}

export function issueOperation(ctx: PluginContext, intent: NativeIssueIntent): NativeOperation {
  return { intent, read: () => readIssue(ctx, intent), async dispatch() {
    const { parentId, ...input } = intent;
    await ctx.issues.create({ ...input, ...(parentId === null ? {} : { parentId }) });
  } };
}

async function readDocument(ctx: PluginContext, intent: NativeDocumentIntent) {
  const document = await ctx.issues.documents.get(intent.issueId, intent.key, intent.companyId);
  if (!document) return undefined;
  const selected = { companyId: document.companyId, issueId: document.issueId, key: document.key,
    title: document.title, format: document.format, body: document.body };
  same(selected, intent);
  return { nativeId: nativeId(document.id), revisionId: nativeId(document.latestRevisionId),
    revisionNumber: document.latestRevisionNumber, contentSha256: contentDigest(intent) };
}

export function documentOperation(ctx: PluginContext, intent: NativeDocumentIntent): NativeOperation {
  return { intent, read: () => readDocument(ctx, intent), async dispatch() {
    // The public SDK cannot pass baseRevisionId. Only one initial creation is
    // dispatched; subsequent runs read this immutable key and compare exactly.
    await ctx.issues.documents.upsert(intent);
  } };
}

async function readRelations(ctx: PluginContext, intent: NativeRelationIntent) {
  const relations = await ctx.issues.relations.get(intent.issueId, intent.companyId);
  const observed = relations.blockedBy.map(issue => nativeId(issue.id)).sort();
  const expected = [...intent.blockerIds].sort();
  assertImport(new Set(observed).size === observed.length, "import_native_relation_duplicate");
  assertImport(observed.every(id => expected.includes(id)), "import_native_relation_outside_plan");
  if (contentDigest(observed) !== contentDigest(expected)) return undefined;
  return { nativeId: intent.issueId, blockerIds: observed, contentSha256: contentDigest(intent) };
}

export function relationOperation(ctx: PluginContext, intent: NativeRelationIntent): NativeOperation {
  return { intent, read: () => readRelations(ctx, intent), async dispatch() {
    await ctx.issues.relations.addBlockers(intent.issueId, intent.blockerIds, intent.companyId);
  } };
}

export async function verifyNativeProject(ctx: PluginContext, companyId: string, projectId: string) {
  const project = await ctx.projects.get(projectId, companyId);
  assertImport(project !== null, "import_project_missing");
  same({ id: project!.id, companyId: project!.companyId }, { id: projectId, companyId });
  assertImport(project!.archivedAt === null, "import_project_archived");
  assertImport(project!.pausedAt === null, "import_project_paused");
  assertImport(["backlog", "planned", "in_progress"].includes(project!.status), "import_project_inactive");
}
