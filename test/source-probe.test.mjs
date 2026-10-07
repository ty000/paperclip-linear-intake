import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createTestHarness } from '@paperclipai/plugin-sdk/testing';
import plugin from '../dist/worker.js';
import manifest from '../dist/manifest.js';
import { parseConfig } from '../dist/config.js';

const companyId = '10000000-0000-4000-8000-000000000001';
const teamId = '10000000-0000-4000-8000-000000000002';
const projectId = '10000000-0000-4000-8000-000000000003';
const issueId = '10000000-0000-4000-8000-000000000004';
const token = 'synthetic-qualification-credential';
const roles = { getProject: 'get-project', getTeam: 'get-team', listStatuses: 'list-issue-statuses',
  listIssues: 'list-issues', getIssue: 'get-issue' };
// Synthetic schemas test pinning; native observed schemas are separate evidence.
const tools = Object.values(roles).map(suffix => ({ name: `synthetic:${suffix}`,
  inputSchema: { type: 'object', properties: {} } }));
const pins = Object.fromEntries(Object.entries(roles).map(([role, suffix]) => {
  const tool = tools.find(t => t.name === `synthetic:${suffix}`);
  return [role, { name: tool.name, inputSchemaSha256: createHash('sha256').update(JSON.stringify(tool.inputSchema)).digest('hex') }];
}));
const config = { gatewayDiscoveryEnabled: true, gatewayUrl: 'https://gateway.example.test/mcp/gateways/synthetic',
  gatewayTokenRef: { type: 'secret_ref', secretId: '20000000-0000-4000-8000-000000000002' },
  sourceProbe: { teamId, projectId, sampleIssueIds: [issueId], tools: pins } };
async function fixture(options = {}) {
  const harness = createTestHarness({ manifest, config: options.config ?? config });
  const requests = [], refs = [];
  harness.ctx.secrets.resolve = async (ref, scope) => { refs.push({ ref, scope }); return token; };
  const responses = new Map([
    ['initialize', () => ({ protocolVersion: '2025-03-26', capabilities: { tools: {} } })],
    ['tools/list', () => ({ tools: options.tools ?? tools })],
    ['tools/call', () => options.result ?? {
      isError: false, content: [{ type: 'text', text: '{"synthetic":true}' }], structuredContent: null,
    }],
  ]);
  harness.ctx.http.fetch = async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const respond = responses.get(request.method);
    assert.ok(respond, 'unexpected method');
    return Response.json({ jsonrpc: '2.0', id: request.id, result: respond() });
  };
  await plugin.definition.setup(harness.ctx);
  return { harness, requests, refs, run: params => harness.performAction('probe-source', params ?? {}, { companyId, actor: { type: 'user', userId: 'synthetic-operator' } }) };
}
test('probe absent by default makes no secret, network or effect calls', async () => {
  const f = await fixture({ config: {} });
  assert.deepEqual(await f.run(), { status: 'disabled', intakeEnabled: false });
  assert.deepEqual(f.requests, []); assert.deepEqual(f.refs, []);
  assert.deepEqual(f.harness.dbExecutes, []); assert.deepEqual(f.harness.activity, []);
});

for (const current of [{}, { ...config, sourceProbe: undefined }]) {
  test('disabling discovery or removing enrollment between config reads prevents source calls', async () => {
    const f = await fixture();
    let reads = 0;
    f.harness.ctx.config.get = async () => ++reads === 1 ? config : current;
    assert.deepEqual(await f.run(), { status: 'blocked', reason: 'source_probe_failed', intakeEnabled: false });
    assert.equal(reads, 2);
    assert.equal(f.requests.some(r => r.method === 'tools/call'), false);
  });
}

