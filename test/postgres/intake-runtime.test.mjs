import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { INTAKE_DATABASE_NAMESPACE as namespace } from '../../dist/intake-state.js';
import { contentDigest } from '../../dist/content-digest.js';
import { isolatedDatabase, interrupted } from './intake-db-helper.mjs';
import { sourceIds } from '../helpers/source-fixture.mjs';
import { intakeFixture, intakeIds, webhookInput, webhookSecret, operator, deferred, assertNoImport } from '../helpers/intake-fixture.mjs';

let database;
before(async () => { database = await isolatedDatabase(); });
beforeEach(async t => {
  await database.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T12:05:00.000Z') });
});
after(async () => { if (database) await database.close(); });

async function rows(table) {
  return (await database.pool.query(`SELECT * FROM ${namespace}.${table}`)).rows;
}
async function request() {
  const found = await rows('intake_requests'); assert.equal(found.length, 1); return found[0];
}
async function enrolled(options = {}) {
  const fixture = await intakeFixture(database, options);
  const activation = await fixture.activate(); assert.equal(activation.status, 'intake_enrolled');
  return { ...fixture, activation };
}
async function retained(options = {}) {
  const fixture = await enrolled(options); await fixture.receive(); return fixture;
}
async function rejectedWebhook(fixture, input) {
  await assert.rejects(fixture.receive(input), error => {
    assert.equal(error.message, 'intake_webhook_rejected');
    assert.equal(error.stack.includes(webhookSecret), false);
    return true;
  });
}
function sourceIsWithdrawn(fixture, kind) {
  const root = fixture.issues.get(sourceIds.root);
  const mutate = {
    state: () => { root.stateHistory[0].state = { id: sourceIds.backlog, name: 'Backlog', type: 'backlog' };
      root.status = 'Backlog'; root.statusType = 'backlog'; },
    project: () => { root.projectId = sourceIds.outside; },
    team: () => { root.teamId = sourceIds.outside; },
    archived: () => { root.archivedAt = new Date().toISOString(); },
  };
  mutate[kind]();
}
async function stopDrain(fixture) {
  try { await fixture.drain(); }
  catch (error) { assert.equal(error.message, 'intake_job_failed'); }
}
function reenterTodo(root) {
  const prior = root.stateHistory[0];
  const leftAt = new Date(Date.now() - 500).toISOString();
  const enteredAt = new Date().toISOString();
  root.stateHistory = [
    { ...prior, endedAt: leftAt },
    { state: { id: sourceIds.backlog, name: 'Backlog', type: 'backlog' }, startedAt: leftAt, endedAt: enteredAt },
    { state: prior.state, startedAt: enteredAt, endedAt: null },
  ];
  root.updatedAt = enteredAt;
}
const sourceCorruptions = {
  eligibility: (payload, call) => call.number === 1 ? { uuid: sourceIds.root } : payload,
  description: (payload, call) => {
    if (call.args.fields?.includes('description')) delete payload.description;
    return payload;
  },
  pagination: (payload, call) => call.role === 'listIssues' ? { issues: [], hasNextPage: true, cursor: 'truncated' } : payload,
  upstream: () => { throw new Error('synthetic-private-upstream-error'); },
};

test('setup defers native database access and enabled config alone never enrolls or fetches', async () => {
  const f = await intakeFixture(database);
  assert.deepEqual(f.registeredJobs, ['drain-intake']);
  assert.equal(database.calls.length, 0);
  assert.equal((await f.inspect()).enrolled, false);
  await f.drain();
  await rejectedWebhook(f, webhookInput(f));
  assert.deepEqual(await rows('intake_binding'), []);
  assert.deepEqual(await rows('intake_requests'), []);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.secretReads, []);
  assertNoImport(f);
});

for (const actor of [undefined, { type: 'system' }, { type: 'agent', agentId: 'synthetic-agent' }, { type: 'user' }]) {
  test('activate requires an authenticated board user and ignores actor or company spoofing in params', async () => {
    const f = await intakeFixture(database);
    const out = await f.harness.performAction('activate-intake', { companyId: sourceIds.outside,
      actor: { type: 'user', userId: 'forged' }, actorContext: operator }, { companyId: sourceIds.company, actor });
    assert.deepEqual(out, { status: 'blocked', reason: 'intake_operator_required' });
    assert.deepEqual(await rows('intake_binding'), []);
    assert.deepEqual(f.configReads, []); assert.deepEqual(f.requests, []);
  });
}
test('host company scope wins over parameters; enrollment replay retains its original epoch', async t => {
  const f = await intakeFixture(database);
  const first = await f.activate({ companyId: sourceIds.outside, activationAt: '2000-01-01T00:00:00.000Z' });
  assert.equal(first.status, 'intake_enrolled');
  assert.equal((await rows('intake_binding'))[0].company_id, sourceIds.company);
  assert.equal((await rows('intake_binding'))[0].authority.activationAt, first.activatedAt);
  t.mock.timers.tick(1000);
  const replay = await f.activate();
  assert.equal(replay.activationId, first.activationId); assert.equal(replay.activatedAt, first.activatedAt);
  const outsider = await f.harness.performAction('activate-intake', {}, { ...operator, companyId: sourceIds.outside });
  assert.deepEqual(outsider, { status: 'blocked', reason: 'intake_company_already_bound' });
  assert.equal((await rows('intake_binding')).length, 1);
});
test('missing company scope cannot enroll even an identified user', async () => {
  const f = await intakeFixture(database);
  const out = await f.harness.performAction('activate-intake', {}, { actor: operator.actor, companyId: null });
  assert.deepEqual(out, { status: 'blocked', reason: 'intake_operator_required' });
  assert.deepEqual(await rows('intake_binding'), []);
});

