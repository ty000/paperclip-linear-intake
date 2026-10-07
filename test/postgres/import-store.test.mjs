import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { createImportStore } from "../../dist/import-store.js";
import { createIntakeStore } from "../../dist/intake-store.js";
import { INTAKE_DATABASE_NAMESPACE } from "../../dist/intake-state.js";
import { contentDigest } from "../../dist/content-digest.js";
import { isolatedDatabase, interrupted } from "./intake-db-helper.mjs";

const companyId = "10000000-0000-4000-8000-000000000003";
const otherCompany = "10000000-0000-4000-8000-000000000004";
const organizationId = "20000000-0000-4000-8000-000000000003";
const activationId = "30000000-0000-4000-8000-000000000003";
const fingerprint = "a".repeat(64);
const authority = {
  organizationId, teamId: randomUUID(), projectId: randomUUID(), todoStateId: randomUUID(), webhookId: randomUUID(),
  activationAt: "2026-10-08T10:00:00.000Z", allowedActors: [{ id: randomUUID(), type: "user" }],
};
const nativeResult = { nativeId: "60000000-0000-4000-8000-000000000003", readbackSha256: "e".repeat(64) };
let database, intake, store;

before(async () => { database = await isolatedDatabase(); });
beforeEach(async () => {
  await database.reset();
  intake = createIntakeStore(database.db);
  store = createImportStore(database.db);
});
after(async () => { if (database) await database.close(); });

function event(issueId, overrides = {}) {
  return {
    classification: "received", organizationId, webhookId: authority.webhookId, issueId, action: "update",
    eventAt: "2026-10-08T10:00:01.000Z", revision: "2026-10-08T10:00:01.000Z",
    teamId: authority.teamId, projectId: authority.projectId, stateId: authority.todoStateId, archivedAt: null,
    actor: authority.allowedActors[0], previous: { stateId: randomUUID() }, providerDeliveryId: randomUUID(),
    rawBodySha256: "b".repeat(64), sourceEventId: "c".repeat(64), webhookTimestamp: 1791453601000,
    receivedAt: "2026-10-08T10:00:02.000Z", sourceScopeWasAuthorized: true, currentScopeMatches: true, ...overrides,
  };
}

async function sourceObserved(issueId = randomUUID()) {
  await intake.activateBinding({ companyId, activationId, fingerprint, authority, activatedAt: authority.activationAt });
  const request = await intake.retainDelivery(companyId, activationId, event(issueId));
  const owner = randomUUID();
  const claimed = await intake.claimRequest({ companyId, activationId, fingerprint, intakeId: request.intakeId,
    owner, now: "2026-10-08T10:00:03.000Z", leaseMs: 30_000, maxAttempts: 3 });
  const family = { schema: "linear-source-family.v1", rootIssueId: issueId, organizationId,
    selectedRootInTodo: true, selectedRootArchived: false, issues: [] };
  const sourceSha256 = contentDigest(family);
  await intake.finishRequest({ companyId, activationId, fingerprint, intakeId: request.intakeId,
    owner, now: "2026-10-08T10:00:04.000Z", revision: claimed.version, status: "source_observed",
    snapshot: { ...family, sourceSha256 }, snapshotSha256: sourceSha256 });
  return intake.getRequest(companyId, request.intakeId);
}

function planInput(request, expectedEffectKeys = [`task:${organizationId}:${request.issueId}`]) {
  const body = { schema: "native-import-test.v1", sourceSha256: request.snapshotSha256, expectedEffectKeys };
  const planSha256 = contentDigest(body);
  return { companyId, intakeId: request.intakeId, activationId, fingerprint, requestVersion: request.version,
    sourceSha256: request.snapshotSha256, expectedEffectKeys, planSha256, plan: { ...body, planSha256 } };
}

async function planned(keys) {
  const request = await sourceObserved();
  const input = planInput(request, keys);
  await store.ensurePlan(input);
  return { request, input };
}

function effectInput(plan, effectKey = plan.expectedEffectKeys[0], overrides = {}) {
  const intent = { kind: "task", originKind: "plugin:ty000.linear-intake", originId: effectKey, status: "blocked" };
  return { companyId, intakeId: plan.intakeId, planSha256: plan.planSha256, effectKey, kind: "task",
    intent, intentSha256: contentDigest(intent), ...overrides };
}

