import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestHarness } from '@paperclipai/plugin-sdk/testing';
import plugin from '../../dist/worker.js';
import manifest from '../../dist/manifest.js';

export const sourceIds = {
  company: '10000000-0000-4000-8000-000000000001',
  organization: '10000000-0000-4000-8000-000000000002',
  team: '10000000-0000-4000-8000-000000000003',
  project: '10000000-0000-4000-8000-000000000004',
  todo: '10000000-0000-4000-8000-000000000005',
  backlog: '10000000-0000-4000-8000-000000000006',
  done: '10000000-0000-4000-8000-000000000007',
  canceled: '10000000-0000-4000-8000-000000000008',
  root: '20000000-0000-4000-8000-000000000001',
  child: '20000000-0000-4000-8000-000000000002',
  completed: '20000000-0000-4000-8000-000000000003',
  canceledIssue: '20000000-0000-4000-8000-000000000004',
  grandchild: '20000000-0000-4000-8000-000000000005',
  outside: '30000000-0000-4000-8000-000000000001',
};
const token = 'synthetic-source-fixture-credential';
const timestamp = '2026-10-07T12:00:00.000Z';
const states = [
  { id: sourceIds.todo, name: 'Todo', type: 'unstarted' },
  { id: sourceIds.backlog, name: 'Backlog', type: 'backlog' },
  { id: sourceIds.done, name: 'Done', type: 'completed' },
  { id: sourceIds.canceled, name: 'Canceled', type: 'canceled' },
];
const roleSuffixes = {
  getWorkspace: 'get-workspace', getProject: 'get-project', getTeam: 'get-team',
  listStatuses: 'list-issue-statuses', listIssues: 'list-issues', getIssue: 'get-issue',
};
const tools = Object.values(roleSuffixes).map(suffix => ({
  name: `synthetic:${suffix}`, inputSchema: { type: 'object', properties: {} },
}));
const pins = Object.fromEntries(Object.entries(roleSuffixes).map(([role, suffix]) => {
  const tool = tools.find(item => item.name === `synthetic:${suffix}`);
  return [role, { name: tool.name, inputSchemaSha256: createHash('sha256').update(JSON.stringify(tool.inputSchema)).digest('hex') }];
}));

function issue(uuid, id, parentId, state) {
  return {
    uuid, id, parentId, teamId: sourceIds.team, projectId: sourceIds.project,
    title: `Synthetic ${id}`, description: `Synthetic full description for ${id}. `.repeat(200),
    status: state.name, statusType: state.type, createdAt: timestamp, updatedAt: timestamp,
    completedAt: null, canceledAt: null, archivedAt: null,
    relations: { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null },
    stateHistory: [{ state, startedAt: timestamp, endedAt: null }],
  };
}

function sourceIssues() {
  const root = issue(sourceIds.root, 'SYN-1', null, states[0]);
  const child = issue(sourceIds.child, 'SYN-2', root.id, states[1]);
  const completed = issue(sourceIds.completed, 'SYN-3', root.id, states[2]);
  const canceled = issue(sourceIds.canceledIssue, 'SYN-4', root.id, states[3]);
  const grandchild = issue(sourceIds.grandchild, 'SYN-5', child.id, states[1]);
  root.relations.blockedBy.push({ id: 'SYN-EXTERNAL', title: 'Synthetic external blocker' });
  child.relations.blockedBy.push({ id: completed.id });
  completed.relations.blocks.push({ id: child.id });
  grandchild.relations.blockedBy.push({ id: child.uuid });
  child.relations.blocks.push({ id: grandchild.uuid });
  completed.completedAt = timestamp;
  canceled.canceledAt = timestamp;
  canceled.archivedAt = timestamp;
  return new Map([root, child, completed, canceled, grandchild].map(value => [value.uuid, value]));
}

function sourceConfig(reader) {
  return {
    gatewayDiscoveryEnabled: true,
    gatewayUrl: 'https://gateway.example.test/mcp/gateways/synthetic-reader',
    gatewayTokenRef: { type: 'secret_ref', secretId: '40000000-0000-4000-8000-000000000001' },
    sourceReader: {
      organizationId: sourceIds.organization, teamId: sourceIds.team, projectId: sourceIds.project,
      todoStateId: sourceIds.todo, qualificationRootIssueIds: [sourceIds.root, sourceIds.child],
      tools: structuredClone(pins), maxIssues: 20, maxPagesPerParent: 10, pageSize: 2,
      maxRequests: 100, deadlineMs: 60_000, ...reader,
    },
  };
}

function inventory(value) {
  const { id, uuid, parentId, teamId, projectId, updatedAt } = value;
  return { id, uuid, parentId, teamId, projectId, updatedAt };
}

