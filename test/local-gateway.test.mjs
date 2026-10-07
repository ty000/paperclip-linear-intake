import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestHarness } from '@paperclipai/plugin-sdk/testing';
import manifest from '../dist/manifest.js';
import plugin from '../dist/worker.js';
import { reply, syntheticGateway } from './helpers/synthetic-gateway.mjs';

const companyId = '10000000-0000-4000-8000-000000000001';
const token = 'synthetic-loopback-credential';
const secretRef = { type: 'secret_ref', secretId: '20000000-0000-4000-8000-000000000002' };

async function fixture(t, { handle, override = {}, secretError = false } = {}) {
  const server = await syntheticGateway(t, handle);
  const config = {
    gatewayDiscoveryEnabled: true, gatewayTransport: 'local_loopback',
    gatewayUrl: server.url, gatewayTokenRef: secretRef, ...override,
  };
  const harness = createTestHarness({ manifest, config });
  const refs = [];
  let hostFetches = 0;
  harness.ctx.secrets.resolve = async (ref, scope) => {
    refs.push({ ref, scope });
    if (secretError) throw new Error(token);
    return token;
  };
  harness.ctx.http.fetch = async () => { hostFetches++; throw new Error('unexpected host HTTP'); };
  await plugin.definition.setup(harness.ctx);
  return {
    ...server, harness, config, refs, hostFetches: () => hostFetches,
    run: () => harness.performAction('inspect-gateway', {}, { companyId }),
  };
}

function assertRedacted(f, result) {
  const serialized = JSON.stringify({ result, logs: f.harness.logs });
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(f.url), false);
  assert.equal(serialized.includes('upstream-private-details'), false);
}

test('explicit loopback mode uses real HTTP, native scoped secrets and bounded metadata logs', async t => {
  const f = await fixture(t);
  const out = await f.run();
  assert.equal(out.status, 'catalog_observed');
  assert.equal(out.sourceCoverage, 'unqualified');
  assert.equal(out.importPerformed, false);
  assert.equal(f.hostFetches(), 0);
  assert.deepEqual(f.refs, [{ ref: secretRef, scope: { companyId, configPath: 'gatewayTokenRef' } }]);
  assert.deepEqual(f.requests.map(x => x.rpc.method), ['initialize', 'notifications/initialized', 'tools/list']);
  for (const request of f.requests) {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/mcp/gateways/fixture');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers['mcp-protocol-version'], '2025-03-26');
  }
  assert.equal(f.harness.logs.length, 3);
  for (const log of f.harness.logs) {
    assert.equal(log.meta.transport, 'local_loopback');
    assert.equal(log.meta.outcome, 'ok');
    assert.ok(log.meta.durationMs >= 0);
    assert.ok(log.meta.responseBytes <= 2 * 1024 * 1024);
    assert.deepEqual(Object.keys(log.meta).sort(), ['durationMs', 'outcome', 'responseBytes', 'status', 'transport']);
  }
  assertRedacted(f, out);
});

test('startup, health, validation and disabled local discovery have no network/secret effects', async t => {
  const f = await fixture(t, { override: { gatewayDiscoveryEnabled: false } });
  await plugin.definition.onHealth();
  assert.equal((await plugin.definition.onValidateConfig(f.config)).ok, true);
  assert.equal((await f.run()).status, 'disabled');
  assert.deepEqual(f.refs, []);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.harness.logs, []);
  assert.equal(f.hostFetches(), 0);
});

test('destination and transport changes are revalidated before resolving credentials', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).status, 'catalog_observed');
  f.harness.setConfig({ ...f.config, gatewayTransport: 'host_http' });
  assert.equal((await f.run()).status, 'blocked');
  f.harness.setConfig({});
  assert.equal((await f.run()).status, 'disabled');
  assert.equal(f.refs.length, 1);
  assert.equal(f.requests.length, 3);
  assert.equal(f.hostFetches(), 0);
});

