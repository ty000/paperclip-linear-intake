import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildImportPlan } from '../dist/import-plan.js';
import { contentDigest } from '../dist/content-digest.js';
import { intakeIdentity } from '../dist/intake-state.js';
import { sourceFixture, sourceIds as ids } from './helpers/source-fixture.mjs';

const prd = '# PRD\nTwo deliveries.'; const tad = '# TAD\nBounded import.';
const sha = value => createHash('sha256').update(value).digest('hex');
const refs = { prd: { url: 'https://example.invalid/prd', version: '0.3', sha256: sha(prd) },
  tad: { url: 'https://example.invalid/tad', version: '0.2', sha256: sha(tad) } };
function source(catalogSha256) { return { projectMetadataScope: 'enrolled', adapterQualification: {
  adapter: 'linear-get-project-milestones.v1', catalogSha256, observedShapeSha256: 'a'.repeat(64) },
  referenceDocuments: [{ ...refs.prd, content: prd }, { ...refs.tad, content: tad }],
  compatibleCampaignStateIds: [ids.todo, ids.backlog], maxProjectPages: 10 }; }
function prepare(f) {
  f.milestones = [{ id: ids.milestone, name: 'V1', description: 'Shared criterion' }];
  const ticket = f.issues.get(ids.root), parent = f.issues.get(ids.child);
  const a = f.issues.get(ids.completed), b = f.issues.get(ids.grandchild);
  ticket.description = `\`\`\`paperclip-campaign\n${JSON.stringify({ schema: 'linear-milestone-campaign.v1', milestoneId: ids.milestone, ...refs })}\n\`\`\``;
  ticket.parentId = null; ticket.projectMilestone = null; ticket.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  parent.parentId = null; parent.projectMilestone = { id: ids.milestone }; parent.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  for (const leaf of [a, b]) { leaf.projectMilestone = { id: ids.milestone };
    leaf.status = 'Backlog'; leaf.statusType = 'backlog'; leaf.completedAt = null;
    leaf.stateHistory = [{ state: { id: ids.backlog, name: 'Backlog', type: 'backlog' }, startedAt: '2026-10-07T12:00:00.000Z', endedAt: null }];
    leaf.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null }; }
  a.parentId = parent.id;
  b.parentId = a.id;
  a.relations.blocks.push({ id: b.id }); b.relations.blockedBy.push({ id: a.id });
  f.issues.delete(ids.canceledIssue);
}

async function imported() {
  const fixture = await sourceFixture({ campaignSource: source, prepare });
  const observed = await fixture.runCampaign(); assert.equal(observed.status, 'campaign_source_observed');
  const companyId = ids.company, activationId = '50000000-0000-4000-8000-000000000001';
  const body = observed.family; const request = { companyId, organizationId: ids.organization, issueId: ids.root,
    intakeId: intakeIdentity(companyId, ids.organization, ids.root), activationId, accepted: true, status: 'source_observed', version: 1,
    revision: '2026-10-07T12:00:00.000Z', eventAt: '2026-10-07T12:00:00.000Z', classification: 'received',
    deliveryId: '50000000-0000-4000-8000-000000000002', acceptedAt: '2026-10-07T12:00:00.000Z', attempts: 1,
    leaseOwner: null, leaseUntil: null, snapshot: body, snapshotSha256: body.sourceSha256, errorCode: null };
  const binding = { companyId, activationId, activatedAt: '2026-10-07T11:00:00.000Z', fingerprint: 'f'.repeat(64),
    active: true, version: 1, authority: { organizationId: ids.organization, teamId: ids.team,
      projectId: ids.project, todoStateId: ids.todo } };
  return { fixture, observed, request, binding, plan: buildImportPlan(binding, request, ids.project) };
}

test('campaign import plan binds campaign readiness and attaches milestone roots only in native mapping', async () => {
  const f = await imported(); const plan = f.plan;
  assert.equal(plan.campaign.mode, 'milestone-fixed-v1');
  assert.equal(plan.campaign.materialSourceSha256, f.observed.family.campaign.materialSourceSha256);
  assert.equal(contentDigest({ ...plan, planSha256: undefined }), contentDigest({ ...plan, planSha256: undefined }));
  const bySource = new Map(plan.nodes.map(node => [node.sourceId, node]));
  assert.equal(bySource.get(ids.root).parentSourceId, null);
  assert.equal(bySource.get(ids.child).parentSourceId, ids.root);
  assert.equal(bySource.get(ids.completed).parentSourceId, ids.child);
  assert.equal(bySource.get(ids.grandchild).parentSourceId, ids.completed);
  assert.equal(bySource.get(ids.child).source.parentId, null);
  assert.equal(bySource.get(ids.completed).source.parentId, 'SYN-2');
  assert.equal(bySource.get(ids.grandchild).source.parentId, 'SYN-3');
  assert.deepEqual(JSON.parse(bySource.get(ids.root).sourceDocumentBody).campaign, f.observed.family.campaign);
  assert.equal(Object.hasOwn(JSON.parse(bySource.get(ids.child).sourceDocumentBody), 'campaign'), false);
  assert.equal(plan.expectedEffectKeys.length, plan.nodes.length * 3 + 1);
  assert.equal(new Set(plan.expectedEffectKeys).size, plan.expectedEffectKeys.length);
});

test('campaign digest, state and mapping tampering are independently rejected', async () => {
  for (const mutate of [
    body => { body.campaign.materialSourceSha256 = '0'.repeat(64); },
    body => { body.campaign.stateCompatibility.observationSha256 = '0'.repeat(64); },
    body => { body.campaign.nativeMapping[1].nativeParentSourceId = ids.completed; },
  ]) {
    const f = await imported(); mutate(f.request.snapshot);
    const { sourceSha256: _old, ...body } = f.request.snapshot;
    f.request.snapshot.sourceSha256 = contentDigest(body); f.request.snapshotSha256 = f.request.snapshot.sourceSha256;
    assert.throws(() => buildImportPlan(f.binding, f.request, ids.project));
  }
});
