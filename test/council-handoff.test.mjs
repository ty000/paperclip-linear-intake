import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { contentDigest } from '../dist/content-digest.js';
import { fingerprint } from '../dist/intake-authority.js';
import { parseConfig } from '../dist/config.js';
import { challenge, handoffFixture, uuid } from './helpers/council-handoff-fixture.mjs';
import { sourceIds } from './helpers/source-fixture.mjs';

function fixedClock(t) { t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T12:05:00.000Z') }); }
function noSource(f) { assert.deepEqual(f.requests, []); assert.deepEqual(f.secretReads, []); }
function blocked(f, reason) {
  assert.equal(f.results.length, 1); assert.equal(f.results[0].status, 'blocked');
  if (reason) assert.equal(f.results[0].reason, reason);
  assert.equal(JSON.stringify(f.results).includes('Synthetic full description'), false);
  assert.deepEqual(f.harness.logs, []);
}

test('public contract fixture has the same canonical request hash', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/council-handoff-contract.json', import.meta.url), 'utf8'));
  assert.equal(contentDigest(fixture.request), fixture.result.requestSha256);
  assert.deepEqual(fixture.result.request, fixture.request);
  assert.equal(Date.parse(fixture.result.validUntil) - Date.parse(fixture.result.observedAt), 120_000);
});

for (const stage of ['preparation', 'admission']) test(`${stage}: full source is reread and response binds the entire challenge`, async t => {
  fixedClock(t); const f = await handoffFixture(), request = challenge(f, stage);
  await f.send(request);
  assert.equal(f.results.length, 1); const result = f.results[0];
  assert.equal(result.status, 'confirmed'); assert.equal(result.reason, 'handoff_confirmed');
  assert.deepEqual(result.request, request); assert.equal(result.requestSha256, contentDigest(request));
  assert.ok(f.sourceCalls.filter(call => call.role === 'getIssue').length >= f.issues.size * 2);
  assert.equal(f.documentReads.length, 2);
  assert.equal(Date.parse(result.validUntil) - Date.parse(result.observedAt), 120_000);
  assert.equal(JSON.stringify(result).includes('Synthetic full description'), false);
  assert.ok(f.secretReads.every(read => read.scope.companyId === sourceIds.company));
  assert.ok(f.secretReads.every(read => read.scope.configPath === 'gatewayTokenRef'));
  assert.deepEqual(f.harness.logs, []);
});

for (const stage of ['preparation', 'admission']) test(`${stage}: campaign revalidation accepts enrolled state-only publication drift`, async t => {
  fixedClock(t); const f = await handoffFixture({ campaign: true });
  const root = f.issues.get(sourceIds.root);
  root.updatedAt = '2026-10-07T12:04:00.000Z'; root.status = 'Backlog'; root.statusType = 'backlog';
  root.stateHistory = [{ state: { id: sourceIds.backlog, name: 'Backlog', type: 'backlog' },
    startedAt: '2026-10-07T12:03:00.000Z', endedAt: null }];
  await f.send(challenge(f, stage));
  assert.equal(f.results.length, 1); assert.equal(f.results[0].status, 'confirmed');
  assert.equal(f.plan.plan.campaign.materialSourceSha256, f.request.snapshot.campaign.materialSourceSha256);
  assert.deepEqual(f.harness.logs, []);
});

test('campaign revalidation rejects material source drift while readiness remains unchanged', async t => {
  fixedClock(t); const f = await handoffFixture({ campaign: true });
  f.issues.get(sourceIds.child).description += ' changed material';
  await f.send(); blocked(f, 'handoff_source_changed');
});

const badEnvelopes = [
  ['wrong actor', { actorId: 'another.plugin' }], ['user actor', { actorType: 'user' }],
  ['missing actor', { actorId: undefined }], ['wrong company', { companyId: uuid(90) }],
  ['future envelope', { occurredAt: '2026-10-07T12:06:00.000Z' }],
  ['old envelope', { occurredAt: '2026-10-07T12:04:00.000Z' }],
];
for (const [name, base] of badEnvelopes) test(`${name} is ignored before configuration, ledger or source I/O`, async t => {
  fixedClock(t); const f = await handoffFixture(); await f.send(challenge(f), base);
  assert.deepEqual(f.results, []); assert.deepEqual(f.dbReads, []); assert.deepEqual(f.configReads, []); noSource(f);
});

