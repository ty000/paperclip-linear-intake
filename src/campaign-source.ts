import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { CAMPAIGN_MODE, CampaignContractError, parseCampaignMarker, resolveCampaignReference, type CampaignNativeMapping,
  type CampaignReadiness } from "./campaign-contract.js";
import { parseConfig } from "./config.js";
import { contentDigest as digest } from "./content-digest.js";
import { openSourceClient, SourceReadError, type SourceClient } from "./source-client.js";
import { familyBlockers } from "./source-graph.js";
import { parseDetail, parseStatuses, parseTeam } from "./source-payload.js";

export const CAMPAIGN_SOURCE_SCHEMA = "linear-milestone-source.v1" as const;
const detailFields = ["id", "uuid", "title", "description", "parentId", "teamId", "projectId", "projectMilestone",
  "status", "statusType", "createdAt", "updatedAt", "completedAt", "canceledAt", "archivedAt", "relations", "stateHistory"];
const inventoryFields = ["id", "uuid", "parentId", "teamId", "projectId", "projectMilestone", "updatedAt"];
const milestoneSchema = z.object({ id: z.uuid(), name: z.string().min(1), description: z.string().nullable().optional() }).passthrough();
const projectSchema = z.object({ uuid: z.uuid(), milestones: z.array(milestoneSchema).max(500) }).passthrough();
const issueMilestoneSchema = z.object({ id: z.uuid() }).passthrough().nullable();
const inventorySchema = z.object({ id: z.string().min(1), uuid: z.uuid(), parentId: z.string().nullable(),
  teamId: z.uuid(), projectId: z.uuid(), updatedAt: z.iso.datetime({ offset: true }), projectMilestone: issueMilestoneSchema }).passthrough();
const pageSchema = z.object({ issues: z.array(inventorySchema), hasNextPage: z.boolean(),
  cursor: z.string().min(1).nullable().optional() }).passthrough();

type Detail = ReturnType<typeof parseDetail> & { projectMilestone?: unknown };
type Inventory = z.infer<typeof inventorySchema>;
type States = ReturnType<typeof parseStatuses>;
type CampaignConfig = NonNullable<ReturnType<typeof parseConfig>["campaignSource"]>;
type CampaignClient = SourceClient & { campaign: CampaignConfig };
type Collected = Awaited<ReturnType<typeof collectCampaign>>;

function fail(code: string): never { throw new SourceReadError(code); }
function contract<T>(read: () => T): T {
  try { return read(); }
  catch (error) { if (error instanceof CampaignContractError) return fail(error.code); throw error; }
}
function same(actual: unknown, expected: unknown, code: string) {
  if (digest(actual) !== digest(expected)) fail(code);
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail("campaign_milestone_shape_unqualified");
  return result.data;
}
function issueMilestone(value: { projectMilestone?: unknown }) {
  return parsed(issueMilestoneSchema, value.projectMilestone)?.id ?? null;
}
function parsePage(value: unknown) {
  const page = parsed(pageSchema, value);
  if (page.hasNextPage && (!page.cursor || page.issues.length === 0)) fail("source_page_incomplete");
  return page;
}

async function openCampaignClient(ctx: PluginContext, companyId: string, ticketId: string,
  qualificationOnly: boolean, guard?: import("./gateway.js").GatewayReadGuard): Promise<CampaignClient> {
  const client = await openSourceClient(ctx, companyId, ticketId, qualificationOnly, guard);
  const campaign = parseConfig(await ctx.config.get(companyId)).campaignSource;
  if (!campaign || campaign.projectMetadataScope !== "enrolled") fail("campaign_source_disabled");
  if (campaign.adapterQualification.catalogSha256 !== client.catalogSha256) fail("campaign_adapter_unqualified");
  return Object.assign(client, { campaign });
}