test('local opt-in rejects URL normalization, other hosts, ports and paths before any effects', async t => {
  const f = await fixture(t);
  const rejected = [
    undefined, 'https://127.0.0.1:3210/mcp/gateways/x',
    'http://localhost:3210/mcp/gateways/x', 'http://127.0.0.2:3210/mcp/gateways/x',
    'http://[::1]:3210/mcp/gateways/x', 'http://127.1:3210/mcp/gateways/x',
    'http://2130706433:3210/mcp/gateways/x', 'http://0x7f000001:3210/mcp/gateways/x',
    'http://127.0.0.1.example.test:3210/mcp/gateways/x',
    'http://gateway.example.test:3210/mcp/gateways/x',
    'http://192.168.1.1:3210/mcp/gateways/x', 'http://169.254.169.254:80/mcp/gateways/x',
    'http://user:password@127.0.0.1:3210/mcp/gateways/x',
    'http://127.0.0.1/mcp/gateways/x', 'http://127.0.0.1:0/mcp/gateways/x',
    'http://127.0.0.1:03210/mcp/gateways/x', 'http://127.0.0.1:65536/mcp/gateways/x',
    'http://127.0.0.1:3210/api/health', 'http://127.0.0.1:3210/mcp/gateways/',
    'http://127.0.0.1:3210/mcp/gateways/../x', 'http://127.0.0.1:3210/mcp/gateways/%78',
    `${f.url}/`, `${f.url}?token=synthetic`, `${f.url}#fragment`, `${f.url}\n`,
    ` ${f.url}`, f.url.replace('/mcp/', '/other/../mcp/'),
    f.url.replace('http://', 'HTTP://'), f.url.replace('/mcp', '\\mcp'),
  ];
  for (const gatewayUrl of rejected) {
    f.harness.setConfig({ ...f.config, gatewayUrl });
    assert.equal((await f.run()).status, 'blocked', String(gatewayUrl));
  }
  for (const localGatewayTimeoutMs of [0, 99, 10001, 1.5, '5000']) {
    f.harness.setConfig({ ...f.config, localGatewayTimeoutMs });
    assert.equal((await f.run()).status, 'blocked');
  }
  f.harness.setConfig({ ...f.config, gatewayTransport: 'automatic' });
  assert.equal((await f.run()).status, 'blocked');
  f.harness.setConfig({ ...f.config, gatewayTransport: undefined });
  assert.equal((await f.run()).status, 'blocked');
  assert.deepEqual(f.refs, []);
  assert.deepEqual(f.requests, []);
  assert.equal(f.hostFetches(), 0);
});

test('missing/refused native credential blocks before opening a local connection', async t => {
  const f = await fixture(t, { secretError: true });
  const out = await f.run();
  assert.equal(out.reason, 'gateway_secret_unavailable');
  assert.deepEqual(f.requests, []);
  assert.equal(f.hostFetches(), 0);
  assertRedacted(f, out);
  f.harness.setConfig({ ...f.config, gatewayTokenRef: undefined });
  assert.equal((await f.run()).reason, 'configuration_unavailable_or_invalid');
  assert.equal(f.refs.length, 1);
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`HTTP ${status} is rejected without forwarding the credential or changing method`, async t => {
    const other = await syntheticGateway(t);
    const f = await fixture(t, { handle: (_req, res) => {
      res.writeHead(status, { location: other.url });
      res.end(`upstream-private-details ${token}`);
      return true;
    } });
    const out = await f.run();
    assert.equal(out.reason, 'gateway_http_rejected');
    assert.equal(f.requests.length, 1);
    assert.deepEqual(other.requests, []);
    assert.equal(f.hostFetches(), 0);
    assertRedacted(f, out);
  });
}