function cursorOffset(cursor) {
  if (cursor === undefined) return 0;
  assert.match(cursor, /^synthetic-page:\d+$/);
  return Number(cursor.split(':')[1]);
}

function issuePage(fixture, args) {
  const children = [...fixture.issues.values()].filter(value => value.parentId === args.parentId);
  const offset = cursorOffset(args.cursor);
  const issues = children.slice(offset, offset + args.limit).map(inventory);
  const hasNextPage = offset + issues.length < children.length;
  const result = { issues, hasNextPage };
  if (hasNextPage) result.cursor = `synthetic-page:${offset + issues.length}`;
  return result;
}

function sourceDetail(fixture, args) {
  assert.ok(fixture.issues.has(args.id), 'reader must never fetch unselected or external identities');
  return structuredClone(fixture.issues.get(args.id));
}

function managedResult(payload) {
  return { isError: false, structuredContent: {
    isError: false, structuredContent: null, content: [{ type: 'text', text: JSON.stringify(payload) }],
  } };
}

function sourceHandlers(fixture) {
  return new Map([
    ['getWorkspace', () => ({ id: sourceIds.organization, name: 'Synthetic workspace' })],
    ['getProject', () => ({ uuid: sourceIds.project, id: 'P-SYN-1', name: 'Synthetic project' })],
    ['getTeam', () => ({ id: sourceIds.team, key: 'SYN' })],
    ['listStatuses', () => structuredClone(states)],
    ['listIssues', args => issuePage(fixture, args)],
    ['getIssue', args => sourceDetail(fixture, args)],
  ]);
}

function recordSourceCall(fixture, rpc) {
  const role = Object.keys(roleSuffixes).find(key => rpc.params.name === `synthetic:${roleSuffixes[key]}`);
  assert.ok(role, 'source call must use a fixed configured read role');
  const args = structuredClone(rpc.params.arguments);
  const key = `${role}:${args.id ?? args.parentId ?? ''}`;
  const targetCall = (fixture.counts.get(key) ?? 0) + 1;
  fixture.counts.set(key, targetCall);
  const call = { role, args, targetCall, number: fixture.sourceCalls.length + 1 };
  fixture.sourceCalls.push(call);
  return call;
}

async function sourceReply(fixture, options, handlers, rpc) {
  const call = recordSourceCall(fixture, rpc);
  await options.beforeCall?.(call, fixture);
  let payload = handlers.get(call.role)(call.args);
  if (options.transformPayload) payload = await options.transformPayload(payload, call, fixture);
  const envelope = managedResult(payload);
  if (options.transformEnvelope) return options.transformEnvelope(envelope, call, fixture);
  return envelope;
}

function connectGateway(fixture, options) {
  const handlers = sourceHandlers(fixture);
  const replies = new Map([
    ['initialize', () => ({ protocolVersion: '2025-03-26', capabilities: { tools: {} } })],
    ['tools/list', () => ({ tools: fixture.catalog })],
    ['tools/call', rpc => sourceReply(fixture, options, handlers, rpc)],
  ]);
  fixture.harness.ctx.http.fetch = async (url, init) => {
    assert.equal(url, fixture.config.gatewayUrl);
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    const rpc = JSON.parse(init.body);
    fixture.requests.push(rpc);
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.ok(replies.has(rpc.method), 'unexpected RPC method');
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: await replies.get(rpc.method)(rpc) });
  };
}

function connectNativeServices(fixture, options) {
  fixture.harness.ctx.config.get = async companyId => {
    fixture.configReads.push(companyId);
    if (options.configAtRead) return options.configAtRead(fixture.configReads.length, fixture.config);
    return fixture.config;
  };
  fixture.harness.ctx.secrets.resolve = async (ref, scope) => {
    fixture.secretReads.push({ ref, scope });
    if (options.secretError) throw new Error('synthetic-private-secret-error');
    return token;
  };
}

export async function sourceFixture(options = {}) {
  const config = structuredClone(options.config ?? sourceConfig(options.reader));
  const harness = createTestHarness({ manifest, config });
  const fixture = {
    harness, config, issues: sourceIssues(), catalog: structuredClone(tools),
    requests: [], sourceCalls: [], configReads: [], secretReads: [], counts: new Map(),
    run: (params = { issueId: sourceIds.root }, context = {
      companyId: sourceIds.company, actor: { type: 'user', userId: 'synthetic-operator' },
    }) => harness.performAction('read-source-family', params, context),
  };
  options.prepare?.(fixture);
  connectNativeServices(fixture, options);
  connectGateway(fixture, options);
  await plugin.definition.setup(harness.ctx);
  return fixture;
}
