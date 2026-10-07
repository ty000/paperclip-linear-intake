import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeHostFixture, prepareNativeEngineInput } from "../../test/native/host-import-fixture.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const sha256 = text => createHash("sha256").update(text).digest("hex");

function issueInput(fixture, index, parentId) {
  return {
    companyId: fixture.companyId, projectId: fixture.projectId, ...(parentId === null ? {} : { parentId }),
    title: `Synthetic native issue ${index}`, description: `Full synthetic description ${index}\n`.repeat(500),
    status: ["blocked", "blocked", "done", "cancelled"][index], priority: "medium",
    assigneeUserId: null,
    originKind: "plugin:ty000.linear-intake", originId: `native-proof:${randomUUID()}`,
  };
}

async function createWithLostResponse(fixture, input) {
  await assert.rejects(async () => {
    await fixture.ctx.issues.create(input);
    throw new Error("synthetic_lost_create_response");
  }, /synthetic_lost_create_response/);
  const matches = await fixture.ctx.issues.list({ companyId: fixture.companyId,
    originKind: input.originKind, originId: input.originId, limit: 2, offset: 0,
  });
  assert.equal(matches.length, 1, "lost_create_origin_reconciliation_failed");
  return matches[0];
}

async function verifyIssue(fixture, expected, issue) {
  const actual = await fixture.ctx.issues.get(issue.id, fixture.companyId);
  for (const key of ["title", "description", "status", "projectId", "originKind", "originId"]) {
    assert.equal(actual[key], expected[key], `native_issue_${key}_readback_failed`);
  }
  assert.equal(actual.parentId, expected.parentId ?? null, "native_issue_parent_readback_failed");
  assert.equal(actual.assigneeAgentId, null, "native_issue_agent_assigned");
  assert.equal(actual.assigneeUserId, null, "native_issue_user_assigned");
  return actual;
}

async function verifyDocument(fixture, issue, body) {
  const input = { issueId: issue.id, companyId: fixture.companyId, key: "linear-source", format: "markdown", body };
  await assert.rejects(async () => {
    await fixture.ctx.issues.documents.upsert(input);
    throw new Error("synthetic_lost_document_response");
  }, /synthetic_lost_document_response/);
  const found = await fixture.ctx.issues.documents.get(issue.id, input.key, fixture.companyId);
  assert.equal(found.body, body, "native_document_readback_failed");
  // The inspected bridge does not forward baseRevisionId. A replay write is
  // therefore rejected; recovery must compare the existing body through get.
  await assert.rejects(() => fixture.ctx.issues.documents.upsert(input));
  const after = await fixture.ctx.issues.documents.get(issue.id, input.key, fixture.companyId);
  assert.equal(after.latestRevisionId, found.latestRevisionId, "native_document_replayed_revision");
  assert.equal(after.body, body, "native_document_replay_changed_body");
  return { length: body.length, sha256: sha256(body), lostResponseRecovered: true, replayWriteRejected: true };
}

async function createSyntheticFamily(fixture) {
  const inputs = [issueInput(fixture, 0, null)];
  const issues = [await createWithLostResponse(fixture, inputs[0])];
  for (const index of [1, 2, 3]) {
    const input = issueInput(fixture, index, issues[0].id);
    inputs.push(input);
    issues.push(await fixture.ctx.issues.create(input));
  }
  const descriptions = [];
  for (const [index, issue] of issues.entries()) {
    await verifyIssue(fixture, inputs[index], issue);
    descriptions.push(await verifyDocument(fixture, issue, inputs[index].description));
  }
  return { issues, descriptions };
}

async function verifyRelations(fixture, issues) {
  const { relations } = fixture.ctx.issues;
  const companyId = fixture.companyId;
  await relations.addBlockers(issues[1].id, [issues[0].id], companyId);
  await relations.addBlockers(issues[1].id, [issues[0].id], companyId);
  const forward = await relations.get(issues[1].id, companyId);
  const inverse = await relations.get(issues[0].id, companyId);
  assert.deepEqual(forward.blockedBy.map(row => row.id), [issues[0].id], "native_blocker_readback_failed");
  assert.deepEqual(inverse.blocks.map(row => row.id), [issues[1].id], "native_blocker_inverse_failed");
  await assert.rejects(() => relations.addBlockers(issues[0].id, [issues[1].id], companyId));
  const preserved = await relations.get(issues[1].id, companyId);
  assert.deepEqual(preserved, forward, "native_cycle_attempt_changed_relations");
  return { blockers: 1, inverseEdges: 1, duplicateAddPreservedSet: true, cycleRejected: true };
}

