import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const run = (...args) => execFileSync(...args, { encoding: 'utf8' }).trim();
const result = {
  schema: 'linear-intake-lot1-build-evidence.v1',
  candidate: run('git', ['rev-parse', 'HEAD']),
  base: '7b5983db12132427f5d1666d3f85147792acd39d',
  node: process.version,
  npm: run('npm', ['--version']),
  sdk: JSON.parse(readFileSync('node_modules/@paperclipai/plugin-sdk/package.json')).version,
  lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  commands: ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run check', 'npm pack --dry-run --json'],
  layer: 'published-sdk-build-harness-and-synthetic-rpc-transport',
  nativeGatewayQualified: false,
  linearSourceCoverageQualified: false,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/build-evidence.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