async function intended(keys) {
  const { request, input } = await planned(keys), effect = effectInput(input);
  await store.ensureEffect(effect);
  return { request, input, effect };
}

function finish(input, state = "prepared", overrides = {}) {
  return { companyId, intakeId: input.intakeId, planSha256: input.planSha256, state,
    ...(state === "prepared" ? { readiness: { schema: "native-import-readback.v1", planSha256: input.planSha256 } } : {}),
    ...overrides };
}

async function count(table) {
  return Number((await database.pool.query(`SELECT count(*) AS total FROM ${INTAKE_DATABASE_NAMESPACE}.${table}`)).rows[0].total);
}

async function withdraw(request, target = intake) {
  return target.retainDelivery(companyId, activationId, event(request.issueId, {
    classification: "withdrawal", revision: "2026-10-08T10:00:05.000Z", eventAt: "2026-10-08T10:00:05.000Z",
  }));
}

test("native migration creates isolated import ledgers without assuming source_observed is readiness", async () => {
  assert.equal(await count("import_plans"), 0);
  const request = await sourceObserved();
  assert.equal(await store.getPlan(companyId, request.intakeId), undefined);
  const [candidate] = await store.listCandidates(companyId, activationId);
  assert.equal(candidate.requestVersion, request.version);
  assert.equal(candidate.sourceSha256, request.snapshotSha256);
  assert.deepEqual(candidate.snapshot, request.snapshot);
  assert.deepEqual(await store.listCandidates(otherCompany, activationId), []);
  assert.throws(() => createImportStore({ ...database.db, namespace: "public" }), /import_namespace_mismatch/);
});

test("concurrent plan creation retains one immutable candidate and replay changes no version", async () => {
  const request = await sourceObserved(), input = planInput(request);
  const rows = await Promise.all(Array.from({ length: 5 }, () => store.ensurePlan(input)));
  assert.ok(rows.every(row => row.planSha256 === input.planSha256 && row.state === "preparing" && row.version === 1));
  assert.equal(await count("import_plans"), 1);
  assert.equal((await store.ensurePlan(input)).version, 1);
  const altered = planInput(request, ["different_effect"]);
  await assert.rejects(store.ensurePlan(altered), /import_plan_conflict/);
  assert.equal((await store.getPlan(companyId, request.intakeId)).planSha256, input.planSha256);
});

test("a rejected source candidate is blocked durably without fabricating a valid import plan", async () => {
  const request = await sourceObserved(), [candidate] = await store.listCandidates(companyId, activationId);
  assert.equal(await store.blockCandidate(candidate, "import_source_cycle"), true);
  const blocked = await intake.getRequest(companyId, request.intakeId);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.errorCode, "import_source_cycle");
  assert.deepEqual(blocked.snapshot, request.snapshot);
  assert.equal(blocked.version, request.version + 1);
  assert.equal(await store.blockCandidate(candidate, "import_source_cycle"), false);
  assert.deepEqual(await store.listCandidates(companyId, activationId), []);
  assert.equal(await count("import_plans"), 0);
});

test("candidate guard is a read-only source/binding check that includes retained pending withdrawals", async () => {
  const request = await sourceObserved(), [candidate] = await store.listCandidates(companyId, activationId);
  const mutations = database.calls.filter(call => call.operation === "execute").length;
  assert.equal(await store.isCurrentCandidate(candidate), true);
  assert.equal(await store.isCurrentCandidate({ ...candidate, fingerprint: "d".repeat(64) }), false);
  assert.equal(await store.isCurrentCandidate({ ...candidate, requestVersion: candidate.requestVersion + 1 }), false);
  assert.equal(database.calls.filter(call => call.operation === "execute").length, mutations);
  await assert.rejects(withdraw(request, createIntakeStore(interrupted(database.db, 2, false))), /synthetic_worker_interrupted/);
  assert.equal(await store.isCurrentCandidate(candidate), false);
});

