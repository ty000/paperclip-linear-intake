// Read-only redaction of native observations; no network or credential access.
// Usage: node scripts/qualification/summarize-native-source.mjs <catalog.json> <probe.json> <samples.json>
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hash = data => createHash('sha256').update(data).digest('hex');

function textPayload(content) {
  if (content?.length !== 1 || content[0].type !== 'text') throw new Error();
  return JSON.parse(content[0].text);
}

function managedPayload(inner) {
  if (inner?.isError !== false || inner.structuredContent !== null) throw new Error();
  return textPayload(inner.content);
}

function validateDescriptions(issue, preview) {
  if (!preview || typeof issue.description !== 'string' || typeof preview.description !== 'string') throw new Error();
}

function validateHistory(issue) {
  if (!issue.relations || !Array.isArray(issue.stateHistory)) throw new Error();
}

function summarizeIssue(issue, page) {
  const preview = page.issues.find(i => i.uuid === issue.uuid);
  validateDescriptions(issue, preview);
  validateHistory(issue);
  return { idDiffersFromUuid: issue.id !== issue.uuid,
    parentIdPresent: typeof issue.parentId === 'string',
    previewDescriptionCharacters: preview.description.length,
    detailDescriptionCharacters: issue.description.length,
    commonDescriptionPrefix: preview.description.slice(0, 300) === issue.description.slice(0, 300),
    updatedAtPresent: typeof issue.updatedAt === 'string',
    relationKinds: Object.keys(issue.relations),
    relationCounts: Object.fromEntries(Object.entries(issue.relations).map(([k, v]) => [k, Array.isArray(v) ? v.length : v === null ? 0 : 'unknown'])),
    openStateHistoryCount: issue.stateHistory.filter(s => s.endedAt === null).length,
    openStateHistoryCarriesId: issue.stateHistory.filter(s => s.endedAt === null).every(s => typeof s.state?.id === 'string'),
    organizationIdPresent: Object.hasOwn(issue, 'organizationId') || Object.hasOwn(issue, 'workspaceId'),
  };
}

try {
  if (process.argv.length !== 5) throw new Error();
  const inputs = process.argv.slice(2).map(path => readFileSync(path));
  const [catalog, probe, samples] = inputs.map(raw => JSON.parse(raw).data);
  if (catalog.status !== 'catalog_observed' || probe.status !== 'source_probe_observed'
      || samples.status !== 'source_probe_observed' || samples.sourceCoverage !== 'unqualified') throw new Error();
  // Observed native route wraps the managed MCP result in structuredContent;
  // the provider payload in this observation is JSON inside its text block.
  function payload(observation) {
    const outer = observation.result;
    if (outer.isError !== false) throw new Error();
    return managedPayload(outer.structuredContent);
  }
  function one(role) {
    const matches = probe.observations.filter(o => o.role === role);
    if (matches.length !== 1) throw new Error();
    return payload(matches[0]);
  }
  const project = one('getProject'), team = one('getTeam'), statuses = one('listStatuses');
  const page = one('listIssues');
  const issues = samples.observations.filter(o => o.role === 'getIssue').map(payload);
  if (page.issues.length !== 2 || issues.length !== 2 || !Array.isArray(statuses)
      || typeof page.hasNextPage !== 'boolean' || typeof page.cursor !== 'string'
      || issues.some(issue => issue.projectId !== project.uuid || issue.teamId !== team.id)
      || page.issues.some(issue => issue.projectId !== project.uuid || issue.teamId !== team.id)) throw new Error();
  const normalizedNames = catalog.tools.map(t => t.name.includes(':') ? t.name.slice(t.name.lastIndexOf(':') + 1) : t.name);
  console.log(JSON.stringify({
    schema: 'linear-intake-native-source-summary.v1',
    layer: 'installed-worker-native-gateway-managed-linear-connection',
    inputSha256: Object.fromEntries(['catalog', 'probe', 'samples'].map((k, i) => [k, hash(inputs[i])])),
    catalogSha256: catalog.catalogSha256, catalogToolCount: catalog.tools.length,
    normalizedToolNames: normalizedNames,
    projectAndExactTeamMembershipMatched: true,
    projectFields: Object.keys(project), teamFields: Object.keys(team),
    workflowStateCount: statuses.length,
    page: { count: page.issues.length, hasNextPage: page.hasNextPage, cursorPresent: page.cursor.length > 0,
      inventoryComplete: false },
    samples: issues.map(issue => summarizeIssue(issue, page)),
    sourceCoverage: 'unqualified', completeFamilyRead: false,
    qualificationsNotEstablished: ['terminal-page semantics', 'complete descendants', 'relation completeness',
      'external blocker resolution', 'source organization binding', 'revision stability', 'independent description completeness'],
  }, null, 2));
} catch {
  console.error('Native observation validation failed; no source data emitted.');
  process.exitCode = 1;
}
