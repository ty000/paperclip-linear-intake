import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceFixture, sourceIds as ids } from './helpers/source-fixture.mjs';

const sourceCalls = (fixture, role) => fixture.sourceCalls.filter(call => call.role === role);
const issueReads = fixture => sourceCalls(fixture, 'getIssue').map(call => call.args.id);
const blocked = (result, reason) => assert.deepEqual(result, { status: 'blocked', reason, importPerformed: false });

test('SDK action reads and revalidates a paginated five-issue family without effects', async () => {
  const f = await sourceFixture();
  const out = await f.run({ issueId: ids.root, renderEnvironment: null });
  assert.equal(out.status, 'source_family_observed');
  assert.equal(out.importPerformed, false);
  assert.equal(out.consistency, 'repeated_details_and_child_inventories');
  assert.equal(out.family.issues.length, 5);
  assert.equal(out.family.childInventory.length, 5);
  assert.equal(out.requests, 30);
  assert.match(out.family.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(out.family.selectedRootInTodo, true);
  assert.equal(out.family.selectedRootArchived, false);
  assert.deepEqual(out.family.cycleAffectedIssueIds, []);
  assert.deepEqual(out.family.externalBlockers, [{ blockedIssueId: ids.root,
    reference: { id: 'SYN-EXTERNAL', title: 'Synthetic external blocker' }, status: 'unresolved' }]);
  assert.deepEqual(f.harness.dbExecutes, []);
  assert.deepEqual(f.harness.activity, []);
  assert.deepEqual(f.harness.logs, []);
  assert.equal(f.secretReads.length, 1);
  assert.deepEqual(f.secretReads[0], { ref: f.config.gatewayTokenRef,
    scope: { companyId: ids.company, configPath: 'gatewayTokenRef' } });
  assert.equal(f.configReads.length, 3);
});

test('detail descriptions, explicit absence and completed/canceled history survive the snapshot', async () => {
  const f = await sourceFixture();
  f.issues.get(ids.child).description = null;
  const out = await f.run();
  const byId = new Map(out.family.issues.map(issue => [issue.uuid, issue]));
  assert.equal(byId.get(ids.root).description, f.issues.get(ids.root).description);
  assert.ok(byId.get(ids.root).description.length > 500);
  assert.equal(byId.get(ids.child).description, null);
  assert.equal(byId.get(ids.completed).statusType, 'completed');
  assert.equal(byId.get(ids.completed).completedAt, f.issues.get(ids.completed).completedAt);
  assert.equal(byId.get(ids.canceledIssue).statusType, 'canceled');
  assert.equal(byId.get(ids.canceledIssue).archivedAt, f.issues.get(ids.canceledIssue).archivedAt);
  assert.deepEqual(byId.get(ids.completed).stateHistory, f.issues.get(ids.completed).stateHistory);
});

test('child selection retains ancestry and external blockers without reading parents or siblings', async () => {
  const f = await sourceFixture();
  const out = await f.run({ issueId: ids.child });
  assert.equal(out.status, 'source_family_observed');
  assert.deepEqual(out.family.issues.map(issue => issue.uuid), [ids.child, ids.grandchild]);
  assert.equal(out.family.issues[0].parentId, 'SYN-1');
  assert.equal(out.family.selectedRootInTodo, false);
  assert.deepEqual([...new Set(issueReads(f))], [ids.child, ids.grandchild]);
  assert.deepEqual(out.family.externalBlockers, [{ blockedIssueId: ids.child, reference: { id: 'SYN-3' }, status: 'unresolved' }]);
  assert.ok(sourceCalls(f, 'listIssues').every(call => ['SYN-2', 'SYN-5'].includes(call.args.parentId)));
});

test('descendant inventories request archives and identity fields without hiding scope violations', async () => {
  const f = await sourceFixture();
  await f.run();
  for (const call of sourceCalls(f, 'listIssues')) {
    assert.equal(call.args.includeArchived, true);
    assert.equal(call.args.limit, 2);
    assert.deepEqual(call.args.fields, ['id', 'uuid', 'parentId', 'teamId', 'projectId', 'updatedAt']);
    assert.equal(call.args.team, undefined);
    assert.equal(call.args.project, undefined);
  }
  assert.equal(sourceCalls(f, 'listIssues').filter(call => call.args.cursor !== undefined).length, 2);
  const detail = sourceCalls(f, 'getIssue')[0].args;
  assert.equal(detail.includeRelations, true);
  assert.ok(detail.fields.includes('description'));
  assert.ok(detail.fields.includes('title'));
  assert.ok(detail.fields.includes('stateHistory'));
});

for (const cursor of [null, 'synthetic-terminal']) {
  test(`terminal inventories accept ${typeof cursor} cursor without continuing it`, async () => {
    const f = await sourceFixture({ transformPayload(payload, call) {
      if (call.role === 'listIssues' && payload.hasNextPage === false) return { ...payload, cursor };
      return payload;
    } });
    assert.equal((await f.run()).status, 'source_family_observed');
    assert.equal(f.sourceCalls.length, 30);
  });
}

const invalidPages = [
  { issues: [], hasNextPage: true, cursor: 'synthetic-page:1' },
  { issues: [], cursor: null },
  { issues: [], hasNextPage: false, cursor: '' },
];
for (const [index, page] of invalidPages.entries()) {
  test(`malformed inventory page ${index} returns no partial family`, async () => {
    const f = await sourceFixture({ transformPayload(payload, call) {
      if (call.role === 'listIssues') return page;
      return payload;
    } });
    blocked(await f.run(), 'source_read_failed');
    assert.deepEqual(issueReads(f), [ids.root]);
  });
}

test('continuation without a cursor fails before fetching child details', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listIssues') return { issues: payload.issues, hasNextPage: true };
    return payload;
  } });
  blocked(await f.run(), 'source_read_failed');
  assert.deepEqual(issueReads(f), [ids.root]);
});

