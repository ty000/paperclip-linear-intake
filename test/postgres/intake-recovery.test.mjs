import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { INTAKE_DATABASE_NAMESPACE as ns } from '../../dist/intake-state.js';
import { isolatedDatabase } from './intake-db-helper.mjs';
import { intakeFixture, operator, assertNoImport } from '../helpers/intake-fixture.mjs';
import { sourceIds } from '../helpers/source-fixture.mjs';

let database;
before(async () => { database = await isolatedDatabase(); });
after(async () => database?.close());
beforeEach(async t => {
  await database.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-09T12:00:00.000Z') });
});
async function current() { return (await database.pool.query(`SELECT * FROM ${ns}.intake_requests`)).rows[0]; }
async function failed() {
  let fail = true;
  const f = await intakeFixture(database, { beforeCall() { if (fail) throw Error('private upstream error'); } });
  await f.activate(); await f.receive(); await f.drain();
  const row = await current();
  assert.equal(row.status, 'blocked'); assert.equal(row.attempts, 1);
  const params = { intakeId: row.intake_id, expectedVersion: row.version };
  return { ...f, params, restore: () => { fail = false; },
    retry: (input = params, context = operator) => f.harness.performAction('retry-source-read', input, context) };
}

test('explicit retry preserves request, source identity and failure history; action never reads or imports', async () => {
  const f = await failed(), prior = await current();
  const inspect = (await f.inspect()).requests[0];
  assert.equal(inspect.errorCode, 'source_read_failed'); assert.equal(inspect.nextAction, 'retry-source-read');
  assert.equal(inspect.version, prior.version); assert.equal(inspect.remainingAttempts, 2);
  const reads = f.requests.length;
  await f.drain(); assert.equal(f.requests.length, reads);
  const receipt = await f.retry();
  assert.equal(receipt.status, 'source_retry_requested'); assert.equal(f.requests.length, reads);
  const queued = await current();
  for (const key of ['intake_id', 'issue_id', 'organization_id', 'activation_id', 'revision', 'accepted_at', 'attempts', 'delivery_id']) {
    assert.deepEqual(queued[key], prior[key]);
  }
  assert.equal(queued.version, prior.version + 1);
  assert.deepEqual(queued.source_retry_history, [receipt.retry]);
  assert.equal(receipt.retry.actorUserId, operator.actor.userId);
  f.restore(); await f.drain();
  const complete = await current();
  assert.equal(complete.status, 'source_observed'); assert.equal(complete.attempts, 2);
  assert.deepEqual(complete.source_retry_history, [receipt.retry]);
  assert.deepEqual(await f.retry(), receipt); assert.deepEqual(await current(), complete);
  assertNoImport(f);
});

test('concurrent duplicate operator commands retain one authorization and no extra attempt', async () => {
  const f = await failed(), before = await current();
  const [one, two] = await Promise.all([f.retry(), f.retry()]);
  assert.equal(one.status, 'source_retry_requested'); assert.deepEqual(one, two);
  const row = await current(); assert.equal(row.version, before.version + 1);
  assert.equal(row.attempts, 1); assert.equal(row.source_retry_history.length, 1);
});

test('lost operator response recovers the original authorization without resetting or appending history', async () => {
  const f = await failed(); const execute = f.harness.ctx.db.execute;
  let lost = false;
  f.harness.ctx.db.execute = async (sql, params) => {
    const result = await execute(sql, params);
    if (sql.includes('source_retry_history =') && !lost) { lost = true; throw Error('lost response'); }
    return result;
  };
  assert.equal((await f.retry()).reason, 'intake_action_failed');
  const saved = await current();
  const resumed = await f.retry(); assert.deepEqual(resumed.retry, saved.source_retry_history[0]);
  assert.deepEqual(await current(), saved);
});

for (const actor of [undefined, { type: 'system' }, { type: 'agent', agentId: 'synthetic' }, { type: 'user' }]) {
  test('retry requires native identified Board actor; params cannot grant authority', async () => {
    const f = await failed(), row = await current();
    const result = await f.retry({ ...f.params, actor: operator.actor, companyId: sourceIds.company }, { companyId: sourceIds.company, actor });
    assert.equal(result.reason, 'intake_operator_required'); assert.deepEqual(await current(), row);
  });
}

