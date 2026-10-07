import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import manifest from '../dist/manifest.js';
import { handoffFixture } from './helpers/council-handoff-fixture.mjs';
import { parseConfig } from '../dist/config.js';
import { fingerprint } from '../dist/intake-authority.js';

test('config JSON Schema compiles with the host Ajv dialect and accepts omitted defaults', () => {
  // Mirrors plugin-config-validator.ts library/options at the cited host SHA.
  // This tests schema interoperability, not a running host config update.
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  ajv.addFormat('secret-ref', { validate: () => true });
  const validate = ajv.compile(manifest.instanceConfigSchema);
  assert.equal(validate({}), true);
  assert.equal(validate({ enabled: false, gatewayDiscoveryEnabled: false }), true);
  assert.equal(validate({ enabled: true }), false);
  assert.equal(validate({ gatewayTokenRef: { type: 'plain', value: 'synthetic' } }), false);
  assert.equal(validate({ gatewayTokenRef: { type: 'secret_ref', secretId: 'invalid' } }), false);
  assert.equal(validate({ gatewayTransport: 'local_loopback', localGatewayTimeoutMs: 100 }), true);
  assert.equal(validate({ gatewayTransport: 'automatic' }), false);
  assert.equal(validate({ localGatewayTimeoutMs: 0 }), false);
  assert.equal(validate({ localGatewayTimeoutMs: 10001 }), false);
  assert.equal(validate({ gatewayToolCallMode: 'native_rest', nativeToolTimeoutMs: 20000 }), true);
  assert.equal(validate({ gatewayToolCallMode: 'automatic' }), false);
  assert.equal(validate({ nativeToolTimeoutMs: 999 }), false);
  assert.equal(validate({ nativeToolTimeoutMs: 30001 }), false);
  assert.equal(validate({ councilHandoffEnabled: true }), false);
  assert.equal(validate({ councilHandoffEnabled: false }), true);
});

test('handoff configuration can suspend and resume without changing its enrolled authority', async () => {
  const f = await handoffFixture();
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv); ajv.addFormat('secret-ref', { validate: () => true });
  const validate = ajv.compile(manifest.instanceConfigSchema);
  const active = parseConfig(f.config), suspended = parseConfig({ ...f.config, enabled: false });
  assert.equal(validate(active), true); assert.equal(validate(suspended), true);
  assert.equal(fingerprint(active), fingerprint(suspended));
  assert.equal(suspended.councilHandoffEnabled, true);
});
