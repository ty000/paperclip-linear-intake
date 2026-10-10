import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourceFixture, sourceIds } from './source-fixture.mjs';
import { readSourceFamily } from '../../dist/source-family.js';
import { buildImportPlan } from '../../dist/import-plan.js';
import { contentDigest } from '../../dist/content-digest.js';
import { fingerprint } from '../../dist/intake-authority.js';
import { parseConfig } from '../../dist/config.js';
import { intakeIdentity, INTAKE_DATABASE_NAMESPACE } from '../../dist/intake-state.js';
import { COUNCIL_REQUEST_EVENT, COUNCIL_RESULT_NAME } from '../../dist/council-handoff-contract.js';

export const uuid = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-10-07T12:00:00.000Z';
const activation = '2026-10-07T11:00:00.000Z';
const campaignPrd = '# Campaign PRD\nExact source family.';
const campaignTad = '# Campaign TAD\nFixed native grouping.';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const campaignReferences = {
  prd: { url: 'https://example.invalid/campaign-prd', version: '1', sha256: sha256(campaignPrd) },
  tad: { url: 'https://example.invalid/campaign-tad', version: '1', sha256: sha256(campaignTad) },
};

function campaignSource(catalogSha256) {
  return { projectMetadataScope: 'enrolled', adapterQualification: {
    adapter: 'linear-get-project-milestones.v1', catalogSha256, observedShapeSha256: 'a'.repeat(64) },
    referenceDocuments: [{ ...campaignReferences.prd, content: campaignPrd },
      { ...campaignReferences.tad, content: campaignTad }],
    compatibleCampaignStateIds: [sourceIds.todo, sourceIds.backlog], maxProjectPages: 10 };
}

function configureCampaign(f) {
  f.milestones = [{ id: sourceIds.milestone, name: 'V1', description: 'Campaign criterion' }];
  const ticket = f.issues.get(sourceIds.root), parent = f.issues.get(sourceIds.child);
  const leaf = f.issues.get(sourceIds.grandchild);
  ticket.description = `Human context\n\n\`\`\`paperclip-campaign\n${JSON.stringify({
    schema: 'linear-milestone-campaign.v1', milestoneId: sourceIds.milestone, ...campaignReferences,
  })}\n\`\`\``;
  ticket.parentId = null; ticket.projectMilestone = null;
  ticket.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  parent.parentId = null; parent.projectMilestone = { id: sourceIds.milestone };
  parent.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  leaf.parentId = parent.id; leaf.projectMilestone = { id: sourceIds.milestone };
  leaf.relations = { blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null };
  for (const issueId of [sourceIds.completed, sourceIds.canceledIssue]) f.issues.delete(issueId);
}

function configure(f) {
  Object.assign(f.config, { enabled: true, nativeImportEnabled: true, councilHandoffEnabled: true,
    intake: { webhookId: uuid(2), webhookSecretRef: { type: 'secret_ref', secretId: uuid(3) },
      targetProjectId: uuid(4), allowedActors: [{ id: uuid(5), type: 'user' }] } });
}

function retained(f, family) {
  f.binding = { companyId: sourceIds.company, activationId: uuid(1), activatedAt: activation,
    fingerprint: fingerprint(parseConfig(f.config)), active: true, version: 1,
    authority: { organizationId: sourceIds.organization, teamId: sourceIds.team, projectId: sourceIds.project,
      todoStateId: sourceIds.todo, webhookId: uuid(2), activationAt: activation, allowedActors: f.config.intake.allowedActors } };
  f.request = { companyId: sourceIds.company, organizationId: sourceIds.organization, issueId: sourceIds.root,
    intakeId: intakeIdentity(sourceIds.company, sourceIds.organization, sourceIds.root), activationId: uuid(1),
    accepted: true, status: 'source_observed', version: 3, revision: time, eventAt: time, classification: 'received',
    deliveryId: uuid(6), acceptedAt: time, attempts: 1, leaseOwner: null, leaseUntil: null,
    snapshot: family, snapshotSha256: family.sourceSha256, errorCode: null };
}

function receipt(effectKey, kind, intent, result) {
  return { companyId: sourceIds.company, effectKey, kind, intent, intentSha256: contentDigest(intent),
    state: 'observed', dispatchCount: 1, dispatchOwner: 'synthetic', result, resultSha256: contentDigest(result), errorCode: null };
}

function sourceReceipts(plan) {
  return plan.expectedEffectKeys.filter(key => key !== plan.readinessKey).map(effectKey => {
    const intent = { companyId: sourceIds.company, effectKey };
    return receipt(effectKey, 'issue', intent, { nativeId: uuid(10), contentSha256: contentDigest(intent) });
  });
}

function readinessBody(plan, effects) {
  return { schema: 'linear-native-readiness.v1', companyId: plan.companyId, intakeId: plan.intakeId,
    activationId: plan.activationId, configurationFingerprint: plan.fingerprint, requestVersion: plan.requestVersion,
    planSha256: plan.planSha256, sourceSha256: plan.sourceSha256, targetProjectId: plan.targetProjectId,
    originKind: plan.originKind, nativeRootId: uuid(7), sourceRootId: plan.rootSourceId,
    importStatus: 'prepared', admissionAllowed: false, implementationStarted: false, receivingContract: 'unqualified',
    requiresCurrentSourceAndMandateRevalidation: true,
    ...(plan.campaign ? { campaign: plan.campaign } : {}),
    effects: effects.map(({ effectKey, intentSha256, result, resultSha256 }) => ({ effectKey, intentSha256, result, resultSha256 })) };
}

