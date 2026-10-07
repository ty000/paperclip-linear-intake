import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import plugin from '../../dist/worker.js';
import manifest from '../../dist/manifest.js';
import { parseConfig } from '../../dist/config.js';
import { createImportStore } from '../../dist/import-store.js';
import { createIntakeStore } from '../../dist/intake-store.js';
import { INTAKE_DATABASE_NAMESPACE as namespace } from '../../dist/intake-state.js';
import { isolatedDatabase } from './intake-db-helper.mjs';
import { sourceIds } from '../helpers/source-fixture.mjs';
import { intakeFixture, operator, webhookInput } from '../helpers/intake-fixture.mjs';

let database;
before(async () => { database = await isolatedDatabase(); });
beforeEach(async t => {
  await database.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T12:05:00.000Z') });
});
after(async () => { if (database) await database.close(); });

async function rows(table) { return (await database.pool.query(`SELECT * FROM ${namespace}.${table}`)).rows; }

function nativeFixture(f, hooks = {}) {
  const issues = new Map(), documents = new Map(), edges = new Map(), calls = [], ctx = f.harness.ctx;
  async function invoke(method, input, action) {
    calls.push(method);
    await hooks.beforeNative?.(method, input, f);
    const result = await action();
    await hooks.afterNative?.(method, input, f);
    return structuredClone(result);
  }
  ctx.projects.get = (id, companyId) => invoke('projects.get', {}, () => ({ id, companyId,
    status: 'in_progress', archivedAt: null, pausedAt: null }));
  ctx.issues.list = input => invoke('issues.list', input, () => [...issues.values()].filter(issue =>
    issue.companyId === input.companyId && issue.originKind === input.originKind && issue.originId === input.originId).slice(0, input.limit));
  ctx.issues.get = (id, companyId) => invoke('issues.get', { id, companyId }, () => {
    const found = issues.get(id); return found?.companyId === companyId ? found : null;
  });
  ctx.issues.create = input => invoke('issues.create', input, () => {
    const issue = { ...input, id: randomUUID(), parentId: input.parentId ?? null, assigneeAgentId: null,
      assigneeUserId: null, executionRunId: null, checkoutRunId: null, executionLockedAt: null, archivedAt: null };
    issues.set(issue.id, issue); return issue;
  });
  ctx.issues.documents.get = (id, key) => invoke('documents.get', { id, key }, () => documents.get(`${id}:${key}`) ?? null);
  ctx.issues.documents.upsert = input => invoke('documents.upsert', input, () => {
    const key = `${input.issueId}:${input.key}`;
    assert.equal(documents.has(key), false, 'native SDK does not support updating an existing document');
    const doc = { ...input, id: randomUUID(), latestRevisionId: randomUUID(), latestRevisionNumber: 1 };
    documents.set(key, doc); return doc;
  });
  ctx.issues.relations.get = id => invoke('relations.get', { id }, () => ({
    blockedBy: (edges.get(id) ?? []).map(blocker => issues.get(blocker)),
    blocks: [...edges].filter(([_key, blockers]) => blockers.includes(id)).map(([key]) => issues.get(key)),
  }));
  ctx.issues.relations.addBlockers = (id, blockers) => invoke('relations.addBlockers', { id, blockers }, () => {
    edges.set(id, [...new Set([...(edges.get(id) ?? []), ...blockers])]);
    return { blockedBy: edges.get(id).map(key => issues.get(key)), blocks: [] };
  });
  return { issues, documents, edges, calls };
}

async function setup(options = {}) {
  const f = await intakeFixture(database, { ...options, prepare(current) {
    current.config.nativeImportEnabled = options.nativeImportEnabled ?? true;
    options.prepare?.(current);
  } });
  f.native = nativeFixture(f, options);
  f.prepareImport = () => f.harness.runJob('prepare-import');
  f.inspectImport = params => f.harness.performAction('inspect-import', params ?? {}, operator);
  f.reconcileImport = intakeId => f.harness.performAction('reconcile-import', { intakeId }, operator);
  return f;
}

async function observed(options) {
  const f = await setup(options);
  assert.equal((await f.activate()).status, 'intake_enrolled');
  await f.receive(); await f.drain();
  const [request] = await rows('intake_requests');
  assert.equal(request.status, 'source_observed');
  f.intakeId = request.intake_id;
  return f;
}

async function finishJob(f) {
  try { await f.prepareImport(); }
  catch (error) { assert.equal(error.message, 'import_job_failed'); }
}

async function plans() { return rows('import_plans'); }

