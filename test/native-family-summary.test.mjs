import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const script = new URL('../scripts/qualification/summarize-native-family.mjs', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const privateText = 'SYNTHETIC_PRIVATE_SENTINEL';
const workspaceId = '10000000-0000-4000-8000-000000000001';
const rootId = '10000000-0000-4000-8000-000000000002';
const childId = '10000000-0000-4000-8000-000000000003';
const stateId = '10000000-0000-4000-8000-000000000004';
const outsideId = '10000000-0000-4000-8000-000000000099';
const failure = 'Native family observation validation failed; no source data emitted.\n';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function seal(family) {
  delete family.sourceSha256;
  family.sourceSha256 = hash(JSON.stringify(canonical(family)));
  return family;
}

function workspaceObservation() {
  const workspace = { id: workspaceId, name: privateText, url: `https://example.test/${privateText}` };
  return { data: { status: 'source_probe_observed', intakeEnabled: false, observations: [{
    role: 'getWorkspace', result: { isError: false, structuredContent: {
      isError: false, structuredContent: null, content: [{ type: 'text', text: JSON.stringify(workspace) }],
    } },
  }] } };
}

function familyObservation() {
  const root = { id: `${privateText}-ROOT`, uuid: rootId, title: privateText,
    description: privateText.repeat(80), currentStateId: stateId, archivedAt: null,
    relations: { blockedBy: [{ id: `${privateText}-EXTERNAL`, title: privateText }] } };
  const child = { id: `${privateText}-CHILD`, uuid: childId, title: privateText,
    description: null, currentStateId: stateId, archivedAt: null,
    relations: { blockedBy: [{ id: root.id }] } };
  const family = seal({ schema: 'linear-source-family.v1', organizationId: workspaceId,
    rootIssueId: rootId, todoStateId: stateId, issues: [root, child],
    childInventory: [{ parentId: rootId, children: [{ uuid: childId }] }, { parentId: childId, children: [] }],
    externalBlockers: [{ blockedIssueId: rootId, reference: root.relations.blockedBy[0], status: 'unresolved' }],
    cycleAffectedIssueIds: [], catalogSha256: hash('synthetic-catalog'),
    selectedRootInTodo: true, selectedRootArchived: false,
  });
  return { data: { status: 'source_family_observed', intakeEnabled: false, family,
    consistency: 'repeated_details_and_child_inventories', requests: 16 } };
}

function serialize(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function runSummary(t, inputs) {
  const dir = await mkdtemp(join(tmpdir(), 'linear-native-family-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = inputs.map(serialize);
  const paths = inputs.map((_, index) => join(dir, `${privateText}-${index}.json`));
  await Promise.all(paths.map((path, index) => writeFile(path, bytes[index])));
  const result = await exec(process.execPath, [script.pathname, ...paths]);
  return { ...result, hashes: bytes.map(hash) };
}

async function expectRejected(t, inputs) {
  const error = await runSummary(t, inputs).catch(result => result);
  assert.equal(error.code, 1);
  assert.equal(error.stdout, '');
  assert.equal(error.stderr, failure);
  assert.equal(error.stderr.includes(privateText), false);
}

test('summary preserves measured counts and both input and canonical family hashes without identifiers', async t => {
  const workspace = workspaceObservation(), family = familyObservation();
  const { stdout, stderr, hashes } = await runSummary(t, [workspace, family]);
  const out = JSON.parse(stdout);
  assert.equal(stderr, '');
  assert.equal(out.schema, 'linear-intake-native-family-summary.v1');
  assert.deepEqual(out.inputSha256, { workspace: hashes[0], families: [hashes[1]] });
  assert.deepEqual(out.workspace, { fieldNames: ['id', 'name', 'url'], idIsUuid: true });
  assert.deepEqual(out.families[0], {
    issueCount: 2, descendantCount: 1,
    descriptions: [{ characters: privateText.repeat(80).length, sha256: hash(privateText.repeat(80)) }, { characters: null, sha256: null }],
    internalBlockerCount: 1, externalBlockerCount: 1,
    childInventory: { parentCount: 2, childCount: 1, childrenPerParent: [1, 0] },
    rootStateFlags: { selectedRootInTodo: true, selectedRootArchived: false },
    requests: 16, catalogSha256: family.data.family.catalogSha256,
    sourceSha256: family.data.family.sourceSha256, consistency: 'repeated_details_and_child_inventories',
  });
  for (const value of [privateText, workspaceId, rootId, childId, stateId, 'https://', 'linear-native-family-test-']) {
    assert.equal(stdout.includes(value), false);
  }
  assert.equal(Object.hasOwn(out, 'sourceCoverage'), false);
  assert.equal(Object.hasOwn(out, 'completeFamilyRead'), false);
});

test('multiple supplied observations are measured separately without inferred scenario labels', async t => {
  const first = familyObservation(), second = familyObservation();
  second.data.family.issues[0].description = '';
  second.data.family.selectedRootInTodo = false;
  seal(second.data.family);
  const { stdout, hashes } = await runSummary(t, [workspaceObservation(), first, second]);
  const out = JSON.parse(stdout);
  assert.deepEqual(out.inputSha256.families, hashes.slice(1));
  assert.equal(out.families.length, 2);
  assert.deepEqual(out.families[1].descriptions[0], { characters: 0, sha256: hash('') });
  assert.equal(out.families[1].rootStateFlags.selectedRootInTodo, false);
  assert.equal(Object.hasOwn(out.families[0], 'scenario'), false);
});

test('canonical family verification ignores object insertion order but preserves array order', async t => {
  const input = familyObservation();
  input.data.family = Object.fromEntries(Object.entries(input.data.family).reverse());
  const { stdout } = await runSummary(t, [workspaceObservation(), input]);
  assert.equal(JSON.parse(stdout).families[0].sourceSha256, input.data.family.sourceSha256);
  input.data.family.issues.reverse();
  await expectRejected(t, [workspaceObservation(), input]);
});

const badActions = [
  ['workspace status', inputs => { inputs[0].data.status = privateText; }],
  ['workspace activation', inputs => { inputs[0].data.intakeEnabled = true; }],
  ['family status', inputs => { inputs[1].data.status = privateText; }],
  ['family activation', inputs => { inputs[1].data.intakeEnabled = true; }],
  ['duplicate workspace observation', inputs => { inputs[0].data.observations.push(inputs[0].data.observations[0]); }],
  ['missing workspace observation', inputs => { inputs[0].data.observations = []; }],
  ['invalid family digest', inputs => { inputs[1].data.family.sourceSha256 = 'f'.repeat(64); }],
  ['non-digest source text', inputs => { inputs[1].data.family.sourceSha256 = privateText; }],
  ['modified source body', inputs => { inputs[1].data.family.issues[0].description += ' changed'; }],
  ['private consistency', inputs => { inputs[1].data.consistency = privateText; }],
  ['private requests', inputs => { inputs[1].data.requests = privateText; }],
];
for (const [label, mutate] of badActions) {
  test(`summary rejects ${label} with one constant diagnostic`, async t => {
    const inputs = [workspaceObservation(), familyObservation()];
    mutate(inputs);
    await expectRejected(t, inputs);
  });
}

const badFamilies = [
  ['schema', family => { family.schema = privateText; }],
  ['organization binding', family => { family.organizationId = outsideId; }],
  ['catalog hash', family => { family.catalogSha256 = privateText; }],
  ['missing root', family => { family.rootIssueId = outsideId; }],
  ['description type', family => { family.issues[0].description = { secret: privateText }; }],
  ['external blocker count', family => { family.externalBlockers = []; }],
  ['inventory parent count', family => { family.childInventory = []; }],
  ['root flag type', family => { family.selectedRootInTodo = privateText; }],
];
for (const [label, mutate] of badFamilies) {
  test(`even a valid digest cannot bypass ${label} validation`, async t => {
    const input = familyObservation();
    mutate(input.data.family);
    seal(input.data.family);
    await expectRejected(t, [workspaceObservation(), input]);
  });
}

const badManaged = [
  ['outer MCP error', outer => { outer.isError = true; }],
  ['inner MCP error', outer => { outer.structuredContent.isError = true; }],
  ['unexpected structured content', outer => { outer.structuredContent.structuredContent = { secret: privateText }; }],
  ['multiple text blocks', outer => { outer.structuredContent.content.push({ type: 'text', text: privateText }); }],
  ['non-text block', outer => { outer.structuredContent.content[0].type = 'image'; }],
  ['invalid workspace JSON', outer => { outer.structuredContent.content[0].text = privateText; }],
  ['invalid workspace identity', outer => { outer.structuredContent.content[0].text = JSON.stringify({ id: privateText }); }],
];
for (const [label, mutate] of badManaged) {
  test(`summary rejects ${label} without returning upstream content`, async t => {
    const workspace = workspaceObservation();
    mutate(workspace.data.observations[0].result);
    await expectRejected(t, [workspace, familyObservation()]);
  });
}

test('malformed files and incomplete arguments produce no source or path diagnostics', async t => {
  await expectRejected(t, [privateText, familyObservation()]);
  await expectRejected(t, [workspaceObservation()]);
  await expectRejected(t, []);
});

test('failure in a later family emits no partial successful report', async t => {
  const invalid = familyObservation();
  invalid.data.family.sourceSha256 = privateText;
  await expectRejected(t, [workspaceObservation(), familyObservation(), invalid]);
});
