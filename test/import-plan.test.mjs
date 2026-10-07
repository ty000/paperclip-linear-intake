import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildImportPlan, IMPORT_ORIGIN, nodeEffectKeys } from '../dist/import-plan.js';
import { contentDigest } from '../dist/content-digest.js';
import { intakeIdentity } from '../dist/intake-state.js';
import { familyBlockers } from '../dist/source-graph.js';

const uuid = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const ids = { company: uuid(1), organization: uuid(2), team: uuid(3), project: uuid(4), target: uuid(5),
  activation: uuid(6), todo: uuid(7), root: uuid(10), child: uuid(11), done: uuid(12), canceled: uuid(13) };
const time = '2026-10-07T12:00:00.000Z';
const activatedAt = '2026-10-07T11:00:00.000Z';

function detail(id, parentId = null, statusType = 'unstarted') {
  const state = { id: statusType === 'unstarted' ? ids.todo : uuid(20 + id), name: statusType, type: statusType };
  return { id: `SYN-${id}`, uuid: uuid(id), title: `Synthetic ${id}`, description: 'Full synthetic description',
    parentId, teamId: ids.team, projectId: ids.project, status: state.name, statusType,
    currentStateId: state.id, createdAt: activatedAt, updatedAt: time,
    completedAt: statusType === 'completed' ? time : null, canceledAt: statusType === 'canceled' ? time : null,
    archivedAt: null, stateHistory: [{ state, startedAt: activatedAt, endedAt: null }],
    relations: { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null } };
}

function inventory(issue) {
  const { id, uuid, parentId, teamId, projectId, updatedAt } = issue;
  return { id, uuid, parentId, teamId, projectId, updatedAt };
}

function reseal(fixture) {
  const { sourceSha256: _previous, ...body } = fixture.request.snapshot;
  fixture.request.snapshotSha256 = contentDigest(body);
  fixture.request.snapshot.sourceSha256 = fixture.request.snapshotSha256;
  return fixture;
}

function fixture(issues = [detail(10), detail(11, 'SYN-10'), detail(12, ids.root, 'completed'), detail(13, 'SYN-10', 'canceled')]) {
  const binding = { companyId: ids.company, activationId: ids.activation, activatedAt, fingerprint: 'a'.repeat(64), active: true, version: 1,
    authority: { organizationId: ids.organization, teamId: ids.team, projectId: ids.project, todoStateId: ids.todo,
      webhookId: uuid(30), activationAt: activatedAt, allowedActors: [{ id: uuid(31), type: 'user' }] } };
  const rootId = issues[0].uuid;
  const snapshot = { schema: 'linear-source-family.v1', organizationId: ids.organization, teamId: ids.team,
    projectId: ids.project, rootIssueId: rootId, todoStateId: ids.todo, issues,
    childInventory: issues.map(parent => ({ parentId: parent.uuid,
      children: issues.filter(issue => [parent.uuid, parent.id].includes(issue.parentId)).map(inventory) })),
    ...familyBlockers(issues), catalogSha256: 'b'.repeat(64), selectedRootInTodo: true, selectedRootArchived: false };
  const request = { companyId: ids.company, organizationId: ids.organization, issueId: rootId,
    intakeId: intakeIdentity(ids.company, ids.organization, rootId), activationId: ids.activation,
    accepted: true, status: 'source_observed', version: 3, revision: time, eventAt: time, classification: 'received',
    deliveryId: 'synthetic-delivery', acceptedAt: time, attempts: 1, leaseOwner: null, leaseUntil: null,
    snapshot, snapshotSha256: null, errorCode: null };
  return reseal({ binding, request });
}

const plan = f => buildImportPlan(f.binding, f.request, ids.target);
const edit = (f, change) => { change(f.request.snapshot); return reseal(f); };

