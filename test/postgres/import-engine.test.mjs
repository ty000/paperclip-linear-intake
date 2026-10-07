import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { createIntakeStore } from '../../dist/intake-store.js';
import { createImportStore } from '../../dist/import-store.js';
import { prepareNativeFamily } from '../../dist/import-engine.js';
import { reconcileNativeEffects } from '../../dist/import-effects.js';
import { buildImportPlan, IMPORT_ORIGIN } from '../../dist/import-plan.js';
import { issueOperation } from '../../dist/import-native.js';
import { contentDigest } from '../../dist/content-digest.js';
import { ImportStoreError } from '../../dist/import-state.js';
import { intakeFixture, intakeIds, webhookInput, deferred } from '../helpers/intake-fixture.mjs';
import { sourceIds } from '../helpers/source-fixture.mjs';
import { isolatedDatabase, interrupted } from './intake-db-helper.mjs';

let database;
before(async () => { database = await isolatedDatabase(); });
beforeEach(async t => {
  await database.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T12:05:00.000Z') });
});
after(async () => { if (database) await database.close(); });

function nativeState() {
  let sequence = 0;
  return {
    issues: new Map(), documents: new Map(), blockers: new Map(), calls: [], reads: [],
    id: () => `90000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    before: async () => {}, after: async () => {}, inspect: async (_kind, _input, result) => result,
  };
}

async function nativeRead(native, kind, input, result) {
  native.reads.push({ kind, input: structuredClone(input) });
  return structuredClone(await native.inspect(kind, input, structuredClone(result)));
}

async function nativeWrite(native, kind, input, apply) {
  native.calls.push({ kind, input: structuredClone(input) });
  await native.before(kind, input);
  const result = apply();
  await native.after(kind, input, result);
  return structuredClone(result);
}

function documentService(native) {
  return {
    get: async (issueId, key, companyId) => nativeRead(native, 'document_get', { issueId, key, companyId },
      native.documents.get(`${issueId}:${key}`) ?? null),
    upsert: async input => nativeWrite(native, input.key === 'linear-intake-readiness-v1' ? 'readiness' : 'document', input, () => {
      const key = `${input.issueId}:${input.key}`;
      const previous = native.documents.get(key) ?? { id: native.id(), latestRevisionNumber: 0 };
      const document = { ...input, id: previous.id, latestRevisionId: native.id(),
        latestRevisionNumber: previous.latestRevisionNumber + 1 };
      native.documents.set(key, document);
      return document;
    }),
  };
}

function relationService(native) {
  return {
    get: async (issueId, companyId) => nativeRead(native, 'relations_get', { issueId, companyId }, {
      blockedBy: [...(native.blockers.get(issueId) ?? [])].map(id => ({ id })),
    }),
    addBlockers: async (issueId, blockerIds, companyId) => nativeWrite(native, 'relations', { issueId, blockerIds, companyId }, () => {
      native.blockers.set(issueId, new Set(blockerIds));
      return { blockedBy: blockerIds.map(id => ({ id })) };
    }),
  };
}

function issueService(native) {
  return {
    list: async query => {
      assert.equal(query.includePluginOperations, true);
      assert.equal(query.limit, 2);
      assert.equal(query.offset, 0);
      const matches = [...native.issues.values()].filter(value =>
        value.companyId === query.companyId && value.originKind === query.originKind && value.originId === query.originId);
      return nativeRead(native, 'issue_list', query, matches.slice(0, query.limit));
    },
    get: async (id, companyId) => nativeRead(native, 'issue_get', { id, companyId }, native.issues.get(id) ?? null),
    create: async input => nativeWrite(native, 'issue', input, () => {
      const row = { parentId: null, ...input, id: native.id(), assigneeAgentId: null, assigneeUserId: null,
        executionRunId: null, checkoutRunId: null, executionLockedAt: null, archivedAt: null };
      native.issues.set(row.id, row);
      return row;
    }),
    documents: documentService(native), relations: relationService(native),
  };
}

function prepareSource(fixture) {
  fixture.issues.delete(sourceIds.grandchild);
  fixture.issues.get(sourceIds.child).relations.blocks = [];
}

async function engineFixture() {
  const fixture = await intakeFixture(database, { prepare: prepareSource });
  await fixture.activate();
  await fixture.receive();
  await fixture.drain();
  const intake = createIntakeStore(database.db), store = createImportStore(database.db);
  const binding = await intake.getBinding(sourceIds.company), [request] = await intake.listRequests(sourceIds.company);
  assert.equal(request.status, 'source_observed');
  const native = nativeState(), ctx = fixture.harness.ctx;
  Object.assign(ctx.issues, issueService(native));
  ctx.projects.get = async (id, companyId) => nativeRead(native, 'project_get', { id, companyId }, {
    id, companyId, status: 'planned', archivedAt: null, pausedAt: null,
  });
  const candidate = { companyId: binding.companyId, intakeId: request.intakeId, activationId: binding.activationId,
    fingerprint: binding.fingerprint, requestVersion: request.version, sourceSha256: request.snapshotSha256 };
  const guard = async () => {
    if (!await store.isCurrentCandidate(candidate)) throw new ImportStoreError('import_candidate_changed');
  };
  const controls = { targetProjectId: intakeIds.targetProject, guard, verifySource: guard };
  const plan = buildImportPlan(binding, request, intakeIds.targetProject);
  return { ...fixture, intake, store, binding, request, native, ctx, controls, plan,
    prepare: () => prepareNativeFamily(ctx, binding, request, controls) };
}

function readinessDocuments(fixture) {
  return [...fixture.native.documents.values()].filter(document => document.key === 'linear-intake-readiness-v1');
}

function assertNoWake(fixture) {
  assert.deepEqual(fixture.effects, []);
  assert.deepEqual(fixture.harness.activity, []);
  assert.deepEqual(fixture.harness.telemetry, []);
  for (const row of fixture.native.issues.values()) {
    assert.equal(row.assigneeAgentId, null);
    assert.equal(row.assigneeUserId, null);
    assert.equal(row.executionRunId, null);
    assert.equal(['blocked', 'done', 'cancelled'].includes(row.status), true);
  }
}

function callCount(fixture, kind) { return fixture.native.calls.filter(call => call.kind === kind).length; }

async function durablePlan(fixture) { return fixture.store.getPlan(sourceIds.company, fixture.request.intakeId); }

async function journalRootDispatch(fixture) {
  const { plan } = fixture, root = plan.nodes[0];
  await fixture.store.ensurePlan({ ...plan, plan });
  const operation = issueOperation(fixture.ctx, { companyId: plan.companyId, projectId: plan.targetProjectId,
    parentId: null, originKind: plan.originKind, originId: root.originId, status: root.status,
    title: root.source.title, description: root.source.description });
  const ref = { companyId: plan.companyId, intakeId: plan.intakeId, planSha256: plan.planSha256,
    effectKey: root.keys.issue, intentSha256: contentDigest(operation.intent) };
  await fixture.store.ensureEffect({ ...ref, kind: 'issue', intent: operation.intent });
  assert.equal(await fixture.store.claimDispatch({ ...ref, owner: randomUUID() }), true);
  return { ref, operation };
}

test('the complete parent family preserves descriptions, history and dependency readback before readiness', async () => {
  const f = await engineFixture(), before = structuredClone(f.request.snapshot);
  const result = await f.prepare();
  assert.equal(result.status, 'prepared');
  assert.equal(result.admissionAllowed, false);
  assert.equal(f.native.issues.size, 4);
  assert.equal(f.native.documents.size, 5);
  assert.equal(callCount(f, 'relations'), 1);
  for (const node of f.plan.nodes) {
    const row = [...f.native.issues.values()].find(value => value.originId === node.originId);
    assert.equal(row.originKind, IMPORT_ORIGIN);
    assert.equal(row.description, node.source.description);
    assert.equal(row.status, node.status);
    const source = JSON.parse(f.native.documents.get(`${row.id}:linear-source-v1`).body);
    assert.deepEqual(source.source, node.source);
    assert.equal(source.sourceSha256, f.request.snapshotSha256);
  }
  const [document] = readinessDocuments(f), readiness = JSON.parse(document.body);
  assert.equal(readiness.effects.length, 12);
  assert.equal(readiness.correspondence.length, 4);
  assert.deepEqual(readiness.externalBlockers, f.plan.externalBlockers);
  assert.equal(readiness.admissionAllowed, false);
  assert.equal(readiness.implementationStarted, false);
  assert.equal(f.native.calls.at(-1).kind, 'readiness');
  assert.equal((await durablePlan(f)).state, 'prepared');
  assert.deepEqual(f.request.snapshot, before);
  assertNoWake(f);
});

test('concurrent workers authorize one native dispatch and converge on one prepared family', { timeout: 5_000 }, async () => {
  const f = await engineFixture(), entered = deferred(), release = deferred();
  let held = false;
  f.native.before = async kind => {
    if (kind !== 'issue') return;
    if (held) return;
    held = true; entered.resolve(); await release.promise;
  };
  const first = f.prepare();
  await entered.promise;
  const second = await f.prepare();
  assert.equal(second.status, 'reconciling');
  assert.equal((await durablePlan(f)).state, 'preparing');
  release.resolve();
  assert.equal((await first).status, 'prepared');
  assert.equal(callCount(f, 'issue'), 4);
  assert.equal(new Set([...f.native.issues.values()].map(row => row.originId)).size, 4);
  const effects = await f.store.listEffects(f.plan);
  assert.ok(effects.every(effect => effect.dispatchCount <= 1));
  assert.equal((await f.prepare()).status, 'prepared');
  assert.equal(callCount(f, 'issue'), 4);
  assertNoWake(f);
});

test('worker restart after dispatch commit but before native creation waits for operator reconciliation without retry', async () => {
  const f = await engineFixture(), { ref } = await journalRootDispatch(f);
  assert.deepEqual(await f.store.listCandidates(sourceIds.company, f.binding.activationId), []);
  assert.equal((await f.prepare()).status, 'reconciling');
  assert.equal(callCount(f, 'issue'), 0);
  assert.equal((await reconcileNativeEffects(f.ctx, f.store, f.plan)).unresolved, 1);
  assert.equal((await durablePlan(f)).state, 'preparing');
  assert.equal((await f.store.getEffect(ref.companyId, ref.effectKey)).dispatchCount, 1);
  assert.deepEqual(readinessDocuments(f), []);
});

test('worker restart after native creation resumes only after read-only reconciliation under the original key', async () => {
  const f = await engineFixture(), { operation } = await journalRootDispatch(f);
  await operation.dispatch();
  const [originalId] = f.native.issues.keys();
  assert.deepEqual(await f.store.listCandidates(sourceIds.company, f.binding.activationId), []);
  assert.equal((await reconcileNativeEffects(f.ctx, f.store, f.plan)).unresolved, 0);
  assert.equal((await f.store.listCandidates(sourceIds.company, f.binding.activationId)).length, 1);
  assert.equal((await f.prepare()).status, 'prepared');
  assert.equal(f.native.issues.has(originalId), true);
  assert.equal(callCount(f, 'issue'), 4);
  assertNoWake(f);
});

test('a previously observed native object that disappears blocks the plan without recreating it or starving other work', async () => {
  const f = await engineFixture(), { ref, operation } = await journalRootDispatch(f);
  await operation.dispatch();
  await f.store.observeEffect({ ...ref, result: await operation.read() });
  f.native.issues.clear();
  const result = await f.prepare();
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'import_native_readback_missing');
  assert.equal((await durablePlan(f)).state, 'blocked');
  assert.deepEqual(await f.store.listCandidates(sourceIds.company, f.binding.activationId), []);
  assert.equal((await f.store.getEffect(ref.companyId, ref.effectKey)).state, 'observed');
  assert.equal(callCount(f, 'issue'), 1);
  assert.deepEqual(readinessDocuments(f), []);
});

for (const phase of ['issue', 'document', 'relations', 'readiness']) {
  test(`committed ${phase} with a lost response reconciles its original identity without another mutation`, async () => {
    const f = await engineFixture();
    let failed = false;
    f.native.after = async kind => {
      if (kind !== phase) return;
      if (failed) return;
      failed = true;
      throw new Error('synthetic_committed_response_lost');
    };
    assert.equal((await f.prepare()).status, 'outcome_unknown');
    const originalIds = [...f.native.issues.keys()];
    const disputed = (await f.store.listEffects(f.plan)).find(effect => effect.state === 'outcome_unknown');
    assert.ok(disputed);
    assert.equal(disputed.dispatchCount, 1);
    assert.equal((await reconcileNativeEffects(f.ctx, f.store, f.plan)).unresolved, 0);
    assert.equal(await f.store.resumePlan(f.plan), true);
    assert.equal((await f.prepare()).status, 'prepared');
    assert.ok(originalIds.every(id => f.native.issues.has(id)));
    assert.equal(callCount(f, 'issue'), 4);
    assert.equal(callCount(f, 'document'), 4);
    assert.equal(callCount(f, 'relations'), 1);
    assert.equal(callCount(f, 'readiness'), 1);
    assert.ok((await f.store.listEffects(f.plan)).every(effect => effect.dispatchCount <= 1));
    assertNoWake(f);
  });
}

for (const phase of ['issue', 'document', 'relations', 'readiness']) {
  test(`absent ${phase} after dispatch uncertainty never authorizes a second mutation`, async () => {
    const f = await engineFixture();
    f.native.before = async kind => { if (kind === phase) throw new Error('synthetic_native_outcome_unknown'); };
    assert.equal((await f.prepare()).status, 'outcome_unknown');
    const writes = f.native.calls.length;
    assert.equal((await reconcileNativeEffects(f.ctx, f.store, f.plan)).unresolved, 1);
    assert.equal(await f.store.resumePlan(f.plan), false);
    assert.equal((await f.prepare()).status, 'outcome_unknown');
    assert.equal(f.native.calls.length, writes);
    assert.equal((await durablePlan(f)).readiness, null);
    assertNoWake(f);
  });
}

const corruptions = {
  description: f => { [...f.native.issues.values()][0].description = 'synthetic incomplete description'; },
  document: f => { [...f.native.documents.values()][0].body = 'synthetic truncated source'; },
  assignee: f => { [...f.native.issues.values()][0].assigneeAgentId = randomUUID(); },
  checkout: f => { [...f.native.issues.values()][0].checkoutRunId = randomUUID(); },
  execution_lock: f => { [...f.native.issues.values()][0].executionLockedAt = new Date().toISOString(); },
  relation: f => { f.native.blockers.set([...f.native.issues.keys()][0], new Set([randomUUID()])); },
};
for (const [name, corrupt] of Object.entries(corruptions)) {
  test(`final native readback rejects ${name} tampering and publishes no readiness`, async () => {
    const f = await engineFixture();
    let documentCount = 0;
    f.native.after = async kind => {
      if (kind !== 'document') return;
      if (++documentCount === 4) corrupt(f);
    };
    assert.equal((await f.prepare()).status, 'blocked');
    assert.equal((await durablePlan(f)).state, 'blocked');
    assert.deepEqual(readinessDocuments(f), []);
    assert.equal((await durablePlan(f)).readiness, null);
    assert.equal(callCount(f, 'issue'), 4);
  });
}

test('a failed current-source revalidation stops readiness after retaining native waiting effects', async () => {
  const f = await engineFixture();
  let checks = 0;
  f.controls.verifySource = async () => {
    await f.controls.guard();
    if (++checks === 2) throw new ImportStoreError('import_current_source_changed');
  };
  assert.equal((await f.prepare()).status, 'blocked');
  assert.equal((await durablePlan(f)).state, 'blocked');
  assert.equal(f.native.issues.size, 4);
  assert.deepEqual(readinessDocuments(f), []);
  assertNoWake(f);
});

test('a native issue duplicate under the original origin blocks rather than creating another identity', async () => {
  const f = await engineFixture(), root = f.plan.nodes[0];
  for (let number = 0; number < 2; number++) {
    const id = f.native.id();
    f.native.issues.set(id, { id, companyId: sourceIds.company, originKind: IMPORT_ORIGIN, originId: root.originId });
  }
  assert.equal((await f.prepare()).status, 'blocked');
  assert.equal(callCount(f, 'issue'), 0);
  assert.deepEqual(readinessDocuments(f), []);
});

test('request withdrawal during native mutation preserves the observed effect and prevents durable readiness', async () => {
  const f = await engineFixture();
  let withdrawn = false;
  f.native.after = async kind => {
    if (kind !== 'issue') return;
    if (withdrawn) return;
    withdrawn = true;
    await f.receive(webhookInput(f, { mutate: body => {
      body.createdAt = new Date(Date.now() + 1).toISOString();
      body.data.updatedAt = body.createdAt;
      body.data.stateId = sourceIds.backlog;
      body.updatedFrom.stateId = sourceIds.todo;
    } }));
  };
  const result = await f.prepare(), plan = await durablePlan(f);
  assert.equal(plan.state, 'preparing');
  assert.equal(plan.readiness, null);
  assert.equal(callCount(f, 'issue'), 1);
  assert.deepEqual(readinessDocuments(f), []);
  assert.equal((await f.store.listEffects(f.plan))[0].state, 'observed');
  assert.equal(result.admissionAllowed, false);
  assert.equal(result.status, 'ineligible');
  assert.equal(result.durableState, 'preparing');
  assertNoWake(f);
});

test('deactivation after advisory readiness creation cannot publish a durable prepared plan', async () => {
  const f = await engineFixture();
  f.native.after = async kind => { if (kind === 'readiness') await f.deactivate(); };
  const result = await f.prepare();
  assert.equal(result.status, 'ineligible');
  assert.equal(result.durableState, 'preparing');
  assert.equal((await durablePlan(f)).readiness, null);
  assert.equal(readinessDocuments(f).length, 1);
  assert.equal(JSON.parse(readinessDocuments(f)[0].body).admissionAllowed, false);
  assertNoWake(f);
});

test('a retained withdrawal interrupted before projection blocks the next native dispatch', async () => {
  const f = await engineFixture();
  let stopped = false;
  f.native.after = async kind => {
    if (kind !== 'issue') return;
    if (stopped) return;
    stopped = true;
    const raw = webhookInput(f, { mutate: body => {
      body.createdAt = new Date(Date.now() + 1).toISOString(); body.data.updatedAt = body.createdAt;
      body.data.stateId = sourceIds.backlog; body.updatedFrom.stateId = sourceIds.todo;
    } });
    const temporary = f.ctx.db;
    f.ctx.db = interrupted(database.db, 2, false);
    try { await assert.rejects(f.receive(raw), /intake_webhook_rejected/); }
    finally { f.ctx.db = temporary; }
  };
  await f.prepare();
  assert.equal(callCount(f, 'issue'), 1);
  assert.equal((await durablePlan(f)).readiness, null);
  assert.deepEqual(readinessDocuments(f), []);
});