test('signed receipt and projection are durable before webhook resolution; callback does no source HTTP', async () => {
  const written = deferred(), release = deferred();
  const db = { ...database.db, async execute(sql, params) {
    const result = await database.db.execute(sql, params);
    if (sql.includes('intake_deliveries SET applied = true')) { written.resolve(); await release.promise; }
    return result;
  } };
  const f = await enrolled({ db }); const input = webhookInput(f);
  let resolved = false;
  const receive = f.receive(input).then(() => { resolved = true; });
  await written.promise;
  try {
    assert.equal(resolved, false);
    const [delivery] = await rows('intake_deliveries');
    assert.equal(delivery.provider_delivery_id, input.headers['Linear-Delivery']); assert.equal(delivery.applied, true);
    assert.equal((await request()).status, 'received');
    assert.deepEqual(f.requests, []);
  } finally { release.resolve(); }
  await receive;
  assert.equal(resolved, true);
  assert.deepEqual(f.secretReads, [{ ref: { type: 'secret_ref', secretId: intakeIds.webhookSecret, version: 1 },
    scope: { companyId: sourceIds.company, configPath: 'intake.webhookSecretRef' } }]);
  const first = await request();
  await f.receive({ ...input, requestId: randomUUID() });
  assert.equal((await request()).intake_id, first.intake_id);
  assert.equal((await rows('intake_deliveries')).length, 1);
  assert.equal((await request()).version, first.version);
  assertNoImport(f);
});

test('the registered job reads the full source family via SDK and persists its canonical digest', async () => {
  const f = await retained();
  assert.deepEqual(f.requests, []);
  await f.drain();
  const row = await request();
  assert.equal(row.status, 'source_observed'); assert.equal(row.attempts, 1);
  assert.equal(row.snapshot.issues.length, 5);
  assert.equal(row.snapshot.selectedRootInTodo, true);
  assert.ok(row.snapshot.issues.every(issue => issue.description.length > 1000));
  const { sourceSha256, ...body } = row.snapshot;
  assert.equal(row.snapshot_sha256, sourceSha256); assert.equal(contentDigest(body), sourceSha256);
  assert.deepEqual(f.sourceCalls[0].args.fields, ['uuid', 'teamId', 'projectId', 'archivedAt', 'stateHistory']);
  assert.equal(f.sourceCalls[0].role, 'getIssue');
  assert.ok(f.sourceCalls.some(call => call.role === 'listIssues' && call.args.cursor));
  assert.ok(f.sourceCalls.filter(call => call.role === 'getIssue').length > 5);
  const gatewaySecrets = f.secretReads.filter(read => read.scope.configPath === 'gatewayTokenRef');
  assert.equal(gatewaySecrets.length, 2);
  assert.ok(gatewaySecrets.every(read => read.scope.companyId === sourceIds.company));
  assert.ok(gatewaySecrets.every(read => read.ref.secretId === f.config.gatewayTokenRef.secretId));
  const httpCount = f.requests.length;
  await f.drain(); assert.equal(f.requests.length, httpCount);
  assertNoImport(f);
});