const badRequests = [
  ['expired', request => { request.expiresAt = request.requestedAt; }],
  ['future', request => { request.requestedAt = '2026-10-07T12:06:00.000Z'; }],
  ['unbounded TTL', request => { request.expiresAt = '2026-10-07T12:10:00.001Z'; }],
  ['extra credential', request => { request.token = 'synthetic-private-sentinel'; }],
  ['invalid nonce', request => { request.nonce = 'short'; }],
  ['oversize', request => { request.padding = 'synthetic-private-sentinel'.repeat(500); }],
  ['invalid stage', request => { request.stage = 'execute'; }],
];
for (const [name, mutate] of badRequests) test(`${name} request is ignored before I/O`, async t => {
  fixedClock(t); const f = await handoffFixture(), request = challenge(f); mutate(request); await f.send(request);
  assert.deepEqual(f.results, []); assert.deepEqual(f.dbReads, []); assert.deepEqual(f.configReads, []); noSource(f);
});

const badBindings = [
  ['inactive', f => { f.binding.active = false; }],
  ['old epoch', f => { f.binding.activationId = uuid(91); }],
  ['changed fingerprint', f => { f.binding.fingerprint = 'c'.repeat(64); }],
  ['handoff disabled', f => { f.config.councilHandoffEnabled = false; }],
  ['retention suspended', f => { f.config.enabled = false; }],
  ['import disabled', f => { f.config.nativeImportEnabled = false; }],
  ['configuration scope changed', f => { f.config.sourceReader.teamId = uuid(92); }],
  ['missing binding', f => { f.binding = undefined; }],
  ['missing request', f => { f.request = undefined; }],
  ['missing plan', f => { f.plan = undefined; }],
  ['pending withdrawal/current guard', f => { f.current = false; }],
  ['unknown plan', f => { f.plan.state = 'outcome_unknown'; }],
  ['unknown effect', f => { f.effects[0].state = 'outcome_unknown'; }],
  ['missing effect', f => { f.effects.pop(); }],
  ['tampered effect digest', f => { f.effects[0].resultSha256 = 'e'.repeat(64); }],
  ['request version changed', f => { f.request.version++; }],
];
for (const [name, mutate] of badBindings) test(`${name} blocks before secret or provider reads`, async t => {
  fixedClock(t); const f = await handoffFixture(), request = challenge(f); mutate(f); await f.send(request);
  blocked(f); noSource(f);
});

for (const field of ['nativeRootId', 'targetProjectId', 'readinessDocumentId', 'readinessRevisionId']) {
  test(`mismatched ${field} blocks before source`, async t => {
    fixedClock(t); const f = await handoffFixture(), request = challenge(f); request[field] = uuid(99);
    await f.send(request); blocked(f); noSource(f);
  });
}

test('immutable readiness drift blocks without exposing the modified body', async t => {
  fixedClock(t); const f = await handoffFixture(); f.document.body = 'synthetic-private-sentinel';
  await f.send(); blocked(f); noSource(f);
  assert.equal(JSON.stringify(f.results).includes('synthetic-private-sentinel'), false);
});

test('a changed observed receipt with its own valid digest still contradicts immutable readiness', async t => {
  fixedClock(t); const f = await handoffFixture();
  f.effects[0].result.nativeId = uuid(77);
  f.effects[0].resultSha256 = contentDigest(f.effects[0].result);
  await f.send(); blocked(f, 'handoff_effects_changed'); noSource(f);
});

test('source withdrawal is detected from current metadata before reading descriptions', async t => {
  fixedClock(t); const f = await handoffFixture(); f.issues.get(sourceIds.root).archivedAt = new Date().toISOString();
  await f.send(); blocked(f, 'handoff_source_withdrawn');
  assert.equal(f.sourceCalls.length, 1);
  assert.equal(f.sourceCalls[0].args.fields.includes('description'), false);
});

