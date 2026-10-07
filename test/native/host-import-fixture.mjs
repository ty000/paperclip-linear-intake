import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createHostClientHandlers, createTestHarness } from "@paperclipai/plugin-sdk";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const capabilities = ["projects.read", "issues.read", "issues.create", "issue.documents.read",
  "issue.documents.write", "issue.relations.read", "issue.relations.write",
  "database.namespace.read", "database.namespace.write", "database.namespace.migrate"];
const manifest = {
  id: "ty000.linear-intake", apiVersion: 1, version: "0.3.0", displayName: "Synthetic native import proof",
  description: "Isolated host service qualification", author: "synthetic", categories: ["connector"],
  capabilities, entrypoints: { worker: "./dist/worker.js" },
  database: { namespaceSlug: "linear_intake", migrationsDir: "migrations", coreReadTables: [] },
};

function validateNativeUrl(value) {
  assert.equal(typeof value, "string", "native_database_url_required");
  const url = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "native_database_protocol_invalid");
  assert.equal(url.hostname, "127.0.0.1", "native_database_host_invalid");
  assert.equal(url.username, "intake_test", "native_database_user_invalid");
  assert.equal(url.pathname, "/intake_native_test", "native_database_name_invalid");
  assert.equal(url.search + url.hash, "", "native_database_overrides_forbidden");
  assert.ok(Number(url.port) >= 1024, "native_database_port_invalid");
  assert.ok(![3210, 5432, 54329, 54339].includes(Number(url.port)), "native_database_port_reserved");
  return url;
}

async function nativeConnection() {
  const value = process.env.INTAKE_NATIVE_TEST_DATABASE_URL;
  const url = validateNativeUrl(value);
  const receiptPath = resolve(repoRoot, "artifacts/postgres-lot3/instance.json");
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600, "native_receipt_permissions_invalid");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.ok(receipt.nativeDatabaseUrl === value, "native_database_receipt_mismatch");
  return { value, url };
}

async function assertDatabaseIdentity(pool, url) {
  const { rows: [row] } = await pool.query(`SELECT current_user AS username, current_database() AS database,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_setting('data_directory') AS data_directory`);
  assert.equal(row.username, "intake_test", "native_connected_user_mismatch");
  assert.equal(row.database, "intake_native_test", "native_connected_database_mismatch");
  assert.equal(row.address, "127.0.0.1", "native_connected_address_mismatch");
  assert.equal(row.port, Number(url.port), "native_connected_port_mismatch");
  const dataDir = await realpath(resolve(repoRoot, "artifacts/postgres-lot3/data"));
  assert.equal(await realpath(row.data_directory), dataDir, "native_connected_directory_mismatch");
  return { database: row.database, user: row.username, loopback: true, dataDirectoryMatched: true };
}