test('a repeated page cursor stops without another request or partial result', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listIssues' && call.args.cursor) return { ...payload, hasNextPage: true, cursor: call.args.cursor };
    return payload;
  } });
  blocked(await f.run(), 'source_cursor_repeated');
  assert.equal(sourceCalls(f, 'listIssues').length, 2);
  assert.deepEqual(issueReads(f), [ids.root]);
});

test('duplicate children across inventory pages are rejected before detail reads', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listIssues' && call.args.cursor) return { issues: [
      { ...payload.issues[0], uuid: ids.child, id: 'SYN-2' },
    ], hasNextPage: false };
    return payload;
  } });
  blocked(await f.run(), 'source_duplicate_child');
  assert.deepEqual(issueReads(f), [ids.root]);
});

for (const [reader, reason] of [
  [{ maxPagesPerParent: 1 }, 'source_page_bound_exceeded'],
  [{ maxIssues: 4 }, 'source_issue_bound_exceeded'],
  [{ maxRequests: 1 }, 'source_request_bound_exceeded'],
]) {
  test(`${reason} bounds actual calls and suppresses incomplete families`, async () => {
    const f = await sourceFixture({ reader });
    blocked(await f.run(), reason);
    assert.ok(f.sourceCalls.length <= f.config.sourceReader.maxRequests);
    assert.equal(issueReads(f).includes(ids.grandchild), false);
  });
}

test('exact issue and request bounds allow the complete nominal family', async () => {
  const f = await sourceFixture({ reader: { maxIssues: 5, maxRequests: 30 } });
  assert.equal((await f.run()).status, 'source_family_observed');
  assert.equal(f.sourceCalls.length, 30);
});

test('deadline expiration after a response prevents the next source call', async t => {
  const now = Date.now();
  const f = await sourceFixture({ reader: { deadlineMs: 1000 }, beforeCall() {
    t.mock.method(Date, 'now', () => now + 5000);
  } });
  blocked(await f.run(), 'source_deadline_exceeded');
  assert.equal(f.sourceCalls.length, 1);
});

test('changed detail revision during revalidation fails without returning a snapshot', async () => {
  const f = await sourceFixture({ beforeCall(call, fixture) {
    if (call.role === 'getIssue' && call.targetCall === 2) fixture.issues.get(call.args.id).description += ' changed';
  } });
  blocked(await f.run(), 'source_revision_changed');
});

test('changed inventory revision before its detail read fails closed', async () => {
  const f = await sourceFixture({ beforeCall(call, fixture) {
    if (call.role === 'getIssue' && call.args.id === ids.child) fixture.issues.get(ids.child).updatedAt = '2026-10-07T13:00:00Z';
  } });
  blocked(await f.run(), 'source_inventory_changed');
});

test('changed child inventory during revalidation fails closed', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listIssues' && call.targetCall === 3) return { issues: [], hasNextPage: false };
    return payload;
  } });
  blocked(await f.run(), 'source_inventory_changed');
});

