import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const script = new URL('../scripts/qualification/summarize-native-source.mjs', import.meta.url);
const privateText = 'SYNTHETIC_PRIVATE_DESCRIPTION';
const observation = (role, value) => ({ role, result: { isError: false, structuredContent: {
  isError: false, structuredContent: null, content: [{ type: 'text', text: JSON.stringify(value) }],
} } });

function fixture() {
  const issues = [1, 2].map(i => ({ id: `SYNTHETIC-${i}`, uuid: `synthetic-uuid-${i}`,
    projectId: 'synthetic-project', teamId: 'synthetic-team', description: privateText,
    relations: { blockedBy: [], duplicateOf: null }, stateHistory: [{ endedAt: null, state: { id: 'state' } }],
  }));
  return [
    { data: { status: 'catalog_observed', tools: [{ name: 'synthetic:get-issue' }], catalogSha256: 'synthetic-digest' } },
    { data: { status: 'source_probe_observed', observations: [
      observation('getProject', { uuid: 'synthetic-project' }), observation('getTeam', { id: 'synthetic-team' }),
      observation('listStatuses', [{ id: 'state' }]),
      observation('listIssues', { issues, hasNextPage: true, cursor: 'synthetic-cursor' }),
    ] } },
    { data: { status: 'source_probe_observed', sourceCoverage: 'unqualified',
      observations: issues.map(issue => observation('getIssue', issue)) } },
  ];
}

async function runSummary(t, inputs) {
  const dir = await mkdtemp(join(tmpdir(), 'linear-summary-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = ['catalog', 'probe', 'samples'].map(name => join(dir, `${name}.json`));
  await Promise.all(paths.map((path, i) => writeFile(path, JSON.stringify(inputs[i]))));
  return exec(process.execPath, [script.pathname, ...paths]);
}

test('qualification summary preserves evidence structure without source text or identifiers', async t => {
  const { stdout, stderr } = await runSummary(t, fixture());
  const summary = JSON.parse(stdout);
  assert.equal(stderr, '');
  assert.equal(stdout.includes(privateText), false);
  assert.equal(stdout.includes('synthetic-uuid'), false);
  assert.equal(summary.completeFamilyRead, false);
  assert.equal(summary.sourceCoverage, 'unqualified');
  assert.deepEqual(summary.normalizedToolNames, ['get-issue']);
  assert.equal(summary.samples.length, 2);
  assert.deepEqual(summary.samples[0].relationCounts, { blockedBy: 0, duplicateOf: 0 });
  assert.equal(summary.samples[0].detailDescriptionCharacters, privateText.length);
  assert.equal(summary.samples[0].openStateHistoryCarriesId, true);
});

const invalidEnvelopes = [
  ['outer error', outer => { outer.isError = true; }],
  ['inner error', outer => { outer.structuredContent.isError = true; }],
  ['missing inner envelope', outer => { delete outer.structuredContent; }],
  ['unexpected structured payload', outer => { outer.structuredContent.structuredContent = {}; }],
  ['multiple text blocks', outer => { outer.structuredContent.content.push({ type: 'text', text: privateText }); }],
  ['non-text content', outer => { outer.structuredContent.content[0].type = 'image'; }],
  ['invalid JSON', outer => { outer.structuredContent.content[0].text = privateText; }],
];
for (const [label, mutate] of invalidEnvelopes) {
  test(`qualification summary rejects ${label} without emitting source data`, async t => {
    const inputs = fixture();
    mutate(inputs[2].data.observations[0].result);
    const error = await runSummary(t, inputs).catch(e => e);
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(error.stderr, 'Native observation validation failed; no source data emitted.\n');
  });
}

for (const field of ['description', 'relations', 'stateHistory']) {
  test(`qualification summary rejects a detail missing ${field}`, async t => {
    const inputs = fixture();
    const block = inputs[2].data.observations[0].result.structuredContent.content[0];
    const issue = JSON.parse(block.text);
    delete issue[field];
    block.text = JSON.stringify(issue);
    const error = await runSummary(t, inputs).catch(e => e);
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(error.stderr.includes(privateText), false);
  });
}