test('manifest defaults, setup and health register import facilities without reading database or source', async () => {
  const f = await setup();
  assert.deepEqual(f.registeredJobs, ['drain-intake', 'prepare-import']);
  assert.equal(database.calls.length, 0);
  assert.equal(parseConfig({}).nativeImportEnabled, false);
  assert.throws(() => parseConfig({ nativeImportEnabled: true }), /import_configuration_missing/);
  assert.equal(manifest.instanceConfigSchema.properties.nativeImportEnabled.default, false);
  assert.ok(!manifest.capabilities.some(capability => /wakeup|agents|checkout/.test(capability)));
  assert.deepEqual(manifest.capabilities.filter(capability => capability.startsWith('events.')).sort(), ['events.emit', 'events.subscribe']);
  await plugin.definition.onHealth();
  await plugin.definition.onValidateConfig({});
  assert.equal(database.calls.length, 0);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.secretReads, []);
  await f.prepareImport();
  assert.deepEqual(await plans(), []);
  assert.deepEqual(f.native.calls, []);
  assert.equal((await f.inspectImport()).importPerformed, false);
});

test('disabled native import leaves retained source untouched and never reads a credential', async () => {
  const f = await observed({ nativeImportEnabled: false });
  const before = { calls: f.requests.length, secrets: f.secretReads.length };
  await f.prepareImport();
  assert.deepEqual(await plans(), []);
  assert.equal(f.requests.length, before.calls); assert.equal(f.secretReads.length, before.secrets);
  assert.deepEqual(f.native.calls, []);
});

test('enabled suspension prevents import under the same enrollment', async () => {
  const f = await observed(); f.config.enabled = false;
  const reads = f.requests.length; await f.prepareImport();
  assert.equal(f.requests.length, reads); assert.deepEqual(await plans(), []);
  f.config.enabled = true; await f.prepareImport();
  assert.equal((await plans())[0].state, 'prepared');
});

test('registered job prepares a complete family with two fresh source reads and no admission or wake', async () => {
  const f = await observed(), before = f.sourceCalls.length;
  await f.prepareImport();
  const [saved] = await plans();
  assert.equal(saved.state, 'prepared');
  assert.equal(f.native.issues.size, 5); assert.equal(f.native.documents.size, 6);
  assert.equal(f.native.calls.filter(method => method === 'issues.create').length, 5);
  assert.equal(f.sourceCalls.length - before, 62);
  const readiness = [...f.native.documents.values()].find(doc => doc.key === 'linear-intake-readiness-v1');
  assert.equal(JSON.parse(readiness.body).admissionAllowed, false);
  for (const issue of f.native.issues.values()) assert.equal(issue.assigneeAgentId, null);
  assert.deepEqual(f.effects, []);
  const out = await f.inspectImport({ intakeId: f.intakeId, companyId: sourceIds.outside, renderEnvironment: null });
  assert.equal(out.status, 'prepared'); assert.equal(out.admissionAllowed, false); assert.equal(out.importPerformed, false);
  assert.equal(JSON.stringify(out).includes('Synthetic full description'), false);
  assert.equal(JSON.stringify(out).includes('synthetic-source-fixture-credential'), false);
  const readCount = f.requests.length; await f.prepareImport();
  assert.equal(f.requests.length, readCount); assert.equal(f.native.issues.size, 5);
});

for (const [label, mutate] of [
  ['configuration fingerprint', f => { f.config.intake.targetProjectId = sourceIds.outside; }],
  ['import switch', f => { f.config.nativeImportEnabled = false; }],
  ['durable deactivation', async f => { await f.deactivate(); }],
]) test(`${label} blocks before source or native calls`, async () => {
  const f = await observed(), calls = f.requests.length;
  await mutate(f); await f.prepareImport();
  assert.equal(f.requests.length, calls); assert.deepEqual(f.native.calls, []);
});

test('malformed retained snapshot is durably blocked before a plan or source effect', async () => {
  const f = await observed(), before = f.requests.length;
  await database.pool.query(`UPDATE ${namespace}.intake_requests SET snapshot = jsonb_set(snapshot, '{issues}', '[]'::jsonb)`);
  await f.prepareImport();
  assert.equal((await rows('intake_requests'))[0].status, 'blocked');
  assert.deepEqual(await plans(), []); assert.equal(f.requests.length, before);
});