for (const scopedCompany of [null, '10000000-0000-4000-8000-000000000099']) {
  test('operator company must be present and match the immutable actor company', async () => {
    const harness = createTestHarness({ manifest, config });
    const handlers = new Map();
    harness.ctx.actions.register = (key, handler) => handlers.set(key, handler);
    let reads = 0;
    harness.ctx.config.get = async () => { reads++; return config; };
    await plugin.definition.setup(harness.ctx);
    const out = await handlers.get('probe-source')({}, {
      companyId: scopedCompany, actor: { type: 'user', userId: 'synthetic-operator', companyId },
    });
    assert.deepEqual(out, { status: 'blocked', reason: 'source_probe_operator_required', intakeEnabled: false });
    assert.equal(reads, 0);
  });
}
test('probe fixes read arguments from config and ignores caller widening', async () => {
  const f = await fixture();
  const out = await f.run({ projectId: 'different', teamId: 'different', tool: 'write', limit: 250, issueId: 'outside' });
  assert.equal(out.status, 'source_probe_observed'); assert.equal(out.sourceCoverage, 'unqualified');
  assert.equal(out.intakeEnabled, false); assert.equal(out.observations.length, 5);
  const calls = f.requests.filter(x => x.method === 'tools/call');
  assert.deepEqual(calls.map(c => c.params.name), ['get-project','get-team','list-issue-statuses','list-issues','get-issue'].map(n => `synthetic:${n}`));
  assert.deepEqual(calls[0].params.arguments, { query: projectId });
  assert.deepEqual(calls[1].params.arguments, { query: teamId });
  assert.deepEqual(calls[2].params.arguments, { team: teamId });
  const list = calls[3].params.arguments;
  assert.equal(list.project, projectId); assert.equal(list.team, teamId); assert.equal(list.limit, 2);
  assert.equal(list.includeArchived, true); assert.equal(list.includeSubTeams, false); assert.equal(list.cursor, undefined);
  assert.equal(calls[4].params.arguments.id, issueId);
  assert.ok(calls[4].params.arguments.fields.includes('relations'));
  assert.ok(calls[4].params.arguments.fields.includes('stateHistory'));
  assert.deepEqual(f.refs, [{ ref: config.gatewayTokenRef, scope: { companyId, configPath: 'gatewayTokenRef' } }]);
  assert.deepEqual(f.harness.dbExecutes, []); assert.deepEqual(f.harness.activity, []);
  assert.equal(JSON.stringify({ out, logs: f.harness.logs }).includes(token), false);
});
test('catalog inspection never calls a source tool even with probe configured', async () => {
  const f = await fixture();
  assert.equal((await f.harness.performAction('inspect-gateway', {}, { companyId })).status, 'catalog_observed');
  assert.equal(f.requests.some(r => r.method === 'tools/call'), false);
});
for (const changed of ['hash', 'name', 'missing']) {
  test(`catalog ${changed} mismatch blocks before all source calls`, async () => {
    const changedTools = structuredClone(tools);
    if (changed === 'hash') changedTools[0].inputSchema.properties.changed = { type: 'string' };
    if (changed === 'name') changedTools[0].name = 'synthetic:mutate-project';
    if (changed === 'missing') changedTools.splice(0, 1);
    const f = await fixture({ tools: changedTools });
    assert.equal((await f.run()).status, 'blocked');
    assert.equal(f.requests.some(r => r.method === 'tools/call'), false);
  });
}
for (const result of [{ isError: true, content: [{ type: 'text', text: token }] },
  { isError: true, content: [{ type: 'text', text: 'synthetic upstream error' }] },
  {}, { content: [{ type: 'text', text: token }] }]) {
  test('failed, empty or credential-echo response stops immediately without leaking details', async () => {
    const f = await fixture({ result }); const out = await f.run();
    assert.deepEqual(out, { status: 'blocked', reason: 'source_probe_failed', intakeEnabled: false });
    assert.equal(f.requests.filter(r => r.method === 'tools/call').length, 1);
    assert.equal(JSON.stringify({ out, logs: f.harness.logs }).includes(token), false);
  });
}
test('probe enrollment rejects unbounded, duplicate, non-UUID or unpinned scope', () => {
  for (const sourceProbe of [
    { ...config.sourceProbe, sampleIssueIds: [issueId, issueId] },
    { ...config.sourceProbe, sampleIssueIds: [issueId, teamId, projectId] },
    { ...config.sourceProbe, projectId: 'arbitrary-query' },
    { ...config.sourceProbe, tools: {} },
  ]) assert.throws(() => parseConfig({ ...config, sourceProbe }));
  assert.throws(() => parseConfig({ ...config, gatewayDiscoveryEnabled: false }));
});

for (const actor of [undefined, { type: 'agent', agentId: 'synthetic-agent' }, { type: 'system' }, { type: 'user' }]) {
  test('host actor context blocks absent, agent, system and unidentified actors before reads', async () => {
    const f = await fixture();
    let configReads = 0;
    f.harness.ctx.config.get = async () => { configReads++; return config; };
    const out = await f.harness.performAction('probe-source', { companyId, actor: { type: 'user', userId: 'spoof' },
      actorContext: { actor: { type: 'user', userId: 'spoof', companyId }, companyId } }, { companyId, actor });
    assert.equal(out.reason, 'source_probe_operator_required');
    assert.equal(configReads, 0); assert.deepEqual(f.requests, []); assert.deepEqual(f.refs, []);
  });
}
