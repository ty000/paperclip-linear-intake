import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unwrapManagedPayload, parseDetail, parsePage, parseStatuses, parseTeam, parseProject } from '../dist/source-payload.js';

const issueUuid = '10000000-0000-4000-8000-000000000001';
const teamId = '10000000-0000-4000-8000-000000000002';
const projectId = '10000000-0000-4000-8000-000000000003';
const stateId = '10000000-0000-4000-8000-000000000004';
const time = '2026-10-07T12:00:00.000Z';
const state = { id: stateId, name: 'Todo', type: 'unstarted' };
const summary = { id: 'SYN-1', uuid: issueUuid, parentId: null, teamId, projectId, updatedAt: time };
const detail = {
  ...summary, title: 'Synthetic issue', description: 'Synthetic description '.repeat(400),
  status: 'Todo', statusType: 'unstarted', createdAt: time,
  completedAt: null, canceledAt: null, archivedAt: null,
  relations: { blocks: [], blockedBy: [{ id: 'SYN-2', title: 'Synthetic blocker' }], relatedTo: [], duplicateOf: null },
  stateHistory: [{ state, startedAt: time, endedAt: null }],
};
const envelope = payload => ({ isError: false, structuredContent: {
  isError: false, structuredContent: null, content: [{ type: 'text', text: JSON.stringify(payload) }],
} });

test('managed payload requires both successful MCP layers and unwraps one JSON text', () => {
  assert.deepEqual(unwrapManagedPayload(envelope(detail)), detail);
  assert.deepEqual(unwrapManagedPayload(envelope([state])), [state]);
});

const badEnvelopes = [
  null, {}, { structuredContent: envelope(detail).structuredContent },
  { ...envelope(detail), isError: true },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, isError: true } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, isError: undefined } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, structuredContent: {} } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, structuredContent: undefined } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, content: [] } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, content: [
    { type: 'text', text: '{}' }, { type: 'text', text: '{}' },
  ] } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, content: [{ type: 'image', text: '{}' }] } },
  { ...envelope(detail), structuredContent: { ...envelope(detail).structuredContent, content: [{ type: 'text', text: '{synthetic-private-marker' }] } },
];
for (const [index, value] of badEnvelopes.entries()) {
  test(`managed envelope failure ${index} is rejected without source diagnostics`, () => {
    assert.throws(() => unwrapManagedPayload(value), { message: 'source_payload_invalid' });
  });
}

test('detail preserves complete descriptions and derives the unique current state', () => {
  const parsed = parseDetail(detail);
  assert.equal(parsed.description, detail.description);
  assert.ok(parsed.description.length > 500);
  assert.equal(parsed.currentStateId, stateId);
  assert.equal(parsed.id, 'SYN-1');
  assert.equal(parsed.uuid, issueUuid);
});

test('explicit null description, parent and project remain explicit absence', () => {
  const parsed = parseDetail({ ...detail, description: null, parentId: null, projectId: null });
  assert.equal(parsed.description, null);
  assert.equal(parsed.parentId, null);
  assert.equal(parsed.projectId, null);
});

test('detail preserves additional detail, relation, history and state fields', () => {
  const raw = structuredClone(detail);
  raw.extra = { synthetic: true };
  raw.relations.extra = [];
  raw.relations.blockedBy[0].extra = 'synthetic-relation';
  raw.stateHistory[0].extra = 'synthetic-history';
  raw.stateHistory[0].state.extra = 'synthetic-state';
  assert.deepEqual(parseDetail(raw), { ...raw, currentStateId: stateId });
});

for (const field of Object.keys(detail)) {
  test(`detail requires explicit ${field}`, () => {
    const raw = structuredClone(detail);
    delete raw[field];
    assert.throws(() => parseDetail(raw));
  });
}

for (const field of ['blocks', 'blockedBy', 'relatedTo', 'duplicateOf']) {
  test(`detail requires explicit relation inventory ${field}`, () => {
    const raw = structuredClone(detail);
    delete raw.relations[field];
    assert.throws(() => parseDetail(raw));
  });
}