test("blocking an obsolete or already-planned candidate cannot bypass its durable authority", async () => {
  const request = await sourceObserved(), [candidate] = await store.listCandidates(companyId, activationId);
  assert.equal(await store.blockCandidate({ ...candidate, fingerprint: "d".repeat(64) }, "import_invalid_scope"), false);
  await store.ensurePlan(planInput(request));
  assert.equal(await store.blockCandidate(candidate, "import_invalid_scope"), false);
  assert.equal((await intake.getRequest(companyId, request.intakeId)).status, "source_observed");
});

for (const field of ["activationId", "fingerprint", "requestVersion", "sourceSha256"]) {
  test(`initial plan refuses mismatched ${field} before creating import state`, async () => {
    const request = await sourceObserved(), input = planInput(request);
    const wrong = { activationId: randomUUID(), fingerprint: "d".repeat(64), requestVersion: request.version + 1, sourceSha256: "d".repeat(64) };
    input[field] = wrong[field];
    await assert.rejects(store.ensurePlan(input), /import_plan_missing_or_inactive/);
    assert.equal(await count("import_plans"), 0);
  });
}

test("plan keys must be unique, bounded, included in the hashed plan and immutable", async () => {
  const request = await sourceObserved();
  await assert.rejects(store.ensurePlan(planInput(request, ["task:one", "task:one"])), /import_duplicate_effect_key/);
  await assert.rejects(store.ensurePlan(planInput(request, [])), /import_invalid_bound/);
  await assert.rejects(store.ensurePlan(planInput(request, Array.from({ length: 501 }, (_, index) => `task:${index}`))), /import_invalid_bound/);
  const input = planInput(request);
  await assert.rejects(store.ensurePlan({ ...input, expectedEffectKeys: ["uncommitted-key"] }), /import_effect_keys_mismatch/);
  await assert.rejects(store.ensurePlan({ ...input, planSha256: "d".repeat(64) }), /import_plan_hash_mismatch/);
  const withoutHash = { ...input.plan };
  delete withoutHash.planSha256;
  assert.equal((await store.ensurePlan({ ...input, plan: withoutHash })).state, "preparing");
});

test("intent and plan association are durable before any effect can be dispatched", async () => {
  const { input } = await planned(), effect = effectInput(input);
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), false);
  const previousWrites = database.calls.length;
  const saved = await store.ensureEffect(effect);
  assert.equal(saved.state, "intended");
  assert.equal(saved.dispatchCount, 0);
  const writes = database.calls.slice(previousWrites).filter(call => call.operation === "execute");
  assert.match(writes[0].sql, /INSERT INTO .*import_effects/);
  assert.match(writes[1].sql, /INSERT INTO .*import_plan_effects/);
  assert.equal((await store.listEffects(input)).length, 1);
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), true);
  assert.equal((await store.getEffect(companyId, effect.effectKey)).dispatchCount, 1);
});