test('a source blocking cycle retains its explicit fixed reason before native effects', async () => {
  const f = await observed({ prepare(current) {
    const root = current.issues.get(sourceIds.root), child = current.issues.get(sourceIds.child);
    root.relations.blocks.push({ id: child.uuid }); root.relations.blockedBy.push({ id: child.uuid });
    child.relations.blocks.push({ id: root.uuid }); child.relations.blockedBy.push({ id: root.uuid });
  } });
  const calls = f.requests.length;
  await f.prepareImport();
  const [request] = await rows('intake_requests');
  assert.equal(request.status, 'blocked'); assert.equal(request.error_code, 'import_blocker_cycle');
  assert.deepEqual(await plans(), []); assert.equal(f.requests.length, calls);
  assert.deepEqual(f.native.calls, []);
  const inspected = await f.inspectImport({ intakeId: f.intakeId });
  assert.equal(inspected.status, 'not_planned'); assert.equal(inspected.requestStatus, 'blocked');
  assert.equal(inspected.reason, 'import_blocker_cycle'); assert.equal(inspected.nextAction, 'review_blocker');
  assert.equal(JSON.stringify(inspected).includes('Synthetic full description'), false);
});

test('source revision drift before creation keeps all native objects absent', async () => {
  const f = await observed(); f.issues.get(sourceIds.root).description += ' changed since retention';
  await f.prepareImport();
  assert.equal((await plans())[0].state, 'blocked');
  assert.equal(f.native.issues.size, 0); assert.equal(f.native.documents.size, 0);
});

test('fresh source withdrawal prevents creation despite a retained source_observed snapshot', async () => {
  const f = await observed(); f.issues.get(sourceIds.root).archivedAt = new Date().toISOString();
  await f.prepareImport();
  assert.equal((await plans())[0].state, 'blocked'); assert.equal(f.native.issues.size, 0);
});

test('source drift after native creation prevents publication of readiness', async () => {
  const f = await observed({ afterNative(method, input, current) {
    if (method === 'documents.upsert' && input.key === 'linear-source-v1') {
      current.issues.get(sourceIds.root).description += ' changed during import';
    }
  } });
  await f.prepareImport();
  assert.equal(f.native.issues.size, 5); assert.equal(f.native.documents.size, 5);
  assert.equal((await plans())[0].state, 'blocked');
  assert.ok([...f.native.documents.values()].every(doc => doc.key !== 'linear-intake-readiness-v1'));
});

test('configuration changes during source verification prevent further RPCs or native effects', async () => {
  let armed = false;
  const f = await observed({ beforeCall(_call, current) { if (armed) current.config.enabled = false; } });
  armed = true; const count = f.sourceCalls.length; await finishJob(f);
  assert.equal(f.sourceCalls.length - count, 1); assert.equal(f.native.issues.size, 0);
});

test('configuration change after dispatch CAS prevents the native write', async () => {
  let f, armed = false;
  const db = { ...database.db, async execute(sql, params) {
    const result = await database.db.execute(sql, params);
    if (armed && sql.includes("SET state = 'dispatched'")) f.config.enabled = false;
    return result;
  } };
  f = await observed({ db }); armed = true; await finishJob(f);
  assert.equal(f.native.issues.size, 0);
  assert.equal((await rows('import_effects'))[0].state, 'outcome_unknown');
  assert.equal((await rows('import_effects'))[0].dispatch_count, 1);
  const inspection = await f.inspectImport({ intakeId: f.intakeId });
  assert.equal(inspection.effects[0].state, 'outcome_unknown');
  assert.equal(inspection.effects[0].dispatchCount, 1);
  assert.equal(Object.hasOwn(inspection.effects[0], 'intent'), false);
  assert.equal(inspection.nextAction, 'reconcile-import');
});

test('withdrawal after the first native write prevents later writes and readiness', async () => {
  let withdrew = false;
  const f = await observed({ async afterNative(method, _input, current) {
    if (method !== 'issues.create' || withdrew) return;
    withdrew = true;
    await current.receive(webhookInput(current, { mutate(body) {
      body.data.stateId = sourceIds.backlog; body.data.updatedAt = new Date(Date.now() + 1).toISOString();
    } }));
  } });
  await finishJob(f);
  assert.equal(f.native.issues.size, 1); assert.equal(f.native.documents.size, 0);
  assert.notEqual((await plans())[0].state, 'prepared');
});

test('lost create response is reconciled under original identity; suspended config cannot resume', async () => {
  let lost = false;
  const f = await observed({ afterNative(method) {
    if (method === 'issues.create' && !lost) { lost = true; throw new Error('synthetic-private-provider-error'); }
  } });
  await f.prepareImport();
  assert.equal((await plans())[0].state, 'outcome_unknown'); assert.equal(f.native.issues.size, 1);
  f.config.enabled = false;
  const calls = f.requests.length, result = await f.reconcileImport(f.intakeId);
  assert.equal(result.unresolved, 0); assert.equal(result.resumed, false);
  assert.equal(result.importPerformed, false); assert.equal(result.admissionAllowed, false);
  assert.equal(f.requests.length, calls); assert.equal(f.native.issues.size, 1);
  assert.equal((await rows('import_effects'))[0].dispatch_count, 1);
  f.config.enabled = true;
  const resumed = await f.reconcileImport(f.intakeId); assert.equal(resumed.resumed, true);
  await f.prepareImport();
  assert.equal((await plans())[0].state, 'prepared'); assert.equal(f.native.issues.size, 5);
  assert.equal(f.native.calls.filter(method => method === 'issues.create').length, 5);
});

