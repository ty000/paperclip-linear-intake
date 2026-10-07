import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import plugin from '../../dist/worker.js';
import { sourceFixture, sourceIds } from './source-fixture.mjs';

export const intakeIds = {
  webhook: '50000000-0000-4000-8000-000000000001',
  webhookSecret: '50000000-0000-4000-8000-000000000002',
  targetProject: '50000000-0000-4000-8000-000000000003',
  actor: '50000000-0000-4000-8000-000000000004',
};
export const webhookSecret = 'synthetic-intake-webhook-secret';
export const operator = { companyId: sourceIds.company, actor: { type: 'user', userId: 'synthetic-board-user' } };

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function guardEffects(fixture) {
  fixture.effects = [];
  const ctx = fixture.harness.ctx;
  for (const [service, method] of [['events', 'emit'], ['agents', 'invoke'], ['issues', 'create'], ['issues', 'update']]) {
    ctx[service][method] = async () => {
      fixture.effects.push(`${service}.${method}`);
      throw new Error('synthetic-forbidden-import-or-wake');
    };
  }
}

function prepareIntake(fixture, options) {
  fixture.config.enabled = options.enabled ?? true;
  fixture.config.intake = { webhookId: intakeIds.webhook,
    webhookSecretRef: { type: 'secret_ref', secretId: intakeIds.webhookSecret, version: 1 },
    targetProjectId: intakeIds.targetProject, allowedActors: [{ id: intakeIds.actor, type: 'user' }] };
  const root = fixture.issues.get(sourceIds.root);
  root.updatedAt = new Date().toISOString();
  root.stateHistory[0].startedAt = root.updatedAt;
  fixture.registeredJobs = [];
  const register = fixture.harness.ctx.jobs.register;
  fixture.harness.ctx.jobs.register = (name, handler) => {
    fixture.registeredJobs.push(name); return register(name, handler);
  };
  guardEffects(fixture);
  // Native ctx.db can be unavailable until the setup handshake completes.
  // Any eager database access during setup is an observable test failure.
  Object.defineProperty(fixture.harness.ctx, 'db', { configurable: true,
    get() { throw new Error('synthetic-db-unavailable-during-setup'); } });
  options.prepare?.(fixture);
}

async function selectedPayload(payload, call, fixture, options) {
  const result = options.transformPayload ? await options.transformPayload(payload, call, fixture) : payload;
  if (call.role !== 'getIssue') return result;
  if (call.args.fields.includes('description')) return result;
  // Simulate the provider's selected-field response for the eligibility read.
  return Object.fromEntries(call.args.fields.map(field => [field, result[field]]));
}

export async function intakeFixture(database, options = {}) {
  const fixture = await sourceFixture({
    prepare: current => prepareIntake(current, options),
    beforeCall: options.beforeCall,
    transformEnvelope: options.transformEnvelope,
    transformPayload: (payload, call, current) => selectedPayload(payload, call, current, options),
  });
  Object.defineProperty(fixture.harness.ctx, 'db', { configurable: true, writable: true, value: options.db ?? database.db });
  const resolveGateway = fixture.harness.ctx.secrets.resolve;
  fixture.harness.ctx.secrets.resolve = async (ref, scope) => {
    if (scope.configPath !== 'intake.webhookSecretRef') return resolveGateway(ref, scope);
    fixture.secretReads.push({ ref, scope });
    if (options.webhookSecretError) throw new Error(webhookSecret);
    return webhookSecret;
  };
  fixture.activate = params => fixture.harness.performAction('activate-intake', params ?? {}, operator);
  fixture.deactivate = () => fixture.harness.performAction('deactivate-intake', {}, operator);
  fixture.inspect = () => fixture.harness.performAction('inspect-intake', {}, operator);
  fixture.drain = () => fixture.harness.runJob('drain-intake');
  fixture.receive = input => plugin.definition.onWebhook(input ?? webhookInput(fixture));
  return fixture;
}

export function webhookInput(fixture, options = {}) {
  const root = fixture.issues.get(sourceIds.root);
  const body = { action: 'update', type: 'Issue', organizationId: sourceIds.organization,
    webhookId: intakeIds.webhook, actor: { id: intakeIds.actor, type: 'user' },
    createdAt: new Date().toISOString(), webhookTimestamp: Date.now(),
    data: { id: root.uuid, teamId: root.teamId, projectId: root.projectId, stateId: sourceIds.todo,
      updatedAt: root.updatedAt, archivedAt: null, title: 'Synthetic private source title' },
    updatedFrom: { stateId: sourceIds.backlog } };
  options.mutate?.(body);
  const rawBody = JSON.stringify(body);
  return { endpointKey: 'linear-todo', requestId: randomUUID(), rawBody, parsedBody: body,
    headers: { 'Linear-Signature': createHmac('sha256', webhookSecret).update(rawBody).digest('hex'),
      'Linear-Delivery': options.deliveryId ?? randomUUID(), 'Linear-Timestamp': String(body.webhookTimestamp), 'Linear-Event': body.type },
    ...options.input };
}

export function assertNoImport(fixture) {
  assert.deepEqual(fixture.effects, []);
  assert.deepEqual(fixture.harness.activity, []);
  assert.deepEqual(fixture.harness.telemetry, []);
}
