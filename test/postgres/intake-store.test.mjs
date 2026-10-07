import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { createIntakeStore } from "../../dist/intake-store.js";
import { intakeIdentity, INTAKE_DATABASE_NAMESPACE } from "../../dist/intake-state.js";
import { contentDigest } from "../../dist/content-digest.js";
import { isolatedDatabase, interrupted } from "./intake-db-helper.mjs";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompanyId = "10000000-0000-4000-8000-000000000002";
const organizationId = "20000000-0000-4000-8000-000000000001";
const issueId = "30000000-0000-4000-8000-000000000001";
const activationId = "40000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(64);
const activatedAt = "2026-10-07T12:00:00.000Z";
const initialRevision = "2026-10-07T12:00:01.000Z";
const now = "2026-10-07T12:01:00.000Z";
const authority = {
  organizationId, activationAt: activatedAt,
  teamId: "50000000-0000-4000-8000-000000000001", projectId: "60000000-0000-4000-8000-000000000001",
  todoStateId: "70000000-0000-4000-8000-000000000001", webhookId: "80000000-0000-4000-8000-000000000001",
  allowedActors: [{ id: "90000000-0000-4000-8000-000000000001", type: "user" }],
};
const activation = { companyId, activationId, activatedAt, fingerprint, authority };
let database, store;

before(async () => { database = await isolatedDatabase(); });
beforeEach(async () => { await database.reset(); store = createIntakeStore(database.db); });
after(async () => { if (database) await database.close(); });

function event(overrides = {}) {
  return {
    classification: "received", organizationId, webhookId: authority.webhookId, issueId, action: "update",
    eventAt: initialRevision, revision: initialRevision, teamId: authority.teamId, projectId: authority.projectId,
    stateId: authority.todoStateId, archivedAt: null, actor: authority.allowedActors[0], previous: { stateId: randomUUID() },
    providerDeliveryId: randomUUID(), rawBodySha256: "b".repeat(64), sourceEventId: "c".repeat(64),
    webhookTimestamp: Date.parse(initialRevision), receivedAt: initialRevision,
    sourceScopeWasAuthorized: true, currentScopeMatches: true, ...overrides,
  };
}

async function retain(input = event(), target = store) {
  return target.retainDelivery(companyId, activationId, input);
}
async function ready(input = event()) { await store.activateBinding(activation); return retain(input); }
function claim(request, overrides = {}) {
  return { companyId, intakeId: request.intakeId, activationId, fingerprint, owner: randomUUID(), now,
    leaseMs: 30_000, maxAttempts: 3, ...overrides };
}
function snapshot(request) {
  const body = { schema: "linear-source-family.v1", rootIssueId: request.issueId, organizationId: request.organizationId,
    selectedRootInTodo: true, selectedRootArchived: false, issues: [] };
  const sourceSha256 = contentDigest(body);
  return { ...body, sourceSha256 };
}
function completion(request, claimant, overrides = {}) {
  const source = snapshot(request);
  return { companyId, intakeId: request.intakeId, activationId, fingerprint, owner: claimant.owner,
    now: "2026-10-07T12:01:01.000Z", revision: request.version, status: "source_observed",
    snapshot: source, snapshotSha256: source.sourceSha256, ...overrides };
}
async function count(table, where = "true") {
  return Number((await database.pool.query(`SELECT count(*) AS total FROM ${INTAKE_DATABASE_NAMESPACE}.${table} WHERE ${where}`)).rows[0].total);
}

test("migration uses the exact host-derived plugin namespace and an empty binding is inert", async () => {
  const suffix = createHash("sha256").update("ty000.linear-intake").digest("hex").slice(0, 10);
  assert.equal(INTAKE_DATABASE_NAMESPACE, `plugin_linear_intake_${suffix}`);
  assert.equal(await store.getBinding(), undefined);
  assert.deepEqual(await store.listRequests(companyId), []);
  await assert.rejects(retain(), /intake_binding_inactive/);
  assert.equal(await count("intake_deliveries"), 0);
  assert.throws(() => createIntakeStore({ ...database.db, namespace: "public" }), /intake_namespace_mismatch/);
});