async function verifySdkGuards(fixture, issue) {
  await assert.rejects(() => fixture.ctx.issues.get(issue.id, randomUUID()), { name: "InvocationScopeDeniedError" });
  await assert.rejects(() => fixture.call("issues.requestWakeup", { issueId: issue.id,
    companyId: fixture.companyId }), { name: "CapabilityDeniedError" });
  return { crossCompanyRejected: true, wakeupCapabilityDenied: true };
}

async function recoverSyntheticFamily(fixture) {
  const rows = await fixture.ctx.issues.list({ companyId: fixture.companyId,
    originKind: "plugin:ty000.linear-intake", limit: 10, offset: 0,
  });
  assert.equal(rows.length, 4, "native_recovery_family_count_mismatch");
  const issues = [0, 1, 2, 3].map(index => rows.find(row => row.title === `Synthetic native issue ${index}`));
  const descriptions = [];
  for (const [index, issue] of issues.entries()) {
    const expected = issueInput(fixture, index, index === 0 ? null : issues[0].id);
    expected.originId = issue.originId;
    await verifyIssue(fixture, expected, issue);
    const document = await fixture.ctx.issues.documents.get(issue.id, "linear-source", fixture.companyId);
    assert.equal(document.body, expected.description, "native_recovered_document_readback_failed");
    assert.equal(document.latestRevisionNumber, 1, "native_recovered_document_revision_mismatch");
    descriptions.push({ length: document.body.length, sha256: sha256(document.body), revisionCount: 1 });
  }
  return { issues, descriptions };
}

async function recoverRelations(fixture, issues) {
  const forward = await fixture.ctx.issues.relations.get(issues[1].id, fixture.companyId);
  const inverse = await fixture.ctx.issues.relations.get(issues[0].id, fixture.companyId);
  assert.deepEqual(forward.blockedBy.map(row => row.id), [issues[0].id], "native_recovered_blocker_failed");
  assert.deepEqual(inverse.blocks.map(row => row.id), [issues[1].id], "native_recovered_inverse_failed");
  return { blockers: 1, inverseEdges: 1 };
}

async function observeNative(fixture, resume) {
  const project = await fixture.ctx.projects.get(fixture.projectId, fixture.companyId);
  assert.equal(project.id, fixture.projectId, "native_project_readback_failed");
  const family = await (resume ? recoverSyntheticFamily(fixture) : createSyntheticFamily(fixture));
  const relations = await (resume ? recoverRelations(fixture, family.issues) : verifyRelations(fixture, family.issues));
  const sdkGuards = await verifySdkGuards(fixture, family.issues[0]);
  return {
    schema: "linear-intake-native-host-primitives.v1", hostSha: fixture.hostSha,
    layer: "sdk-capability-bridge-and-core-services-isolated-postgresql",
    identity: fixture.identity, coreMigrationsApplied: true, issueCount: family.issues.length,
    statuses: family.issues.map(issue => issue.status), unassigned: true,
    readOnlyRecovery: Boolean(resume), descriptions: family.descriptions, relations, sdkGuards,
    before: fixture.baseline, after: await fixture.absenceCounts(),
    callCounts: Object.fromEntries([...new Set(fixture.calls.map(call => call.method))]
      .map(method => [method, fixture.calls.filter(call => call.method === method).length])),
    operationalServerStarted: false, providerCalled: false, nativeImporterEngineExercised: false,
  };
}

function outputDirectory(argument) {
  const directory = resolve(argument);
  assert.ok(directory.startsWith(resolve(repoRoot, "artifacts") + "/"), "native_output_must_be_local_artifact");
  return directory;
}