test("global source identity rejects a different intent across plans and shares only identical effects", async () => {
  const first = await intended(["task:shared"]), secondRequest = await sourceObserved();
  const second = planInput(secondRequest, ["task:shared"]);
  await store.ensurePlan(second);
  const changedIntent = { ...first.effect.intent, title: "different authorized content" };
  await assert.rejects(store.ensureEffect(effectInput(second, "task:shared", { intent: changedIntent,
    intentSha256: contentDigest(changedIntent) })), /import_intent_conflict/);
  assert.deepEqual(await store.listEffects(second), []);
  const shared = await store.ensureEffect(effectInput(second));
  assert.equal(shared.intentSha256, first.effect.intentSha256);
  const claims = await Promise.all([
    store.claimDispatch({ ...first.effect, owner: randomUUID() }),
    store.claimDispatch({ ...effectInput(second), owner: randomUUID() }),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await count("import_effects"), 1);
  assert.equal(await count("import_plan_effects"), 2);
});

test("an effect outside the immutable planned key set is refused without inventing a replacement identity", async () => {
  const { input } = await planned();
  await assert.rejects(store.ensureEffect(effectInput(input, "replacement-key")), /import_effect_missing_or_inactive/);
  assert.equal(await count("import_effects"), 0);
});

for (const afterEffect of [false, true]) {
  test(`interruption ${afterEffect ? "after" : "before"} plan persistence resumes the same intake and plan`, async () => {
    const request = await sourceObserved(), input = planInput(request);
    const fragile = createImportStore(interrupted(database.db, 1, afterEffect));
    await assert.rejects(fragile.ensurePlan(input), /synthetic_worker_interrupted/);
    const saved = await store.ensurePlan(input);
    assert.equal(saved.planSha256, input.planSha256);
    assert.equal(saved.version, 1);
    assert.equal(await count("import_plans"), 1);
  });
}

for (const writeNumber of [1, 2]) {
  for (const afterEffect of [false, true]) {
    test(`intent interruption ${afterEffect ? "after" : "before"} write ${writeNumber} creates no duplicate or dispatch`, async () => {
      const { input } = await planned(), effect = effectInput(input);
      const fragile = createImportStore(interrupted(database.db, writeNumber, afterEffect));
      await assert.rejects(fragile.ensureEffect(effect), /synthetic_worker_interrupted/);
      const saved = await store.ensureEffect(effect);
      assert.equal(saved.state, "intended");
      assert.equal(saved.dispatchCount, 0);
      assert.equal(await count("import_effects"), 1);
      assert.equal(await count("import_plan_effects"), 1);
    });
  }
}

test("concurrent dispatch claims including identical owners grant exactly one authorization", async () => {
  const { effect } = await intended(), owner = randomUUID();
  const claims = await Promise.all(Array.from({ length: 6 }, () => store.claimDispatch({ ...effect, owner })));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await store.getEffect(companyId, effect.effectKey)).dispatchCount, 1);
});

test("a dispatched candidate cannot starve other work and remains authorized only for its existing writer", async () => {
  const { input, effect } = await intended();
  const next = await sourceObserved();
  await store.claimDispatch({ ...effect, owner: randomUUID() });
  assert.equal(await store.isCurrentCandidate(input), true);
  assert.deepEqual((await store.listCandidates(companyId, activationId, 1)).map(row => row.intakeId), [next.intakeId]);
  await store.markUnknown({ ...effect, errorCode: "native_worker_interrupted" });
  assert.deepEqual((await store.listCandidates(companyId, activationId)).map(row => row.intakeId), [next.intakeId]);
  await store.observeEffect({ ...effect, result: nativeResult });
  assert.equal((await store.listCandidates(companyId, activationId)).length, 2);
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), false);
  assert.equal((await store.getEffect(companyId, effect.effectKey)).dispatchCount, 1);
});

test("interruption before dispatch commit can retry the original claim after readback", async () => {
  const { effect } = await intended(), input = { ...effect, owner: randomUUID() };
  await assert.rejects(createImportStore(interrupted(database.db, 1, false)).claimDispatch(input), /synthetic_worker_interrupted/);
  assert.equal((await store.getEffect(companyId, effect.effectKey)).state, "intended");
  assert.equal(await store.claimDispatch(input), true);
});

test("a lost dispatch response permanently closes the dispatch gate even if no native object is found", async () => {
  const { input, effect } = await intended(), owner = randomUUID();
  await assert.rejects(createImportStore(interrupted(database.db, 1, true)).claimDispatch({ ...effect, owner }), /synthetic_worker_interrupted/);
  assert.equal((await store.getEffect(companyId, effect.effectKey)).state, "dispatched");
  assert.equal(await store.claimDispatch({ ...effect, owner }), false);
  await store.markUnknown({ ...effect, errorCode: "native_readback_absent" });
  assert.equal(await store.finishPlan(finish(input, "outcome_unknown", { errorCode: "native_readback_absent" })), true);
  assert.equal(await store.resumePlan(input), false);
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), false);
  assert.deepEqual(await store.listCandidates(companyId, activationId), []);
});