test('absence after a lost response never rearms the original dispatch', async () => {
  const f = await observed({ beforeNative(method) { if (method === 'issues.create') throw new Error('synthetic-unknown-outcome'); } });
  await f.prepareImport();
  const result = await f.reconcileImport(f.intakeId);
  assert.equal(result.unresolved, 1); assert.equal(result.resumed, false);
  await f.prepareImport();
  assert.equal(f.native.calls.filter(method => method === 'issues.create').length, 1);
  assert.equal((await rows('import_effects'))[0].dispatch_count, 1);
});

test('a crashed preparing plan exposes its dispatched effect and resumes only after original readback', async () => {
  let lost = false;
  const f = await observed({ afterNative(method) {
    if (method === 'issues.create' && !lost) { lost = true; throw new Error('synthetic-receipt-lost'); }
  } });
  await f.prepareImport();
  // Represent interruption before either unknown receipt could be persisted.
  await database.pool.query(`UPDATE ${namespace}.import_effects SET state = 'dispatched'`);
  await database.pool.query(`UPDATE ${namespace}.import_plans SET state = 'preparing'`);
  const count = f.requests.length;
  await f.prepareImport();
  assert.equal(f.requests.length, count);
  const inspected = await f.inspectImport({ intakeId: f.intakeId });
  assert.equal(inspected.effects[0].state, 'dispatched');
  assert.equal(inspected.nextAction, 'reconcile-import');
  const reconciled = await f.reconcileImport(f.intakeId);
  assert.equal(reconciled.readyToResume, true); assert.equal(reconciled.resumed, false);
  assert.equal(reconciled.effects[0].state, 'observed');
  await f.prepareImport();
  assert.equal((await plans())[0].state, 'prepared');
  assert.equal(f.native.calls.filter(method => method === 'issues.create').length, 5);
});

for (const name of ['inspect-import', 'reconcile-import']) {
  for (const actor of [undefined, { type: 'system' }, { type: 'agent', agentId: 'synthetic-agent' }, { type: 'user' }]) {
    test(`${name} rejects unauthenticated actors before database access`, async () => {
      const f = await setup(), count = database.calls.length;
      const result = await f.harness.performAction(name, { companyId: sourceIds.company, actor: operator.actor,
        intakeId: `linear-intake-${'a'.repeat(64)}` }, { companyId: sourceIds.company, actor });
      assert.equal(result.reason, 'import_operator_required');
      assert.equal(database.calls.length, count); assert.deepEqual(f.native.calls, []);
    });
  }
}

test('reconciliation uses context company and cannot expose another company plan', async () => {
  const f = await observed(); await f.prepareImport();
  const out = await f.harness.performAction('reconcile-import', { companyId: sourceIds.company, intakeId: f.intakeId },
    { ...operator, companyId: sourceIds.outside });
  assert.equal(out.reason, 'import_plan_missing');
  assert.equal(out.importPerformed, false); assert.equal(out.admissionAllowed, false);
});

test('unprojected durable withdrawal blocks candidate selection without source calls', async () => {
  const f = await observed();
  const [delivery] = await rows('intake_deliveries');
  await database.pool.query(`UPDATE ${namespace}.intake_deliveries SET applied = false WHERE provider_delivery_id = $1`, [delivery.provider_delivery_id]);
  const calls = f.requests.length; await f.prepareImport();
  assert.equal(f.requests.length, calls); assert.deepEqual(await plans(), []);
});

test('inspection exposes only bounded plan summaries and no source snapshots', async () => {
  const f = await observed(); await f.prepareImport();
  const out = await f.inspectImport();
  assert.equal(out.plans.length, 1); assert.equal(out.plans[0].status, 'prepared');
  assert.equal(out.plans[0].effects.length, 16);
  assert.equal(JSON.stringify(out).includes('sourceDocumentBody'), false);
  assert.equal(JSON.stringify(out).includes('Synthetic full description'), false);
  assert.equal(out.admissionAllowed, false);
  assert.equal((await createImportStore(database.db).getPlan(sourceIds.company, f.intakeId)).state, 'prepared');
  assert.equal((await createIntakeStore(database.db).getRequest(sourceIds.company, f.intakeId)).status, 'source_observed');
});