test('source family drift blocks although the retained ledger is prepared', async t => {
  fixedClock(t); const f = await handoffFixture(); f.issues.get(sourceIds.child).description += 'private current source';
  await f.send(); blocked(f, 'handoff_source_changed');
  assert.equal(JSON.stringify(f.results).includes('private current source'), false);
});

test('reader request bounds remain active in the responder', async t => {
  fixedClock(t); const f = await handoffFixture({ configure(config) { config.sourceReader.maxRequests = 2; } });
  await f.send(); blocked(f);
  assert.ok(f.sourceCalls.length <= 3);
});

test('configuration revoked during source read stops before the next provider call', async t => {
  fixedClock(t); const f = await handoffFixture({ beforeCall(_call, current) { current.config.councilHandoffEnabled = false; } });
  await f.send(); blocked(f); assert.equal(f.sourceCalls.length, 1);
});

test('readiness revision changing after source read cannot confirm', async t => {
  fixedClock(t); const f = await handoffFixture({ beforeDocument(current) {
    if (current.documentReads.length === 2) current.document.latestRevisionId = uuid(98);
  } });
  await f.send(); blocked(f, 'handoff_readiness_changed');
  assert.equal(f.documentReads.length, 2);
});

test('same challenge replay rereads source and never reuses an earlier positive result', async t => {
  fixedClock(t); const f = await handoffFixture(), request = challenge(f);
  await f.send(request); const count = f.sourceCalls.length;
  assert.equal(f.results[0].status, 'confirmed');
  f.issues.get(sourceIds.root).archivedAt = new Date().toISOString();
  await f.send(request);
  assert.equal(f.results[1].status, 'blocked'); assert.ok(f.sourceCalls.length > count);
});

test('expired replay performs no new read and produces no reusable response', async t => {
  fixedClock(t); const f = await handoffFixture(), request = challenge(f);
  await f.send(request); const count = f.sourceCalls.length;
  t.mock.timers.setTime(Date.parse(request.expiresAt));
  await f.send(request); assert.equal(f.results.length, 1); assert.equal(f.sourceCalls.length, count);
});

test('expired request during collection cannot receive a positive response', async t => {
  fixedClock(t); const f = await handoffFixture({ beforeCall() { t.mock.timers.setTime(Date.parse('2026-10-07T12:10:00.000Z')); } });
  await f.send(); blocked(f); assert.equal(f.sourceCalls.length, 1);
});

test('concurrent duplicate and other challenges share one global read slot', async t => {
  fixedClock(t); let release; const wait = new Promise(resolve => { release = resolve; });
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const f = await handoffFixture({ async beforeCall() { entered(); await wait; } });
  const request = challenge(f), first = f.send(request); await started;
  await f.send(request); await f.send({ ...request, challengeId: uuid(50) });
  assert.equal(f.sourceCalls.length, 1); release(); await first;
  assert.equal(f.results.length, 1); assert.equal(f.results[0].status, 'confirmed');
});

test('secret and transport errors yield fixed diagnostics and no private logs', async t => {
  fixedClock(t); const f = await handoffFixture();
  f.harness.ctx.secrets.resolve = async () => { throw new Error('synthetic-private-sentinel'); };
  await f.send(); blocked(f, 'handoff_verification_failed');
  assert.equal(JSON.stringify(f.results).includes('synthetic-private-sentinel'), false);
});

test('failed emit never retries reads or leaks delivery errors', async t => {
  fixedClock(t); const f = await handoffFixture(); let emits = 0;
  f.harness.ctx.events.emit = async () => { emits++; throw new Error('synthetic-private-sentinel'); };
  await f.send(); assert.equal(emits, 1); assert.deepEqual(f.harness.logs, []);
});

test('off flag preserves the exact 0.3.0 fingerprint while opt-in requires new enrollment', async () => {
  const f = await handoffFixture(), off = parseConfig({ ...f.config, councilHandoffEnabled: false });
  const { councilHandoffEnabled: _off, ...legacy } = off;
  assert.equal(fingerprint(off), contentDigest({ ...legacy, enabled: false }));
  assert.notEqual(fingerprint(parseConfig(f.config)), fingerprint(off));
  assert.equal(parseConfig({}).councilHandoffEnabled, false);
  assert.throws(() => parseConfig({ councilHandoffEnabled: true }), /handoff_configuration_missing/);
});
