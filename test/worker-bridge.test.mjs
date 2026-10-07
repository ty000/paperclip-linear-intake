import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import manifest from '../dist/manifest.js';

test('published SDK serializes scoped config, secret and HTTP calls across its actual worker bridge', { timeout: 10000 }, async t => {
  const companyId = '10000000-0000-4000-8000-000000000001';
  const token = 'synthetic-bridge-only-credential';
  const config = {
    gatewayDiscoveryEnabled: true,
    gatewayUrl: 'https://gateway.example.test/mcp/gateways/fixture',
    gatewayTokenRef: { type: 'secret_ref', secretId: '20000000-0000-4000-8000-000000000002', version: 1 },
  };
  const child = spawn(process.execPath, ['dist/worker.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  const calls = [];
  const outbound = [];
  const unexpected = [];
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
  lines.on('line', line => {
    const msg = JSON.parse(line);
    if (!msg.method) return pending.get(msg.id)?.(msg);
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
  assert.deepEqual(calls, ['config.get', 'secrets.resolve', 'http.fetch', 'http.fetch', 'http.fetch']);
  assert.deepEqual(outbound, ['initialize', 'notifications/initialized', 'tools/list']);
  assert.deepEqual(unexpected, []);
  const exited = once(child, 'exit');
  await rpc('shutdown');
  assert.equal((await exited)[0], 0);
  assert.equal(stderr, '');
});