test('complete plan retains full source, historical dates and stable effect identities without mutation', () => {
  const f = fixture();
  const root = f.request.snapshot.issues[0], child = f.request.snapshot.issues[1], done = f.request.snapshot.issues[2];
  root.description = 'Long complete source. '.repeat(4000);
  root.customProviderMetadata = { detail: ['Preserve unknown fields', { value: 1 }] };
  child.description = null;
  child.relations.blockedBy = [{ id: done.id }]; done.relations.blocks = [{ id: child.uuid }];
  f.request.snapshot.externalBlockers = familyBlockers(f.request.snapshot.issues).externalBlockers;
  reseal(f);
  const before = structuredClone(f), result = plan(f);
  assert.deepEqual(f, before);
  assert.deepEqual(result.nodes.map(node => node.sourceId), [ids.root, ids.child, ids.done, ids.canceled]);
  assert.deepEqual(result.nodes.map(node => node.status), ['blocked', 'blocked', 'done', 'cancelled']);
  assert.equal(result.originKind, IMPORT_ORIGIN);
  assert.equal(result.nodes[0].originId, `linear:${ids.organization}:${ids.root}`);
  assert.equal(result.nodes[1].parentSourceId, ids.root);
  assert.deepEqual(result.nodes[1].blockedBySourceIds, [ids.done]);
  assert.equal(result.nodes[1].source.description, null);
  assert.equal(result.expectedEffectKeys.length, 13);
  assert.equal(new Set(result.expectedEffectKeys).size, 13);
  assert.deepEqual(result.nodes[0].keys, nodeEffectKeys(ids.organization, ids.root));
  assert.equal(result.expectedEffectKeys.at(-1), result.readinessKey);
  const doc = JSON.parse(result.nodes[0].sourceDocumentBody);
  assert.deepEqual(doc.source, root);
  assert.equal(doc.sourceSha256, f.request.snapshotSha256);
  assert.equal(doc.provenance.activationId, ids.activation);
  assert.equal(JSON.parse(result.nodes[2].sourceDocumentBody).source.completedAt, time);
  assert.equal(JSON.parse(result.nodes[3].sourceDocumentBody).source.canceledAt, time);
  const { planSha256, ...body } = result;
  assert.equal(planSha256, contentDigest(body));
  assert.deepEqual(plan(structuredClone(f)), result);
  assert.equal(Object.hasOwn(result.nodes[0], 'assigneeAgentId'), false);
  assert.equal(Object.hasOwn(result.nodes[0], 'ownedPaths'), false);
});

test('selected child stays a native root and retains external ancestry/blockers without siblings', () => {
  const child = detail(11, 'SYN-10'), grandchild = detail(14, child.uuid);
  child.relations.blockedBy = [{ id: 'SYN-12', title: 'External completed status is unproven' }];
  const result = plan(fixture([child, grandchild]));
  assert.deepEqual(result.nodes.map(node => node.sourceId), [ids.child, uuid(14)]);
  assert.equal(result.nodes[0].parentSourceId, null);
  assert.equal(result.nodes[0].source.parentId, 'SYN-10');
  assert.deepEqual(result.nodes[0].blockedBySourceIds, []);
  assert.deepEqual(result.externalBlockers, [{ blockedIssueId: ids.child,
    reference: child.relations.blockedBy[0], status: 'unresolved' }]);
});

test('parent-first output ignores input array order while canonical JSON ignores object key insertion order', () => {
  const f = fixture(), original = plan(f);
  f.request.snapshot = JSON.parse(JSON.stringify(f.request.snapshot, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).reverse());
    return value;
  }));
  assert.deepEqual(plan(f), original);
  edit(f, source => { source.issues.reverse(); source.childInventory.reverse(); source.childInventory.forEach(row => row.children.reverse()); });
  assert.deepEqual(plan(f).nodes.map(node => node.sourceId), original.nodes.map(node => node.sourceId));
});

test('target, activation fingerprint and request version participate in the plan hash', () => {
  const f = fixture(), original = plan(f);
  assert.notEqual(buildImportPlan(f.binding, f.request, uuid(99)).planSha256, original.planSha256);
  f.binding.fingerprint = 'c'.repeat(64);
  assert.notEqual(plan(f).planSha256, original.planSha256);
  f.binding.fingerprint = 'a'.repeat(64); f.request.version++;
  assert.notEqual(plan(f).planSha256, original.planSha256);
});

for (const [label, change] of [
  ['inactive binding', f => { f.binding.active = false; }],
  ['wrong company', f => { f.request.companyId = uuid(99); }],
  ['different activation', f => { f.request.activationId = uuid(99); }],
  ['unaccepted request', f => { f.request.accepted = false; }],
  ['withdrawn request', f => { f.request.status = 'withdrawn'; }],
  ['retained withdrawal classification', f => { f.request.classification = 'withdrawal'; }],
  ['different intake identity', f => { f.request.intakeId = 'replacement'; }],
  ['invalid version', f => { f.request.version = 0; }],
  ['missing snapshot', f => { f.request.snapshot = null; }],
  ['tampered hash', f => { f.request.snapshotSha256 = 'c'.repeat(64); }],
  ['tampered content', f => { f.request.snapshot.issues[0].description = 'Changed'; }],
]) test(`rejects ${label}`, () => { const f = fixture(); change(f); assert.throws(() => plan(f)); });

