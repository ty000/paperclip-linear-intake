import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import manifest from '../dist/manifest.js';

test('built worker runs the actual SDK JSON-RPC host with no unsolicited effects', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['dist/worker.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const lines = createInterface({ input: child.stdout });
  const replies = new Map();
  const hostCalls = [];
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  lines.on('line', line => {
    const msg = JSON.parse(line);
    if (msg.method) {
      hostCalls.push(msg);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null }) + '\n');
    }
    else replies.get(msg.id)?.(msg);
  });
  let id = 0;
  function rpc(method, params = {}) {
    return new Promise(resolve => {
      const requestId = ++id;
      replies.set(requestId, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  const initialized = await rpc('initialize', { manifest, config: {} });
  assert.equal(initialized.result.ok, true);
  assert.ok(initialized.result.supportedMethods.includes('health'));
  assert.equal((await rpc('health')).result.status, 'degraded');
  assert.equal((await rpc('validateConfig', { config: { enabled: true } })).result.ok, false);
  assert.equal((await rpc('validateConfig', { config: {} })).result.ok, true);
  const exited = once(child, 'exit');
  await rpc('shutdown');
  assert.equal((await exited)[0], 0);
  assert.deepEqual(hostCalls.map(({ method, params }) => ({ method, params })), [{ method: 'events.subscribe',
    params: { eventPattern: 'plugin.private.paperclip-council.linear-intake-revalidation-request', filter: null } }, { method: 'events.subscribe', params: { eventPattern: 'plugin.private.paperclip-council.linear-continuity-request', filter: null } }]);
  assert.equal(stderr, '');
});