const badDetails = [
  { uuid: 'SYN-1' }, { teamId: 'synthetic-team' }, { projectId: 'synthetic-project' },
  { id: '' }, { title: null }, { description: 42 }, { parentId: '' },
  { relations: { ...detail.relations, blockedBy: [{ title: 'Missing identifier' }] } },
  { relations: { ...detail.relations, duplicateOf: [] } },
  { stateHistory: [] }, { stateHistory: [...detail.stateHistory, ...detail.stateHistory] },
  { stateHistory: [{ state, startedAt: time, endedAt: time }] },
  { stateHistory: [{ state: { ...state, id: 'Todo' }, startedAt: time, endedAt: null }] },
  { stateHistory: [{ state: { ...state, name: 'Done' }, startedAt: time, endedAt: null }] },
  { stateHistory: [{ state: { ...state, type: 'completed' }, startedAt: time, endedAt: null }] },
  { stateHistory: [{ state, startedAt: time }] },
];
for (const [index, patch] of badDetails.entries()) {
  test(`invalid detail identity, content or state ${index} fails closed`, () => {
    assert.throws(() => parseDetail({ ...detail, ...patch }));
  });
}

for (const field of ['createdAt', 'updatedAt', 'completedAt', 'canceledAt', 'archivedAt']) {
  test(`detail rejects invalid calendar timestamp in ${field}`, () => {
    assert.throws(() => parseDetail({ ...detail, [field]: '2026-02-30T12:00:00Z' }));
  });
}
for (const field of ['startedAt', 'endedAt']) {
  test(`history rejects invalid timestamp in ${field}`, () => {
    const interval = { ...detail.stateHistory[0], [field]: 'not-a-timestamp' };
    assert.throws(() => parseDetail({ ...detail, stateHistory: [interval] }));
  });
}

test('closed historical states coexist with one matching current state', () => {
  const history = [{ state: { ...state, name: 'Backlog' }, startedAt: time, endedAt: time }, ...detail.stateHistory];
  assert.equal(parseDetail({ ...detail, stateHistory: history }).currentStateId, stateId);
});

test('page preserves exact continuation and issue identity without inventing a terminal cursor', () => {
  const page = { issues: [summary], hasNextPage: true, cursor: 'synthetic-next' };
  assert.deepEqual(parsePage(page), page);
  assert.deepEqual(parsePage({ issues: [], hasNextPage: false }), { issues: [], hasNextPage: false });
});
for (const cursor of [null, 'synthetic-terminal']) {
  test(`terminal page accepts explicit ${typeof cursor} cursor without qualification claims`, () => {
    assert.deepEqual(parsePage({ issues: [], hasNextPage: false, cursor }), { issues: [], hasNextPage: false, cursor });
  });
}
const badPages = [
  { issues: [summary] }, { issues: [summary], hasNextPage: true },
  { issues: [summary], hasNextPage: true, cursor: null },
  { issues: [summary], hasNextPage: true, cursor: '' },
  { issues: [], hasNextPage: true, cursor: 'synthetic-next' },
  { issues: [], hasNextPage: false, cursor: '' },
  { issues: [], hasNextPage: 'false' },
  { issues: [{ ...summary, updatedAt: 'invalid' }], hasNextPage: false },
];
for (const [index, page] of badPages.entries()) {
  test(`incomplete or contradictory page ${index} fails closed`, () => assert.throws(() => parsePage(page)));
}
for (const field of Object.keys(summary)) {
  test(`page requires explicit issue ${field}`, () => {
    const issue = { ...summary };
    delete issue[field];
    assert.throws(() => parsePage({ issues: [issue], hasNextPage: false }));
  });
}

test('statuses, team and project retain provider metadata and exact UUIDs', () => {
  assert.deepEqual(parseStatuses([{ ...state, color: 'synthetic' }]), [{ ...state, color: 'synthetic' }]);
  assert.deepEqual(parseTeam({ id: teamId, key: 'SYN' }), { id: teamId, key: 'SYN' });
  assert.deepEqual(parseProject({ uuid: projectId, id: 'P-SYN-1' }), { uuid: projectId, id: 'P-SYN-1' });
});
for (const [label, parse, value] of [
  ['statuses wrapper', parseStatuses, { statuses: [state] }],
  ['status identity', parseStatuses, [{ ...state, id: 'Todo' }]],
  ['status name', parseStatuses, [{ id: stateId, type: 'unstarted' }]],
  ['status type', parseStatuses, [{ id: stateId, name: 'Todo' }]],
  ['team identity', parseTeam, { id: 'SYN' }],
  ['project identity', parseProject, { id: projectId }],
]) {
  test(`${label} fails closed when required metadata is absent or malformed`, () => assert.throws(() => parse(value)));
}