for (const [label, change] of [
  ['organization mismatch', source => { source.organizationId = uuid(99); }],
  ['team mismatch', source => { source.teamId = uuid(99); }],
  ['project mismatch', source => { source.issues[1].projectId = uuid(99); }],
  ['Todo state mismatch', source => { source.todoStateId = uuid(99); }],
  ['missing root', source => { source.issues.shift(); }],
  ['duplicate issue', source => { source.issues.push(source.issues[0]); }],
  ['ambiguous alias', source => { source.issues[1].id = source.issues[0].uuid; }],
  ['missing terminal inventory', source => { source.childInventory.pop(); }],
  ['omitted descendant', source => { source.childInventory[0].children.pop(); }],
  ['duplicate inventory row', source => { source.childInventory.push(source.childInventory[0]); }],
  ['duplicate child', source => { source.childInventory[0].children.push(source.childInventory[0].children[0]); }],
  ['inventory revision mismatch', source => { source.childInventory[0].children[0].updatedAt = activatedAt; }],
  ['wrong parent', source => { source.childInventory[0].children[0].parentId = 'SYN-99'; }],
  ['archived root', source => { source.issues[0].archivedAt = time; }],
  ['root eligibility flag false', source => { source.selectedRootInTodo = false; }],
  ['unknown state', source => { source.issues[0].statusType = 'unexpected'; source.issues[0].stateHistory[0].state.type = 'unexpected'; }],
  ['terminal Todo state', source => { source.issues[0].statusType = 'completed'; source.issues[0].stateHistory[0].state.type = 'completed'; }],
  ['current state contradicted', source => { source.issues[0].currentStateId = uuid(99); }],
  ['blocker summary tampered', source => { source.externalBlockers.push({ fake: true }); }],
  ['graph summary tampered', source => { source.cycleAffectedIssueIds = [ids.root]; }],
  ['Todo reentry after retained event', source => { source.issues[0].stateHistory[0].startedAt = '2026-10-07T13:00:00.000Z'; }],
]) test(`rejects self-consistent hash with ${label}`, () => {
  assert.throws(() => plan(edit(fixture(), change)));
});

test('snapshot older than a later retained transition cannot authorize import', () => {
  const f = fixture(); f.request.revision = '2026-10-07T13:00:00.000Z';
  assert.throws(() => plan(f), /import_source_stale/);
});

test('disconnected parent cycle is rejected although every nonroot occurs in an inventory', () => {
  const f = fixture([detail(10), detail(11, 'SYN-12'), detail(12, 'SYN-11')]);
  assert.throws(() => plan(f), /import_parent_cycle/);
});

test('selected root cannot point at itself or a selected descendant', () => {
  assert.throws(() => plan(edit(fixture(), source => { source.issues[0].parentId = ids.child; })), /import_parent_cycle/);
  assert.throws(() => plan(edit(fixture(), source => { source.issues[0].parentId = ids.root; })), /import_parent_cycle/);
});

test('reciprocal blocking cycles are rejected before producing effect intent', () => {
  const root = detail(10), child = detail(11, root.id);
  root.relations = { ...root.relations, blocks: [{ id: child.id }], blockedBy: [{ id: child.uuid }] };
  child.relations = { ...child.relations, blocks: [{ id: root.uuid }], blockedBy: [{ id: root.id }] };
  assert.throws(() => plan(fixture([root, child])), /import_blocker_cycle/);
});

test('missing inverse internal relation is rejected even when the supplied summary says no cycle', () => {
  const f = fixture();
  edit(f, source => { source.issues[1].relations.blockedBy = [{ id: ids.done }]; });
  assert.throws(() => plan(f), /source_relations_inconsistent/);
});

test('snapshot size and issue count are bounded before a plan can be persisted', () => {
  assert.throws(() => plan(edit(fixture(), source => { source.issues[0].description = 'x'.repeat(2 * 1024 * 1024); })), /intake_invalid_snapshot/);
  const many = [detail(10), ...Array.from({ length: 100 }, (_, index) => detail(index + 100, 'SYN-10'))];
  assert.throws(() => plan(fixture(many)), /import_snapshot_invalid/);
});
