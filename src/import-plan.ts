import { z } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { intakeIdentity, validateSnapshot, type IntakeBinding, type IntakeRequest } from "./intake-state.js";
import { parseDetail, parsePage } from "./source-payload.js";
import { familyBlockers } from "./source-graph.js";

export const IMPORT_ORIGIN = "plugin:ty000.linear-intake";
type Detail = ReturnType<typeof parseDetail>;
type Inventory = ReturnType<typeof parsePage>["issues"][number];
type EffectKeys = { issue: string; document: string; relations: string };
export type ImportNode = {
  sourceId: string; originId: string; parentSourceId: string | null;
  status: "blocked" | "done" | "cancelled"; source: Detail;
  blockedBySourceIds: string[]; sourceDocumentBody: string; keys: EffectKeys;
};
export type ImportPlan = {
  schema: "linear-native-import-plan.v1"; originKind: typeof IMPORT_ORIGIN;
  companyId: string; intakeId: string; activationId: string; fingerprint: string;
  requestVersion: number; sourceSha256: string; targetProjectId: string; rootSourceId: string;
  nodes: ImportNode[]; externalBlockers: ReturnType<typeof familyBlockers>["externalBlockers"];
  expectedEffectKeys: string[]; readinessKey: string; planSha256: string;
};

export class ImportPlanError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ImportPlanError"; }
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const familySchema = z.object({
  schema: z.literal("linear-source-family.v1"), organizationId: z.uuid(), teamId: z.uuid(),
  projectId: z.uuid(), rootIssueId: z.uuid(), todoStateId: z.uuid(), sourceSha256: hash, catalogSha256: hash,
  issues: z.array(z.unknown()).min(1).max(100),
  childInventory: z.array(z.object({ parentId: z.uuid(), children: z.array(z.unknown()).max(100) })).min(1).max(100),
  externalBlockers: z.array(z.unknown()), cycleAffectedIssueIds: z.array(z.uuid()),
  selectedRootInTodo: z.literal(true), selectedRootArchived: z.literal(false),
});
type Family = z.infer<typeof familySchema>;
const knownStates = new Set(["triage", "backlog", "unstarted", "started", "completed", "canceled"]);

function requirePlan(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ImportPlanError(code);
}

function same(actual: unknown, expected: unknown, code: string) {
  requirePlan(contentDigest(actual) === contentDigest(expected), code);
}

function requireAcceptedRequest(request: IntakeRequest) {
  requirePlan(request.accepted && request.status === "source_observed"
    && request.classification === "received", "import_request_ineligible");
}

function requireRequestIdentity(request: IntakeRequest) {
  requirePlan(request.intakeId === intakeIdentity(request.companyId, request.organizationId, request.issueId)
    && Number.isSafeInteger(request.version) && request.version > 0, "import_identity_invalid");
}

function requireBinding(binding: IntakeBinding, request: IntakeRequest, targetProjectId: string) {
  requirePlan(z.array(z.uuid()).safeParse([binding.companyId, binding.activationId, targetProjectId]).success,
    "import_identity_invalid");
  requirePlan(hash.safeParse(binding.fingerprint).success, "import_identity_invalid");
  requirePlan(binding.active, "import_request_ineligible");
  requireAcceptedRequest(request);
  requirePlan(request.companyId === binding.companyId && request.activationId === binding.activationId,
    "import_binding_mismatch");
  requireRequestIdentity(request);
}

function readFamily(binding: IntakeBinding, request: IntakeRequest): Family {
  requirePlan(request.snapshot && request.snapshotSha256, "import_snapshot_missing");
  validateSnapshot(request.snapshot, request.snapshotSha256, request);
  const result = familySchema.safeParse(request.snapshot);
  requirePlan(result.success, "import_snapshot_invalid");
  const family = result.data;
  for (const key of ["organizationId", "teamId", "projectId", "todoStateId"] as const) {
    requirePlan(family[key] === binding.authority[key], "import_scope_mismatch");
  }
  return family;
}

function bindDetailReferences(refs: Map<string, Detail>, issue: Detail) {
  for (const key of [issue.uuid, issue.id]) {
    requirePlan(!refs.has(key) || refs.get(key) === issue, "import_reference_ambiguous");
    refs.set(key, issue);
  }
}

function readDetails(family: Family) {
  const refs = new Map<string, Detail>(), issues = new Map<string, Detail>();
  for (const raw of family.issues) {
    const issue = parseDetail(raw);
    same(issue, raw, "import_detail_invalid");
    requirePlan(issue.teamId === family.teamId && issue.projectId === family.projectId, "import_scope_mismatch");
    requirePlan(knownStates.has(issue.statusType), "import_state_unknown");
    requirePlan(!issues.has(issue.uuid), "import_duplicate_issue");
    issues.set(issue.uuid, issue);
    bindDetailReferences(refs, issue);
  }
  return { issues, refs };
}

function requireRoot(family: Family, request: IntakeRequest, issues: Map<string, Detail>) {
  const root = issues.get(family.rootIssueId);
  requirePlan(root && root.archivedAt === null && root.currentStateId === family.todoStateId,
    "import_root_ineligible");
  requirePlan(!["completed", "canceled"].includes(root.statusType), "import_root_ineligible");
  requireRetainedInterval(root, request);
}

function requireRetainedInterval(root: Detail, request: IntakeRequest) {
  const current = root.stateHistory.find(interval => interval.endedAt === null)!;
  const revision = Date.parse(request.revision);
  requirePlan(Number.isFinite(revision) && Date.parse(root.updatedAt) >= revision
    && Date.parse(current.startedAt) <= revision, "import_source_stale");
}

