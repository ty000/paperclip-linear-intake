import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { isolatedDatabase } from './intake-db-helper.mjs';
import { publicationFixture } from '../helpers/publication-fixture.mjs';
import { sourceIds as ids } from '../helpers/source-fixture.mjs';
import { uuid } from '../helpers/council-handoff-fixture.mjs';
import { createPublicationStore } from '../../dist/publication-store.js';

let database;
before(async () => { database = await isolatedDatabase(); });
after(async () => database?.close());
beforeEach(async () => database.reset());
const last = f => f.continuityResults.at(-1);

// Four tickets: campaign, parent, two leaves; one project inventory page.
// One full collection = 12 calls; a consistent source observation = 24 calls.
function representativeCampaign(f) {
  f.config.sourceReader.pageSize = 10;
  const sibling = structuredClone(f.issues.get(ids.grandchild));
  Object.assign(sibling, { uuid: ids.completed, id: 'SYN-6', title: 'Synthetic second leaf' });
  f.issues.set(sibling.uuid, sibling);
}

for (const control of ['running', 'paused', 'cancelled']) {
  test(`a ${control} observation without publications collects the full source twice, not four times`, async () => {
    const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign });
    f.requestWire.control = control;
    await f.sendContinuity();
    assert.equal(last(f).availability, 'available');
    assert.equal(f.sourceCalls.length, 24);
    assert.equal(f.publisherReads.length, 0);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(last(f).acknowledgements, []);
    // Each new request observes the actual source; no cached positive verdict.
    f.issues.get(ids.child).description += ' changed acceptance criterion';
    f.requestWire.challengeId = uuid(32);
    await f.sendContinuity();
    assert.equal(last(f).availability, 'unavailable');
    assert.equal(last(f).diagnostic.code, 'source_changed');
    assert.equal(f.sourceCalls.length, 48);
    assert.equal(f.writes.length, 0);
  });
}

test('an observation without publications still reconciles a lost status response before reading source', async () => {
  let lost = false;
  const options = { prepareCampaign: representativeCampaign };
  const f = await publicationFixture(database.db, { ...options,
    afterCall(_current, role) { if (role === 'saveIssue' && !lost) { lost = true; throw Error('lost response'); } } });
  f.addIntent([{ sourceId: ids.child, state: 'started' }]);
  await f.sendContinuity();
  const store = createPublicationStore(database.db), before = await store.get(ids.company, uuid(40));
  assert.equal(before.effects[1].state, 'claimed');
  assert.equal(f.writes.length, 2);
  const restarted = await publicationFixture(database.db, options);
  restarted.issues.set(ids.child, structuredClone(f.issues.get(ids.child)));
  restarted.comments = structuredClone(f.comments);
  await restarted.sendContinuity();
  const after = await store.get(ids.company, uuid(40));
  assert.equal(after.intentId, before.intentId);
  assert.equal(after.payloadSha256, before.payloadSha256);
  assert.deepEqual(after.effects.map(effect => effect.state), ['confirmed', 'confirmed']);
  assert.equal(last(restarted).availability, 'available');
  assert.equal(restarted.sourceCalls.length, 24);
  assert.equal(restarted.publisherReads.length, 1);
  assert.equal(restarted.writes.length, 0);
  assert.deepEqual(last(restarted).acknowledgements, []);
});

function checkpointMatches(sql, args, stage, index) {
  if (stage === 'beforeClaim') return sql.includes('SET active_intent_id=$3');
  return sql.includes('SET effects=') && JSON.parse(args[0])[index]?.state === 'claimed';
}

function atCheckpoint(f, stage, callback, index = 0) {
  const execute = f.harness.ctx.db.execute;
  let reached = false;
  f.harness.ctx.db.execute = async (sql, args) => {
    const result = await execute(sql, args);
    if (!reached && result.rowCount === 1 && checkpointMatches(sql, args, stage, index)) { reached = true; await callback(); }
    return result;
  };
  return () => assert.equal(reached, true, `must reach ${stage}`);
}

function recordSourceCallsAtClaims(f, counts) {
  const execute = f.harness.ctx.db.execute;
  f.harness.ctx.db.execute = async (sql, args) => {
    const result = await execute(sql, args);
    if (sql.includes('SET effects=') && JSON.parse(args[0]).some(effect => effect.state === 'claimed')) counts.push(f.sourceCalls.length);
    return result;
  };
}

const ordinaryScenarios = [
  { label: 'comment', updates: [], effects: 1, claims: [24], sends: [48], reads: 3, total: 76, oldSourceCalls: 96 },
  { label: 'comment and status', updates: [{ sourceId: ids.child, state: 'started' }], effects: 2,
    claims: [24, 48], sends: [48, 72], reads: 6, total: 104, oldSourceCalls: 144 },
];
for (const scenario of ordinaryScenarios) {
  test(`ordinary publication removes exactly one 24-call observation per effect (${scenario.label})`, async () => {
    const sendCounts = [], claimCounts = [];
    const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign,
      beforeCall(current, role) { if (role.startsWith('save')) sendCounts.push(current.sourceCalls.length); } });
    f.addIntent(scenario.updates);
    recordSourceCallsAtClaims(f, claimCounts);
    await f.sendContinuity();
    assert.equal(last(f).availability, 'available');
    assert.equal(last(f).acknowledgements.length, 1);
    assert.equal(f.writes.length, scenario.effects);
    assert.deepEqual(claimCounts, scenario.claims);
    assert.deepEqual(sendCounts, scenario.sends);
    assert.equal(f.sourceCalls.length, 48 + 24 * scenario.effects, 'initial + per-send + final double observations');
    assert.equal(f.publisherReads.length, scenario.reads);
    assert.equal(f.sourceCalls.length + f.publisherReads.length + f.writes.length, scenario.total);
    // Baseline counts measured on the unchanged 0.6.2 source.
    assert.equal(scenario.oldSourceCalls - f.sourceCalls.length, 24 * scenario.effects);
  });
}