test('extra preview metadata does not contradict the selected identity fields', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listIssues') return { ...payload, issues: payload.issues.map(issue => ({ ...issue, providerHint: 'synthetic' })) };
    return payload;
  } });
  assert.equal((await f.run()).status, 'source_family_observed');
});

for (const [role, field, reason] of [
  ['getWorkspace', 'id', 'source_organization_mismatch'],
  ['getProject', 'uuid', 'source_project_mismatch'],
  ['getTeam', 'id', 'source_team_mismatch'],
]) {
  test(`${role} identity mismatch stops before issue reads`, async () => {
    const f = await sourceFixture({ transformPayload(payload, call) {
      if (call.role === role) return { ...payload, [field]: ids.outside };
      return payload;
    } });
    blocked(await f.run(), reason);
    assert.deepEqual(issueReads(f), []);
  });
}

for (const field of ['teamId', 'projectId']) {
  test(`out-of-scope child ${field} is rejected from inventory before fetching its body`, async () => {
    const f = await sourceFixture({ prepare(fixture) { fixture.issues.get(ids.child)[field] = ids.outside; } });
    blocked(await f.run(), 'source_issue_outside_scope');
    assert.deepEqual(issueReads(f), [ids.root]);
  });
}

test('an enrolled root returned under another UUID is rejected', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'getIssue') return { ...payload, uuid: ids.outside };
    return payload;
  } });
  blocked(await f.run(), 'source_issue_identity_mismatch');
});

test('unknown child parent identity is rejected', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listIssues') return { ...payload, issues: payload.issues.map(issue => ({ ...issue, parentId: 'SYN-OUTSIDE' })) };
    return payload;
  } });
  blocked(await f.run(), 'source_parent_mismatch');
});

test('workflow metadata changing after source reads invalidates the observation', async () => {
  const f = await sourceFixture({ transformPayload(payload, call) {
    if (call.role === 'listStatuses' && call.targetCall === 2) return payload.map(state => ({ ...state, name: `${state.name} changed` }));
    return payload;
  } });
  blocked(await f.run(), 'source_states_changed');
});

for (const mutate of [
  catalog => catalog.pop(),
  catalog => { catalog.at(-1).inputSchema.properties.changed = { type: 'string' }; },
  catalog => { catalog.at(-1).name = 'synthetic:write-issue'; },
]) {
  test('all role pins must match before the first source call', async () => {
    const f = await sourceFixture({ prepare(fixture) { mutate(fixture.catalog); } });
    blocked(await f.run(), 'source_catalog_changed');
    assert.deepEqual(f.sourceCalls, []);
  });
}

test('valid pins from different connection namespaces cannot authorize a source read', async () => {
  const f = await sourceFixture({ prepare(fixture) {
    fixture.catalog[0].name = 'other-synthetic-connection:get-workspace';
    fixture.config.sourceReader.tools.getWorkspace.name = fixture.catalog[0].name;
  } });
  blocked(await f.run(), 'source_connection_mismatch');
  assert.deepEqual(f.sourceCalls, []);
});

test('native secret access failure is expurgated before gateway calls', async () => {
  const f = await sourceFixture({ secretError: true });
  const out = await f.run();
  blocked(out, 'source_read_failed');
  assert.deepEqual(f.requests, []);
  assert.equal(JSON.stringify(out).includes('synthetic-private-secret-error'), false);
});

for (const level of ['outer', 'inner']) {
  test(`${level} managed access error stops immediately and returns no private content`, async () => {
    const f = await sourceFixture({ transformEnvelope(envelope) {
      const target = level === 'outer' ? envelope : envelope.structuredContent;
      target.isError = true;
      target.content = [{ type: 'text', text: 'synthetic-private-provider-error' }];
      return envelope;
    } });
    const out = await f.run();
    blocked(out, 'source_read_failed');
    assert.equal(f.sourceCalls.length, 1);
    assert.equal(JSON.stringify({ out, logs: f.harness.logs }).includes('synthetic-private-provider-error'), false);
  });
}

