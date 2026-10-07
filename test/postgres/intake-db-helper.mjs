import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { INTAKE_DATABASE_NAMESPACE } from "../../dist/intake-state.js";

function requireIsolatedIdentity(url) {
  if (!["localhost", "127.0.0.1", "[::1]", "postgres"].includes(url.hostname)) throw new Error("isolated PostgreSQL host required");
  if (url.username !== "intake_test" || url.pathname !== "/intake_test") {
    throw new Error("dedicated intake_test PostgreSQL user and database required");
  }
}

function rejectConnectionOverrides(url) {
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash) {
    throw new Error("isolated PostgreSQL URL must not contain connection overrides");
  }
}

function isolatedConnectionString() {
  const connectionString = process.env.INTAKE_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("INTAKE_TEST_DATABASE_URL is required for isolated PostgreSQL tests");
  const url = new URL(connectionString);
  requireIsolatedIdentity(url);
  rejectConnectionOverrides(url);
  return connectionString;
}

async function applyMigration(pool) {
  const directory = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const migrations = await Promise.all(names.map(name => readFile(new URL(name, directory), "utf8")));
  const statements = migrations.join('\n').split(";").map(part => part.trim()).filter(Boolean);
  await pool.query(`DROP SCHEMA IF EXISTS ${INTAKE_DATABASE_NAMESPACE} CASCADE`);
  await pool.query(`CREATE SCHEMA ${INTAKE_DATABASE_NAMESPACE}`);
  for (const statement of statements) await pool.query(statement);
  return statements;
}

function nativeDatabaseAdapter(pool, calls) {
  return {
    namespace: INTAKE_DATABASE_NAMESPACE,
    async query(sql, params = []) {
      if (!/^\s*SELECT\s/i.test(sql)) throw new Error("test adapter requires native SELECT query contract");
      calls.push({ operation: "query", sql });
      return (await pool.query(sql, params)).rows;
    },
    async execute(sql, params = []) {
      if (!/^\s*(INSERT INTO|UPDATE|DELETE FROM)\s/i.test(sql) || /;|\bRETURNING\b/i.test(sql)) {
        throw new Error("test adapter requires native single DML rowCount contract");
      }
      calls.push({ operation: "execute", sql });
      const result = await pool.query(sql, params);
      return { rowCount: result.rowCount ?? 0 };
    },
  };
}

export async function isolatedDatabase() {
  const pool = new Pool({ connectionString: isolatedConnectionString(), max: 8 });
  const statements = await applyMigration(pool);
  const calls = [];
  return {
    db: nativeDatabaseAdapter(pool, calls), calls, statements, pool,
    async reset() {
      calls.length = 0;
      await pool.query(`TRUNCATE ${INTAKE_DATABASE_NAMESPACE}.intake_deliveries,
        ${INTAKE_DATABASE_NAMESPACE}.intake_requests, ${INTAKE_DATABASE_NAMESPACE}.intake_binding,
        ${INTAKE_DATABASE_NAMESPACE}.import_plans, ${INTAKE_DATABASE_NAMESPACE}.import_effects,
        ${INTAKE_DATABASE_NAMESPACE}.import_plan_effects`);
    },
    close: () => pool.end(),
  };
}

export function interrupted(db, writeNumber, afterEffect) {
  let writes = 0;
  return {
    ...db,
    async execute(sql, params) {
      writes++;
      if (writes !== writeNumber) return db.execute(sql, params);
      if (afterEffect) await db.execute(sql, params);
      throw new Error("synthetic_worker_interrupted");
    },
  };
}