function verifyScope(client: CampaignClient, issue: { teamId: string; projectId: string | null }) {
  if (issue.teamId !== client.scope.teamId || issue.projectId !== client.scope.projectId) fail("source_issue_outside_scope");
}
function verifyState(states: States, issue: Detail) {
  const state = states.find(item => item.id === issue.currentStateId);
  if (!state) fail("source_state_unknown");
  same({ name: state.name, type: state.type }, { name: issue.status, type: issue.statusType }, "source_state_changed");
}
async function readDetail(client: CampaignClient, states: States, id: string) {
  const detail = parseDetail(await client.call("getIssue", { id, fields: detailFields, includeRelations: true })) as Detail;
  if (detail.uuid !== id) fail("source_issue_identity_mismatch");
  parsed(issueMilestoneSchema, detail.projectMilestone);
  verifyScope(client, detail); verifyState(states, detail);
  return detail;
}

async function readMetadata(client: CampaignClient) {
  const workspace = parsed(z.object({ id: z.uuid() }), await client.call("getWorkspace", {}));
  same(workspace.id, client.scope.organizationId, "source_organization_mismatch");
  const project = parsed(projectSchema, await client.call("getProject", { query: client.scope.projectId, includeMilestones: true }));
  same(project.uuid, client.scope.projectId, "source_project_mismatch");
  const team = parseTeam(await client.call("getTeam", { query: client.scope.teamId }));
  same(team.id, client.scope.teamId, "source_team_mismatch");
  const states = parseStatuses(await client.call("listStatuses", { team: client.scope.teamId }));
  if (!states.some(state => state.id === client.scope.todoStateId)) fail("source_todo_state_missing");
  return { project, states };
}

async function projectInventory(client: CampaignClient) {
  const rows: Inventory[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < client.campaign.maxProjectPages; pageNumber++) {
    const page = parsePage(await client.call("listIssues", { project: client.scope.projectId, fields: inventoryFields,
      includeArchived: true, orderBy: "createdAt", limit: client.scope.pageSize, ...(cursor ? { cursor } : {}) }));
    for (const issue of page.issues) {
      if (ids.has(issue.uuid)) fail("source_duplicate_issue");
      ids.add(issue.uuid); rows.push(issue);
      if (rows.length > client.scope.maxIssues * 20) fail("source_project_inventory_bound_exceeded");
    }
    if (!page.hasNextPage) return { rows, pageCount: pageNumber + 1 };
    cursor = page.cursor!;
    if (cursors.has(cursor)) fail("source_cursor_repeated");
    cursors.add(cursor);
  }
  return fail("source_page_bound_exceeded");
}

async function listChildren(client: CampaignClient, parent: Detail) {
  const rows: Inventory[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < client.scope.maxPagesPerParent; pageNumber++) {
    const page = parsePage(await client.call("listIssues", { parentId: parent.id, fields: inventoryFields,
      includeArchived: true, orderBy: "createdAt", limit: client.scope.pageSize, ...(cursor ? { cursor } : {}) }));
    for (const child of page.issues) {
      verifyScope(client, child);
      if (![parent.id, parent.uuid].includes(child.parentId ?? "")) fail("source_parent_mismatch");
      if (ids.has(child.uuid)) fail("source_duplicate_child");
      ids.add(child.uuid); rows.push(child);
    }
    if (!page.hasNextPage) return rows.sort((a, b) => a.uuid.localeCompare(b.uuid));
    cursor = page.cursor!;
    if (cursors.has(cursor)) fail("source_cursor_repeated");
    cursors.add(cursor);
  }
  return fail("source_page_bound_exceeded");
}

function inventoryIdentity(issue: Inventory | Detail) {
  return { id: issue.id, uuid: issue.uuid, parentId: issue.parentId, teamId: issue.teamId,
    projectId: issue.projectId, projectMilestone: issueMilestone(issue), updatedAt: issue.updatedAt };
}