test("database test setup refuses other identities and URL overrides before connecting", async () => {
  const original = process.env.INTAKE_TEST_DATABASE_URL;
  const unsafe = [
    "postgres://postgres@127.0.0.1/intake_test",
    "postgres://intake_test@127.0.0.1/paperclip",
    "postgres://intake_test@127.0.0.1/intake_test?database=paperclip",
    "postgres://intake_test@127.0.0.1/intake_test?host=example.invalid",
    "postgres://intake_test@example.invalid/intake_test",
  ];
  try {
    for (const connection of unsafe) {
      process.env.INTAKE_TEST_DATABASE_URL = connection;
      await assert.rejects(isolatedDatabase(), /isolated PostgreSQL|dedicated intake_test/);
    }
  } finally { process.env.INTAKE_TEST_DATABASE_URL = original; }
});

test("explicit binding preserves the first activation boundary and rejects another company or changed configuration", async () => {
  const first = await store.activateBinding(activation);
  const later = "2026-10-07T13:00:00.000Z";
  const repeated = await store.activateBinding({ ...activation, activationId: randomUUID(), activatedAt: later,
    authority: { ...authority, activationAt: later } });
  assert.deepEqual(repeated, first);
  await assert.rejects(store.activateBinding({ ...activation, companyId: otherCompanyId }), /intake_company_already_bound/);
  await assert.rejects(store.activateBinding({ ...activation, fingerprint: "d".repeat(64) }), /intake_deactivation_required/);
  assert.equal(await store.getBinding(otherCompanyId), undefined);
});

test("deactivation stays durable and a new activation retains prior intake history", async () => {
  const retained = await ready();
  const disabled = await store.deactivateBinding(companyId, activationId);
  assert.equal(disabled.active, false);
  assert.deepEqual(await store.deactivateBinding(companyId, activationId), disabled);
  await assert.rejects(store.activateBinding(activation), /intake_activation_identity_retired/);
  const nextId = randomUUID(), nextAt = "2026-10-07T12:02:00.000Z";
  await store.activateBinding({ ...activation, activationId: nextId, activatedAt: nextAt,
    authority: { ...authority, activationAt: nextAt } });
  const newer = event({ revision: "2026-10-07T12:03:00.000Z", eventAt: "2026-10-07T12:03:00.000Z" });
  const observed = await store.retainDelivery(companyId, nextId, newer);
  assert.equal(observed.intakeId, retained.intakeId);
  assert.equal(observed.activationId, activationId);
  assert.equal(observed.status, "withdrawn");
  assert.equal(await count("intake_requests"), 1);
});

test("one valid delivery durably precedes its projection and receipt", async () => {
  const input = event(), request = await ready(input);
  assert.equal(request.intakeId, intakeIdentity(companyId, organizationId, issueId));
  assert.equal(request.status, "received");
  assert.equal(request.accepted, true);
  assert.equal(await count("intake_deliveries", "applied = true"), 1);
  const writes = database.calls.filter(call => call.operation === "execute").slice(1).map(call => call.sql);
  assert.match(writes[0], /INSERT INTO .*intake_deliveries/);
  assert.match(writes[1], /INSERT INTO .*intake_requests/);
  assert.match(writes[2], /UPDATE .*intake_deliveries SET applied = true/);
  assert.deepEqual(await store.listRequests(otherCompanyId), []);
});

test("concurrent identical deliveries yield one identity and one projection", async () => {
  await store.activateBinding(activation);
  const input = event();
  const outcomes = await Promise.all(Array.from({ length: 6 }, () => retain(input)));
  assert.equal(new Set(outcomes.map(item => item.intakeId)).size, 1);
  assert.equal(await count("intake_deliveries"), 1);
  assert.equal(await count("intake_requests"), 1);
  assert.equal((await store.listRequests(companyId))[0].version, 1);
});

test("delivery identity collision cannot replace the retained body", async () => {
  const input = event();
  await ready(input);
  await assert.rejects(retain({ ...input, rawBodySha256: "d".repeat(64) }), /intake_delivery_collision/);
  assert.equal(await count("intake_deliveries", "raw_body_sha256 = '" + "b".repeat(64) + "'"), 1);
  assert.equal(await count("intake_requests"), 1);
});

