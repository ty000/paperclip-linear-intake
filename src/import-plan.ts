import { z } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { intakeIdentity, validateSnapshot, type IntakeBinding, type IntakeRequest } from "./intake-state.js";
import { parseDetail, parsePage } from "./source-payload.js";
import { familyBlockers } from "./source-graph.js";
import { campaignMaterialSourceSha256, campaignReadinessSchema, campaignSourceExtensionSchema,
  campaignStateObservationSha256, textSha256, type CampaignReadiness, type CampaignSourceExtension } from "./campaign-contract.js";
import { CAMPAIGN_SOURCE_SCHEMA } from "./campaign-source.js";

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
  campaign?: CampaignReadiness;
  expectedEffectKeys: string[]; readinessKey: string; planSha256: string;
};

export class ImportPlanError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ImportPlanError"; }
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const todoFamilySchema = z.object({
  schema: z.literal("linear-source-family.v1"), organizationId: z.uuid(), teamId: z.uuid(),
  projectId: z.uuid(), rootIssueId: z.uuid(), todoStateId: z.uuid(), sourceSha256: hash, catalogSha256: hash,
  issues: z.array(z.unknown()).min(1).max(100),
  childInventory: z.array(z.object({ parentId: z.uuid(), children: z.array(z.unknown()).max(100) })).min(1).max(100),
  externalBlockers: z.array(z.unknown()), cycleAffectedIssueIds: z.array(z.uuid()),
  selectedRootInTodo: z.literal(true), selectedRootArchived: z.literal(false),
});
const campaignFamilySchema = z.object({
  schema: z.literal(CAMPAIGN_SOURCE_SCHEMA), organizationId: z.uuid(), teamId: z.uuid(),
  projectId: z.uuid(), rootIssueId: z.uuid(), todoStateId: z.uuid(), sourceSha256: hash, catalogSha256: hash,
  campaign: campaignSourceExtensionSchema, issues: z.array(z.unknown()).min(2).max(33),
  childInventory: z.array(z.object({ parentId: z.uuid(), children: z.array(z.unknown()).max(32) })).min(1).max(32),
  externalBlockers: z.array(z.unknown()).max(0), cycleAffectedIssueIds: z.array(z.uuid()).max(0),
  selectedRootInTodo: z.boolean(), selectedRootArchived: z.literal(false), projectScan: z.unknown(),
});
type TodoFamily = z.infer<typeof todoFamilySchema>;
type CampaignFamily = z.infer<typeof campaignFamilySchema>;
type Family = TodoFamily | CampaignFamily;
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
  const result = z.union([todoFamilySchema, campaignFamilySchema]).safeParse(request.snapshot);
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

function importNode(source: Detail, refs: Map<string, Detail>, family: Family, request: IntakeRequest,
  parentSourceId = source.uuid === family.rootIssueId ? null : refs.get(source.parentId!)!.uuid): ImportNode {
  const sourceId = source.uuid;
  const blockedBySourceIds = [...new Set(source.relations.blockedBy
    .flatMap(reference => refs.has(reference.id) ? [refs.get(reference.id)!.uuid] : []))].sort();
  return {
    sourceId, originId: `linear:${family.organizationId}:${sourceId}`,
    parentSourceId,
    status: nativeStatus(source), source, blockedBySourceIds, keys: nodeEffectKeys(family.organizationId, sourceId),
    sourceDocumentBody: canonicalJson({ schema: "linear-native-source.v1", organizationId: family.organizationId,
      sourceSha256: family.sourceSha256, source,
      provenance: { originKind: IMPORT_ORIGIN, intakeId: request.intakeId, activationId: request.activationId,
        rootSourceId: family.rootIssueId, catalogSha256: family.catalogSha256 },
      ...(family.schema === CAMPAIGN_SOURCE_SCHEMA && sourceId === family.rootIssueId ? { campaign: family.campaign } : {}) }),
  };
}

function basePlan(binding: IntakeBinding, request: IntakeRequest, targetProjectId: string, family: Family,
  nodes: ImportNode[], externalBlockers: ImportPlan["externalBlockers"], campaign?: CampaignReadiness): ImportPlan {
  const readinessKey = `readiness:${request.intakeId}`;
  const plan: Omit<ImportPlan, "planSha256"> = {
    schema: "linear-native-import-plan.v1" as const, originKind: IMPORT_ORIGIN,
    companyId: binding.companyId, intakeId: request.intakeId, activationId: binding.activationId,
    fingerprint: binding.fingerprint, requestVersion: request.version, sourceSha256: family.sourceSha256,
    targetProjectId, rootSourceId: family.rootIssueId, nodes, externalBlockers,
    ...(campaign ? { campaign } : {}), readinessKey,
    expectedEffectKeys: [...nodes.flatMap(node => [node.keys.issue, node.keys.document, node.keys.relations]), readinessKey],
  };
  return { ...plan, planSha256: contentDigest(plan) };
}

