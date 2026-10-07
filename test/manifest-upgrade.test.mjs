import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseConfig } from '../dist/config.js';

test('packaged manifest is self-contained and reloads new schema in a persistent host', async t => {
  const root = await mkdtemp(join(tmpdir(), 'linear-intake-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, 'manifest.mjs');
  await writeFile(entry, 'export default {version:"synthetic-prior",instanceConfigSchema:{properties:{enabled:{const:false}}}};');
  const before = await import(`${pathToFileURL(entry).href}?mtime=prior`);
  assert.equal(before.default.instanceConfigSchema.properties.sourceProbe, undefined);
  // No SDK/config files exist alongside this entry. The host loads only data.
  await copyFile(new URL('../dist/manifest.js', import.meta.url), entry);
  const after = await import(`${pathToFileURL(entry).href}?mtime=current`);
  assert.equal(after.default.instanceConfigSchema.properties.sourceProbe.type, 'object');
  assert.equal(after.default.instanceConfigSchema.properties.enabled.default, false);
  assert.equal(after.default.instanceConfigSchema.properties.enabled.type, 'boolean');
  assert.ok(after.default.instanceConfigSchema.allOf[0].then.required.includes('intake'));
  assert.equal(parseConfig({}).enabled, false);
  assert.doesNotMatch(await readFile(entry, 'utf8'), /^import\s/m);
});