function nativeWriteCounts(fixture) {
  return Object.fromEntries(["issues.create", "issues.documents.upsert", "issues.relations.addBlockers"]
    .map(method => [method, fixture.calls.filter(call => call.method === method).length]));
}

async function verifyEngineReadiness(fixture, saved, input, plan) {
  assert.equal(saved.state, "prepared", "native_engine_not_prepared");
  const rootId = saved.readiness.nativeRootId;
  const document = await fixture.ctx.issues.documents.get(rootId, "linear-intake-readiness-v1", fixture.companyId);
  const body = JSON.parse(document.body);
  assert.equal(body.sourceSha256, input.family.sourceSha256, "native_engine_source_hash_mismatch");
  assert.equal(body.admissionAllowed, false, "native_engine_admission_not_blocked");
  assert.equal(body.implementationStarted, false, "native_engine_implementation_started");
  assert.equal(body.receivingContract, "unqualified", "native_engine_receiving_contract_overclaimed");
  assert.deepEqual(body.externalBlockers, plan.externalBlockers, "native_engine_external_blockers_lost");
  assert.equal(body.correspondence.length, plan.nodes.length, "native_engine_correspondence_incomplete");
  return body;
}

async function verifyEngineNodes(fixture, plan, readiness) {
  const nativeIds = new Map(readiness.correspondence.map(row => [row.sourceId, row.nativeId]));
  const descriptions = [];
  for (const node of plan.nodes) {
    const parentId = node.parentSourceId === null ? null : nativeIds.get(node.parentSourceId);
    const issue = await fixture.ctx.issues.get(nativeIds.get(node.sourceId), fixture.companyId);
    await verifyIssue(fixture, { ...node.source, description: node.source.description ?? "", status: node.status,
      parentId, projectId: fixture.projectId, originKind: plan.originKind, originId: node.originId }, issue);
    const document = await fixture.ctx.issues.documents.get(issue.id, "linear-source-v1", fixture.companyId);
    assert.equal(document.body, node.sourceDocumentBody, "native_engine_document_mismatch");
    assert.equal(document.latestRevisionNumber, 1, "native_engine_document_not_initial_revision");
    descriptions.push({ length: issue.description.length, sha256: sha256(issue.description),
      documentSha256: sha256(document.body), revisionCount: document.latestRevisionNumber });
  }
  return descriptions;
}

async function observeEngine(fixture) {
  const { prepareNativeFamily } = await import("../../src/import-engine.ts");
  const { createImportStore } = await import("../../src/import-store.ts");
  const { buildImportPlan } = await import("../../src/import-plan.ts");
  const input = await prepareNativeEngineInput(fixture);
  const plan = buildImportPlan(input.binding, input.request, fixture.projectId);
  const store = createImportStore(fixture.ctx.db);
  const before = await store.getPlan(fixture.companyId, input.request.intakeId);
  const result = await prepareNativeFamily(fixture.ctx, input.binding, input.request, input.controls);
  assert.equal(result.status, "prepared", "native_engine_result_not_prepared");
  const saved = await store.getPlan(fixture.companyId, input.request.intakeId);
  const readiness = await verifyEngineReadiness(fixture, saved, input, plan);
  const descriptions = await verifyEngineNodes(fixture, plan, readiness);
  const effects = await store.listEffects(plan);
  assert.equal(effects.length, plan.expectedEffectKeys.length, "native_engine_effects_incomplete");
  assert.ok(effects.every(effect => effect.state === "observed"), "native_engine_effects_unobserved");
  if (before) assert.deepEqual(saved, before, "native_engine_restart_changed_plan");
  return {
    schema: "linear-intake-native-host-engine.v1", hostSha: fixture.hostSha,
    layer: "synthetic-source-native-ledger-sdk-bridge-and-core-services", replay: Boolean(before),
    issueCount: plan.nodes.length, statuses: plan.nodes.map(node => node.status), descriptions,
    sourceSha256: plan.sourceSha256, planSha256: plan.planSha256, readinessSha256: saved.readinessSha256,
    effectCount: effects.length, dispatchCounts: effects.map(effect => effect.dispatchCount),
    externalBlockerCount: readiness.externalBlockers.length, writes: nativeWriteCounts(fixture),
    sourceVerifications: input.sourceVerifications(), noExecution: await fixture.absenceCounts(),
    admissionAllowed: false, implementationStarted: false, receivingContract: "unqualified",
  };
}