function buildTodoImportPlan(binding: IntakeBinding, request: IntakeRequest, targetProjectId: string,
  family: TodoFamily): ImportPlan {
  const { issues, refs } = readDetails(family);
  requireRoot(family, request, issues);
  const order = orderFamily(family, refs, readInventory(family, issues));
  const externalBlockers = validateBlockers(family, issues);
  const nodes = order.map(id => importNode(issues.get(id)!, refs, family, request));
  return basePlan(binding, request, targetProjectId, family, nodes, externalBlockers);
}

function campaignReadiness(campaign: CampaignSourceExtension): CampaignReadiness {
  return campaignReadinessSchema.parse({ schema: campaign.schema, mode: campaign.mode, projectId: campaign.projectId,
    ticketSourceId: campaign.ticketSourceId, milestoneId: campaign.milestoneId, references: campaign.references,
    materialSourceSha256: campaign.materialSourceSha256, stateCompatibility: campaign.stateCompatibility,
    nativeMapping: campaign.nativeMapping });
}

function validateCampaignContents(family: CampaignFamily, ticket: Detail, selected: Detail[]) {
  const campaign = family.campaign;
  requirePlan([campaign.ticketSourceId === ticket.uuid, campaign.projectId === family.projectId].every(Boolean),
    "campaign_identity_invalid");
  for (const reference of [campaign.referenceContents.prd, campaign.referenceContents.tad]) {
    requirePlan(textSha256(reference.content) === reference.sha256, "campaign_reference_invalid");
  }
  requirePlan(campaignMaterialSourceSha256(ticket, selected, campaign) === campaign.materialSourceSha256,
    "campaign_material_hash_invalid");
  requirePlan(campaignStateObservationSha256([ticket, ...selected]) === campaign.stateCompatibility.observationSha256,
    "campaign_state_hash_invalid");
  requirePlan(campaign.stateCompatibility.status === "compatible", "campaign_state_incompatible");
  requirePlan([ticket.currentStateId === family.todoStateId, ticket.archivedAt === null,
    !["started", "completed", "canceled"].includes(ticket.statusType)].every(Boolean), "campaign_root_ineligible");
  for (const issue of selected) requirePlan(!["started", "triage"].includes(issue.statusType), "campaign_work_already_started");
}

type CampaignMap = CampaignFamily["campaign"]["nativeMapping"][number];

function requireMappedIssue(issues: Map<string, Detail>, entry: CampaignMap) {
  const issue = issues.get(entry.sourceId);
  requirePlan([issue !== undefined, entry.sourceParentId === issue?.parentId].every(Boolean), "campaign_mapping_invalid");
  return issue!;
}

function addMilestoneRoot(family: CampaignFamily, entry: CampaignMap, roots: string[]) {
  requirePlan(entry.nativeParentSourceId === family.rootIssueId, "campaign_mapping_invalid");
  roots.push(entry.sourceId);
}

function addMilestoneNode(issues: Map<string, Detail>, entry: CampaignMap, issue: Detail,
  children: Map<string, string[]>) {
  const parent = issues.get(entry.nativeParentSourceId!);
  requirePlan([parent !== undefined, [parent?.id, parent?.uuid].includes(issue.parentId ?? "")].every(Boolean),
    "campaign_mapping_invalid");
  const siblings = children.get(parent!.uuid) ?? [];
  children.set(parent!.uuid, [...siblings, entry.sourceId]);
}

function addCampaignMapping(family: CampaignFamily, issues: Map<string, Detail>, entry: CampaignMap,
  children: Map<string, string[]>, roots: string[]) {
  const issue = requireMappedIssue(issues, entry);
  if (entry.sourceId === family.rootIssueId) return;
  requirePlan([entry.role !== "campaign-root", entry.nativeParentSourceId !== null].every(Boolean), "campaign_mapping_invalid");
  if (entry.role === "milestone-root") return addMilestoneRoot(family, entry, roots);
  addMilestoneNode(issues, entry, issue, children);
}

function appendCampaignChild(ordered: string[], seen: Set<string>, child: string) {
  requirePlan(!seen.has(child), "campaign_parent_cycle");
  seen.add(child); ordered.push(child);
}