for (const scenario of ['blocker', 'closure-claim']) {
  test(`${scenario} retains its original source and targeted-read gates`, async () => {
    const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign });
    if (scenario === 'blocker') f.addIntent([], uuid(40), 'blocker');
    else f.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure');
    await f.sendContinuity();
    assert.equal(last(f).availability, 'available');
    assert.equal(f.sourceCalls.length, scenario === 'blocker' ? 48 : 72);
    assert.equal(f.publisherReads.length, scenario === 'blocker' ? 5 : 0);
    assert.equal(f.writes.length, scenario === 'blocker' ? 1 : 0);
    if (scenario === 'closure-claim') {
      assert.equal(last(f).terminalClaimRequest.intentId, uuid(40));
      const row = await createPublicationStore(database.db).get(ids.company, uuid(40));
      assert.deepEqual(row.effects.map(effect => effect.state), ['pending', 'pending']);
    }
  });
}

for (const kind of ['progress', 'closure']) {
  test(`source drift after the ${kind} claim prevents send and retains the original identity after restoration`, async () => {
    const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign });
    f.addIntent(kind === 'closure' ? [{ sourceId: ids.root, state: 'completed' }] : [], uuid(40), kind);
    if (kind === 'closure') f.grantTerminal();
    const original = f.issues.get(ids.child).description;
    const reached = atCheckpoint(f, 'afterClaim', () => { f.issues.get(ids.child).description += ' Changed after claim'; });
    await f.sendContinuity(); reached();
    assert.equal(f.writes.length, 0);
    assert.equal(last(f).diagnostic.code, 'source_changed');
    const store = createPublicationStore(database.db), held = await store.get(ids.company, uuid(40));
    assert.equal(held.effects[0].state, 'claimed');
    f.issues.get(ids.child).description = original;
    f.requestWire.resumeVersion = 1;
    await f.sendContinuity();
    assert.equal(f.writes.length, 0);
    assert.deepEqual((await store.get(ids.company, uuid(40))).effects, held.effects);
    assert.equal((await store.get(ids.company, uuid(40))).payloadSha256, held.payloadSha256);
  });
}

const revoke = {
  authority(f) { f.binding.active = false; },
  configuration(f) { f.config.sourceReader.maxPagesPerParent++; },
  publisher(f) { f.config.publisher.enabled = false; },
  preparation(f) { f.plan.state = 'blocked'; },
  readiness(f) { f.documents.get('linear-intake-readiness-v1').latestRevisionId = uuid(888); },
  expiration(f, t) { t.mock.method(Date, 'now', () => Date.parse(f.requestWire.expiresAt) + 1); },
};
for (const stage of ['beforeClaim', 'afterClaim']) {
  for (const [reason, change] of Object.entries(revoke)) {
    test(`${reason} revocation ${stage} prevents publication without a replacement effect`, async t => {
      const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign });
      f.addIntent();
      const reached = atCheckpoint(f, stage, () => change(f, t));
      await f.sendContinuity(); reached();
      assert.equal(f.writes.length, 0);
      const rows = await createPublicationStore(database.db).list(ids.company, uuid(30));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].intentId, uuid(40));
      assert.equal(rows[0].effects[0].state, stage === 'beforeClaim' ? 'pending' : 'claimed');
      assert.equal(f.sourceCalls.length, 24, 'native revocation blocks before any additional full scan');
    });
  }
}

test('a control comment still rechecks the root project after claiming its effect', async () => {
  const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign });
  f.addIntent([], uuid(40), 'blocker');
  const reached = atCheckpoint(f, 'afterClaim', () => { f.issues.get(ids.root).projectId = ids.outside; });
  await f.sendContinuity(); reached();
  assert.equal(f.writes.length, 0);
  assert.equal((await createPublicationStore(database.db).get(ids.company, uuid(40))).effects[0].state, 'claimed');
});

test('a concurrently held source remains a native pre-claim gate without another source scan', async () => {
  const f = await publicationFixture(database.db, { prepareCampaign: representativeCampaign });
  f.addIntent();
  const store = createPublicationStore(database.db);
  const reached = atCheckpoint(f, 'beforeClaim', () => store.holdSource(f.requestWire, {
    code: 'source_changed', expectedSourceSha256: f.requestWire.sourceSha256,
    changedSourceIds: [ids.child], changedFields: ['description'],
  }));
  await f.sendContinuity(); reached();
  assert.equal(f.writes.length, 0);
  assert.equal((await store.get(ids.company, uuid(40))).effects[0].state, 'pending');
  assert.equal(f.sourceCalls.length, 24);
});