const modes = {
  engine: fixture => observeEngine(fixture),
  "engine-lost-response": fixture => observeUnknown(fixture, "lost_response"),
  "engine-absent-effect": fixture => observeUnknown(fixture, "absent_effect"),
  "replay-nominal": fixture => observeReplay(fixture, "nominal"),
  "replay-lost-response": fixture => observeReplay(fixture, "lost_response"),
  "replay-absent-effect": fixture => observeReplay(fixture, "absent_effect"),
};

function scenario(fixture, resume, mode) {
  if (mode === undefined) return observeNative(fixture, resume);
  return modes[mode](fixture);
}

async function injectCreateFailure(fixture, input, prepareNativeFamily, variant) {
  const create = fixture.ctx.issues.create;
  fixture.ctx.issues.create = async parameters => {
    if (variant === "lost_response") await create(parameters);
    throw new Error("synthetic_create_response_lost");
  };
  try { return await prepareNativeFamily(fixture.ctx, input.binding, input.request, input.controls); }
  finally { fixture.ctx.issues.create = create; }
}

async function verifyRecoveredUnknown(fixture, input, modules, store, plan) {
  const result = await modules.prepareNativeFamily(fixture.ctx, input.binding, input.request, input.controls);
  assert.equal(result.status, "prepared", "native_unknown_recovery_not_prepared");
  const saved = await store.getPlan(fixture.companyId, input.request.intakeId);
  const readiness = await verifyEngineReadiness(fixture, saved, input, plan);
  await verifyEngineNodes(fixture, plan, readiness);
  assert.equal(nativeWriteCounts(fixture)["issues.create"], 4, "native_unknown_recovery_duplicate_create");
  return { status: saved.state, readinessSha256: saved.readinessSha256 };
}

async function verifyFrozenUnknown(fixture, input, modules, store, plan) {
  const result = await modules.prepareNativeFamily(fixture.ctx, input.binding, input.request, input.controls);
  assert.equal(result.status, "outcome_unknown", "native_unknown_absent_not_frozen");
  const effects = await store.listEffects(plan);
  assert.equal(effects.length, 1, "native_unknown_absent_effects_widened");
  assert.equal(effects[0].dispatchCount, 1, "native_unknown_absent_dispatch_rearmed");
  assert.equal(effects[0].state, "outcome_unknown", "native_unknown_absent_effect_not_unknown");
  assert.equal(nativeWriteCounts(fixture)["issues.create"], 0, "native_unknown_absent_create_retried");
  return { status: result.status, readinessSha256: null };
}

async function observeUnknown(fixture, variant) {
  const modules = { ...await import("../../src/import-engine.ts"), ...await import("../../src/import-effects.ts"),
    ...await import("../../src/import-store.ts"), ...await import("../../src/import-plan.ts") };
  const input = await prepareNativeEngineInput(fixture, variant);
  const plan = modules.buildImportPlan(input.binding, input.request, fixture.projectId);
  const store = modules.createImportStore(fixture.ctx.db);
  assert.equal(await store.getPlan(fixture.companyId, input.request.intakeId), undefined, "native_unknown_scenario_already_started");
  const first = await injectCreateFailure(fixture, input, modules.prepareNativeFamily, variant);
  assert.equal(first.status, "outcome_unknown", "native_unknown_not_recorded");
  const beforeWrites = nativeWriteCounts(fixture);
  const reconciled = await modules.reconcileNativeEffects(fixture.ctx, store, plan);
  assert.deepEqual(nativeWriteCounts(fixture), beforeWrites, "native_unknown_reconcile_dispatched_effect");
  const resumed = await store.resumePlan(plan);
  assert.equal(resumed, variant === "lost_response", "native_unknown_resume_guard_failed");
  const final = resumed
    ? await verifyRecoveredUnknown(fixture, input, modules, store, plan)
    : await verifyFrozenUnknown(fixture, input, modules, store, plan);
  const effects = await store.listEffects(plan);
  assert.ok(effects.every(effect => effect.dispatchCount <= 1), "native_unknown_effect_dispatched_twice");
  return {
    schema: "linear-intake-native-host-uncertainty.v1", hostSha: fixture.hostSha, scenario: variant,
    initialStatus: first.status, reconciled, resumed, finalStatus: final.status,
    sourceSha256: plan.sourceSha256, planSha256: plan.planSha256, readinessSha256: final.readinessSha256,
    effectCount: effects.length, dispatchCounts: effects.map(effect => effect.dispatchCount),
    writes: nativeWriteCounts(fixture), noExecution: await fixture.absenceCounts(),
    admissionAllowed: false, implementationStarted: false, receivingContract: "unqualified",
  };
}