function orderedCampaignIds(rootId: string, roots: string[], children: Map<string, string[]>, expected: number) {
  requirePlan(roots.length > 0, "campaign_mapping_invalid");
  const ordered = [rootId, ...roots.sort()], seen = new Set(ordered);
  for (let index = 1; index < ordered.length; index++) {
    for (const child of (children.get(ordered[index]!) ?? []).sort()) appendCampaignChild(ordered, seen, child);
  }
  requirePlan(seen.size === expected, "campaign_parent_cycle");
  return ordered;
}

function campaignOrder(family: CampaignFamily, issues: Map<string, Detail>) {
  const bySource = new Map(family.campaign.nativeMapping.map(entry => [entry.sourceId, entry]));
  requirePlan([bySource.size === family.campaign.nativeMapping.length, bySource.size === issues.size].every(Boolean),
    "campaign_mapping_invalid");
  const root = bySource.get(family.rootIssueId);
  requirePlan([root?.role === "campaign-root", root?.nativeParentSourceId === null].every(Boolean), "campaign_mapping_invalid");
  const children = new Map<string, string[]>(), roots: string[] = [];
  for (const entry of family.campaign.nativeMapping) addCampaignMapping(family, issues, entry, children, roots);
  return { ordered: orderedCampaignIds(family.rootIssueId, roots, children, issues.size), bySource };
}

function validateCampaignInventoryRow(issue: Detail, raw: unknown[], selected: Map<string, Detail>,
  seenChildren: Map<string, string>, parentId: string) {
  const parsed = parsePage({ issues: raw, hasNextPage: false });
  for (const child of parsed.issues) {
    const detail = selected.get(child.uuid);
    requirePlan([detail !== undefined, [issue.id, issue.uuid].includes(child.parentId ?? "")].every(Boolean),
      "import_inventory_invalid");
    same(identity(child), identity(detail!), "import_inventory_invalid");
    requirePlan(!seenChildren.has(child.uuid), "import_inventory_invalid");
    seenChildren.set(child.uuid, parentId);
  }
}

function validateCampaignInventoryMapping(mapping: CampaignMap[], seenChildren: Map<string, string>) {
  for (const entry of mapping) {
    if (entry.role === "milestone-node") {
      requirePlan(seenChildren.get(entry.sourceId) === entry.nativeParentSourceId, "campaign_mapping_invalid");
    }
    if (entry.role === "milestone-root") requirePlan(!seenChildren.has(entry.sourceId), "campaign_mapping_invalid");
  }
}

function validateCampaignInventory(family: CampaignFamily, issues: Map<string, Detail>) {
  const selected = new Map([...issues].filter(([id]) => id !== family.rootIssueId));
  const rows = new Map(family.childInventory.map(entry => [entry.parentId, entry.children]));
  requirePlan(rows.size === selected.size, "import_inventory_incomplete");
  const seenChildren = new Map<string, string>();
  for (const [parentId, issue] of selected) {
    const raw = rows.get(parentId); requirePlan(raw !== undefined, "import_inventory_incomplete");
    validateCampaignInventoryRow(issue, raw!, selected, seenChildren, parentId);
  }
  validateCampaignInventoryMapping(family.campaign.nativeMapping, seenChildren);
}

function buildCampaignImportPlan(binding: IntakeBinding, request: IntakeRequest, targetProjectId: string,
  family: CampaignFamily): ImportPlan {
  const { issues, refs } = readDetails(family);
  const ticket = issues.get(family.rootIssueId);
  requirePlan(ticket !== undefined, "campaign_root_missing");
  const selected = [...issues.values()].filter(issue => issue.uuid !== family.rootIssueId);
  validateCampaignContents(family, ticket!, selected);
  validateCampaignInventory(family, issues);
  const blockers = familyBlockers(selected);
  requirePlan(blockers.cycleAffectedIssueIds.length === 0, "import_blocker_cycle");
  requirePlan(blockers.externalBlockers.length === 0, "campaign_external_blocker");
  const { ordered, bySource } = campaignOrder(family, issues);
  const nodes = ordered.map(id => importNode(issues.get(id)!, refs, family, request,
    bySource.get(id)!.nativeParentSourceId));
  return basePlan(binding, request, targetProjectId, family, nodes, [], campaignReadiness(family.campaign));
}

export function buildImportPlan(binding: IntakeBinding, request: IntakeRequest, targetProjectId: string): ImportPlan {
  requireBinding(binding, request, targetProjectId);
  const family = readFamily(binding, request);
  return family.schema === CAMPAIGN_SOURCE_SCHEMA
    ? buildCampaignImportPlan(binding, request, targetProjectId, family)
    : buildTodoImportPlan(binding, request, targetProjectId, family);
}