async function expandMilestone(client: CampaignClient, states: States, direct: Inventory[]) {
  const issues = new Map<string, Detail>(), queue: Detail[] = [], childInventory = new Map<string, Inventory[]>(), childOwner = new Map<string, string>();
  for (const item of direct.sort((a, b) => a.uuid.localeCompare(b.uuid))) {
    if (issues.has(item.uuid)) fail("source_duplicate_issue");
    const detail = await readDetail(client, states, item.uuid);
    same(inventoryIdentity(detail), inventoryIdentity(item), "source_inventory_changed");
    issues.set(detail.uuid, detail); queue.push(detail);
  }
  for (const parent of queue) {
    const children = await listChildren(client, parent);
    childInventory.set(parent.uuid, children);
    for (const child of children) {
      const owner = childOwner.get(child.uuid);
      if (owner && owner !== parent.uuid) fail("source_hierarchy_repeated");
      childOwner.set(child.uuid, parent.uuid);
      const existing = issues.get(child.uuid);
      if (existing) {
        same(inventoryIdentity(existing), inventoryIdentity(child), "source_inventory_changed");
        continue;
      }
      if (issues.size >= Math.min(client.scope.maxIssues, 32)) fail("source_issue_bound_exceeded");
      const detail = await readDetail(client, states, child.uuid);
      same(inventoryIdentity(detail), inventoryIdentity(child), "source_inventory_changed");
      issues.set(detail.uuid, detail); queue.push(detail);
    }
  }
  return { issues, childInventory, childOwner };
}

function materialIssue(issue: Detail) {
  return { id: issue.id, uuid: issue.uuid, title: issue.title, description: issue.description,
    parentId: issue.parentId, teamId: issue.teamId, projectId: issue.projectId,
    projectMilestoneId: issueMilestone(issue), relations: issue.relations };
}
function stateObservation(issue: Detail) {
  return { sourceId: issue.uuid, currentStateId: issue.currentStateId, statusType: issue.statusType,
    archived: issue.archivedAt !== null, completed: issue.completedAt !== null, canceled: issue.canceledAt !== null };
}
function requireCompatibleState(client: CampaignClient, ticket: Detail, issues: Detail[]) {
  if (ticket.archivedAt || ["started", "completed", "canceled"].includes(ticket.statusType)
      || !client.campaign.compatibleCampaignStateIds.includes(ticket.currentStateId)) fail("campaign_state_incompatible");
  for (const issue of issues) {
    if (issue.statusType === "started") fail("campaign_work_already_started");
    if (!["backlog", "unstarted", "completed", "canceled"].includes(issue.statusType)) fail("campaign_state_incompatible");
    if (issue.archivedAt && !["completed", "canceled"].includes(issue.statusType)) fail("campaign_state_incompatible");
  }
}

function nativeMapping(ticket: Detail, issues: Map<string, Detail>, childOwner: Map<string, string>): CampaignNativeMapping[] {
  const children = new Map<string, string[]>();
  for (const [child, parent] of childOwner) children.set(parent, [...(children.get(parent) ?? []), child]);
  const roots = [...issues.keys()].filter(id => !childOwner.has(id)).sort();
  if (roots.length === 0) fail("campaign_parent_cycle");
  const ordered = [...roots], seen = new Set(roots);
  for (const parent of ordered) for (const child of (children.get(parent) ?? []).sort()) {
    if (seen.has(child)) fail("campaign_parent_cycle");
    seen.add(child); ordered.push(child);
  }
  if (seen.size !== issues.size) fail("campaign_parent_cycle");
  return [{ sourceId: ticket.uuid, sourceParentId: ticket.parentId, nativeParentSourceId: null, role: "campaign-root" },
    ...ordered.map(sourceId => { const issue = issues.get(sourceId)!; const owner = childOwner.get(sourceId);
      return { sourceId, sourceParentId: issue.parentId, nativeParentSourceId: owner ?? ticket.uuid,
        role: owner ? "milestone-node" as const : "milestone-root" as const }; })];
}