function operationFromReceipt(ctx, effect, native) {
  if (effect.kind === "issue") return native.issueOperation(ctx, effect.intent);
  if (effect.kind === "relations") return native.relationOperation(ctx, effect.intent);
  return native.documentOperation(ctx, effect.intent);
}

async function replayEffects(fixture, store, plan, variant, modules) {
  const effects = await store.listEffects(plan);
  const before = structuredClone(effects);
  for (const effect of effects) {
    const found = await operationFromReceipt(fixture.ctx, effect, modules).read();
    if (variant === "absent_effect") assert.equal(found, undefined, "native_replay_unknown_effect_now_present");
    else assert.equal(modules.contentDigest(found), effect.resultSha256, "native_replay_effect_changed");
  }
  assert.deepEqual(await store.listEffects(plan), before, "native_replay_journal_changed");
  return effects;
}

function verifyReplayState(saved, effects, variant) {
  if (variant !== "absent_effect") {
    assert.equal(saved.state, "prepared", "native_replay_plan_not_prepared");
    assert.ok(effects.every(effect => effect.state === "observed"), "native_replay_effect_not_observed");
    return;
  }
  assert.equal(saved.state, "outcome_unknown", "native_replay_unknown_plan_changed");
  assert.equal(saved.readiness, null, "native_replay_unknown_readiness_present");
  assert.equal(effects.length, 1, "native_replay_unknown_effects_widened");
  assert.equal(effects[0].state, "outcome_unknown", "native_replay_unknown_effect_changed");
  assert.equal(effects[0].dispatchCount, 1, "native_replay_unknown_rearmed");
}

async function observeReplay(fixture, variant) {
  const modules = { ...await import("../../src/import-store.ts"), ...await import("../../src/import-plan.ts"),
    ...await import("../../src/import-native.ts"), ...await import("../../src/content-digest.ts") };
  const input = await prepareNativeEngineInput(fixture, variant, true);
  const plan = modules.buildImportPlan(input.binding, input.request, fixture.projectId);
  const store = modules.createImportStore(fixture.ctx.db);
  const saved = await store.getPlan(fixture.companyId, input.request.intakeId);
  assert.equal(saved.planSha256, plan.planSha256, "native_replay_plan_hash_changed");
  const effects = await replayEffects(fixture, store, plan, variant, modules);
  verifyReplayState(saved, effects, variant);
  assert.deepEqual(await store.getPlan(fixture.companyId, input.request.intakeId), saved, "native_replay_plan_changed");
  assert.deepEqual(nativeWriteCounts(fixture), { "issues.create": 0, "issues.documents.upsert": 0,
    "issues.relations.addBlockers": 0 }, "native_replay_write_attempted");
  assert.equal(fixture.calls.filter(call => call.method === "db.execute").length, 0, "native_replay_ledger_write_attempted");
  return { schema: "linear-intake-native-host-readonly-replay.v1", hostSha: fixture.hostSha,
    scenario: variant, state: saved.state, planSha256: saved.planSha256, sourceSha256: saved.sourceSha256,
    readinessSha256: saved.readinessSha256, effectCount: effects.length,
    dispatchCounts: effects.map(effect => effect.dispatchCount), writes: nativeWriteCounts(fixture),
    ledgerWrites: 0, noExecution: await fixture.absenceCounts(), admissionAllowed: false,
    implementationStarted: false, receivingContract: "unqualified" };
}