const failures = [
  ['connection reset', (req) => { req.socket.destroy(); }, 'gateway_transport_failed'],
  ['denied response', (_req, res) => { res.writeHead(403); res.end(token); }, 'gateway_http_rejected'],
  ['oversized Content-Length', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': 2 * 1024 * 1024 + 1 });
    res.flushHeaders();
  }, 'gateway_response_too_large'],
  ['oversized chunked body', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('x'.repeat(2 * 1024 * 1024 + 1));
  }, 'gateway_response_too_large'],
  ['truncated response', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': 100 });
    res.flushHeaders();
    setImmediate(() => res.destroy());
  }, 'gateway_response_unreadable'],
  ['malformed JSON', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{');
  }, 'gateway_response_invalid'],
  ['SSE', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('event: message');
  }, 'gateway_transport_unsupported'],
  ['reflected credential', (_req, res, rpc) => reply(res, rpc, {
    tools: [{ name: 'fixture_read', description: token, inputSchema: { type: 'object' } }],
  }), 'gateway_response_rejected'],
  ['cursor loop', (_req, res, rpc) => reply(res, rpc, { tools: [], nextCursor: 'same' }), 'gateway_catalog_cursor_repeated'],
];
for (const [name, fail, reason] of failures) {
  test(`real local HTTP ${name} fails closed with redacted output`, async t => {
    const f = await fixture(t, { handle: (req, res, rpc) => {
      if (rpc.method !== 'tools/list') return false;
      fail(req, res, rpc);
      return true;
    } });
    const out = await f.run();
    assert.deepEqual(out, { status: 'blocked', reason, importPerformed: false });
    assert.equal(f.hostFetches(), 0);
    assertRedacted(f, out);
  });
}

test('notification bodies are bounded even when no JSON reply is expected', async t => {
  const f = await fixture(t, { handle: (_req, res, rpc) => {
    if (rpc.method !== 'notifications/initialized') return false;
    res.writeHead(202);
    res.end('x'.repeat(2 * 1024 * 1024 + 1));
    return true;
  } });
  const out = await f.run();
  assert.equal(out.reason, 'gateway_response_too_large');
  assert.equal(f.requests.length, 2);
  assertRedacted(f, out);
});

for (const stall of ['headers', 'body', 'notification']) {
  test(`absolute deadline cancels stalled ${stall}, including continuously streamed data`, async t => {
    const f = await fixture(t, { override: { localGatewayTimeoutMs: 100 }, handle: (_req, res, rpc) => {
      if (stall === 'notification' && rpc.method !== 'notifications/initialized') return false;
      if (stall === 'body') {
        res.writeHead(200, { 'content-type': 'application/json' });
        const interval = setInterval(() => res.write(' '), 10);
        res.once('close', () => clearInterval(interval));
        t.after(() => clearInterval(interval));
      }
      return true;
    } });
    const started = performance.now();
    const out = await f.run();
    assert.equal(out.reason, 'gateway_request_timeout');
    assert.ok(performance.now() - started < 3000);
    assert.equal(f.harness.logs.at(-1).meta.outcome, 'gateway_request_timeout');
    assertRedacted(f, out);
  });
}

test('local pagination preserves a full schema without widening the configured gateway', async t => {
  const description = 'synthetic full description '.repeat(10000);
  const f = await fixture(t, { handle: (_req, res, rpc) => {
    if (rpc.method !== 'tools/list') return false;
    reply(res, rpc, rpc.params.cursor ? {
      tools: [{ name: 'fixture_second', inputSchema: { type: 'object' }, description }],
    } : { tools: [{ name: 'fixture_first', inputSchema: { type: 'object' } }], nextCursor: 'next' });
    return true;
  } });
  const out = await f.run();
  assert.equal(out.status, 'catalog_observed');
  assert.equal(out.tools[1].description, description);
  assert.equal(f.requests.length, 4);
  assert.ok(f.requests.every(req => req.url === '/mcp/gateways/fixture'));
  assertRedacted(f, out);
});