function prepared(f) {
  const plan = buildImportPlan(f.binding, f.request, uuid(4));
  f.effects = sourceReceipts(plan);
  const documentIntent = { companyId: sourceIds.company, issueId: uuid(7), key: 'linear-intake-readiness-v1',
    title: 'Linear intake readiness', format: 'markdown', body: JSON.stringify(readinessBody(plan, f.effects)) };
  const docResult = { nativeId: uuid(8), revisionId: uuid(9), revisionNumber: 1, contentSha256: contentDigest(documentIntent) };
  f.document = { ...documentIntent, id: uuid(8), latestRevisionId: uuid(9), latestRevisionNumber: 1 };
  const readiness = { ...docResult, nativeRootId: uuid(7), planSha256: plan.planSha256, sourceSha256: plan.sourceSha256 };
  f.plan = { ...plan, plan, state: 'prepared', version: 1, readiness, readinessSha256: contentDigest(readiness), errorCode: null };
  f.effects.push(receipt(plan.readinessKey, 'readiness', documentIntent, docResult));
}

function dbHandlers(f) {
  return [
    [' AS current', () => [{ current: f.current }]],
    ['SELECT e.company_id', () => f.effects],
    ['FROM ' + INTAKE_DATABASE_NAMESPACE + '.import_plans', () => f.plan ? [f.plan] : []],
    ['FROM ' + INTAKE_DATABASE_NAMESPACE + '.intake_requests', () => f.request ? [f.request] : []],
    ['FROM ' + INTAKE_DATABASE_NAMESPACE + '.intake_binding', () => f.binding ? [f.binding] : []],
  ];
}

function connectLedger(f, options) {
  f.current = true; f.dbReads = []; f.documentReads = [];
  const handlers = dbHandlers(f);
  f.harness.ctx.db = { namespace: INTAKE_DATABASE_NAMESPACE,
    async query(sql, params) {
      f.dbReads.push({ sql, params }); await options.beforeDb?.(sql, f);
      assert.equal(params[0], sourceIds.company);
      const entry = handlers.find(([match]) => sql.includes(match));
      assert.ok(entry, 'only known read-only ledger queries may run');
      return structuredClone(entry[1]());
    },
    async execute() { assert.fail('responder must not write its ledger'); } };
  f.harness.ctx.issues.documents.get = async (issueId, key, companyId) => {
    f.documentReads.push({ issueId, key, companyId });
    await options.beforeDocument?.(f);
    assert.deepEqual({ issueId, key, companyId }, { issueId: uuid(7), key: 'linear-intake-readiness-v1', companyId: sourceIds.company });
    return structuredClone(f.document);
  };
  for (const service of [f.harness.ctx.issues, f.harness.ctx.issues.documents, f.harness.ctx.issues.relations]) {
    for (const method of ['create', 'update', 'upsert', 'addBlockers']) service[method] = async () => assert.fail('native write forbidden');
  }
  f.harness.ctx.agents.invoke = async () => assert.fail('agent wake forbidden');
}

export function challenge(f, stage = 'preparation') {
  const now = Date.now();
  return { schema: 'linear-intake-revalidation-request.v1', challengeId: uuid(20), nonce: '1'.repeat(64), stage,
    companyId: sourceIds.company, admissionId: uuid(21), mandateId: uuid(22), mandateRevisionSha256: '2'.repeat(64),
    intakeId: f.request.intakeId, activationId: f.binding.activationId, configurationFingerprint: f.binding.fingerprint,
    requestVersion: f.plan.requestVersion, nativeRootId: uuid(7), targetProjectId: uuid(4),
    readinessDocumentId: uuid(8), readinessRevisionId: uuid(9), readinessSha256: f.plan.readinessSha256,
    sourceSha256: f.plan.sourceSha256, planSha256: f.plan.planSha256,
    requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString() };
}

export async function handoffFixture(options = {}) {
  const f = await sourceFixture({ campaignSource: options.campaign ? campaignSource : undefined,
    prepare(current) { configure(current); if (options.campaign) configureCampaign(current); options.prepare?.(current); },
    beforeCall: async (call, current) => { if (current.armed) await options.beforeCall?.(call, current); } });
  const observed = options.campaign ? await f.runCampaign()
    : await readSourceFamily(f.harness.ctx, sourceIds.company, sourceIds.root, false);
  options.configure?.(f.config);
  retained(f, observed.family); prepared(f); connectLedger(f, options);
  f.results = [];
  f.harness.ctx.events.on(`plugin.ty000.linear-intake.${COUNCIL_RESULT_NAME}`, async event => { f.results.push(event.payload); });
  f.send = (request = challenge(f), base = {}) => f.harness.emit(COUNCIL_REQUEST_EVENT, request, {
    companyId: sourceIds.company, actorType: 'plugin', actorId: 'private.paperclip-council', ...base });
  f.requests.length = 0; f.sourceCalls.length = 0; f.secretReads.length = 0; f.configReads.length = 0;
  f.armed = true;
  return f;
}
