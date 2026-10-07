import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { createTestHarness } from '@paperclipai/plugin-sdk/testing';
import plugin from '../dist/worker.js';
import manifest from '../dist/manifest.js';
import { parseConfig } from '../dist/config.js';
import { reply, syntheticGateway } from './helpers/synthetic-gateway.mjs';

const companyId = '10000000-0000-4000-8000-000000000001';
const teamId = '10000000-0000-4000-8000-000000000002';
const projectId = '10000000-0000-4000-8000-000000000003';
const invocationId = '10000000-0000-4000-8000-000000000004';
const token = 'synthetic-native-gateway-credential';
const nativePath = '/api/tool-gateway/tools/call';
const roles = { getProject: 'get-project', getTeam: 'get-team', listStatuses: 'list-issue-statuses',
  listIssues: 'list-issues', getIssue: 'get-issue' };
const tools = Object.values(roles).map(suffix => ({ name: `synthetic:${suffix}`,
  inputSchema: { type: 'object', properties: {} } }));
const pins = Object.fromEntries(Object.entries(roles).map(([role, suffix]) => {
  const tool = tools.find(t => t.name === `synthetic:${suffix}`);
  return [role, { name: tool.name, inputSchemaSha256: createHash('sha256').update(JSON.stringify(tool.inputSchema)).digest('hex') }];
}));
const base = { gatewayDiscoveryEnabled: true, gatewayToolCallMode: 'native_rest',
  gatewayTokenRef: { type: 'secret_ref', secretId: '20000000-0000-4000-8000-000000000002' },
  sourceProbe: { teamId, projectId, sampleIssueIds: [], tools: pins } };
const actor = { companyId, actor: { type: 'user', userId: 'synthetic-operator' } };
function managed(text = '{"synthetic":true}') {
  return { isError: false, structuredContent: null, content: [{ type: 'text', text }],
    transport: 'mcp_http', spawnedLocalProcess: false };
}
function completed(tool) {
  return { invocationId, status: 'completed', tool, result: { content: 'synthetic summary', data: managed() } };
}
function jsonReply(res, value) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function nativeReply(res, body, mutate) {
  const result = completed(body.tool);
  mutate?.(result);
  jsonReply(res, result);
}
function mcpReply(res, body, catalog) {
  if (body.method === 'tools/list') {
    reply(res, body, { tools: catalog });
    return true;
  }
  if (body.method === 'tools/call') {
    reply(res, body, { isError: false, structuredContent: managed() });
    return true;
  }
  return false;
}
function serve(options = {}) {
  const catalog = options.tools ?? tools;
  return (req, res, body) => {
    if (options.handle?.(req, res, body)) return true;
    if (req.url === nativePath) {
      nativeReply(res, body, options.mutate);
      return true;
    }
    return mcpReply(res, body, catalog);
  };
}
async function harnessFor(config, options = {}) {
  const harness = createTestHarness({ manifest, config });
  const refs = [];
  harness.ctx.secrets.resolve = async (ref, scope) => {
    refs.push({ ref, scope });
    if (options.secretError) throw new Error(token);
    return token;
  };
  harness.ctx.http.fetch = options.fetch ?? (async () => { throw new Error('unexpected host transport'); });
  await plugin.definition.setup(harness.ctx);
  return { harness, refs, run: () => harness.performAction('probe-source', {
    url: 'https://untrusted.example.test/write', tool: 'write', timeoutMs: 60000,
  }, actor) };
}
async function fixture(t, options = {}) {
  const server = await syntheticGateway(t, serve(options));
  const config = { ...base, gatewayTransport: 'local_loopback', gatewayUrl: server.url, ...options.config };
  return { ...server, config, ...await harnessFor(config, options) };
}
const nativeCalls = f => f.requests.filter(r => r.url === nativePath);
function redacted(f, out) {
  const rendered = JSON.stringify({ out, logs: f.harness.logs });
  assert.equal(rendered.includes(token), false);
  assert.equal(rendered.includes('private-upstream-diagnostic'), false);
}
function blocked(f, out) {
  assert.deepEqual(out, { status: 'blocked', reason: 'source_probe_failed', importPerformed: false });
  redacted(f, out);
}