async function collectCampaign(client: CampaignClient, ticketId: string) {
  const { project, states } = await readMetadata(client);
  const ticket = await readDetail(client, states, ticketId);
  const marker = contract(() => parseCampaignMarker(ticket.description));
  if (!marker) fail("campaign_marker_missing");
  if (issueMilestone(ticket) !== null) fail("campaign_ticket_in_milestone");
  const milestoneMatches = project.milestones.filter(value => value.id === marker.milestoneId);
  if (milestoneMatches.length !== 1) fail("campaign_milestone_missing");
  const milestone = milestoneMatches[0]!;
  const references = { prd: contract(() => resolveCampaignReference(marker.prd, client.campaign.referenceDocuments)),
    tad: contract(() => resolveCampaignReference(marker.tad, client.campaign.referenceDocuments)) };
  const inventory = await projectInventory(client);
  const direct = inventory.rows.filter(issue => issueMilestone(issue) === marker.milestoneId);
  if (direct.length === 0) fail("campaign_milestone_empty");
  if (direct.length > 32) fail("source_issue_bound_exceeded");
  const expanded = await expandMilestone(client, states, direct);
  const selected = [...expanded.issues.values()].sort((a, b) => a.uuid.localeCompare(b.uuid));
  requireCompatibleState(client, ticket, selected);
  const blockers = familyBlockers(selected);
  if (blockers.cycleAffectedIssueIds.length) fail("campaign_blocker_cycle");
  if (blockers.externalBlockers.length) fail("campaign_external_blocker");
  const mapping = nativeMapping(ticket, expanded.issues, expanded.childOwner);
  const material = { ticket: materialIssue(ticket), milestone: { id: milestone.id, name: milestone.name,
      description: milestone.description ?? null }, references, issues: selected.map(materialIssue), nativeMapping: mapping };
  const materialSourceSha256 = digest(material);
  const observations = [ticket, ...selected].map(stateObservation).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const campaign: CampaignReadiness & { marker: typeof marker; milestone: typeof milestone;
    referenceContents: typeof references } = {
    schema: "linear-milestone-campaign-readiness.v1", mode: CAMPAIGN_MODE,
    projectId: client.scope.projectId, ticketSourceId: ticket.uuid, milestoneId: milestone.id,
    references: { prd: marker.prd, tad: marker.tad }, materialSourceSha256,
    stateCompatibility: { status: "compatible", observationSha256: digest(observations) }, nativeMapping: mapping,
    marker, milestone, referenceContents: references,
  };
  return { ticket, selected, childInventory: expanded.childInventory, blockers, campaign,
    projectScan: { pageCount: inventory.pageCount, issueCount: inventory.rows.length,
      milestoneMemberIds: direct.map(issue => issue.uuid).sort(), adapter: client.campaign.adapterQualification } };
}

function snapshot(client: CampaignClient, collected: Collected) {
  const data = { schema: CAMPAIGN_SOURCE_SCHEMA, organizationId: client.scope.organizationId,
    teamId: client.scope.teamId, projectId: client.scope.projectId, todoStateId: client.scope.todoStateId,
    rootIssueId: collected.ticket.uuid, catalogSha256: client.catalogSha256, campaign: collected.campaign,
    issues: [collected.ticket, ...collected.selected],
    childInventory: [...collected.childInventory].map(([parentId, children]) => ({ parentId, children })),
    externalBlockers: collected.blockers.externalBlockers,
    cycleAffectedIssueIds: collected.blockers.cycleAffectedIssueIds,
    projectScan: collected.projectScan,
    selectedRootInTodo: collected.ticket.currentStateId === client.scope.todoStateId,
    selectedRootArchived: collected.ticket.archivedAt !== null };
  if (Buffer.byteLength(JSON.stringify(data)) > 2 * 1024 * 1024) fail("source_size_bound_exceeded");
  return { ...data, sourceSha256: digest(data) };
}

export async function readCampaignSource(ctx: PluginContext, companyId: string, ticketId: string,
  qualificationOnly = true, guard?: import("./gateway.js").GatewayReadGuard) {
  const client = await openCampaignClient(ctx, companyId, ticketId, qualificationOnly, guard);
  const startedAt = new Date().toISOString();
  const first = await collectCampaign(client, ticketId), second = await collectCampaign(client, ticketId);
  same(second.campaign.materialSourceSha256, first.campaign.materialSourceSha256, "campaign_material_source_changed");
  const current = parseConfig(await ctx.config.get(companyId));
  same(current.sourceReader, client.scope, "source_configuration_changed");
  same(current.campaignSource, client.campaign, "source_configuration_changed");
  return { status: "campaign_source_observed" as const, importPerformed: false, family: snapshot(client, second),
    startedAt, completedAt: new Date().toISOString(), consistency: "repeated_material_and_state_compatible" as const,
    requests: client.requests() };
}

