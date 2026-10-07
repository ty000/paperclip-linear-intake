import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { parseConfig } from "./config.js";
import { openSourceClient, SourceReadError, type SourceClient } from "./source-client.js";
import { parseDetail, parsePage, parseProject, parseStatuses, parseTeam } from "./source-payload.js";
import { familyBlockers } from "./source-graph.js";
import { contentDigest as digest } from "./content-digest.js";

const detailFields = ["id", "uuid", "title", "description", "parentId", "teamId", "projectId", "status", "statusType",
  "createdAt", "updatedAt", "completedAt", "canceledAt", "archivedAt", "relations", "stateHistory"];
const inventoryFields = ["id", "uuid", "parentId", "teamId", "projectId", "updatedAt"];
type Detail = ReturnType<typeof parseDetail>;
type Child = ReturnType<typeof parsePage>["issues"][number];
type States = ReturnType<typeof parseStatuses>;
type Family = {
  client: SourceClient; states: States; issues: Map<string, Detail>;
  children: Map<string, Child[]>; queue: Detail[];
};

function same(actual: unknown, expected: unknown, code: string) {
  if (digest(actual) !== digest(expected)) throw new SourceReadError(code);
}

async function verifyWorkspace(client: SourceClient) {
  // This contract must be qualified against get-workspace before native closure.
  const workspace = z.object({ id: z.uuid() }).parse(await client.call("getWorkspace", {}));
  same(workspace.id, client.scope.organizationId, "source_organization_mismatch");
}

async function readMetadata(client: SourceClient) {
  await verifyWorkspace(client);
  const project = parseProject(await client.call("getProject", { query: client.scope.projectId }));
  same(project.uuid, client.scope.projectId, "source_project_mismatch");
  const team = parseTeam(await client.call("getTeam", { query: client.scope.teamId }));
  same(team.id, client.scope.teamId, "source_team_mismatch");
  const states = parseStatuses(await client.call("listStatuses", { team: client.scope.teamId }));
  if (!states.some(state => state.id === client.scope.todoStateId)) throw new SourceReadError("source_todo_state_missing");
  return states;
}

function verifyIssueScope(client: SourceClient, issue: Child) {
  if (issue.teamId !== client.scope.teamId || issue.projectId !== client.scope.projectId) throw new SourceReadError("source_issue_outside_scope");
}

function verifyIssueState(states: States, issue: Detail) {
  const state = states.find(item => item.id === issue.currentStateId);
  if (!state) throw new SourceReadError("source_state_unknown");
  same({ name: state.name, type: state.type }, { name: issue.status, type: issue.statusType }, "source_state_changed");
}

async function readIssue(client: SourceClient, states: States, uuid: string) {
  const detail = parseDetail(await client.call("getIssue", { id: uuid, fields: detailFields, includeRelations: true }));
  same(detail.uuid, uuid, "source_issue_identity_mismatch");
  verifyIssueScope(client, detail);
  verifyIssueState(states, detail);
  return detail;
}

function verifyParent(parent: Detail, child: Child) {
  if (![parent.id, parent.uuid].includes(child.parentId ?? "")) throw new SourceReadError("source_parent_mismatch");
}

function appendChildren(family: Family, parent: Detail, children: Child[], page: Child[]) {
  const seen = new Set(children.map(child => child.uuid));
  for (const child of page) {
    verifyChild(family, parent, child, seen);
    children.push(child);
    if (children.length >= family.client.scope.maxIssues) throw new SourceReadError("source_issue_bound_exceeded");
  }
}

function verifyChild(family: Family, parent: Detail, child: Child, seen: Set<string>) {
  verifyIssueScope(family.client, child);
  verifyParent(parent, child);
  if (seen.has(child.uuid)) throw new SourceReadError("source_duplicate_child");
  seen.add(child.uuid);
}

async function childPage(client: SourceClient, parent: Detail, cursor: string | undefined) {
  // Parent-scoped identity metadata only: filters must not hide children in
  // other projects/teams. Reject those before fetching their detail bodies.
  return parsePage(await client.call("listIssues", {
    parentId: parent.id, fields: inventoryFields, includeArchived: true,
    orderBy: "createdAt", limit: client.scope.pageSize, ...(cursor === undefined ? {} : { cursor }),
  }));
}

