import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import manifest from '../dist/manifest.js';

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
});