for (const kind of ["exit", "archive", "move"]) {
  test(`${kind} by another actor withdraws accepted work and a later Todo transition does not reopen it`, async () => {
    const retained = await ready();
    const withdrawal = event({ classification: "withdrawal", actor: { id: randomUUID(), type: "user" },
      revision: "2026-10-07T12:00:03.000Z", eventAt: "2026-10-07T12:00:03.000Z",
      ...(kind === "archive" ? { archivedAt: "2026-10-07T12:00:03.000Z" } : {}),
      ...(kind === "move" ? { projectId: randomUUID(), currentScopeMatches: false } : {}) });
    assert.equal((await retain(withdrawal)).status, "withdrawn");
    const repeat = await retain(event({ revision: "2026-10-07T12:00:04.000Z", eventAt: "2026-10-07T12:00:04.000Z" }));
    assert.equal(repeat.status, "withdrawn");
    assert.equal(repeat.intakeId, retained.intakeId);
    assert.equal(await count("intake_requests"), 1);
    assert.equal(await count("intake_deliveries"), 3);
  });
}

test("withdrawal tombstone blocks an older arrival without creating visible work; a future first entry remains possible", async () => {
  await store.activateBinding(activation);
  await retain(event({ classification: "withdrawal", revision: "2026-10-07T12:00:03.000Z", eventAt: "2026-10-07T12:00:03.000Z" }));
  assert.deepEqual(await store.listRequests(companyId), []);
  assert.equal(await retain(event()), undefined);
  assert.deepEqual(await store.listPendingRequests(companyId, activationId, now), []);
  const first = await retain(event({ revision: "2026-10-07T12:00:04.000Z", eventAt: "2026-10-07T12:00:04.000Z" }));
  assert.equal(first.status, "received");
  assert.equal(await count("intake_requests"), 1);
});

test("withdrawal dominates an equal source revision regardless of event timestamp and arrival order", async () => {
  await ready(event({ eventAt: "2026-10-07T12:00:10.000Z" }));
  const withdrawn = await retain(event({ classification: "withdrawal", eventAt: "2026-10-07T12:00:02.000Z" }));
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal((await retain(event({ eventAt: "2026-10-07T12:00:11.000Z" }))).status, "withdrawn");
});

for (const writeNumber of [1, 2, 3]) {
  for (const afterEffect of [false, true]) {
    test(`worker interruption ${afterEffect ? "after" : "before"} durable write ${writeNumber} recovers under the original identity`, async () => {
      await store.activateBinding(activation);
      const input = event();
      const fragile = createIntakeStore(interrupted(database.db, writeNumber, afterEffect));
      await assert.rejects(retain(input, fragile), /synthetic_worker_interrupted/);
      const restarted = createIntakeStore(database.db);
      await restarted.replayPending(companyId, activationId, 20);
      const recovered = await retain(input, restarted);
      assert.equal(recovered.intakeId, intakeIdentity(companyId, organizationId, issueId));
      assert.equal(await count("intake_requests"), 1);
      assert.equal(await count("intake_deliveries", "applied = true"), 1);
      assert.equal(recovered.version, 1);
    });
  }
}

test("recovery scans only a bounded retained set and never lists historical Todo source work", async () => {
  await store.activateBinding(activation);
  for (let number = 0; number < 3; number++) {
    const input = event({ issueId: randomUUID() });
    await assert.rejects(retain(input, createIntakeStore(interrupted(database.db, 2, false))), /synthetic_worker_interrupted/);
  }
  assert.equal(await store.replayPending(companyId, activationId, 1), 1);
  assert.equal(await count("intake_deliveries", "applied = true"), 1);
  assert.equal((await store.listRequests(companyId)).length, 1);
  assert.equal(await store.replayPending(companyId, activationId, 2), 2);
  await assert.rejects(store.replayPending(companyId, activationId, 101), /intake_invalid_bound/);
});

