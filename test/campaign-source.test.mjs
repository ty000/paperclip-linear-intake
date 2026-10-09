import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { sourceFixture, sourceIds as ids } from './helpers/source-fixture.mjs';

const prdContent = '# Product\nTwo exact deliveries and one shared criterion.';
const tadContent = '# Architecture\nUse the bounded native intake path.';
const sha = value => createHash('sha256').update(value).digest('hex');
const references = {
  prd: { url: 'https://example.invalid/prd', version: '0.3', sha256: sha(prdContent) },
  tad: { url: 'https://example.invalid/tad', version: '0.2', sha256: sha(tadContent) },
};

function campaignSource(catalogSha256) {
  return { projectMetadataScope: 'enrolled', adapterQualification: {
    adapter: 'linear-get-project-milestones.v1', catalogSha256, observedShapeSha256: 'a'.repeat(64),
  }, referenceDocuments: [{ ...references.prd, content: prdContent }, { ...references.tad, content: tadContent }],
  compatibleCampaignStateIds: [ids.todo, ids.backlog], maxProjectPages: 10 };
}

function prepareCampaign(f) {
  f.milestones = [{ id: ids.milestone, name: 'Synthetic V1 milestone', description: 'Shared acceptance criterion' }];
  const ticket = f.issues.get(ids.root), parent = f.issues.get(ids.child);
  const leafA = f.issues.get(ids.completed), leafB = f.issues.get(ids.grandchild);
  ticket.description = `Human campaign context\n\n\`\`\`paperclip-campaign\n${JSON.stringify({
    schema: 'linear-milestone-campaign.v1', milestoneId: ids.milestone, ...references,
  })}\n\`\`\``;
  ticket.projectMilestone = null; ticket.parentId = null; ticket.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  parent.parentId = null; parent.projectMilestone = { id: ids.milestone, name: 'Synthetic V1 milestone' };
  leafA.parentId = parent.id; leafA.projectMilestone = { id: ids.milestone }; leafA.status = 'Backlog'; leafA.statusType = 'backlog';
  leafA.completedAt = null; leafA.stateHistory = [{ state: { id: ids.backlog, name: 'Backlog', type: 'backlog' },
    startedAt: '2026-10-07T12:00:00.000Z', endedAt: null }];
  leafB.parentId = parent.id; leafB.projectMilestone = { id: ids.milestone };
  parent.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  leafA.relations = { blocks: [{ id: leafB.id }], blockedBy: [], relatedTo: [], duplicateOf: null };
  leafB.relations = { blocks: [], blockedBy: [{ id: leafA.id }], relatedTo: [], duplicateOf: null };
  f.issues.delete(ids.canceledIssue);
}

const fixture = options => sourceFixture({ campaignSource, prepare: prepareCampaign, ...options });
const blocked = (result, reason) => assert.deepEqual(result, { status: 'blocked', reason, importPerformed: false });

test('an exact milestone becomes one bounded source with two leaves and separate native grouping', async () => {
  const f = await fixture(); const out = await f.runCampaign();
  assert.equal(out.status, 'campaign_source_observed');
  assert.equal(out.consistency, 'repeated_material_and_state_compatible');
  assert.equal(out.family.schema, 'linear-milestone-source.v1');
  assert.equal(out.family.rootIssueId, ids.root);
  assert.deepEqual(out.family.projectScan.milestoneMemberIds, [ids.child, ids.completed, ids.grandchild].sort());
  assert.deepEqual(out.family.campaign.nativeMapping, [
    { sourceId: ids.root, sourceParentId: null, nativeParentSourceId: null, role: 'campaign-root' },
    { sourceId: ids.child, sourceParentId: null, nativeParentSourceId: ids.root, role: 'milestone-root' },
    { sourceId: ids.completed, sourceParentId: 'SYN-2', nativeParentSourceId: ids.child, role: 'milestone-node' },
    { sourceId: ids.grandchild, sourceParentId: 'SYN-2', nativeParentSourceId: ids.child, role: 'milestone-node' },
  ]);
  assert.equal(out.family.issues.find(issue => issue.uuid === ids.child).parentId, null);
  assert.equal(out.family.issues.find(issue => issue.uuid === ids.completed).parentId, 'SYN-2');
  assert.match(out.family.campaign.materialSourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(out.family.campaign.referenceContents.prd.content, prdContent);
  assert.deepEqual(f.harness.dbExecutes, []); assert.deepEqual(f.harness.activity, []);
});

test('compatible state and timestamp observations do not change the material campaign identity', async () => {
  const f = await fixture({ beforeCall(call, current) {
    if (call.role === 'getIssue' && call.args.id === ids.root && call.targetCall === 2) {
      const ticket = current.issues.get(ids.root); ticket.updatedAt = '2026-10-07T13:00:00.000Z';
      ticket.status = 'Backlog'; ticket.statusType = 'backlog';
      ticket.stateHistory = [{ state: { id: ids.backlog, name: 'Backlog', type: 'backlog' },
        startedAt: '2026-10-07T12:30:00.000Z', endedAt: null }];
    }
  } });
  const out = await f.runCampaign();
  assert.equal(out.status, 'campaign_source_observed');
  assert.equal(out.family.campaign.stateCompatibility.status, 'compatible');
});

test('material drift between bounded observations fails closed', async () => {
  const f = await fixture({ beforeCall(call, current) {
    if (call.role === 'getIssue' && call.args.id === ids.child && call.targetCall === 2) current.issues.get(ids.child).description += ' changed';
  } });
  blocked(await f.runCampaign(), 'campaign_material_source_changed');
});

test('started work and unresolved external dependencies never produce a campaign source', async () => {
  const started = await fixture({ prepare(f) { prepareCampaign(f); const issue = f.issues.get(ids.grandchild);
    issue.status = 'In Progress'; issue.statusType = 'started';
    issue.stateHistory = [{ state: { id: ids.started, name: 'In Progress', type: 'started' },
      startedAt: '2026-10-07T12:00:00.000Z', endedAt: null }]; } });
  blocked(await started.runCampaign(), 'campaign_work_already_started');
  const external = await fixture({ prepare(f) { prepareCampaign(f);
    f.issues.get(ids.child).relations.blockedBy.push({ id: 'SYN-EXTERNAL' }); } });
  blocked(await external.runCampaign(), 'campaign_external_blocker');
});

test('campaign source remains disabled without explicit project-scan and adapter qualification enrollment', async () => {
  const f = await sourceFixture({ prepare: prepareCampaign });
  blocked(await f.runCampaign(), 'campaign_source_disabled');
});