async function listChildren(family: Family, parent: Detail) {
  const children: Child[] = [], cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < family.client.scope.maxPagesPerParent; pageNumber++) {
    const page = await childPage(family.client, parent, cursor);
    appendChildren(family, parent, children, page.issues);
    if (!page.hasNextPage) return children.sort((a, b) => a.uuid.localeCompare(b.uuid));
    cursor = page.cursor!;
    if (cursors.has(cursor)) throw new SourceReadError("source_cursor_repeated");
    cursors.add(cursor);
  }
  throw new SourceReadError("source_page_bound_exceeded");
}

function inventoryOf(detail: Child): Child {
  return { id: detail.id, uuid: detail.uuid, parentId: detail.parentId,
    teamId: detail.teamId, projectId: detail.projectId, updatedAt: detail.updatedAt };
}

async function expandParent(family: Family, parent: Detail) {
  const children = await listChildren(family, parent);
  family.children.set(parent.uuid, children);
  for (const child of children) {
    if (family.issues.has(child.uuid)) throw new SourceReadError("source_hierarchy_repeated");
    if (family.issues.size >= family.client.scope.maxIssues) throw new SourceReadError("source_issue_bound_exceeded");
    const detail = await readIssue(family.client, family.states, child.uuid);
    same(inventoryOf(detail), inventoryOf(child), "source_inventory_changed");
    family.issues.set(detail.uuid, detail);
    family.queue.push(detail);
  }
}

async function collectFamily(client: SourceClient, states: States, rootId: string) {
  const root = await readIssue(client, states, rootId);
  const family: Family = { client, states, issues: new Map([[root.uuid, root]]), children: new Map(), queue: [root] };
  for (const parent of family.queue) await expandParent(family, parent);
  return family;
}

async function revalidateFamily(family: Family) {
  for (const issue of family.issues.values()) {
    const detail = await readIssue(family.client, family.states, issue.uuid);
    same(detail, issue, "source_revision_changed");
    same(await listChildren(family, issue), family.children.get(issue.uuid), "source_inventory_changed");
  }
}

function snapshot(family: Family, rootId: string) {
  const { scope, catalogSha256 } = family.client;
  const issues = [...family.issues.values()].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const blockers = familyBlockers(issues);
  const root = family.issues.get(rootId)!;
  const data = {
    schema: "linear-source-family.v1" as const,
    organizationId: scope.organizationId, teamId: scope.teamId, projectId: scope.projectId,
    rootIssueId: rootId, todoStateId: scope.todoStateId, issues,
    childInventory: [...family.children].map(([parentId, children]) => ({ parentId, children })),
    ...blockers, catalogSha256,
    selectedRootInTodo: root.currentStateId === scope.todoStateId,
    selectedRootArchived: root.archivedAt !== null,
  };
  if (Buffer.byteLength(JSON.stringify(data)) > 2 * 1024 * 1024) throw new SourceReadError("source_size_bound_exceeded");
  return { ...data, sourceSha256: digest(data) };
}

// No import, event, job, state write or agent wake. Qualification is operator
// gated by the worker; future retained requests can use the same scoped reader.
export async function readSourceFamily(ctx: PluginContext, companyId: string, rootId: string, qualificationOnly = true,
  guard?: import("./gateway.js").GatewayReadGuard) {
  const client = await openSourceClient(ctx, companyId, rootId, qualificationOnly, guard);
  const startedAt = new Date().toISOString();
  const states = await readMetadata(client);
  const family = await collectFamily(client, states, rootId);
  await revalidateFamily(family);
  same(await readMetadata(client), states, "source_states_changed");
  same(parseConfig(await ctx.config.get(companyId)).sourceReader, client.scope, "source_configuration_changed");
  return {
    status: "source_family_observed" as const, importEnabled: false,
    family: snapshot(family, rootId), startedAt, completedAt: new Date().toISOString(),
    consistency: "repeated_details_and_child_inventories" as const, requests: client.requests(),
  };
}