test("concurrent claims assign one lease and expired recovery preserves identity with a bounded attempt count", async () => {
  const retained = await ready();
  const first = claim(retained), second = claim(retained);
  const outcomes = await Promise.all([store.claimRequest(first), store.claimRequest(second)]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const winner = outcomes.find(Boolean);
  assert.equal(winner.attempts, 1);
  assert.equal(await store.claimRequest(claim(retained)), undefined);
  const resumed = await store.claimRequest(claim(retained, { now: "2026-10-07T12:01:31.000Z" }));
  assert.equal(resumed.intakeId, retained.intakeId);
  assert.equal(resumed.attempts, 2);
  assert.equal((await store.claimRequest(claim(retained, { now: "2026-10-07T12:02:02.000Z" }))).attempts, 3);
  assert.equal(await store.claimRequest(claim(retained, { now: "2026-10-07T12:02:33.000Z" })), undefined);
  assert.equal((await store.getRequest(companyId, retained.intakeId)).errorCode, "source_attempt_limit");
});

test("the same claim arguments cannot grant a second lease to a concurrent caller", async () => {
  const retained = await ready(), input = claim(retained);
  const claims = await Promise.all([store.claimRequest(input), store.claimRequest(input)]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test("completion persists a coherent snapshot only while the captured request lease remains current", async () => {
  const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
  assert.equal(await store.finishRequest(completion(claimed, claimant)), true);
  const observed = await store.getRequest(companyId, retained.intakeId);
  assert.equal(observed.status, "source_observed");
  assert.equal(observed.snapshotSha256, observed.snapshot.sourceSha256);
  assert.equal(observed.leaseOwner, null);
  assert.deepEqual(await store.listPendingRequests(companyId, activationId, now), []);
});

for (const terminal of ["source_observed", "blocked"]) {
  test(`a later Todo entry preserves ${terminal} evidence without authorizing another source attempt`, async () => {
    const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
    const finish = completion(claimed, claimant);
    if (terminal === "blocked") Object.assign(finish, { status: "blocked", snapshot: undefined,
      snapshotSha256: undefined, errorCode: "source_read_failed" });
    assert.equal(await store.finishRequest(finish), true);
    const completed = await store.getRequest(companyId, retained.intakeId);
    const later = event({ revision: "2026-10-07T12:02:00.000Z", eventAt: "2026-10-07T12:02:00.000Z" });
    const repeated = await retain(later);
    assert.equal(repeated.status, terminal);
    assert.equal(repeated.intakeId, retained.intakeId);
    assert.equal(repeated.attempts, 1);
    assert.equal(repeated.revision, later.revision);
    assert.equal(repeated.version, completed.version + 1);
    assert.deepEqual(repeated.snapshot, completed.snapshot);
    assert.equal(repeated.snapshotSha256, completed.snapshotSha256);
    assert.equal(repeated.errorCode, completed.errorCode);
    assert.deepEqual(await store.listPendingRequests(companyId, activationId, later.eventAt), []);
    assert.equal(await store.claimRequest(claim(retained, { now: later.eventAt })), undefined);
    assert.equal(await count("intake_deliveries"), 2);
  });
}

for (const status of ["received", "fetching"]) {
  test(`a new Todo transition withdraws ${status} work when the intervening withdrawal was not delivered`, async () => {
    const retained = await ready(), claimant = claim(retained);
    if (status === "fetching") await store.claimRequest(claimant);
    const later = event({ revision: "2026-10-07T12:02:00.000Z", eventAt: "2026-10-07T12:02:00.000Z" });
    const repeated = await retain(later);
    assert.equal(repeated.status, "withdrawn");
    assert.equal(repeated.intakeId, retained.intakeId);
    assert.equal(repeated.leaseOwner, null);
    assert.equal(repeated.leaseUntil, null);
    assert.equal(repeated.attempts, status === "fetching" ? 1 : 0);
    assert.deepEqual(await store.listPendingRequests(companyId, activationId, later.eventAt), []);
    assert.equal(await store.claimRequest(claim(retained, { now: later.eventAt })), undefined);
  });
}

test("another delivery of the same accepted event preserves the active lease and terminal result", async () => {
  const input = event(), retained = await ready(input), claimant = claim(retained);
  const claimed = await store.claimRequest(claimant);
  const duplicate = await retain({ ...input, providerDeliveryId: randomUUID() });
  assert.deepEqual(duplicate, claimed);
  assert.equal(await store.finishRequest(completion(claimed, claimant)), true);
  const finished = await store.getRequest(companyId, retained.intakeId);
  assert.deepEqual(await retain({ ...input, providerDeliveryId: randomUUID() }), finished);
  assert.equal(await count("intake_requests"), 1);
});

test("an explicit withdrawal preserves the historical source snapshot while removing current eligibility", async () => {
  const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
  await store.finishRequest(completion(claimed, claimant));
  const finished = await store.getRequest(companyId, retained.intakeId);
  const withdrawn = await retain(event({ classification: "withdrawal", revision: "2026-10-07T12:02:00.000Z",
    eventAt: "2026-10-07T12:02:00.000Z" }));
  assert.equal(withdrawn.status, "withdrawn");
  assert.deepEqual(withdrawn.snapshot, finished.snapshot);
  assert.equal(withdrawn.snapshotSha256, finished.snapshotSha256);
  assert.equal(await store.claimRequest(claim(retained)), undefined);
});

test("a concurrent completion and later Todo entry cannot erase proof or grant a replacement lease", async () => {
  const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
  const later = event({ revision: "2026-10-07T12:02:00.000Z", eventAt: "2026-10-07T12:02:00.000Z" });
  await Promise.all([store.finishRequest(completion(claimed, claimant)), retain(later)]);
  const observed = await store.getRequest(companyId, retained.intakeId);
  assert.ok(["withdrawn", "source_observed"].includes(observed.status));
  if (observed.status === "source_observed") assert.equal(observed.snapshotSha256, snapshot(claimed).sourceSha256);
  assert.equal(observed.revision, later.revision);
  assert.equal(observed.attempts, 1);
  assert.equal(observed.leaseOwner, null);
  assert.equal(await store.claimRequest(claim(retained, { now: later.eventAt })), undefined);
});

const completionConflicts = [
  ["withdrawal", () => retain(event({ classification: "withdrawal", revision: "2026-10-07T12:00:03.000Z", eventAt: "2026-10-07T12:00:03.000Z" }))],
  ["new_revision", () => retain(event({ revision: "2026-10-07T12:00:03.000Z", eventAt: "2026-10-07T12:00:03.000Z" }))],
  ["disabled", () => store.deactivateBinding(companyId, activationId)],
  ["fingerprint", finish => { finish.fingerprint = "d".repeat(64); }],
  ["owner", finish => { finish.owner = randomUUID(); }],
  ["expired", finish => { finish.now = "2026-10-07T12:01:31.000Z"; }],
  ["activation", finish => { finish.activationId = randomUUID(); }],
];
for (const [conflict, prepare] of completionConflicts) {
  test(`completion refuses a stale ${conflict} without publishing a snapshot`, async () => {
    const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
    const finish = completion(claimed, claimant);
    await prepare(finish);
    assert.equal(await store.finishRequest(finish), false);
    assert.equal((await store.getRequest(companyId, retained.intakeId)).snapshot, null);
  });
}

test("snapshot mismatch and raw error messages cannot be retained as source evidence", async () => {
  const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
  const finish = completion(claimed, claimant);
  await assert.rejects(store.finishRequest({ ...finish, snapshot: { ...finish.snapshot, organizationId: randomUUID() } }), /intake_invalid_snapshot/);
  await assert.rejects(store.finishRequest({ ...finish, errorCode: "Remote request failed with credential example" }), /intake_invalid_error_code/);
  assert.equal((await store.getRequest(companyId, retained.intakeId)).snapshot, null);
});

test("a retained withdrawal blocks source completion before its interrupted projection is replayed", async () => {
  const retained = await ready(), claimant = claim(retained), claimed = await store.claimRequest(claimant);
  const withdrawal = event({ classification: "withdrawal", revision: "2026-10-07T12:00:03.000Z", eventAt: "2026-10-07T12:00:03.000Z" });
  await assert.rejects(retain(withdrawal, createIntakeStore(interrupted(database.db, 2, false))), /synthetic_worker_interrupted/);
  assert.equal(await store.finishRequest(completion(claimed, claimant)), false);
  assert.equal((await store.getRequest(companyId, retained.intakeId)).snapshot, null);
  await store.replayPending(companyId, activationId);
  assert.equal((await store.getRequest(companyId, retained.intakeId)).status, "withdrawn");
});

test("a retained but unprojected withdrawal blocks fetching only its own request", async () => {
  const retained = await ready(), unrelated = await retain(event({ issueId: randomUUID() }));
  const withdrawal = event({ classification: "withdrawal", revision: "2026-10-07T12:00:03.000Z", eventAt: "2026-10-07T12:00:03.000Z" });
  await assert.rejects(retain(withdrawal, createIntakeStore(interrupted(database.db, 2, false))), /synthetic_worker_interrupted/);
  assert.deepEqual((await store.listPendingRequests(companyId, activationId, now)).map(item => item.intakeId), [unrelated.intakeId]);
  assert.equal(await store.claimRequest(claim(retained)), undefined);
  assert.equal((await store.claimRequest(claim(unrelated))).status, "fetching");
});

test("a disabled binding forbids new retention, claim and projection replay", async () => {
  const retained = await ready();
  await store.deactivateBinding(companyId, activationId);
  await assert.rejects(retain(), /intake_binding_inactive/);
  await assert.rejects(store.replayPending(companyId, activationId), /intake_binding_inactive/);
  assert.equal(await store.claimRequest(claim(retained)), undefined);
  assert.deepEqual(await store.listPendingRequests(companyId, activationId, now), []);
});