test('native calls follow named MCP binding and complete pins with fixed origin, headers, body and secret scope', async t => {
  const f = await fixture(t);
  const out = await f.run();
  assert.equal(out.status, 'source_probe_observed');
  assert.equal(out.importPerformed, false);
  assert.equal(out.observations.length, 4);
  assert.deepEqual(f.requests.slice(0, 3).map(r => r.rpc.method), ['initialize', 'notifications/initialized', 'tools/list']);
  for (const request of f.requests.slice(0, 3)) {
    assert.equal(request.url, '/mcp/gateways/fixture');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers['x-paperclip-tool-gateway-token'], undefined);
  }
  assert.equal(nativeCalls(f).length, 4);
  for (const request of nativeCalls(f)) {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.host, new URL(f.url).host);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['x-paperclip-tool-gateway-token'], token);
    assert.deepEqual(Object.keys(request.rpc).sort(), ['parameters', 'timeoutMs', 'tool']);
    assert.equal(request.rpc.timeoutMs, 20000);
  }
  const calls = nativeCalls(f).map(r => r.rpc);
  assert.deepEqual(calls.map(r => r.tool), tools.slice(0, 4).map(t => t.name));
  assert.deepEqual(calls[0].parameters, { query: projectId });
  assert.equal(calls[3].parameters.project, projectId);
  assert.equal(calls[3].parameters.team, teamId);
  assert.equal(calls[3].parameters.limit, 2);
  assert.deepEqual(f.refs, [{ ref: base.gatewayTokenRef, scope: { companyId, configPath: 'gatewayTokenRef' } }]);
  assert.deepEqual(f.harness.activity, []);
  assert.deepEqual(f.harness.dbExecutes, []);
  redacted(f, out);
});

test('inspect-gateway stays catalog-only under native REST mode', async t => {
  const f = await fixture(t);
  assert.equal((await f.harness.performAction('inspect-gateway', {}, { companyId })).status, 'catalog_observed');
  assert.equal(f.requests.length, 3);
  assert.equal(nativeCalls(f).length, 0);
});

test('omitted mode keeps every call on MCP without a native timeout', async t => {
  const f = await fixture(t, { config: { gatewayToolCallMode: undefined } });
  assert.equal((await f.run()).status, 'source_probe_observed');
  assert.equal(nativeCalls(f).length, 0);
  assert.equal(f.requests.filter(r => r.rpc.method === 'tools/call').length, 4);
  for (const request of f.requests) {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers['x-paperclip-tool-gateway-token'], undefined);
    assert.equal(request.rpc.timeoutMs, undefined);
  }
});

for (const fault of ['initialize', 'tools/list', 'pin', 'secret']) {
  test(`${fault} failure prevents REST calls and never falls back`, async t => {
    const f = await fixture(t, {
      secretError: fault === 'secret', tools: fault === 'pin' ? [] : tools,
      handle: (_req, res, body) => {
        if (body.method !== fault) return false;
        res.writeHead(401); res.end('private-upstream-diagnostic'); return true;
      },
    });
    blocked(f, await f.run());
    assert.equal(nativeCalls(f).length, 0);
    assert.equal(f.requests.some(r => r.rpc.method === 'tools/call'), false);
  });
}

