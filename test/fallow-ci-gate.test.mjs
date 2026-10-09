import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { evaluateAudit } from "../scripts/fallow-ci-gate.mjs";

const base = "a".repeat(40), head = "b".repeat(40);
const deadCodeLists = ["unused_files", "unused_exports", "unused_types", "private_type_leaks", "unused_dependencies",
  "unused_dev_dependencies", "unused_optional_dependencies", "unused_enum_members", "unused_class_members", "unresolved_imports",
  "unlisted_dependencies", "duplicate_exports", "type_only_dependencies", "test_only_dependencies", "dev_dependencies_in_production",
  "circular_dependencies", "re_export_cycles", "boundary_violations", "boundary_coverage_violations", "boundary_call_violations",
  "policy_violations", "stale_suppressions", "unused_catalog_entries", "empty_catalog_groups", "unresolved_catalog_references",
  "unused_dependency_overrides", "misconfigured_dependency_overrides", "invalid_client_exports", "mixed_client_server_barrels",
  "misplaced_directives", "route_collisions", "dynamic_segment_name_conflicts"];
function report() {
  return { kind: "audit", schema_version: 10, version: "3.23.0", command: "audit", verdict: "fail",
    changed_files_count: 1, base_ref: base, head_sha: head.slice(0, 7), elapsed_ms: 1,
    summary: { dead_code_issues: 0, dead_code_has_errors: false, complexity_findings: 2, max_cyclomatic: 12, duplication_clone_groups: 0 },
    attribution: { gate: "new-only", dead_code_introduced: 0, dead_code_inherited: 0, complexity_introduced: 1,
      complexity_inherited: 1, duplication_introduced: 0, duplication_inherited: 0, styling_introduced: 0, styling_inherited: 0, duplication_demoted: 0 },
    dead_code: { schema_version: 9, version: "3.23.0", elapsed_ms: 1, total_issues: 0, entry_points: {}, summary: {},
      ...Object.fromEntries(deadCodeLists.map(key => [key, []])) }, duplication: { clone_groups: [] },
    complexity: { findings: [{ path: "src/new.ts", name: "bounded", introduced: true, severity: "moderate", exceeded: "crap", coverage_source: "estimated", coverage_tier: "none" },
      { path: "src/old.ts", name: "inherited", introduced: false, severity: "critical", exceeded: "crap" }] }, next_steps: [], _meta: {} };
}
const evaluate = value => evaluateAudit(value, 1, base, head);

test("retains moderate CRAP warnings and native failure without changing the report", () => {
  const value = report(), before = structuredClone(value), result = evaluate(value);
  assert.equal(result.status, "warn"); assert.equal(result.nativeExitCode, 1); assert.equal(result.nativeVerdict, "fail");
  assert.equal(result.introducedComplexity.length, 1); assert.deepEqual(value, before);
});
for (const severity of ["high", "critical"]) test(`blocks introduced ${severity} complexity`, () => {
  const value = report(); value.complexity.findings[0].severity = severity; assert.equal(evaluate(value).status, "fail");
});
test("does not exempt moderate cyclomatic findings", () => {
  const value = report(); value.complexity.findings[0].exceeded = "cyclomatic"; assert.equal(evaluate(value).status, "fail");
});
for (const [field, value] of [["coverage_source", "istanbul"], ["coverage_tier", "partial"], ["coverage_source", undefined]]) test(`does not exempt ${field}=${value}`, () => {
  const audit = report(); audit.complexity.findings[0][field] = value; assert.equal(evaluate(audit).status, "fail");
});
for (const kind of ["unresolved_imports", "circular_dependencies", "unused_dependencies", "boundary_violations"]) test(`blocks ${kind}`, () => {
  const value = report(); value.attribution.dead_code_introduced = 1; value.summary.dead_code_issues = 1;
  value.dead_code.total_issues = 1; value.dead_code[kind].push({ introduced: true }); assert.equal(evaluate(value).status, "fail");
});
test("nonempty import findings cannot hide behind zero counters", () => {
  const value = report(); value.dead_code.unresolved_imports.push({ introduced: true });
  assert.equal(evaluate(value).status, "fail");
});
test("dead-code errors without counts still prevent the exception", () => {
  const value = report(); value.summary.dead_code_has_errors = true; assert.equal(evaluate(value).status, "fail");
});
test("an inherited dead-code finding conservatively retains native failure", () => {
  const value = report(); value.dead_code.unresolved_imports.push({ introduced: false });
  value.dead_code.total_issues = 1; value.summary.dead_code_issues = 1; value.attribution.dead_code_inherited = 1;
  assert.equal(evaluate(value).status, "fail");
});
test("blocks introduced duplication", () => {
  const value = report(); value.attribution.duplication_introduced = 1; value.summary.duplication_clone_groups = 1;
  value.duplication.clone_groups.push({ introduced: true }); assert.equal(evaluate(value).status, "fail");
});
for (const key of ["styling_introduced", "duplication_demoted"]) test(`retains blocking ${key}`, () => {
  const value = report(); value.attribution[key] = 1; assert.equal(evaluate(value).status, "fail");
});
const invalid = {
  "missing attribution": value => { delete value.attribution; },
  "new attribution field": value => { value.attribution.security_introduced = 0; },
  "missing import findings": value => { delete value.dead_code.unresolved_imports; },
  "missing cycle findings": value => { delete value.dead_code.circular_dependencies; },
  "new dead-code field": value => { value.dead_code.new_findings = []; },
  "missing summary": value => { delete value.summary.dead_code_issues; },
  "missing count": value => { delete value.attribution.dead_code_introduced; },
  "inconsistent count": value => { value.attribution.complexity_introduced = 0; },
  "negative count": value => { value.attribution.dead_code_introduced = -1; },
  "unknown severity": value => { value.complexity.findings[0].severity = "unknown"; },
  "missing introduced flag": value => { delete value.complexity.findings[0].introduced; },
  "new report field": value => { value.security = {}; },
  "unsupported schema": value => { value.schema_version = 11; },
  "unsupported version": value => { value.version = "3.24.0"; },
  "different base": value => { value.base_ref = head; },
  "different candidate": value => { value.head_sha = base.slice(0, 7); },
};
for (const [name, mutate] of Object.entries(invalid)) test(`fails closed on ${name}`, () => {
  const value = report(); mutate(value); assert.throws(() => evaluate(value));
});
test("tool errors cannot reuse a valid old report", () => assert.throws(() => evaluateAudit(report(), 2, base, head)));
test("preserves an unexplained native failure", () => {
  const value = report(); value.complexity.findings.shift(); value.attribution.complexity_introduced = 0;
  value.summary.complexity_findings = 1; assert.equal(evaluate(value).status, "fail");
});
test("accepts an ordinary clean native audit", () => {
  const value = report(); value.complexity.findings.shift(); value.attribution.complexity_introduced = 0;
  value.summary.complexity_findings = 1; value.verdict = "pass";
  assert.equal(evaluateAudit(value, 0, base, head).status, "pass");
});
test("keeps unrelated native warnings without defining another severity policy", () => {
  const value = report(); value.verdict = "warn"; value.attribution.styling_introduced = 1;
  assert.equal(evaluateAudit(value, 0, base, head).status, "warn");
});
test("CLI blocks malformed JSON and saves an interpretable failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "fallow-gate-"));
  try {
    const file = join(directory, "audit.json"); writeFileSync(file, "{invalid");
    const result = spawnSync(process.execPath, [new URL("../scripts/fallow-ci-gate.mjs", import.meta.url).pathname, file, "1", base, head], { encoding: "utf8" });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, "fail");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
