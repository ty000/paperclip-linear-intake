import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestHarness } from '@paperclipai/plugin-sdk/testing';
import { pluginManifestV1Schema } from '@paperclipai/shared/validators/plugin';
import plugin from '../dist/worker.js';
import manifest from '../dist/manifest.js';
import { parseConfig } from '../dist/config.js';

const companyId = '10000000-0000-4000-8000-000000000001';
const token = 'synthetic-gateway-credential-only';
const config = {
  gatewayDiscoveryEnabled: true,
  gatewayUrl: 'https://gateway.example.test/mcp/gateways/synthetic',
  gatewayTokenRef: { type: 'secret_ref', secretId: '20000000-0000-4000-8000-000000000002' },
};
// Explicitly synthetic tool name/schema. It is NOT a Linear schema fixture.
const tool = { name: 'fixture_read', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } };
const response = (request, result) => Response.json({ jsonrpc: '2.0', id: request.id, result });

async function fixture(options = {}) {
  const harness = createTestHarness({ manifest, config: options.config ?? config });
  const requests = [];
  const refs = [];
  const reads = [];
  const getConfig = harness.ctx.config.get;
  harness.ctx.config.get = async (company) => { reads.push(company); return getConfig(company); };
  harness.ctx.secrets.resolve = async (ref, scope) => {
    refs.push({ ref, scope });
    if (options.secretError) throw new Error(token);
    return options.secret ?? token;
  };
  harness.ctx.http.fetch = async (url, init) => {
    assert.equal(url, config.gatewayUrl);
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'error');
    const request = JSON.parse(init.body);
    requests.push(request);
    if (options.transportError) throw new Error(token);
    if (request.method === 'initialize') return response(request, options.init ?? {
      protocolVersion: '2025-03-26', capabilities: { tools: {} },
    });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(request.method, 'tools/list', 'never call tools, models or issue APIs');
    return options.catalog ? options.catalog(request) : response(request, { tools: [tool] });
  };
  await plugin.definition.setup(harness.ctx);
  return { harness, requests, refs, reads, run: () => harness.performAction('inspect-gateway', {}, { companyId }) };
}

test('manifest passes the published native validator; intake cannot be activated', async () => {
  assert.equal(pluginManifestV1Schema.safeParse(manifest).success, true);
  assert.deepEqual(parseConfig({}), { enabled: false, gatewayDiscoveryEnabled: false, gatewayTransport: 'host_http', gatewayToolCallMode: 'mcp' });
  assert.equal((await plugin.definition.onValidateConfig({ enabled: true })).ok, false);
  assert.equal(manifest.webhooks, undefined);
  assert.equal(manifest.jobs, undefined);
  assert.equal(manifest.tools, undefined);
  assert.ok(!manifest.capabilities.some(x => /agents|issues|jobs|webhooks/.test(x)));
});

test('setup, health, validation and disabled discovery make no secret/network calls', async () => {
  const f = await fixture({ config: {} });
  assert.equal((await plugin.definition.onHealth()).status, 'degraded');
  assert.equal((await plugin.definition.onValidateConfig({})).ok, true);
  assert.deepEqual(await f.run(), { status: 'disabled', intakeEnabled: false });
  assert.deepEqual(f.refs, []);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.harness.dbExecutes, []);
  assert.deepEqual(f.harness.activity, []);
});

test('missing company scope blocks before reading config', async () => {
  const f = await fixture();
  assert.equal((await f.harness.performAction('inspect-gateway')).reason, 'company_scope_required');
  assert.deepEqual(f.reads, []);
});

