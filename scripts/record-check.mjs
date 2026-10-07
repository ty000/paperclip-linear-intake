import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
const run = (...args) => execFileSync(...args, { encoding: 'utf8' }).trim();
const requestedBase = process.env.BUILD_EVIDENCE_BASE;
const explicitBase = requestedBase && requestedBase !== '0'.repeat(40);
if (explicitBase && !/^[0-9a-f]{40}$/.test(requestedBase)) {
  throw new Error('BUILD_EVIDENCE_BASE must identify a full commit SHA');
}
const base = explicitBase ? requestedBase : run('git', ['merge-base', 'HEAD',
  `refs/remotes/origin/${process.env.BUILD_EVIDENCE_DEFAULT_BRANCH || 'main'}`]);
run('git', ['cat-file', '-e', `${base}^{commit}`]);
const result = {
  schema: 'linear-intake-build-evidence.v1',
  candidate: run('git', ['rev-parse', 'HEAD']),
  base,
  baseSource: explicitBase ? 'explicit-ci-event-or-local-override' : 'merge-base-with-default-branch',
  node: process.version,
  npm: run('npm', ['--version']),
  sdk: JSON.parse(readFileSync('node_modules/@paperclipai/plugin-sdk/package.json')).version,
  lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  migrationsSha256: Object.fromEntries(readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()
    .map(name => [`migrations/${name}`, createHash('sha256').update(readFileSync(`migrations/${name}`)).digest('hex')])),
  builtRuntimeSha256: Object.fromEntries(readdirSync('dist').filter(name => name.endsWith('.js')).sort()
    .map(name => [`dist/${name}`, createHash('sha256').update(readFileSync(`dist/${name}`)).digest('hex')])),
  commands: ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run check', 'npm pack --dry-run --json'],
  layer: 'published-sdk-build-harness-rpc-and-synthetic-loopback-http',
  gatewayTransports: ['host_http', 'local_loopback'],
  // This artifact describes CI only; native evidence is recorded separately.
  nativeGatewayQualified: false,
  linearSourceCoverageQualified: false,
  nativeImportQualified: false,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/build-evidence.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