test('unicode-escaped credential in managed JSON is rejected after unwrapping', async () => {
  const credential = 'synthetic-source-fixture-credential';
  const escaped = [...credential].map(character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const f = await sourceFixture({ transformEnvelope(envelope, call) {
    if (call.role !== 'getIssue') return envelope;
    const payload = JSON.parse(envelope.structuredContent.content[0].text);
    payload.description = credential;
    envelope.structuredContent.content[0].text = JSON.stringify(payload).replace(credential, escaped);
    return envelope;
  } });
  const out = await f.run();
  blocked(out, 'source_read_failed');
  assert.equal(f.sourceCalls.length, 5);
  assert.equal(JSON.stringify({ out, logs: f.harness.logs }).includes(credential), false);
});

test('unenrolled issue UUID is rejected before secrets or network', async () => {
  const f = await sourceFixture();
  blocked(await f.run({ issueId: ids.outside }), 'source_root_not_enrolled');
  assert.deepEqual(f.secretReads, []);
  assert.deepEqual(f.requests, []);
});

test('reader absent from configuration is blocked before secrets or network', async () => {
  const f = await sourceFixture({ config: {} });
  blocked(await f.run(), 'source_reader_disabled');
  assert.deepEqual(f.secretReads, []);
  assert.deepEqual(f.requests, []);
});

for (const readNumber of [2, 3]) {
  test(`reader enrollment revoked at config read ${readNumber} cannot yield a family`, async () => {
    const f = await sourceFixture({ configAtRead(number, config) {
      if (number === readNumber) return { ...config, sourceReader: undefined };
      return config;
    } });
    const out = await f.run();
    assert.equal(out.status, 'blocked');
    assert.equal(out.family, undefined);
    assert.equal(f.configReads.length, readNumber);
  });
}

test('changed scope between configuration reads stops before source calls', async () => {
  const f = await sourceFixture({ configAtRead(number, config) {
    if (number === 2) return { ...config, sourceReader: { ...config.sourceReader, projectId: ids.outside } };
    return config;
  } });
  blocked(await f.run(), 'source_configuration_changed');
  assert.deepEqual(f.sourceCalls, []);
});

for (const actor of [undefined, { type: 'agent', agentId: 'synthetic-agent' }, { type: 'system' }, { type: 'user' }]) {
  test('non-operator and spoofed actors cannot cause configuration or source reads', async () => {
    const f = await sourceFixture();
    blocked(await f.run({ issueId: ids.root, actor: { type: 'user', userId: 'spoof' },
      actorContext: { type: 'user', userId: 'spoof' } }, { companyId: ids.company, actor }), 'source_reader_operator_required');
    assert.deepEqual(f.configReads, []);
    assert.deepEqual(f.secretReads, []);
    assert.deepEqual(f.requests, []);
  });
}

test('caller scope and actor fields cannot widen the trusted source configuration', async () => {
  const f = await sourceFixture();
  const out = await f.run({ issueId: ids.root, companyId: ids.outside, teamId: ids.outside,
    projectId: ids.outside, limit: 1000, actor: { type: 'system' }, renderEnvironment: null });
  assert.equal(out.status, 'source_family_observed');
  assert.equal(out.family.projectId, ids.project);
  assert.equal(out.family.teamId, ids.team);
  assert.ok(f.configReads.every(company => company === ids.company));
});

test('blocking cycles and downstream affected issues remain explicit in the snapshot', async () => {
  const f = await sourceFixture({ prepare(fixture) {
    fixture.issues.get(ids.completed).relations.blockedBy.push({ id: 'SYN-2' });
    fixture.issues.get(ids.child).relations.blocks.push({ id: 'SYN-3' });
  } });
  const out = await f.run();
  assert.equal(out.status, 'source_family_observed');
  assert.deepEqual(out.family.cycleAffectedIssueIds, [ids.child, ids.completed, ids.grandchild]);
});

for (const [uuid, field] of [[ids.completed, 'blocks'], [ids.child, 'blockedBy']]) {
  test(`missing inverse relation ${field} prevents a coherent family snapshot`, async () => {
    const f = await sourceFixture({ prepare(fixture) { fixture.issues.get(uuid).relations[field] = []; } });
    blocked(await f.run(), 'source_relations_inconsistent');
  });
}

test('a hierarchy cycle never recursively re-reads an already selected issue', async () => {
  const f = await sourceFixture({ prepare(fixture) { fixture.issues.get(ids.root).parentId = 'SYN-5'; } });
  blocked(await f.run(), 'source_hierarchy_repeated');
  assert.equal(issueReads(f).filter(uuid => uuid === ids.root).length, 1);
});

test('ambiguous readable issue identities cannot produce relation mappings', async () => {
  const f = await sourceFixture({ prepare(fixture) { fixture.issues.get(ids.canceledIssue).id = 'SYN-3'; } });
  blocked(await f.run(), 'source_reference_ambiguous');
});