async function assertEmptyDatabase(pool) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`);
  assert.equal(result.rows[0].count, 0, "native_database_must_be_empty_no_implicit_reset");
}

function isolateHostEnvironment() {
  process.env.NODE_ENV = "production";
  process.env.PAPERCLIP_LOG_LEVEL = "silent";
  process.env.PAPERCLIP_HOME = resolve(repoRoot, "artifacts/native-host-home");
  process.env.PAPERCLIP_INSTANCE_ID = "lot3-native-proof";
  process.env.PAPERCLIP_DISABLE_PLUGIN_AUTOBUILD = "1";
  process.env.PAPERCLIP_IN_WORKTREE = "1";
  process.env.RUN_LOG_BASE_PATH = resolve(repoRoot, "artifacts/native-host-home/run-logs");
  delete process.env.RUN_LOG_S3_BUCKET;
  delete process.env.DATABASE_URL;
}

async function loadHost(hostRepo, expectedHostSha) {
  assert.match(expectedHostSha, /^[a-f0-9]{40}$/, "host_sha_required");
  const hostSha = execFileSync("git", ["-C", hostRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(hostSha, expectedHostSha, "host_sha_mismatch");
  const load = path => import(pathToFileURL(resolve(hostRepo, path)).href);
  const db = await load("packages/db/src/index.ts");
  const services = await load("server/src/services/plugin-host-services.ts");
  const events = await load("server/src/services/plugin-event-bus.ts");
  const activity = await load("server/src/services/activity-log.ts");
  const database = await load("server/src/services/plugin-database.ts");
  return { db, services, events, activity, database, hostSha };
}

async function seedNativeEntities(db, schema) {
  const companyId = randomUUID();
  const projectId = randomUUID();
  const pluginId = randomUUID();
  await db.insert(schema.companies).values({ id: companyId, name: "Synthetic Lot3 company", issuePrefix: "L3X" });
  await db.insert(schema.projects).values({ id: projectId, companyId, name: "Synthetic import destination" });
  await db.insert(schema.plugins).values({ id: pluginId, pluginKey: manifest.id,
    packageName: "paperclip-linear-intake", version: manifest.version, manifestJson: manifest,
    status: "disabled", categories: ["connector"] });
  return { companyId, projectId, pluginId };
}

function issueClients(call) {
  return {
    list: input => call("issues.list", input),
    get: (issueId, companyId) => call("issues.get", { issueId, companyId }),
    create: input => call("issues.create", input),
    documents: {
      get: (issueId, key, companyId) => call("issues.documents.get", { issueId, key, companyId }),
      upsert: input => call("issues.documents.upsert", input),
    },
    relations: {
      get: (issueId, companyId) => call("issues.relations.get", { issueId, companyId }),
      addBlockers: (issueId, blockerIssueIds, companyId) => call("issues.relations.addBlockers",
        { issueId, blockerIssueIds, companyId }),
    },
  };
}

function nativeContext(services, ids, namespace) {
  const harness = createTestHarness({ manifest });
  const handlers = createHostClientHandlers({ pluginId: ids.pluginId, capabilities, services });
  const calls = [];
  const scope = { invocationScope: { companyId: ids.companyId } };
  const call = async (method, params) => {
    calls.push({ method });
    return handlers[method](params, scope);
  };
  Object.assign(harness.ctx.issues, issueClients(call));
  harness.ctx.projects.get = (projectId, companyId) => call("projects.get", { projectId, companyId });
  harness.ctx.db = {
    namespace,
    query: (sql, params = []) => call("db.query", { sql, params }),
    execute: (sql, params = []) => call("db.execute", { sql, params }),
  };
  return { ctx: harness.ctx, harness, calls, call };
}

async function absenceCounts(pool) {
  const { rows: [counts] } = await pool.query(`SELECT
    (SELECT count(*)::int FROM agents) AS agents,
    (SELECT count(*)::int FROM heartbeat_runs) AS heartbeat_runs,
    (SELECT count(*)::int FROM agent_wakeup_requests) AS agent_wakeup_requests`);
  assert.deepEqual(counts, { agents: 0, heartbeat_runs: 0, agent_wakeup_requests: 0 }, "native_execution_absence_failed");
  return counts;
}

async function recoverNativeEntities(pool, ids) {
  for (const value of Object.values(ids)) assert.match(value, /^[a-f0-9-]{36}$/, "native_recovery_identity_invalid");
  const { rows } = await pool.query(`SELECT c.id AS company_id, p.id AS project_id, x.id AS plugin_id
    FROM companies c JOIN projects p ON p.company_id = c.id CROSS JOIN plugins x
    WHERE c.id = $1 AND p.id = $2 AND x.id = $3 AND c.issue_prefix = 'L3X'
      AND x.plugin_key = 'ty000.linear-intake'`, [ids.companyId, ids.projectId, ids.pluginId]);
  assert.equal(rows.length, 1, "native_recovery_identity_mismatch");
  return ids;
}

async function prepareCoreDatabase(host, connection, resume) {
  if (!resume) await host.db.applyPendingMigrations(connection.value);
  const migrations = await host.db.inspectMigrations(connection.value);
  assert.equal(migrations.status, "upToDate", "native_core_migrations_incomplete");
  return host.db.createDb(connection.value);
}

async function initialiseNative({ hostRepo, expectedHostSha, resume }, connection, pool, resources) {
  const identity = await assertDatabaseIdentity(pool, connection.url);
  if (!resume) await assertEmptyDatabase(pool);
  isolateHostEnvironment();
  const host = await loadHost(hostRepo, expectedHostSha);
  resources.host = host;
  const db = await prepareCoreDatabase(host, connection, resume);
  const ids = resume ? await recoverNativeEntities(pool, resume) : await seedNativeEntities(db, host.db);
  const bus = host.events.createPluginEventBus();
  host.activity.setPluginEventBus(bus);
  const services = host.services.buildHostServices(db, ids.pluginId, manifest.id, bus, undefined,
    { manifest, heartbeatRuntimeEnv: { PAPERCLIP_IN_WORKTREE: "1" } });
  const namespace = host.database.derivePluginDatabaseNamespace(manifest.id, manifest.database.namespaceSlug);
  const adapter = nativeContext(services, ids, namespace);
  const baseline = await absenceCounts(pool);
  return {
    ...adapter, ...ids, identity, baseline, hostSha: host.hostSha, pool,
    applyPluginMigrations: () => host.database.pluginDatabaseService(db).applyMigrations(ids.pluginId, manifest, repoRoot),
    absenceCounts: () => absenceCounts(pool),
    async close() {
      services.dispose();
      await host.services.flushPluginLogBuffer();
      await host.db.closeRegisteredClients(connection.value);
      await pool.end();
    },
  };
}

// Native services run in this process only. There is no host HTTP server,
// worker loader, scheduler, agent or provider. The supplied DB must be fresh.
export async function createNativeHostFixture(options) {
  const connection = await nativeConnection();
  const pool = new Pool({ connectionString: connection.value, max: 4 });
  const resources = {};
  try {
    return await initialiseNative(options, connection, pool, resources);
  } catch (error) {
    await resources.host?.db.closeRegisteredClients(connection.value);
    await pool.end();
    throw error;
  }
}

function syntheticAuthority(ids) {
  return {
    organizationId: ids.organization, teamId: ids.team, projectId: ids.project, todoStateId: ids.todo,
    webhookId: randomUUID(), activationAt: "2026-10-07T11:00:00.000Z",
    allowedActors: [{ id: randomUUID(), type: "user" }],
  };
}

function syntheticEvent(authority, family, digest) {
  const timestamp = "2026-10-07T12:00:00.000Z";
  return {
    classification: "received", providerDeliveryId: family.rootIssueId,
    sourceEventId: digest({ issueId: family.rootIssueId, sourceSha256: family.sourceSha256 }),
    rawBodySha256: digest({ source: family.sourceSha256 }), webhookTimestamp: Date.parse(timestamp), receivedAt: timestamp,
    organizationId: authority.organizationId, webhookId: authority.webhookId, issueId: family.rootIssueId,
    action: "update", eventAt: timestamp, revision: timestamp, teamId: authority.teamId,
    projectId: authority.projectId, stateId: authority.todoStateId, archivedAt: null,
    actor: authority.allowedActors[0], previous: { stateId: randomUUID() },
    sourceScopeWasAuthorized: true, currentScopeMatches: true,
  };
}

async function retainSyntheticSnapshot(fixture, source, ids, modules, readOnly) {
  const observed = await modules.readSourceFamily(source.harness.ctx, ids.company, ids.root);
  const family = observed.family;
  const store = modules.createIntakeStore(fixture.ctx.db);
  if (readOnly) return existingSyntheticSnapshot(fixture, store, family, modules);
  const binding = await syntheticBinding(fixture, store, ids, modules);
  const intakeId = modules.intakeIdentity(fixture.companyId, family.organizationId, family.rootIssueId);
  const previous = await store.getRequest(fixture.companyId, intakeId);
  if (previous) return recoverSyntheticSnapshot(store, binding, family, previous);
  return retainNewSnapshot(fixture, store, binding, family, modules);
}

async function existingSyntheticSnapshot(fixture, store, family, modules) {
  const binding = await store.getBinding(fixture.companyId);
  assert.ok(binding, "native_fixture_readonly_binding_missing");
  const intakeId = modules.intakeIdentity(fixture.companyId, family.organizationId, family.rootIssueId);
  const request = await store.getRequest(fixture.companyId, intakeId);
  assert.ok(request, "native_fixture_readonly_request_missing");
  return recoverSyntheticSnapshot(store, binding, family, request);
}

async function syntheticBinding(fixture, store, ids, modules) {
  const previous = await store.getBinding(fixture.companyId);
  if (previous) return previous;
  const authority = syntheticAuthority(ids);
  return store.activateBinding({ companyId: fixture.companyId, activationId: randomUUID(),
    activatedAt: authority.activationAt, fingerprint: modules.contentDigest({ authority, target: fixture.projectId }), authority });
}

async function retainNewSnapshot(fixture, store, binding, family, modules) {
  const event = syntheticEvent(binding.authority, family, modules.contentDigest);
  const retained = await store.retainDelivery(fixture.companyId, binding.activationId, event);
  assert.equal(retained.status, "received", "native_fixture_request_not_retained");
  const claimInput = { companyId: fixture.companyId, activationId: binding.activationId,
    intakeId: retained.intakeId, fingerprint: binding.fingerprint, owner: "native-import-proof",
    now: "2026-10-07T12:01:00.000Z", leaseMs: 60_000, maxAttempts: 1 };
  const claimed = await store.claimRequest(claimInput);
  assert.ok(claimed, "native_fixture_request_not_claimed");
  assert.equal(await store.finishRequest({ ...claimInput, revision: claimed.version, status: "source_observed",
    snapshot: family, snapshotSha256: family.sourceSha256 }), true, "native_fixture_snapshot_not_retained");
  const request = await store.getRequest(fixture.companyId, retained.intakeId);
  return { store, binding, request, family };
}

function recoverSyntheticSnapshot(store, binding, family, request) {
  assert.equal(binding.active, true, "native_fixture_binding_inactive");
  assert.equal(request.status, "source_observed", "native_fixture_request_not_observed");
  assert.equal(request.snapshotSha256, family.sourceSha256, "native_fixture_retained_source_changed");
  return { store, binding, request, family };
}

function sourceVariant(fixture, ids, variant) {
  if (variant === "nominal") return ids;
  const variants = { lost_response: ["21000000", "LOST-"], absent_effect: ["22000000", "ABSENT-"] };
  assert.ok(Object.hasOwn(variants, variant), "native_fixture_variant_invalid");
  const [prefix, reference] = variants[variant];
  const rewrite = value => value.replaceAll("20000000", prefix).replaceAll("SYN-", reference);
  fixture.issues = new Map([...fixture.issues.values()].map(issue => {
    const mapped = JSON.parse(rewrite(JSON.stringify(issue)));
    return [mapped.uuid, mapped];
  }));
  fixture.config.sourceReader.qualificationRootIssueIds = fixture.config.sourceReader.qualificationRootIssueIds.map(rewrite);
  return { ...ids, root: rewrite(ids.root) };
}

async function syntheticSource(variant) {
  const { sourceFixture, sourceIds } = await import("../helpers/source-fixture.mjs");
  let ids;
  const source = await sourceFixture({ prepare(fixture) {
    fixture.issues.delete(sourceIds.grandchild);
    fixture.issues.get(sourceIds.child).relations.blocks = [];
    fixture.issues.get(sourceIds.root).description = "Complete synthetic engine source. ".repeat(1000);
    ids = sourceVariant(fixture, sourceIds, variant);
  } });
  return { source, ids };
}

function retainedControls(fixture, retained, verifySource) {
  return {
    targetProjectId: fixture.projectId, verifySource,
    async guard() {
      const currentBinding = await retained.store.getBinding(fixture.companyId);
      const currentRequest = await retained.store.getRequest(fixture.companyId, retained.request.intakeId);
      assert.deepEqual(currentBinding, retained.binding, "native_fixture_binding_changed");
      assert.deepEqual(currentRequest, retained.request, "native_fixture_request_changed");
    },
  };
}

// Explicitly synthetic webhook/source layer. Persistence and import effects
// use the real native SDK bridge; this does not qualify a Linear provider.
export async function prepareNativeEngineInput(fixture, variant = "nominal", readOnly = false) {
  if (!readOnly) await fixture.applyPluginMigrations();
  const { source, ids } = await syntheticSource(variant);
  const modules = {
    ...await import("../../src/intake-store.ts"),
    ...await import("../../src/source-family.ts"),
    ...await import("../../src/content-digest.ts"),
    ...await import("../../src/intake-state.ts"),
  };
  const retained = await retainSyntheticSnapshot(fixture, source, ids, modules, readOnly);
  let sourceVerifications = 0;
  const controls = retainedControls(fixture, retained, async () => {
    const current = await modules.readSourceFamily(source.harness.ctx, ids.company, ids.root);
    assert.equal(current.family.sourceSha256, retained.family.sourceSha256, "native_fixture_source_changed");
    sourceVerifications++;
  });
  return { ...retained, controls, sourceVerifications: () => sourceVerifications };
}
