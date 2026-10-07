import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
const run = (...args) => execFileSync(...args, { encoding: 'utf8' }).trim();
const result = {
  schema: 'linear-intake-lot1-build-evidence.v1',
  candidate: run('git', ['rev-parse', 'HEAD']),
  base: 'f418c1e8ae2961844d498264957642596d23c98a',
  node: process.version,
  npm: run('npm', ['--version']),
  sdk: JSON.parse(readFileSync('node_modules/@paperclipai/plugin-sdk/package.json')).version,
  lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  builtRuntimeSha256: Object.fromEntries(readdirSync('dist').filter(name => name.endsWith('.js')).sort()
    .map(name => [`dist/${name}`, createHash('sha256').update(readFileSync(`dist/${name}`)).digest('hex')])),
  commands: ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run check', 'npm pack --dry-run --json'],
  layer: 'published-sdk-build-harness-rpc-and-synthetic-loopback-http',
  gatewayTransports: ['host_http', 'local_loopback'],
  // This artifact describes CI only; native evidence is recorded separately.
  nativeGatewayQualified: false,
  linearSourceCoverageQualified: false,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/build-evidence.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