function identity(issue: Inventory) {
  return { id: issue.id, uuid: issue.uuid, parentId: issue.parentId,
    teamId: issue.teamId, projectId: issue.projectId, updatedAt: issue.updatedAt };
}

function inventoryChildren(parent: Detail, raw: unknown[], issues: Map<string, Detail>, seen: Set<string>) {
  const page = parsePage({ issues: raw, hasNextPage: false });
  return page.issues.map(child => {
    const detail = issues.get(child.uuid);
    requirePlan(detail && !seen.has(child.uuid), "import_inventory_invalid");
    requirePlan([parent.id, parent.uuid].includes(child.parentId ?? ""), "import_parent_mismatch");
    same(identity(child), identity(detail), "import_inventory_invalid");
    seen.add(child.uuid);
    return child.uuid;
  }).sort();
}

function readInventory(family: Family, issues: Map<string, Detail>) {
  const children = new Map<string, string[]>(), seen = new Set<string>();
  for (const entry of family.childInventory) {
    const parent = issues.get(entry.parentId);
    requirePlan(parent && !children.has(entry.parentId), "import_inventory_invalid");
    children.set(entry.parentId, inventoryChildren(parent, entry.children, issues, seen));
  }
  requirePlan(children.size === issues.size, "import_inventory_incomplete");
  requirePlan(seen.size === issues.size - 1, "import_inventory_incomplete");
  requirePlan(!seen.has(family.rootIssueId), "import_inventory_incomplete");
  return children;
}

function orderFamily(family: Family, refs: Map<string, Detail>, children: Map<string, string[]>) {
  const root = refs.get(family.rootIssueId)!;
  requirePlan(!root.parentId || !refs.has(root.parentId), "import_parent_cycle");
  const ordered = [root.uuid], seen = new Set(ordered);
  for (const parent of ordered) {
    for (const child of children.get(parent)!) {
      requirePlan(!seen.has(child), "import_parent_cycle");
      seen.add(child); ordered.push(child);
    }
  }
  requirePlan(ordered.length === family.issues.length, "import_parent_cycle");
  return ordered;
}

function validateBlockers(family: Family, issues: Map<string, Detail>) {
  const blockers = familyBlockers([...issues.values()]);
  requirePlan(blockers.cycleAffectedIssueIds.length === 0, "import_blocker_cycle");
  same(blockers.cycleAffectedIssueIds, family.cycleAffectedIssueIds, "import_graph_mismatch");
  same(blockers.externalBlockers, family.externalBlockers, "import_graph_mismatch");
  return blockers.externalBlockers.sort((a, b) =>
    `${a.blockedIssueId}:${a.reference.id}`.localeCompare(`${b.blockedIssueId}:${b.reference.id}`));
}

export function nodeEffectKeys(organizationId: string, issueId: string): EffectKeys {
  return { issue: `issue:${organizationId}:${issueId}`, document: `document:${organizationId}:${issueId}:linear-source-v1`,
    relations: `relations:${organizationId}:${issueId}` };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  }, 2);
}

function nativeStatus(source: Detail): ImportNode["status"] {
  if (source.statusType === "completed") return "done";
  return source.statusType === "canceled" ? "cancelled" : "blocked";
}

function importNode(source: Detail, refs: Map<string, Detail>, family: Family, request: IntakeRequest): ImportNode {
  const sourceId = source.uuid;
  const blockedBySourceIds = [...new Set(source.relations.blockedBy
    .flatMap(reference => refs.has(reference.id) ? [refs.get(reference.id)!.uuid] : []))].sort();
  return {
    sourceId, originId: `linear:${family.organizationId}:${sourceId}`,
    parentSourceId: sourceId === family.rootIssueId ? null : refs.get(source.parentId!)!.uuid,
    status: nativeStatus(source), source, blockedBySourceIds, keys: nodeEffectKeys(family.organizationId, sourceId),
    sourceDocumentBody: canonicalJson({ schema: "linear-native-source.v1", organizationId: family.organizationId,
      sourceSha256: family.sourceSha256, source,
      provenance: { originKind: IMPORT_ORIGIN, intakeId: request.intakeId, activationId: request.activationId,
        rootSourceId: family.rootIssueId, catalogSha256: family.catalogSha256 } }),
  };
}

export function buildImportPlan(binding: IntakeBinding, request: IntakeRequest, targetProjectId: string): ImportPlan {
  requireBinding(binding, request, targetProjectId);
  const family = readFamily(binding, request), { issues, refs } = readDetails(family);
  requireRoot(family, request, issues);
  const order = orderFamily(family, refs, readInventory(family, issues));
  const externalBlockers = validateBlockers(family, issues);
  const nodes = order.map(id => importNode(issues.get(id)!, refs, family, request));
  const readinessKey = `readiness:${request.intakeId}`;
  const plan: Omit<ImportPlan, "planSha256"> = {
    schema: "linear-native-import-plan.v1" as const, originKind: IMPORT_ORIGIN,
    companyId: binding.companyId, intakeId: request.intakeId, activationId: binding.activationId,
    fingerprint: binding.fingerprint, requestVersion: request.version, sourceSha256: family.sourceSha256,
    targetProjectId, rootSourceId: family.rootIssueId, nodes, externalBlockers, readinessKey,
    expectedEffectKeys: [...nodes.flatMap(node => [node.keys.issue, node.keys.document, node.keys.relations]), readinessKey],
  };
  return { ...plan, planSha256: contentDigest(plan) };
}
