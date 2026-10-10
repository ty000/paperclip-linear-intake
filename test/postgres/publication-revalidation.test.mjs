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

async function partiallyPublishedClosure() {
  const f = await publicationFixture(database.db);
  const intent = f.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure');
  f.grantTerminal();
  const execute = f.harness.ctx.db.execute;
  f.harness.ctx.db.execute = async (sql, args) => {
    const result = await execute(sql, args);
    if (sql.includes('SET effects=') && JSON.parse(args[0])[0].state === 'confirmed') f.config.publisher.enabled = false;
    return result;
  };
  await f.sendContinuity();
  f.harness.ctx.db.execute = execute;
  assert.equal(f.writes.length, 1);
  const row = await createPublicationStore(database.db).get(ids.company, intent.intentId);
  assert.deepEqual(row.effects.map(effect => effect.state), ['confirmed', 'pending']);
  return f;
}

for (const corruption of ['altered', 'missing', 'replaced']) {
  test(`terminal ${corruption} comment blocks its pending Done after restart without replacement`, async () => {
    const f = await partiallyPublishedClosure(), original = structuredClone(f.comments[0]);
    if (corruption === 'altered') f.comments[0].body += '\nModified externally';
    if (corruption === 'missing') f.comments.length = 0;
    if (corruption === 'replaced') f.comments[0].id = uuid(800);
    // A different required decision observes the full current comment inventory.
    const terminal = f.requestWire.publications[0];
    f.requestWire.publications = []; f.config.publisher.enabled = true;
    f.addIntent([], uuid(41), 'decision'); await f.sendContinuity();
    assert.equal(last(f).acknowledgements.length, 1);
    const restarted = await publicationFixture(database.db);
    restarted.comments = structuredClone(f.comments);
    restarted.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure');
    restarted.grantTerminal();
    assert.equal(restarted.requestWire.publications[0].payloadSha256, terminal.payloadSha256);
    await restarted.sendContinuity();
    assert.equal(last(restarted).acknowledgements.length, 0);
    assert.equal(restarted.writes.length, 0);
    const row = await createPublicationStore(database.db).get(ids.company, uuid(40));
    assert.equal(row.effects[0].body, original.body);
    assert.equal(row.effects[1].state, 'pending');
  });
}

for (const [kind, details] of [['progress', { campaignPlan: { leaves: [] } }],
  ['progress', { campaignDelivery: { sourceId: ids.child } }], ['decision', {}]]) {
  test(`closure retains an altered required ${Object.keys(details)[0] ?? kind} publication`, async () => {
    const f = await publicationFixture(database.db);
    f.addIntent([], uuid(41), kind, details); await f.sendContinuity();
    assert.equal(last(f).acknowledgements.length, 1);
    f.comments[0].body += '\nAltered proof'; f.requestWire.publications = [];
    f.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure');
    await f.sendContinuity();
    assert.equal(last(f).terminalClaimRequest, undefined);
    assert.equal(f.writes.length, 1);
    f.grantTerminal();
    await f.sendContinuity();
    assert.equal(f.writes.length, 1); assert.equal(last(f).acknowledgements.length, 0);
    assert.equal(f.issues.get(ids.root).stateHistory[0].state.id, ids.todo);
  });
}

for (const kind of ['question', 'blocker', 'progress']) {
  test(`missing historical ${kind} information does not become a required closure proof`, async () => {
    const f = await publicationFixture(database.db);
    f.addIntent([], uuid(41), kind); await f.sendContinuity();
    f.comments.length = 0; f.requestWire.publications = [];
    f.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure'); f.grantTerminal();
    await f.sendContinuity();
    assert.equal(last(f).acknowledgements.length, 1);
    assert.equal(f.issues.get(ids.root).stateHistory[0].state.id, ids.done);
  });
}

test('confirmed closure readback cannot be acknowledged again after its comment disappears', async () => {
  const f = await publicationFixture(database.db);
  f.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure'); f.grantTerminal();
  await f.sendContinuity(); assert.equal(last(f).acknowledgements.length, 1);
  f.comments.length = 0; const writes = f.writes.length;
  await f.sendContinuity();
  assert.equal(last(f).acknowledgements.length, 0); assert.equal(f.writes.length, writes);
});

for (const drift of [false, true]) {
  test(`revoked publisher credential preserves independent source diagnosis (drift=${drift})`, async () => {
    const f = await publicationFixture(database.db), fetch = f.harness.ctx.http.fetch;
    if (drift) f.issues.get(ids.child).description += ' changed criterion';
    f.harness.ctx.http.fetch = async (url, init) => url === f.config.publisher.gatewayUrl
      ? new Response('revoked', { status: 401 }) : fetch(url, init);
    const before = f.sourceCalls.length;
    await f.sendContinuity();
    assert.equal(last(f).availability, 'unavailable'); assert.equal(f.writes.length, 0);
    assert.ok(f.sourceCalls.length > before);
    assert.equal(last(f).diagnostic.code, drift ? 'source_changed' : 'publication_unavailable');
    if (drift) assert.deepEqual(last(f).diagnostic.changedSourceIds, [ids.child]);
  });
}