test("a lost native response reconciles one original object and never recreates its family", async () => {
  const { input, effect } = await intended(), native = new Map();
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), true);
  native.set(effect.effectKey, nativeResult);
  await store.markUnknown({ ...effect, errorCode: "native_response_lost" });
  await store.finishPlan(finish(input, "outcome_unknown", { errorCode: "native_response_lost" }));
  const restarted = createImportStore(database.db);
  assert.equal(await restarted.claimDispatch({ ...effect, owner: randomUUID() }), false);
  await restarted.observeEffect({ ...effect, result: native.get(effect.effectKey) });
  assert.equal(await restarted.resumePlan(input), true);
  assert.equal(await restarted.finishPlan(finish(input)), true);
  assert.equal(native.size, 1);
  assert.equal((await restarted.getEffect(companyId, effect.effectKey)).dispatchCount, 1);
  assert.equal((await restarted.getPlan(companyId, input.intakeId)).state, "prepared");
});

test("existing conforming no-op relations can be observed without any native dispatch", async () => {
  const { input } = await planned(["relations:one"]);
  const intent = { kind: "relations", blockedByIds: [] }, effect = effectInput(input, "relations:one", {
    kind: "relations", intent, intentSha256: contentDigest(intent),
  });
  await store.ensureEffect(effect);
  const observed = await store.observeEffect({ ...effect, result: { relationIds: [] } });
  assert.equal(observed.state, "observed");
  assert.equal(observed.dispatchCount, 0);
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), false);
  assert.equal(await store.finishPlan(finish(input)), true);
});

test("native observation is immutable, idempotent and tied to its associated original plan", async () => {
  const { input, effect } = await intended();
  const observed = await store.observeEffect({ ...effect, result: nativeResult });
  assert.deepEqual(await store.observeEffect({ ...effect, result: nativeResult }), observed);
  await assert.rejects(store.observeEffect({ ...effect, result: { ...nativeResult, nativeId: randomUUID() } }), /import_observation_conflict/);
  await assert.rejects(store.observeEffect({ ...effect, planSha256: "d".repeat(64), result: nativeResult }), /import_effect_not_associated/);
  await assert.rejects(store.markUnknown({ ...effect, intakeId: "invented-intake", errorCode: "native_failure" }), /import_effect_not_associated/);
  assert.equal((await store.markUnknown({ ...effect, errorCode: "native_failure" })).state, "observed");
  assert.equal((await store.getPlan(companyId, input.intakeId)).state, "preparing");
});

test("prepared requires every planned key rather than just the observed subset", async () => {
  const { input, effect } = await intended(["task:one", "document:one", "readiness:one"]);
  await store.observeEffect({ ...effect, result: nativeResult });
  assert.equal(await store.finishPlan(finish(input)), false);
  assert.equal((await store.getPlan(companyId, input.intakeId)).readiness, null);
  for (const key of input.expectedEffectKeys.slice(1)) {
    const next = effectInput(input, key);
    await store.ensureEffect(next);
    await store.observeEffect({ ...next, result: { nativeId: randomUUID() } });
  }
  assert.equal(await store.finishPlan(finish(input)), true);
  const complete = await store.getPlan(companyId, input.intakeId);
  assert.equal(await store.finishPlan(finish(input)), true);
  assert.equal((await store.getPlan(companyId, input.intakeId)).version, complete.version);
  assert.equal(await store.finishPlan(finish(input, "blocked", { errorCode: "late_failure" })), false);
  assert.deepEqual(await store.listCandidates(companyId, activationId), []);
});

test("unresolved effects prevent resume and automatic candidates until explicit reconciliation", async () => {
  const { input, effect } = await intended(["task:one", "document:one"]);
  await store.claimDispatch({ ...effect, owner: randomUUID() });
  await store.finishPlan(finish(input, "outcome_unknown", { errorCode: "native_response_lost" }));
  assert.equal(await store.resumePlan(input), false);
  assert.deepEqual(await store.listCandidates(companyId, activationId), []);
  await store.observeEffect({ ...effect, result: nativeResult });
  assert.equal(await store.resumePlan(input), true);
  assert.equal((await store.listCandidates(companyId, activationId)).length, 1);
  assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), false);
  const remaining = effectInput(input, "document:one");
  await store.ensureEffect(remaining);
  assert.equal(await store.claimDispatch({ ...remaining, owner: randomUUID() }), true);
});

