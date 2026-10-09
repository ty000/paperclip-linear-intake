import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const attributionKeys = ["gate", "dead_code_introduced", "dead_code_inherited", "complexity_introduced", "complexity_inherited",
  "duplication_introduced", "duplication_inherited", "styling_introduced", "styling_inherited", "duplication_demoted"];
const reportKeys = ["kind", "schema_version", "version", "command", "verdict", "changed_files_count", "base_ref", "head_sha",
  "elapsed_ms", "summary", "attribution", "dead_code", "duplication", "complexity", "next_steps", "_meta"];
const deadCodeLists = ["unused_files", "unused_exports", "unused_types", "private_type_leaks", "unused_dependencies",
  "unused_dev_dependencies", "unused_optional_dependencies", "unused_enum_members", "unused_class_members", "unresolved_imports",
  "unlisted_dependencies", "duplicate_exports", "type_only_dependencies", "test_only_dependencies", "dev_dependencies_in_production",
  "circular_dependencies", "re_export_cycles", "boundary_violations", "boundary_coverage_violations", "boundary_call_violations",
  "policy_violations", "stale_suppressions", "unused_catalog_entries", "empty_catalog_groups", "unresolved_catalog_references",
  "unused_dependency_overrides", "misconfigured_dependency_overrides", "invalid_client_exports", "mixed_client_server_barrels",
  "misplaced_directives", "route_collisions", "dynamic_segment_name_conflicts"];
const severities = new Set(["moderate", "high", "critical"]);
const thresholds = new Set(["cyclomatic", "cognitive", "both", "crap", "cyclomatic_crap", "cognitive_crap", "all"]);
const require = (condition, reason) => { if (!condition) throw new Error(reason); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

function exactKeys(value, keys, reason) {
  require(record(value), reason);
  require(Object.keys(value).sort().join("|") === [...keys].sort().join("|"), reason);
}

function validateIdentity(report, nativeExitCode, base, head) {
  require([0, 1].includes(nativeExitCode), "Fallow did not finish normally");
  exactKeys(report, reportKeys, "Unknown or incomplete Fallow report");
  require(report.kind === "audit" && report.command === "audit", "Expected a native audit report");
  require(report.version === "3.23.0" && report.schema_version === 10, "Unsupported Fallow version or schema");
  require([base, head].every(value => /^[a-f0-9]{40}$/.test(value)), "Exact base and candidate SHAs required");
  require(report.base_ref === base && /^[a-f0-9]{7,40}$/.test(report.head_sha), "Audit identity mismatch");
  require(head.startsWith(report.head_sha), "Audit candidate mismatch");
  require(["pass", "warn", "fail"].includes(report.verdict), "Unknown native verdict");
  require((nativeExitCode === 1) === (report.verdict === "fail"), "Native exit and verdict disagree");
}

function validateAttribution(report) {
  const attribution = report.attribution;
  exactKeys(attribution, attributionKeys, "Unknown or incomplete finding attribution");
  require(attribution.gate === "new-only", "Only a new-only audit can use this gate");
  require(attributionKeys.filter(key => key !== "gate").every(key => integer(attribution[key])), "Invalid attribution counts");
  const findings = report.complexity?.findings;
  require(Array.isArray(findings), "Missing complexity findings");
  require(findings.every(item => record(item) && typeof item.introduced === "boolean"
    && severities.has(item.severity) && thresholds.has(item.exceeded)), "Unknown complexity classification");
  const introduced = findings.filter(item => item.introduced);
  require(introduced.length === attribution.complexity_introduced, "Introduced complexity count mismatch");
  require(findings.length === introduced.length + attribution.complexity_inherited, "Inherited complexity count mismatch");
  return introduced;
}

function validateCounts(report) {
  const a = report.attribution, summary = report.summary;
  exactKeys(summary, ["dead_code_issues", "dead_code_has_errors", "complexity_findings", "max_cyclomatic", "duplication_clone_groups"], "Incomplete audit summary");
  exactKeys(report.dead_code, ["schema_version", "version", "elapsed_ms", "total_issues", "entry_points", "summary", ...deadCodeLists], "Incomplete dead-code report");
  require(deadCodeLists.every(key => Array.isArray(report.dead_code[key])), "Missing dead-code findings");
  require(report.dead_code.schema_version === 9 && report.dead_code.version === "3.23.0", "Unknown dead-code schema");
  require(summary.dead_code_issues === a.dead_code_introduced + a.dead_code_inherited, "Dead-code count mismatch");
  require(report.dead_code.total_issues === summary.dead_code_issues, "Dead-code detail mismatch");
  require(typeof summary.dead_code_has_errors === "boolean", "Missing dead-code error status");
  require(summary.complexity_findings === report.complexity.findings.length, "Complexity summary mismatch");
  require(Array.isArray(report.duplication?.clone_groups), "Missing duplication findings");
  require(summary.duplication_clone_groups === report.duplication.clone_groups.length, "Duplication detail mismatch");
  require(summary.duplication_clone_groups === a.duplication_introduced + a.duplication_inherited, "Duplication count mismatch");
}

function deadCodeClear(report) {
  return report.summary.dead_code_issues === 0 && report.summary.dead_code_has_errors === false
    && deadCodeLists.every(key => report.dead_code[key].length === 0);
}

/** Preserve native failures except the precisely identified moderate CRAP advisory. */
export function evaluateAudit(report, nativeExitCode, base, head) {
  validateIdentity(report, nativeExitCode, base, head);
  const introduced = validateAttribution(report);
  validateCounts(report);
  const result = { nativeExitCode, nativeVerdict: report.verdict, base, head, introducedComplexity: introduced };
  if (nativeExitCode === 0) return { ...result, status: report.verdict, reason: "Native verdict retained" };
  if (!deadCodeClear(report)) return { ...result, status: "fail", reason: "Dead-code findings or errors prevent the CRAP exception" };
  const otherIntroduced = ["dead_code_introduced", "duplication_introduced", "styling_introduced", "duplication_demoted"];
  if (otherIntroduced.some(key => report.attribution[key] !== 0)) {
    return { ...result, status: "fail", reason: "Other introduced findings remain blocking" };
  }
  if (introduced.some(item => item.severity !== "moderate" || item.exceeded !== "crap"
    || item.coverage_source !== "estimated" || item.coverage_tier !== "none")) {
    return { ...result, status: "fail", reason: "Introduced complexity exceeds the moderate CRAP exception" };
  }
  if (introduced.length) return { ...result, status: "warn", reason: "Moderate CRAP findings retained as advisory; native report unchanged" };
  return { ...result, status: report.verdict, reason: "Native verdict retained" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    require(process.argv.length === 6, "Usage: fallow-ci-gate.mjs report.json native-exit-code base-sha head-sha");
    const [, , file, code, base, head] = process.argv;
    require(/^[0-9]+$/.test(code), "Invalid native exit code");
    result = evaluateAudit(JSON.parse(readFileSync(file, "utf8")), Number(code), base, head);
  } catch (error) { result = { status: "fail", reason: error.message }; }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "warn") process.stderr.write(`Fallow CI warning: ${result.reason} (${result.introducedComplexity.length} introduced findings).\n`);
  process.exitCode = result.status === "fail" ? 1 : 0;
}