for (const state of ['started', 'completed']) {
  test(`lost ${state} response and revoked publisher defer status diagnosis until original reconciliation`, async () => {
    let lost = false;
    const f = await publicationFixture(database.db, { afterCall(_current, role) {
      if (role === 'saveIssue' && !lost) { lost = true; throw Error('lost response'); }
    } });
    f.addIntent([{ sourceId: ids.child, state }]); await f.sendContinuity();
    const store = createPublicationStore(database.db), fetch = f.harness.ctx.http.fetch;
    const effect = (await store.get(ids.company, uuid(40))).effects[1];
    assert.equal(effect.state, 'claimed'); assert.equal(f.writes.length, 2);
    f.harness.ctx.http.fetch = async (url, init) => url === f.config.publisher.gatewayUrl
      ? new Response('revoked', { status: 401 }) : fetch(url, init);
    const before = f.sourceCalls.length;
    await f.sendContinuity();
    assert.equal(last(f).availability, 'unavailable'); assert.equal(last(f).diagnostic.code, 'publication_unavailable');
    assert.ok(f.sourceCalls.length > before); assert.equal(last(f).acknowledgements.length, 0);
    assert.equal(await store.sourceAllows(f.requestWire), true); assert.equal(await store.heldDiagnostic(f.requestWire), undefined);
    assert.deepEqual((await store.get(ids.company, uuid(40))).effects[1], effect);
    f.harness.ctx.http.fetch = fetch; await f.sendContinuity();
    assert.equal(last(f).availability, 'available'); assert.equal(last(f).acknowledgements.length, 1);
    assert.equal((await store.get(ids.company, uuid(40))).effects[1].state, 'confirmed');
    assert.equal(f.writes.filter(write => write.role === 'saveIssue').length, 1);
  });
}

test('unreconciled status does not suppress an independently observed material drift with a revoked publisher', async () => {
  const f = await publicationFixture(database.db, { afterCall(_current, role) {
    if (role === 'saveIssue') throw Error('lost response');
  } });
  f.addIntent([{ sourceId: ids.child, state: 'completed' }]); await f.sendContinuity();
  f.issues.get(ids.child).description += ' changed criterion';
  const fetch = f.harness.ctx.http.fetch, store = createPublicationStore(database.db);
  f.harness.ctx.http.fetch = async (url, init) => url === f.config.publisher.gatewayUrl
    ? new Response('revoked', { status: 401 }) : fetch(url, init);
  await f.sendContinuity();
  assert.equal(last(f).diagnostic.code, 'source_changed'); assert.deepEqual(last(f).diagnostic.changedSourceIds, [ids.child]);
  assert.equal(await store.sourceAllows(f.requestWire), false); assert.equal(f.writes.length, 2);
});

test('absent claimed status remains unknown after publisher restoration and is never resent', async () => {
  const f = await publicationFixture(database.db, { beforeCall(_current, role) {
    if (role === 'saveIssue') throw Error('lost before remote');
  } });
  f.addIntent([{ sourceId: ids.child, state: 'started' }]); await f.sendContinuity();
  const store = createPublicationStore(database.db), fetch = f.harness.ctx.http.fetch;
  f.harness.ctx.http.fetch = async (url, init) => url === f.config.publisher.gatewayUrl
    ? new Response('revoked', { status: 401 }) : fetch(url, init);
  await f.sendContinuity();
  assert.equal(last(f).availability, 'unavailable'); assert.equal(last(f).acknowledgements.length, 0);
  f.harness.ctx.http.fetch = fetch; await f.sendContinuity();
  assert.equal(last(f).availability, 'unavailable'); assert.equal(last(f).acknowledgements.length, 0);
  assert.equal((await store.get(ids.company, uuid(40))).effects[1].state, 'claimed');
  assert.equal(f.writes.filter(write => write.role === 'saveIssue').length, 0);
});

test('new closure presents fixed objective and only observed historical comment URLs, preserving old bodies', async () => {
  const f = await publicationFixture(database.db, { afterCall(current, role) {
    if (role === 'saveComment') current.comments.at(-1).url = `https://linear.app/example/comment/${current.comments.at(-1).id}`;
  } });
  f.addIntent([], uuid(41), 'progress', { campaignPlan: { leaves: [] } }); await f.sendContinuity();
  const oldComment = structuredClone(f.comments[0]);
  f.requestWire.publications = [];
  f.addIntent([{ sourceId: ids.root, state: 'completed' }], uuid(40), 'closure'); f.grantTerminal();
  await f.sendContinuity();
  const body = f.comments.at(-1).body;
  assert.ok(body.includes(f.request.snapshot.campaign.milestone.description));
  assert.ok(body.includes(oldComment.url)); assert.ok(body.includes(oldComment.id));
  assert.deepEqual(f.comments[0], oldComment);
  const before = f.writes.length, receipt = last(f).acknowledgements[0].publicationReceipt;
  await f.sendContinuity();
  assert.equal(f.writes.length, before); assert.deepEqual(last(f).acknowledgements[0].publicationReceipt, receipt);
});