test('strict selector, native company and original retry actor cannot be substituted', async () => {
  const f = await failed(), original = await current();
  assert.equal((await f.retry({ ...f.params, resetAttempts: true })).reason, 'intake_retry_invalid_request');
  assert.equal((await f.retry({ ...f.params, expectedVersion: 0 })).reason, 'intake_retry_invalid_request');
  assert.equal((await f.retry(f.params, { ...operator, companyId: sourceIds.outside })).reason, 'intake_not_enrolled');
  assert.deepEqual(await current(), original);
  await f.retry(); const retained = await current();
  assert.equal((await f.retry(f.params, { ...operator, actor: { type: 'user', userId: 'another-user' } })).reason, 'intake_retry_actor_changed');
  assert.deepEqual(await current(), retained);
});

for (const mode of ['suspended', 'changed', 'deactivated', 'reactivated']) {
  test(`retry refuses ${mode} authority without changing the request`, async () => {
    const f = await failed(), before = await current();
    if (mode === 'suspended') f.config.enabled = false;
    if (mode === 'changed') f.config.sourceReader.maxRequests++;
    if (mode === 'deactivated' || mode === 'reactivated') await f.deactivate();
    if (mode === 'reactivated') await f.activate();
    assert.equal((await f.retry()).status, 'blocked'); assert.deepEqual(await current(), before);
  });
}

for (const status of ['received', 'fetching', 'withdrawn']) {
  test(`operator retry cannot reopen ${status} state`, async () => {
    const f = await failed();
    await database.pool.query(`UPDATE ${ns}.intake_requests SET status=$1`, [status]);
    const row = await current();
    assert.equal((await f.retry()).reason, 'intake_retry_not_allowed'); assert.deepEqual(await current(), row);
  });
}

test('retry rejects source snapshots, another blocker and a stale request version', async () => {
  const f = await failed(), prior = await current();
  assert.equal((await f.retry({ ...f.params, expectedVersion: prior.version + 1 })).reason, 'intake_retry_not_allowed');
  await database.pool.query(`UPDATE ${ns}.intake_requests SET error_code='other_failure'`);
  assert.equal((await f.retry()).reason, 'intake_retry_not_allowed');
  await database.pool.query(`UPDATE ${ns}.intake_requests SET error_code='source_read_failed', snapshot='{}', snapshot_sha256=$1`, ['a'.repeat(64)]);
  assert.equal((await f.retry()).reason, 'intake_retry_not_allowed');
  assert.equal((await current()).source_retry_history.length, 0);
});

test('an existing uncertain import plan forbids source retry and preserves original effects', async () => {
  const f = await failed(), row = await current();
  await database.pool.query(`INSERT INTO ${ns}.import_plans
    (company_id,intake_id,activation_id,fingerprint,request_version,source_sha256,plan_sha256,plan,effect_keys,state)
    VALUES ($1,$2,$3,$4,$5,$4,$4,'{}','[]','outcome_unknown')`,
  [row.company_id,row.intake_id,row.activation_id,'a'.repeat(64),row.version]);
  assert.equal((await f.retry()).reason, 'intake_retry_not_allowed'); assert.deepEqual(await current(), row);
  assert.equal((await database.pool.query(`SELECT state FROM ${ns}.import_plans`)).rows[0].state, 'outcome_unknown');
});

test('unapplied source event prevents operator retry until original delivery is reconciled', async () => {
  const f = await failed(), before = await current();
  await database.pool.query(`UPDATE ${ns}.intake_deliveries SET applied=false`);
  assert.equal((await f.retry()).reason, 'intake_retry_not_allowed'); assert.deepEqual(await current(), before);
});

test('two authorized retries exhaust the original three-attempt bound; no reset or fourth read', async () => {
  const f = await failed();
  for (let attempt = 2; attempt <= 3; attempt++) {
    const row = await current();
    assert.equal((await f.retry({ intakeId: row.intake_id, expectedVersion: row.version })).status, 'source_retry_requested');
    await f.drain(); assert.equal((await current()).attempts, attempt);
  }
  const exhausted = await current(), reads = f.requests.length;
  assert.equal((await f.retry({ intakeId: exhausted.intake_id, expectedVersion: exhausted.version })).reason, 'source_attempt_limit');
  await f.drain(); assert.equal(f.requests.length, reads); assert.deepEqual(await current(), exhausted);
  const inspect = (await f.inspect()).requests[0];
  assert.equal(inspect.nextAction, 'source_attempt_limit'); assert.equal(inspect.remainingAttempts, 0);
  assert.equal(inspect.sourceRetryHistory.length, 2);
});

test('additive migration preserves all historical request bytes and defaults empty retry history', async () => {
  const f = await failed(), before = await current();
  await database.pool.query(`ALTER TABLE ${ns}.intake_requests DROP COLUMN source_retry_history`);
  await database.pool.query(await readFile(new URL('../../migrations/004_source_retry.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await current(), before);
  assert.equal((await f.retry()).status, 'source_retry_requested');
});
