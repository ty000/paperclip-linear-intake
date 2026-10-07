import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Optional qualification probe against an existing host checkout. Never a CI
// dependency; fake DB stops all persistence, and autobuild/discovery are off.
const hostRepo = process.argv[2];
if (!hostRepo) throw new Error('Usage: host-loader-preflight.mjs <host-repo>');
process.env.NODE_ENV = 'production';
process.env.PAPERCLIP_LOG_LEVEL = 'silent';
process.env.PAPERCLIP_DISABLE_PLUGIN_AUTOBUILD = '1';
const hostSha = execFileSync('git', ['-C', hostRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const { pluginLoader } = await import(pathToFileURL(resolve(hostRepo, 'server/src/services/plugin-loader.ts')).href);
const candidatePath = fileURLToPath(new URL('../../', import.meta.url));
const originalFloor = '2026.1005.0';
const marker = 'SYNTHETIC_DB_SENTINEL_NO_DATABASE_AVAILABLE';
const observations = [];

for (const variant of ['original-floor', 'without-unqualified-floor']) {
  const dbAttempts = [];
  const fakeDb = new Proxy({}, {
    get(_target, key) {
      dbAttempts.push(String(key));
      throw new Error(marker);
    },
  });
  let capturedFloor;
  const loader = pluginLoader(fakeDb, {
    enableLocalFilesystem: false,
    enableNpmDiscovery: false,
    assertPackageActivation({ manifest }) {
      if (!manifest) return;
      capturedFloor = manifest.minimumHostVersion ?? null;
      // The manifest is an imported object in this process only. No file write.
      if (variant === 'original-floor') manifest.minimumHostVersion = originalFloor;
      else delete manifest.minimumHostVersion;
    },
  }, { instanceInfo: { instanceId: 'synthetic-review-only', hostVersion: '0.0.0' } });

  let error;
  try {
    // Local-path branch only. All persistence stops at the proxy before access.
    await loader.installPlugin({ localPath: candidatePath });
    assert.fail('Sentinel must make installation impossible');
  } catch (caught) {
    error = caught.message;
  }
  if (variant === 'original-floor') {
    assert.match(error, /requires host version 2026\.1005\.0 or newer, but this server is running 0\.0\.0/);
    assert.deepEqual(dbAttempts, []);
  } else {
    assert.equal(error, marker);
    assert.deepEqual(dbAttempts, ['transaction']);
  }
  observations.push({ variant, capturedFloor, hostVersion: '0.0.0', error, dbAttempts, persisted: false });
}
console.log(JSON.stringify({ scope: 'native-loader-pre-persistence-only', hostSha, observations }, null, 2));