const invalidWebhook = {
  signature: (f) => webhookInput(f, { input: { headers: { 'Linear-Signature': '0'.repeat(64), 'Linear-Delivery': randomUUID() } } }),
  timestamp: (f) => webhookInput(f, { mutate: p => { p.webhookTimestamp -= 60001; } }),
  endpoint: (f) => webhookInput(f, { input: { endpointKey: 'other' } }),
  envelope: (f) => webhookInput(f, { mutate: p => { delete p.data.stateId; } }),
};
for (const [name, input] of Object.entries(invalidWebhook)) {
  test(`invalid ${name} webhook leaves no retained request or delivery`, async () => {
    const f = await enrolled(); await rejectedWebhook(f, input(f));
    assert.deepEqual(await rows('intake_requests'), []); assert.deepEqual(await rows('intake_deliveries'), []);
    assert.deepEqual(f.requests, []); assertNoImport(f);
  });
}
for (const mutation of [
  p => { p.organizationId = sourceIds.outside; },
  p => { p.data.projectId = sourceIds.outside; },
  p => { p.actor.id = sourceIds.outside; },
  p => { p.updatedFrom = {}; },
  p => { p.action = 'create'; },
  p => { p.createdAt = '2000-01-01T00:00:00.000Z'; },
]) {
  test('out-of-authority, stale-action and non-transition webhooks are inert', async () => {
    const f = await enrolled(); await f.receive(webhookInput(f, { mutate: mutation }));
    assert.deepEqual(await rows('intake_deliveries'), []); assert.deepEqual(await rows('intake_requests'), []);
    assert.deepEqual(f.requests, []);
  });
}
test('signed raw body alone controls processing; parsedBody cannot inject or suppress a request', async () => {
  const f = await enrolled();
  const rawIgnored = webhookInput(f, { mutate: p => { p.action = 'create'; } });
  rawIgnored.parsedBody = webhookInput(f).parsedBody;
  await f.receive(rawIgnored); assert.deepEqual(await rows('intake_requests'), []);
  const rawAccepted = webhookInput(f, { input: { parsedBody: { action: 'remove', data: { id: sourceIds.outside } } } });
  await f.receive(rawAccepted);
  assert.equal((await request()).issue_id, sourceIds.root); assert.equal((await request()).status, 'received');
});

test('a fresh worker setup recovers retained work without any configChanged callback', async () => {
  const first = await retained(); const original = await request();
  const restarted = await intakeFixture(database);
  assert.equal((await restarted.inspect()).activationId, first.activation.activationId);
  assert.deepEqual(restarted.sourceCalls, []);
  await restarted.drain();
  const recovered = await request();
  assert.equal(recovered.status, 'source_observed'); assert.equal(recovered.intake_id, original.intake_id);
  assert.equal(recovered.activation_id, original.activation_id);
  assert.deepEqual(first.requests, []); assertNoImport(restarted);
});
test('restart replays a retained receipt after interrupted projection under its original delivery identity', async () => {
  const first = await enrolled();
  first.harness.ctx.db = interrupted(database.db, 2, false);
  const input = webhookInput(first); await rejectedWebhook(first, input);
  assert.equal((await rows('intake_deliveries')).length, 1);
  assert.deepEqual(await rows('intake_requests'), []);
  const restarted = await intakeFixture(database); await restarted.drain();
  assert.equal((await request()).status, 'source_observed');
  assert.equal((await request()).delivery_id, input.headers['Linear-Delivery']);
  assert.equal((await rows('intake_deliveries'))[0].applied, true);
});
test('enabled false suspends retained work and true resumes the same activation and boundary', async t => {
  const f = await retained(); const first = await request();
  f.config.enabled = false;
  await f.drain(); await rejectedWebhook(f, webhookInput(f));
  assert.equal((await request()).status, 'received'); assert.deepEqual(f.requests, []);
  assert.equal((await f.inspect()).activationId, f.activation.activationId);
  t.mock.timers.tick(1000); f.config.enabled = true;
  const resumed = await f.activate();
  assert.equal(resumed.activationId, f.activation.activationId); assert.equal(resumed.activatedAt, f.activation.activatedAt);
  await f.drain();
  assert.equal((await request()).intake_id, first.intake_id); assert.equal((await request()).status, 'source_observed');
});

test('explicit deactivation prevents a delayed job from publishing its observed family', async t => {
  const entered = deferred(), release = deferred();
  const f = await retained({ beforeCall: async call => {
    if (call.number === 1) { entered.resolve(); await release.promise; }
  } });
  const running = stopDrain(f); await entered.promise;
  const stopped = await f.deactivate(); assert.equal(stopped.active, false);
  release.resolve(); await running;
  const row = await request(); assert.notEqual(row.status, 'source_observed'); assert.equal(row.snapshot, null);
  assert.equal(f.sourceCalls.length, 1, 'deactivation stops subsequent source calls');
  const after = f.requests.length; await f.drain(); assert.equal(f.requests.length, after);
  t.mock.timers.tick(1000);
  const next = await f.activate();
  assert.notEqual(next.activationId, f.activation.activationId); assert.notEqual(next.activatedAt, f.activation.activatedAt);
  await f.receive(webhookInput(f, { mutate: p => { p.createdAt = f.activation.activatedAt; } }));
  assert.equal((await rows('intake_deliveries')).length, 1);
  await f.drain(); assert.equal(f.requests.length, after);
  assertNoImport(f);
});
test('changed authority configuration blocks without a configChanged callback', async () => {
  const f = await retained(); f.config.sourceReader.projectId = sourceIds.outside;
  await f.drain(); await rejectedWebhook(f, webhookInput(f));
  assert.deepEqual(f.requests, []); assert.equal((await request()).status, 'received');
  assert.deepEqual(await f.activate(), { status: 'blocked', reason: 'intake_deactivation_required' });
});