function argumentsForRun() {
  const args = process.argv.slice(2);
  assert.ok(args.length >= 3 && args.length <= 5, "native_qualification_arguments_invalid");
  const [hostRepo, expectedHostSha, artifactArgument, receiptArgument, mode] = args;
  assert.ok(mode === undefined || Object.hasOwn(modes, mode), "native_qualification_mode_invalid");
  return { hostRepo, expectedHostSha, artifactArgument, receiptArgument, mode };
}

async function hashDirectory(root, directory, suffix) {
  const files = (await readdir(resolve(root, directory))).filter(name => name.endsWith(suffix)).sort();
  const hashes = await Promise.all(files.map(async name => ({
    file: `${directory}/${name}`, sha256: sha256(await readFile(resolve(root, directory, name))),
  })));
  return { sha256: sha256(JSON.stringify(hashes)), files: hashes };
}

async function codeProvenance(hostRepo, expectedHostSha) {
  return {
    schema: "native-import-code-provenance.v1", hostSha: expectedHostSha,
    source: await hashDirectory(repoRoot, "src", ".ts"),
    build: await hashDirectory(repoRoot, "dist", ".js"),
    pluginMigrations: await hashDirectory(repoRoot, "migrations", ".sql"),
    hostMigrations: await hashDirectory(hostRepo, "packages/db/src/migrations", ".sql"),
    fixtureSha256: sha256(await readFile(resolve(repoRoot, "test/native/host-import-fixture.mjs"))),
    qualificationScriptSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    sdkHostBridgeSha256: sha256(await readFile(resolve(repoRoot, "node_modules/@paperclipai/plugin-sdk/dist/host-client-factory.js"))),
  };
}

async function saveObservation(directory, summary, before, after) {
  const provenance = { before, after };
  const result = { ...summary, provenanceSha256: sha256(JSON.stringify(provenance)),
    sourceStableDuringRun: before.source.sha256 === after.source.sha256,
    sourceSha256AtRun: before.source.sha256, buildSha256AtRun: before.build.sha256,
    migrationsSha256AtRun: before.pluginMigrations.sha256, hostMigrationsSha256AtRun: before.hostMigrations.sha256 };
  await writeFile(resolve(directory, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await writeFile(resolve(directory, "summary.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
}

async function main() {
  const { hostRepo, expectedHostSha, artifactArgument, receiptArgument, mode } = argumentsForRun();
  const directory = outputDirectory(artifactArgument);
  await mkdir(directory, { mode: 0o700 });
  let stage = "native_setup";
  let fixture;
  try {
    const before = await codeProvenance(hostRepo, expectedHostSha);
    const resume = receiptArgument ? JSON.parse(await readFile(receiptArgument, "utf8")) : undefined;
    fixture = await createNativeHostFixture({ hostRepo, expectedHostSha, resume });
    const identities = { companyId: fixture.companyId, projectId: fixture.projectId, pluginId: fixture.pluginId };
    await writeFile(resolve(directory, "identity.json"), JSON.stringify(identities) + "\n", { mode: 0o600, flag: "wx" });
    stage = mode ? "native_engine" : "native_primitives";
    const summary = await scenario(fixture, resume, mode);
    await saveObservation(directory, summary, before, await codeProvenance(hostRepo, expectedHostSha));
  } catch (error) {
    const diagnostic = failureCode(error);
    await writeFile(resolve(directory, "failure.json"), JSON.stringify({ status: "fail", stage, diagnostic }) + "\n", { mode: 0o600, flag: "wx" });
    process.stderr.write(`native_host_qualification_failed:${stage}\n`);
    process.exitCode = 1;
  } finally {
    await fixture?.close();
  }
}

function failureCode(error) {
  const firstLine = String(error?.message).split("\n")[0];
  if (/^(native_|host_|lost_create_)[a-z_]+$/.test(firstLine)) return firstLine;
  return fallbackFailureCode(error?.code);
}

function fallbackFailureCode(code) {
  return /^[A-Z0-9_]+$/.test(code) ? code : "upstream_or_assertion_failed";
}

main().catch(() => {
  process.stderr.write("native_host_qualification_failed:setup_or_cleanup\n");
  process.exitCode = 1;
});
