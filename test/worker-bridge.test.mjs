import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import manifest from '../dist/manifest.js';
import { syntheticGateway } from './helpers/synthetic-gateway.mjs';

for (const transport of ['host_http', 'local_loopback']) {
test(`published SDK worker uses scoped native secrets and ${transport} transport`, { timeout: 10000 }, async t => {
  const companyId = '10000000-0000-4000-8000-000000000001';
  const token = 'synthetic-bridge-only-credential';
  const local = transport === 'local_loopback' ? await syntheticGateway(t) : undefined;
  // If local transport obeyed proxy env vars, this sentinel would receive
  // the bearer credential. A real subprocess also tests Node startup flags.
  const proxy = transport === 'local_loopback' ? await syntheticGateway(t) : undefined;
  const config = {
    gatewayDiscoveryEnabled: true,
    gatewayTransport: transport,
    gatewayUrl: local?.url ?? 'https://gateway.example.test/mcp/gateways/fixture',
    gatewayTokenRef: { type: 'secret_ref', secretId: '20000000-0000-4000-8000-000000000002', version: 1 },
  };
  const proxyOrigin = proxy ? new URL(proxy.url).origin : undefined;
  const proxyEnv = proxyOrigin ? {
    NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyOrigin, HTTPS_PROXY: proxyOrigin,
    http_proxy: proxyOrigin, https_proxy: proxyOrigin, NO_PROXY: '', no_proxy: '',
  } : {};
  const child = spawn(process.execPath, ['dist/worker.js'], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...proxyEnv },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  const calls = [];
  const outbound = [];
  const unexpected = [];
  const logs = [];
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
  lines.on('line', line => {
    const msg = JSON.parse(line);
    if (!msg.method) return pending.get(msg.id)?.(msg);
    if (msg.method === 'log') { logs.push(msg.params); return; }
    calls.push(msg.method);
    // Host services below are synthetic; SDK transport/worker code are real.
    let result;
    if (msg.method === 'config.get') {
      assert.equal(msg.params.companyId, companyId);
      result = config;
    } else if (msg.method === 'secrets.resolve') {
      assert.deepEqual(msg.params, { secretRef: config.gatewayTokenRef, companyId, configPath: 'gatewayTokenRef' });
      result = token;
    } else if (msg.method === 'http.fetch') {
      assert.equal(msg.params.url, config.gatewayUrl);
      assert.equal(msg.params.init.headers.authorization, `Bearer ${token}`);
      const request = JSON.parse(msg.params.init.body);
      outbound.push(request.method);
      const rpcResult = request.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        : { tools: [{ name: 'fixture_read', inputSchema: { type: 'object' } }] };
      result = {
        status: request.method === 'notifications/initialized' ? 202 : 200,
        statusText: 'OK', headers: { 'content-type': 'application/json' },
        body: request.method === 'notifications/initialized' ? '' : JSON.stringify({ jsonrpc: '2.0', id: request.id, result: rpcResult }),
      };
    } else {
      unexpected.push(msg.method);
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Unexpected host method' } });
      return;
    }
    send({ jsonrpc: '2.0', id: msg.id, result });
  });
  let id = 0;
  function rpc(method, params = {}) {
    return new Promise(resolve => {
      const requestId = ++id;
      pending.set(requestId, resolve);
      send({ jsonrpc: '2.0', id: requestId, method, params });
    });
  }
  assert.equal((await rpc('initialize', { manifest, config: {} })).result.ok, true);
  const out = await rpc('performAction', { key: 'inspect-gateway', companyId, params: {} });
  assert.equal(out.result.status, 'catalog_observed');
  assert.equal(out.result.sourceCoverage, 'unqualified');
  assert.equal(JSON.stringify(out).includes(token), false);
  if (local) {
    assert.deepEqual(calls, ['config.get', 'secrets.resolve']);
    assert.deepEqual(outbound, []);
    assert.deepEqual(proxy.requests, []);
    assert.deepEqual(local.requests.map(req => req.rpc.method), ['initialize', 'notifications/initialized', 'tools/list']);
    assert.ok(local.requests.every(req => req.headers.authorization === `Bearer ${token}`));
    assert.equal(logs.length, 3);
    assert.ok(logs.every(log => log.meta.transport === 'local_loopback' && log.meta.outcome === 'ok'));
    assert.equal(JSON.stringify(logs).includes(token), false);
    assert.equal(JSON.stringify(logs).includes(local.url), false);
  } else {
    assert.deepEqual(calls, ['config.get', 'secrets.resolve', 'http.fetch', 'http.fetch', 'http.fetch']);
    assert.deepEqual(outbound, ['initialize', 'notifications/initialized', 'tools/list']);
    assert.deepEqual(logs, []);
  }
  assert.deepEqual(unexpected, []);
  const exited = once(child, 'exit');
  await rpc('shutdown');
  assert.equal((await exited)[0], 0);
  assert.equal(stderr, '');
});
}
