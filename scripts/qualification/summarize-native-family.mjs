// Portable read-only redaction; no host imports, credentials, network or writes.
// Usage: node scripts/qualification/summarize-native-family.mjs <workspace.json> <family.json> [family.json ...]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const sum = values => values.reduce((total, value) => total + value, 0);

function requireValue(condition) {
  if (!condition) throw new Error();
}

function object(value) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}

function array(value) {
  requireValue(Array.isArray(value));
  return value;
}

function requireUuid(value) {
  requireValue(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function requireDigest(value) {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}

function requireReference(value) {
  requireValue(typeof value === 'string' && value.length > 0);
}

// Independently replay the runtime's key ordering without importing its build.
// JSON's replacer walks nested values and preserves array order for us.
function orderedObject(_key, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function actionData(raw, status) {
  const data = object(object(raw).data);
  requireValue(data.status === status);
  requireValue(data.intakeEnabled === false);
  return data;
}

function managedPayload(raw) {
  const outer = object(raw);
  requireValue(outer.isError === false);
  const inner = object(outer.structuredContent);
  requireValue(inner.isError === false);
  requireValue(inner.structuredContent === null);
  const content = array(inner.content);
  requireValue(content.length === 1);
  const text = object(content[0]);
  requireValue(text.type === 'text');
  requireValue(typeof text.text === 'string');
  return JSON.parse(text.text);
}

function workspacePayload(raw) {
  const data = actionData(raw, 'source_probe_observed');
  const matches = array(data.observations).filter(item => object(item).role === 'getWorkspace');
  requireValue(matches.length === 1);
  const workspace = object(managedPayload(matches[0].result));
  requireUuid(workspace.id);
  return workspace;
}

function verifyFamilyDigest(family) {
  requireValue(family.schema === 'linear-source-family.v1');
  const { sourceSha256, ...snapshot } = family;
  requireDigest(sourceSha256);
  requireDigest(family.catalogSha256);
  requireValue(hash(JSON.stringify(snapshot, orderedObject)) === sourceSha256);
}

function validateIssue(raw) {
  const issue = object(raw);
  requireUuid(issue.uuid);
  requireReference(issue.id);
  requireValue(issue.description === null || typeof issue.description === 'string');
  const relations = object(issue.relations);
  array(relations.blockedBy).forEach(reference => requireReference(object(reference).id));
  return issue;
}

function familyIssues(family) {
  const issues = array(family.issues).map(validateIssue);
  requireValue(issues.length > 0);
  requireValue(new Set(issues.map(issue => issue.uuid)).size === issues.length);
  requireUuid(family.rootIssueId);
  requireValue(issues.some(issue => issue.uuid === family.rootIssueId));
  return issues;
}

function descriptionSummary(issue) {
  if (issue.description === null) return { characters: null, sha256: null };
  return { characters: issue.description.length, sha256: hash(issue.description) };
}

function internalCount(issue, references) {
  return issue.relations.blockedBy.filter(reference => references.has(reference.id)).length;
}

function blockerCounts(family, issues) {
  const references = new Set(issues.flatMap(issue => [issue.id, issue.uuid]));
  const internal = sum(issues.map(issue => internalCount(issue, references)));
  const total = sum(issues.map(issue => issue.relations.blockedBy.length));
  const external = array(family.externalBlockers).length;
  requireValue(total - internal === external);
  return { internalBlockerCount: internal, externalBlockerCount: external };
}

function inventoryCounts(family, issues) {
  const rows = array(family.childInventory);
  requireValue(rows.length === issues.length);
  const childrenPerParent = rows.map(row => array(object(row).children).length);
  return { parentCount: rows.length, childCount: sum(childrenPerParent), childrenPerParent };
}

function rootStateFlags(family) {
  requireValue(typeof family.selectedRootInTodo === 'boolean');
  requireValue(typeof family.selectedRootArchived === 'boolean');
  return { selectedRootInTodo: family.selectedRootInTodo, selectedRootArchived: family.selectedRootArchived };
}

function familySummary(raw, workspace) {
  const data = actionData(raw, 'source_family_observed');
  const family = object(data.family);
  verifyFamilyDigest(family);
  requireValue(family.organizationId === workspace.id);
  requireValue(Number.isSafeInteger(data.requests) && data.requests > 0);
  requireValue(data.consistency === 'repeated_details_and_child_inventories');
  const issues = familyIssues(family);
  return {
    issueCount: issues.length, descendantCount: issues.length - 1,
    descriptions: issues.map(descriptionSummary), ...blockerCounts(family, issues),
    childInventory: inventoryCounts(family, issues), rootStateFlags: rootStateFlags(family),
    requests: data.requests, catalogSha256: family.catalogSha256,
    sourceSha256: family.sourceSha256, consistency: data.consistency,
  };
}

function readObservation(path) {
  const bytes = readFileSync(path);
  return { sha256: hash(bytes), value: JSON.parse(bytes.toString('utf8')) };
}

function summarize(paths) {
  requireValue(paths.length >= 2);
  const [workspaceInput, ...families] = paths.map(readObservation);
  const workspace = workspacePayload(workspaceInput.value);
  return {
    schema: 'linear-intake-native-family-summary.v1',
    inputSha256: { workspace: workspaceInput.sha256, families: families.map(input => input.sha256) },
    workspace: { fieldNames: Object.keys(workspace).sort(), idIsUuid: true },
    families: families.map(input => familySummary(input.value, workspace)),
  };
}

try {
  // Emit only after every input validates; failures cannot leave a partial report.
  console.log(JSON.stringify(summarize(process.argv.slice(2)), null, 2));
} catch {
  console.error('Native family observation validation failed; no source data emitted.');
  process.exitCode = 1;
}