test('configuration changed immediately after claim cannot select another gateway or source authority', async () => {
  let f;
  const db = { ...database.db, async execute(sql, params) {
    const result = await database.db.execute(sql, params);
    if (sql.includes('lease_owner = CASE WHEN')) {
      f.config.gatewayUrl = 'https://unapproved.example.test/mcp/gateways/changed';
      f.config.sourceReader.projectId = sourceIds.outside;
    }
    return result;
  } };
  f = await retained({ db });
  await stopDrain(f);
  assert.deepEqual(f.requests, []);
  assert.equal((await request()).snapshot, null);
});
test('configuration changed after eligibility cannot open a new family session under another authority', async () => {
  const f = await retained({ beforeCall: (call, current) => {
    if (call.number === 1) {
      current.config.gatewayUrl = 'https://unapproved.example.test/mcp/gateways/changed';
      current.config.sourceReader.projectId = sourceIds.outside;
    }
  } });
  await stopDrain(f);
  assert.equal(f.requests.length, 4, 'only the already-authorized MCP eligibility session may run');
  assert.equal(f.sourceCalls.length, 1);
  assert.equal((await request()).snapshot, null);
});
test('a later Todo entry without an observed exit never re-fetches an already observed intake', async t => {
  const f = await retained(); await f.drain();
  const original = await request(); const reads = f.requests.length;
  t.mock.timers.tick(1000);
  f.issues.get(sourceIds.root).updatedAt = new Date().toISOString();
  await f.receive(); await f.drain();
  const later = await request();
  assert.equal(later.intake_id, original.intake_id); assert.equal(later.status, 'source_observed');
  assert.equal(later.attempts, original.attempts); assert.equal(later.snapshot_sha256, original.snapshot_sha256);
  assert.deepEqual(later.snapshot, original.snapshot); assert.equal(f.requests.length, reads);
});
test('a missed exit and later Todo interval withdraw the old retained request before description reads', async t => {
  const f = await retained(); t.mock.timers.tick(1000);
  reenterTodo(f.issues.get(sourceIds.root));
  await f.drain();
  assert.equal((await request()).status, 'withdrawn'); assert.equal((await request()).snapshot, null);
  assert.equal(f.sourceCalls.length, 1); assert.equal(f.sourceCalls[0].args.fields.includes('description'), false);
});
test('a new Todo interval arising during collection cannot publish under the previous retained entry', async t => {
  const f = await retained({ beforeCall: (call, current) => {
    if (call.role !== 'getIssue') return;
    if (call.targetCall !== 2) return;
    t.mock.timers.tick(1000); reenterTodo(current.issues.get(sourceIds.root));
  } });
  await f.drain();
  assert.equal((await request()).status, 'withdrawn'); assert.equal((await request()).snapshot, null);
  assertNoImport(f);
});

for (const kind of ['state', 'project', 'team', 'archived']) {
  test(`current source ${kind} withdrawal stops after metadata without reading descriptions or descendants`, async () => {
    const f = await retained(); sourceIsWithdrawn(f, kind);
    await f.drain();
    assert.equal((await request()).status, 'withdrawn'); assert.equal((await request()).snapshot, null);
    assert.equal(f.sourceCalls.length, 1); assert.equal(f.sourceCalls[0].role, 'getIssue');
    assert.equal(f.sourceCalls[0].args.fields.includes('description'), false);
    assertNoImport(f);
  });
}
for (const kind of ['eligibility', 'description', 'pagination', 'upstream']) {
  test(`incomplete ${kind} source becomes blocked with a fixed error and no import`, async () => {
    const f = await retained({ transformPayload: sourceCorruptions[kind] });
    await f.drain();
    const row = await request(); assert.equal(row.status, 'blocked'); assert.equal(row.error_code, 'source_read_failed');
    assert.equal(row.snapshot, null);
    assert.equal(JSON.stringify(await f.inspect()).includes('synthetic-private-upstream-error'), false);
    const count = f.requests.length; await f.drain(); assert.equal(f.requests.length, count);
    assertNoImport(f);
  });
}
test('webhook secret failure is redacted and never records or fetches work', async () => {
  const f = await enrolled({ webhookSecretError: true });
  await rejectedWebhook(f, webhookInput(f));
  assert.deepEqual(await rows('intake_deliveries'), []);
  assert.deepEqual(await rows('intake_requests'), []); assert.deepEqual(f.requests, []);
  assert.equal(JSON.stringify(f.harness.logs).includes(webhookSecret), false);
});