test('native secret reference receives exact company and config binding path', async () => {
  const f = await fixture();
  const out = await f.run();
  assert.equal(out.status, 'catalog_observed');
  assert.equal(out.sourceCoverage, 'unqualified');
  assert.equal(out.intakeEnabled, false);
  assert.deepEqual(out.tools, [tool]);
  assert.match(out.catalogSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.refs, [{ ref: config.gatewayTokenRef, scope: { companyId, configPath: 'gatewayTokenRef' } }]);
  assert.deepEqual(f.requests.map(x => x.method), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.equal(JSON.stringify({ out, logs: f.harness.logs }).includes(token), false);
});

test('config is re-read: disabling discovery takes effect without a stale token cache', async () => {
  const f = await fixture();
  await f.run();
  f.harness.setConfig({});
  assert.equal((await f.run()).status, 'disabled');
  assert.equal(f.refs.length, 1);
  assert.equal(f.requests.length, 3);
});

for (const bad of [
  { gatewayDiscoveryEnabled: true },
  { ...config, gatewayTokenRef: undefined },
  { ...config, gatewayTokenRef: 'raw-value' },
  { ...config, gatewayTokenRef: { type: 'plain', value: 'raw-value' } },
  { ...config, gatewayToken: 'raw-value' },
  { ...config, enabled: true },
  { ...config, gatewayUrl: 'http://127.0.0.1:3210/mcp/gateways/x' },
  { ...config, gatewayUrl: 'https://127.0.0.1/mcp/gateways/x' },
  { ...config, gatewayUrl: 'https://[::1]/mcp/gateways/x' },
  { ...config, gatewayUrl: 'https://localhost/mcp/gateways/x' },
  { ...config, gatewayUrl: 'https://user:password@gateway.example.test/mcp/gateways/x' },
  { ...config, gatewayUrl: config.gatewayUrl + '?token=raw-value' },
  { ...config, gatewayUrl: config.gatewayUrl + '#fragment' },
  { ...config, gatewayUrl: 'https://gateway.example.test/api/other' },
]) {
  test(`invalid configuration ${JSON.stringify(bad).slice(0, 90)} blocks without effects`, async () => {
    const f = await fixture({ config: bad });
    assert.equal((await f.run()).status, 'blocked');
    assert.deepEqual(f.refs, []);
    assert.deepEqual(f.requests, []);
  });
}

for (const options of [{ secretError: true }, { secret: '' }, { secret: 'invalid\r\nvalue' }, { transportError: true }]) {
  test(`secret/transport failure is safe: ${Object.keys(options)[0]}`, async () => {
    const f = await fixture(options);
    const out = await f.run();
    assert.equal(out.status, 'blocked');
    assert.equal(JSON.stringify(out).includes(token), false);
    assert.deepEqual(f.harness.logs, []);
  });
}

test('catalog pagination preserves full schemas and does not claim Linear coverage', async () => {
  const longDescription = 'synthetic-long-schema-description '.repeat(3000);
  const f = await fixture({ catalog: req => response(req, req.params.cursor
    ? { tools: [{ ...tool, name: 'fixture_second', description: longDescription }] }
    : { tools: [tool], nextCursor: 'page-2' }) });
  const out = await f.run();
  assert.equal(out.status, 'catalog_observed');
  assert.equal(out.tools[1].description, longDescription);
  assert.equal(out.sourceCoverage, 'unqualified');
  assert.equal(f.requests.at(-1).params.cursor, 'page-2');
});

test('catalog accepts exactly 1000 distinct tools across pages', async () => {
  const first = Array.from({ length: 999 }, (_, i) => ({ ...tool, name: `fixture_${i}` }));
  const f = await fixture({ catalog: req => response(req, req.params.cursor
    ? { tools: [{ ...tool, name: 'fixture_last' }] }
    : { tools: first, nextCursor: 'last' }) });
  const out = await f.run();
  assert.equal(out.status, 'catalog_observed');
  assert.equal(out.tools.length, 1000);
});

test('catalog rejects the 1001st tool without publishing a partial catalog', async () => {
  const first = Array.from({ length: 1000 }, (_, i) => ({ ...tool, name: `fixture_${i}` }));
  const f = await fixture({ catalog: req => response(req, req.params.cursor
    ? { tools: [{ ...tool, name: 'fixture_overflow' }] }
    : { tools: first, nextCursor: 'overflow' }) });
  assert.deepEqual(await f.run(), { status: 'blocked', reason: 'gateway_catalog_bound_exceeded', intakeEnabled: false });
  assert.deepEqual(f.harness.logs, []);
});

test('catalog accepts a terminal tenth page', async () => {
  let pages = 0;
  const f = await fixture({ catalog: req => {
    pages++;
    return response(req, { tools: [], ...(pages === 10 ? {} : { nextCursor: `page-${pages}` }) });
  } });
  assert.equal((await f.run()).status, 'catalog_observed');
  assert.equal(pages, 10);
});

const failures = [
  ['HTTP access denied', () => new Response(token, { status: 403 }), 'gateway_http_rejected'],
  ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://other.example.test' } }), 'gateway_http_rejected'],
  ['SSE', () => new Response('event: message', { headers: { 'content-type': 'text/event-stream' } }), 'gateway_transport_unsupported'],
  ['invalid JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } }), 'gateway_response_invalid'],
  ['mismatched id', () => Response.json({ jsonrpc: '2.0', id: -1, result: {} }), 'gateway_rpc_rejected'],
  ['RPC error', req => Response.json({ jsonrpc: '2.0', id: req.id, error: { message: token } }), 'gateway_response_rejected'],
  ['absent tools', req => response(req, {}), 'gateway_catalog_incomplete'],
  ['missing input schema', req => response(req, { tools: [{ name: 'incomplete' }] }), 'gateway_catalog_incomplete'],
  ['null continuation', req => response(req, { tools: [], nextCursor: null }), 'gateway_catalog_incomplete'],
  ['repeated cursor', req => response(req, { tools: [], nextCursor: 'same' }), 'gateway_catalog_cursor_repeated'],
  ['duplicate tool', req => response(req, { tools: [tool, tool] }), 'gateway_catalog_duplicate_tool'],
  ['unterminated pagination', req => response(req, { tools: [], nextCursor: String(req.id) }), 'gateway_catalog_page_bound_exceeded'],
  ['oversized body', req => response(req, { tools: [], unused: 'x'.repeat(2 * 1024 * 1024) }), 'gateway_response_too_large'],
  ['reflected secret', req => response(req, { tools: [{ ...tool, description: token }] }), 'gateway_response_rejected'],
  ['unicode-escaped reflected secret', req => new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ ...tool, description: token }] } }).replace(token, [...token].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')), { headers: { 'content-type': 'application/json' } }), 'gateway_response_rejected'],
];
for (const [name, catalog, reason] of failures) {
  test(`${name} blocks; no partial catalog escapes`, async () => {
    const f = await fixture({ catalog });
    assert.deepEqual(await f.run(), { status: 'blocked', reason, intakeEnabled: false });
    assert.deepEqual(f.harness.logs, []);
  });
}

test('unsupported protocol never proceeds to catalog discovery', async () => {
  const f = await fixture({ init: { protocolVersion: 'unknown', capabilities: { tools: {} } } });
  assert.equal((await f.run()).reason, 'gateway_protocol_unsupported');
  assert.equal(f.requests.length, 1);
});