const invalidResponses = {
  replayed: r => { r.status = 'replayed'; },
  failed: r => { r.status = 'failed'; },
  wrongTool: r => { r.tool = 'synthetic:write'; },
  invalidInvocation: r => { r.invocationId = 'private-upstream-diagnostic'; },
  missingInvocation: r => { delete r.invocationId; },
  errorProperty: r => { r.result.error = 'private-upstream-diagnostic'; },
  nullErrorProperty: r => { r.result.error = null; },
  missingContent: r => { delete r.result.content; },
  missingData: r => { delete r.result.data; },
  failedManaged: r => { r.result.data.isError = true; },
  missingManagedFlag: r => { delete r.result.data.isError; },
  nonnullStructured: r => { r.result.data.structuredContent = {}; },
  malformedInnerJson: r => { r.result.data.content[0].text = 'private-upstream-diagnostic'; },
  multipleText: r => { r.result.data.content.push({ type: 'text', text: '{}' }); },
  rawCredential: r => { r.result.content = token; },
  unicodeCredential: r => {
    const escaped = Array.from(token, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    r.result.data.content[0].text = `{"description":"${escaped}"}`;
  },
};
for (const [name, mutate] of Object.entries(invalidResponses)) {
  test(`REST rejects ${name} with generic output and no retry or MCP fallback`, async t => {
    const f = await fixture(t, { mutate });
    blocked(f, await f.run());
    assert.equal(nativeCalls(f).length, 1);
    assert.equal(f.requests.length, 4);
  });
}

for (const mode of ['json', 'sse', 'http']) {
  test(`REST ${mode} transport rejection is redacted and terminal`, async t => {
    const f = await fixture(t, { handle: (req, res) => {
      if (req.url !== nativePath) return false;
      res.writeHead(mode === 'http' ? 403 : 200, { 'content-type': mode === 'sse' ? 'text/event-stream' : 'application/json' });
      res.end(`${token} private-upstream-diagnostic`); return true;
    } });
    blocked(f, await f.run());
    assert.equal(f.requests.length, 4);
  });
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`REST never follows ${status} to another endpoint or forwards the token`, async t => {
    const receiver = await syntheticGateway(t);
    const f = await fixture(t, { handle: (req, res) => {
      if (req.url !== nativePath) return false;
      res.writeHead(status, { location: receiver.url }); res.end(); return true;
    } });
    blocked(f, await f.run());
    assert.equal(nativeCalls(f).length, 1);
    assert.equal(receiver.requests.length, 0);
  });
}

for (const declared of [true, false]) {
  test(`REST enforces 2 MiB response cap (${declared ? 'declared' : 'streamed'})`, async t => {
    const f = await fixture(t, { handle: (req, res) => {
      if (req.url !== nativePath) return false;
      res.writeHead(200, { 'content-type': 'application/json', ...(declared ? { 'content-length': 3 * 1024 * 1024 } : {}) });
      res.end('x'.repeat(2 * 1024 * 1024 + 1)); return true;
    } });
    blocked(f, await f.run());
    assert.equal(nativeCalls(f).length, 1);
    assert.ok(f.harness.logs.some(log => JSON.stringify(log).includes('gateway_response_too_large')));
  });
}

test('native timer uses its separate bounded budget while MCP remains at its configured timeout', async t => {
  const observed = [];
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    observed.push(ms); return original(fn, ms, ...args);
  });
  const f = await fixture(t, { config: { nativeToolTimeoutMs: 30000, localGatewayTimeoutMs: 100 } });
  assert.equal((await f.run()).status, 'source_probe_observed');
  assert.deepEqual(observed.filter(ms => ms === 100 || ms === 32000), [100, 100, 100, 32000, 32000, 32000, 32000]);
  assert.ok(nativeCalls(f).every(r => r.rpc.timeoutMs === 30000));
});

test('REST call can exceed the MCP budget without retry', async t => {
  const f = await fixture(t, { config: { nativeToolTimeoutMs: 1000, localGatewayTimeoutMs: 100 },
    handle: (req, res, body) => {
      if (req.url !== nativePath) return false;
      setTimeout(() => jsonReply(res, completed(body.tool)), 150); return true;
    } });
  assert.equal((await f.run()).status, 'source_probe_observed');
  assert.equal(nativeCalls(f).length, 4);
});

test('REST absolute client deadline terminates a response that keeps streaming', async t => {
  const f = await fixture(t, { config: { nativeToolTimeoutMs: 1000 }, handle: (req, res) => {
    if (req.url !== nativePath) return false;
    res.writeHead(200, { 'content-type': 'application/json' });
    const timer = setInterval(() => res.write(' '), 20);
    res.once('close', () => clearInterval(timer)); return true;
  } });
  const started = performance.now();
  blocked(f, await f.run());
  assert.ok(performance.now() - started >= 2800);
  assert.ok(performance.now() - started < 5500);
  assert.equal(nativeCalls(f).length, 1);
  assert.ok(f.harness.logs.some(log => JSON.stringify(log).includes('gateway_request_timeout')));
});