const invalidations = [
  ["withdrawal", ({ request }) => withdraw(request)],
  ["disabled binding", () => intake.deactivateBinding(companyId, activationId)],
  ["new source revision", ({ request }) => intake.retainDelivery(companyId, activationId, event(request.issueId, {
    revision: "2026-10-08T10:00:05.000Z", eventAt: "2026-10-08T10:00:05.000Z",
  }))],
  ["retained withdrawal before projection", async ({ request }) => {
    await assert.rejects(withdraw(request, createIntakeStore(interrupted(database.db, 2, false))), /synthetic_worker_interrupted/);
  }],
];
for (const [name, invalidate] of invalidations) {
  test(`${name} prevents dispatch and prepared but preserves later native observations as history`, async () => {
    const context = await intended(["task:one", "document:one"]);
    await invalidate(context);
    assert.equal(await store.claimDispatch({ ...context.effect, owner: randomUUID() }), false);
    await assert.rejects(store.ensureEffect(effectInput(context.input, "document:one")), /import_effect_missing_or_inactive/);
    const observed = await store.observeEffect({ ...context.effect, result: nativeResult });
    assert.equal(observed.state, "observed");
    assert.equal(await store.finishPlan(finish(context.input)), false);
    assert.equal((await store.getPlan(companyId, context.input.intakeId)).readiness, null);
    assert.deepEqual(await store.listCandidates(companyId, activationId), []);
  });
}

test("activation replacement cannot claim or finish a plan captured in the previous epoch", async () => {
  const { input, effect } = await intended();
  await store.claimDispatch({ ...effect, owner: randomUUID() });
  await intake.deactivateBinding(companyId, activationId);
  const nextActivation = randomUUID(), nextAt = "2026-10-08T11:00:00.000Z";
  await intake.activateBinding({ companyId, activationId: nextActivation, activatedAt: nextAt, fingerprint: "d".repeat(64),
    authority: { ...authority, activationAt: nextAt } });
  await store.observeEffect({ ...effect, result: nativeResult });
  assert.equal(await store.finishPlan(finish(input)), false);
  assert.deepEqual(await store.listCandidates(companyId, nextActivation), []);
});

for (const afterEffect of [false, true]) {
  test(`lost observation ${afterEffect ? "after" : "before"} persistence converges without dispatching again`, async () => {
    const { effect } = await intended();
    await store.claimDispatch({ ...effect, owner: randomUUID() });
    const fragile = createImportStore(interrupted(database.db, 1, afterEffect));
    await assert.rejects(fragile.observeEffect({ ...effect, result: nativeResult }), /synthetic_worker_interrupted/);
    assert.equal((await store.observeEffect({ ...effect, result: nativeResult })).state, "observed");
    assert.equal(await store.claimDispatch({ ...effect, owner: randomUUID() }), false);
  });
}

test("a lost prepared response reconciles the same immutable readiness receipt", async () => {
  const { input, effect } = await intended();
  await store.observeEffect({ ...effect, result: nativeResult });
  await assert.rejects(createImportStore(interrupted(database.db, 1, true)).finishPlan(finish(input)), /synthetic_worker_interrupted/);
  assert.equal(await store.finishPlan(finish(input)), true);
  const row = await store.getPlan(companyId, input.intakeId);
  assert.equal(row.version, 2);
  assert.equal(row.readinessSha256, contentDigest(row.readiness));
});

test("all durable JSON inputs are bounded and malformed hashes or error details fail closed", async () => {
  const { input, effect } = await intended();
  const large = { body: "x".repeat(8 * 1024 * 1024) };
  await assert.rejects(store.ensureEffect({ ...effect, intent: large, intentSha256: contentDigest(large) }), /import_json_bound_exceeded/);
  await assert.rejects(store.observeEffect({ ...effect, result: large }), /import_json_bound_exceeded/);
  await assert.rejects(store.finishPlan(finish(input, "prepared", { readiness: large })), /import_json_bound_exceeded/);
  await assert.rejects(store.ensureEffect({ ...effect, intentSha256: "d".repeat(64) }), /import_intent_hash_mismatch/);
  await assert.rejects(store.markUnknown({ ...effect, errorCode: "Native response included private details" }), /import_invalid_error_code/);
  await assert.rejects(store.listCandidates(companyId, activationId, 21), /import_invalid_bound/);
});