test('host_http retains ctx.http policy, fixed same-origin REST path and dedicated header', async () => {
  const url = 'https://gateway.example.test:8443/mcp/gateways/synthetic';
  const requests = [];
  const f = await harnessFor({ ...base, gatewayUrl: url }, { fetch: async (address, init) => {
    const body = JSON.parse(init.body); requests.push({ address, init, body });
    if (address === new URL(nativePath, url).href) return Response.json(completed(body.tool));
    assert.equal(address, url);
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } } : { tools } });
  } });
  assert.equal((await f.run()).status, 'source_probe_observed');
  assert.equal(requests.length, 7);
  for (const request of requests) assert.equal(request.init.redirect, 'error');
  for (const request of requests.slice(3)) {
    assert.equal(request.address, 'https://gateway.example.test:8443/api/tool-gateway/tools/call');
    assert.equal(request.init.headers.authorization, undefined);
    assert.equal(request.init.headers['x-paperclip-tool-gateway-token'], token);
  }
});

test('native mode and timeout config reject implicit fallback, widening and MCP timeout changes', () => {
  assert.equal(parseConfig({}).gatewayToolCallMode, 'mcp');
  assert.equal(parseConfig({ gatewayToolCallMode: 'native_rest' }).nativeToolTimeoutMs, undefined);
  for (const config of [
    { nativeToolTimeoutMs: 20000 }, { gatewayToolCallMode: 'mcp', nativeToolTimeoutMs: 20000 },
    { gatewayToolCallMode: 'fallback' },
    ...[999, 30001, 1500.5, '20000'].map(nativeToolTimeoutMs => ({ gatewayToolCallMode: 'native_rest', nativeToolTimeoutMs })),
    { gatewayTransport: 'local_loopback', gatewayUrl: 'http://127.0.0.1:3000/mcp/gateways/test', localGatewayTimeoutMs: 10001 },
    { gatewayTransport: 'local_loopback', gatewayUrl: 'http://localhost:3000/mcp/gateways/test', gatewayToolCallMode: 'native_rest' },
    { gatewayUrl: 'https://gateway.example.test/api/tool-gateway/tools/call', gatewayToolCallMode: 'native_rest' },
  ]) assert.throws(() => parseConfig(config));
});

test('proxy environment does not receive MCP or REST local credentials', async t => {
  const proxy = await syntheticGateway(t);
  const server = await syntheticGateway(t, serve());
  const config = { ...base, gatewayTransport: 'local_loopback', gatewayUrl: server.url };
  // A fresh process activates Node's startup environment proxy support. All
  // credentials, schemas and endpoints here are synthetic test-only values.
  const script = `
    import { createTestHarness } from '@paperclipai/plugin-sdk/testing';
    import plugin from './dist/worker.js';
    import manifest from './dist/manifest.js';
    const harness = createTestHarness({manifest, config: JSON.parse(process.argv[1])});
    harness.ctx.secrets.resolve = async () => 'synthetic-native-gateway-credential';
    harness.ctx.http.fetch = async () => { throw new Error('unexpected host transport'); };
    await plugin.definition.setup(harness.ctx);
    const out = await harness.performAction('probe-source', {}, ${JSON.stringify(actor)});
    process.stdout.write(JSON.stringify({out, logs:harness.logs}));
  `;
  const proxyOrigin = new URL(proxy.url).origin;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(config)], {
    cwd: new URL('..', import.meta.url), timeout: 10000,
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyOrigin, HTTPS_PROXY: proxyOrigin,
      http_proxy: proxyOrigin, https_proxy: proxyOrigin, ALL_PROXY: proxyOrigin, all_proxy: proxyOrigin,
      NO_PROXY: '', no_proxy: '' },
  });
  assert.equal(JSON.parse(stdout).out.status, 'source_probe_observed');
  assert.equal(server.requests.length, 7);
  assert.equal(proxy.requests.length, 0);
  assert.equal(`${stdout}${stderr}`.includes(token), false);
});
