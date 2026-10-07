import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyLinearEvent } from '../dist/webhook-event.js';

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const secret = 'synthetic-webhook-signing-secret-only';
const privateSentinel = 'synthetic-private-body-not-for-diagnostics';
const now = Date.parse('2026-10-07T12:00:00.000Z');
const iso = ms => new Date(ms).toISOString();
const authority = { organizationId: id(1), teamId: id(2), projectId: id(3), todoStateId: id(4),
  webhookId: id(5), allowedActors: [{ id: id(6), type: 'user' }], activationAt: iso(now - 60000) };
function payload() {
  return { organizationId: id(1), webhookId: id(5), type: 'Issue', action: 'update',
    actor: { id: id(6), type: 'user', name: privateSentinel }, createdAt: iso(now - 1000),
    webhookTimestamp: now,
    data: { id: id(7), teamId: id(2), projectId: id(3), stateId: id(4),
      updatedAt: iso(now - 999), createdAt: '2020-01-01T00:00:00.000Z', archivedAt: null,
      title: privateSentinel, description: 'Espaces, café ☕ et \\u00e9' },
    updatedFrom: { stateId: id(8), title: privateSentinel } };
}
function sign(raw, signingSecret = secret) {
  return createHmac('sha256', signingSecret).update(raw).digest('hex');
}
function headers(raw) {
  return { 'Linear-Signature': sign(raw), 'Linear-Delivery': id(9), 'Linear-Timestamp': String(now), 'Linear-Event': 'Issue' };
}
function verificationContext(options) {
  return { secret: options.secret ?? secret, authority: options.authority ?? authority, now: options.now ?? now };
}
function verify(body = payload(), options = {}) {
  const raw = options.raw ?? JSON.stringify(body);
  const currentHeaders = { ...headers(raw), ...options.headers };
  const context = verificationContext(options);
  return verifyLinearEvent(raw, currentHeaders, context.secret, context.authority, context.now);
}
function changed(mutator) {
  const body = payload(); mutator(body); return body;
}
function fixedError(run, code) {
  assert.throws(run, error => {
    assert.equal(error.message, code);
    assert.equal(error.stack.includes(privateSentinel), false);
    assert.equal(error.stack.includes(secret), false);
    return true;
  });
}

test('exact signed transition normalizes identities without descriptions, names, or host IDs', () => {
  const body = payload(); const raw = JSON.stringify(body, null, 2);
  const event = verify(body, { raw });
  assert.equal(event.classification, 'received');
  assert.equal(event.providerDeliveryId, id(9));
  assert.equal(event.rawBodySha256, createHash('sha256').update(raw).digest('hex'));
  assert.match(event.sourceEventId, /^[a-f0-9]{64}$/);
  assert.equal(event.issueId, id(7)); assert.equal(event.organizationId, id(1));
  assert.equal(event.revision, iso(now - 999)); assert.equal(event.eventAt, iso(now - 1000));
  assert.equal(event.receivedAt, iso(now)); assert.equal(event.webhookTimestamp, now);
  assert.equal(event.sourceScopeWasAuthorized, true); assert.equal(event.currentScopeMatches, true);
  assert.deepEqual(event.actor, { id: id(6), type: 'user' });
  assert.deepEqual(event.previous, { stateId: id(8) });
  assert.equal(JSON.stringify(event).includes(privateSentinel), false);
  assert.equal(JSON.stringify(event).includes(secret), false);
});

test('byte representation, whitespace and Unicode escaping affect raw hash but never semantic identity', () => {
  const body = payload(); const raw = JSON.stringify(body);
  const baseline = verify(body, { raw });
  for (const representation of [Buffer.from(raw), new Uint8Array(Buffer.from(raw)), JSON.stringify(body, null, 2), raw.replace('café', 'caf\\u00e9')]) {
    const event = verify(body, { raw: representation });
    assert.equal(event.sourceEventId, baseline.sourceEventId);
    assert.equal(event.classification, 'received');
  }
  assert.notEqual(verify(body, { raw: JSON.stringify(body, null, 2) }).rawBodySha256, baseline.rawBodySha256);
});

test('semantic event identity survives delivery replacement, retry timestamp and object key ordering', () => {
  const body = payload(); const original = verify(body);
  const retry = { ...body, webhookTimestamp: now + 1000 };
  const redelivery = verify(retry, { now: now + 1000, headers: {
    'Linear-Delivery': id(10), 'Linear-Timestamp': String(now + 1000), 'X-Request-Id': 'different-host-request',
  } });
  assert.equal(redelivery.sourceEventId, original.sourceEventId);
  assert.notEqual(redelivery.rawBodySha256, original.rawBodySha256);
  const reversed = Object.fromEntries(Object.entries(body).reverse());
  assert.equal(verify(reversed).sourceEventId, original.sourceEventId);
  const newRevision = verify(changed(p => { p.data.updatedAt = iso(now); }));
  assert.notEqual(newRevision.sourceEventId, original.sourceEventId);
});

test('signature uses original bytes and is verified before JSON parsing or filtering', () => {
  const raw = JSON.stringify(payload(), null, 2);
  const normalized = JSON.stringify(JSON.parse(raw));
  fixedError(() => verifyLinearEvent(raw, headers(normalized), secret, authority, now), 'webhook_signature_invalid');
  fixedError(() => verify(null, { raw: '{invalid', headers: { 'Linear-Signature': '0'.repeat(64) } }), 'webhook_signature_invalid');
  fixedError(() => verify(null, { raw: '{invalid' }), 'webhook_envelope_invalid');
  fixedError(() => verify(payload(), { raw: `${JSON.stringify(payload())} `, headers: headers(JSON.stringify(payload())) }), 'webhook_signature_invalid');
});

test('tampered Unicode bytes and invalid UTF-8 fail closed', () => {
  const raw = Buffer.from(JSON.stringify(payload())); const h = headers(raw);
  const tampered = Buffer.from(raw); tampered[tampered.indexOf(Buffer.from('café'))] ^= 1;
  fixedError(() => verifyLinearEvent(tampered, h, secret, authority, now), 'webhook_signature_invalid');
  const invalidUtf8 = Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]);
  fixedError(() => verifyLinearEvent(invalidUtf8, headers(invalidUtf8), secret, authority, now), 'webhook_envelope_invalid');
});

for (const signature of [undefined, '', 'x'.repeat(64), 'ab', 'a'.repeat(63), 'a'.repeat(65), '00'.repeat(32)]) {
  test(`invalid signature form ${String(signature).length} is rejected with a fixed error`, () => {
    fixedError(() => verify(payload(), { headers: { 'Linear-Signature': signature } }), 'webhook_signature_invalid');
  });
}
test('hex signature is case-insensitive without normalizing the signed body', () => {
  const raw = JSON.stringify(payload());
  assert.equal(verify(payload(), { headers: { 'Linear-Signature': sign(raw).toUpperCase() } }).classification, 'received');
});

for (const name of ['Linear-Signature', 'Linear-Delivery', 'Linear-Timestamp', 'Linear-Event']) {
  test(`duplicate and array ${name} headers are rejected`, () => {
    const raw = JSON.stringify(payload()); const h = headers(raw);
    fixedError(() => verifyLinearEvent(raw, { ...h, [name.toLowerCase()]: h[name] }, secret, authority, now), 'webhook_headers_invalid');
    fixedError(() => verifyLinearEvent(raw, { ...h, [name]: [h[name]] }, secret, authority, now), 'webhook_headers_invalid');
  });
}
test('ordinary case-insensitive unique headers work; merged critical values do not', () => {
  const raw = JSON.stringify(payload()); const h = Object.fromEntries(Object.entries(headers(raw)).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(verifyLinearEvent(raw, h, secret, authority, now).classification, 'received');
  fixedError(() => verify(payload(), { headers: { 'Linear-Delivery': `${id(9)}, ${id(10)}` } }), 'webhook_delivery_invalid');
});

for (const delivery of [undefined, '', 'host-request-id', '10000000-0000-1000-8000-000000000009', '10000000-0000-7000-8000-000000000009']) {
  test('provider delivery is required UUIDv4, never a host request fallback', () => {
    fixedError(() => verify(payload(), { headers: { 'Linear-Delivery': delivery, 'X-Request-Id': id(9) } }), 'webhook_delivery_invalid');
  });
}

for (const delta of [-60000, 60000]) {
  test(`signed timestamp inclusive boundary ${delta} is accepted`, () => {
    const body = changed(p => { p.webhookTimestamp = now + delta; });
    assert.equal(verify(body, { headers: { 'Linear-Timestamp': String(now + delta) } }).classification, 'received');
  });
}
for (const delta of [-60001, 60001]) {
  test(`stale or future signed timestamp ${delta} cannot pass via unsigned header`, () => {
    const body = changed(p => { p.webhookTimestamp = now + delta; });
    fixedError(() => verify(body), 'webhook_timestamp_invalid');
  });
}
test('optional header timestamps and types must agree with signed fields', () => {
  assert.equal(verify(payload(), { headers: { 'Linear-Timestamp': undefined, 'Linear-Event': undefined } }).classification, 'received');
  for (const value of [String(now + 1), `0${now}`, `${now}.0`, '', 'private']) {
    fixedError(() => verify(payload(), { headers: { 'Linear-Timestamp': value } }), 'webhook_headers_invalid');
  }
  fixedError(() => verify(payload(), { headers: { 'Linear-Event': 'Comment' } }), 'webhook_headers_invalid');
});
for (const invalidNow of [NaN, Infinity, -1, now + 0.5]) {
  test('invalid injected clock cannot disable replay protection', () => {
    fixedError(() => verify(payload(), { now: invalidNow }), 'webhook_clock_invalid');
  });
}

test('2 MiB limit is measured in bytes and checked before HMAC or parsing', () => {
  for (const raw of ['é'.repeat(1024 * 1024 + 1), Buffer.alloc(2 * 1024 * 1024 + 1)]) {
    fixedError(() => verifyLinearEvent(raw, {}, secret, authority, now), 'webhook_body_too_large');
  }
  const raw = Buffer.alloc(2 * 1024 * 1024, 0x20);
  fixedError(() => verifyLinearEvent(raw, headers(raw), secret, authority, now), 'webhook_envelope_invalid');
});

const envelopeMutations = {
  missingOrganization: p => { delete p.organizationId; },
  invalidWebhook: p => { p.webhookId = privateSentinel; },
  missingClock: p => { delete p.webhookTimestamp; },
  stringClock: p => { p.webhookTimestamp = String(now); },
  invalidEventAt: p => { p.createdAt = '2026-02-30T00:00:00.000Z'; },
  missingIssueId: p => { delete p.data.id; },
  missingStateId: p => { delete p.data.stateId; p.data.state = { id: authority.todoStateId }; },
  missingTeamId: p => { delete p.data.teamId; },
  invalidProject: p => { p.data.projectId = privateSentinel; },
  missingRevision: p => { delete p.data.updatedAt; },
  invalidRevision: p => { p.data.updatedAt = 'yesterday'; },
  invalidArchivedAt: p => { p.data.archivedAt = true; },
  invalidPreviousState: p => { p.updatedFrom.stateId = privateSentinel; },
  invalidPreviousTeam: p => { p.updatedFrom.teamId = null; },
  invalidActor: p => { p.actor = { id: privateSentinel, type: 'user' }; },
};
for (const [name, mutate] of Object.entries(envelopeMutations)) {
  test(`${name} is an invalid envelope with no upstream diagnostic`, () => {
    fixedError(() => verify(changed(mutate)), 'webhook_envelope_invalid');
  });
}

const ignoredMutations = {
  organization_mismatch: p => { p.organizationId = id(90); },
  webhook_mismatch: p => { p.webhookId = id(90); },
  unsupported_action: p => { p.action = 'create'; },
  source_scope_mismatch: p => { p.data.teamId = id(90); },
  before_activation: p => { p.createdAt = iso(Date.parse(authority.activationAt) - 1); },
  actor_not_allowed: p => { p.actor.id = id(90); },
  no_todo_transition: p => { p.updatedFrom = { title: 'changed' }; },
};
for (const [reason, mutate] of Object.entries(ignoredMutations)) {
  test(`well-formed unrelated event is ignored: ${reason}`, () => {
    assert.deepEqual(verify(changed(mutate)), { classification: 'ignored', reason });
  });
}
test('non-Issue entity is ignored using its signed type', () => {
  const body = changed(p => { p.type = 'Comment'; p.data = { body: privateSentinel }; });
  assert.deepEqual(verify(body, { headers: { 'Linear-Event': 'Comment' } }), { classification: 'ignored', reason: 'unsupported_type' });
});
test('existing old ticket is allowed only by a new explicit Todo transition at activation', () => {
  const body = changed(p => { p.createdAt = authority.activationAt; });
  assert.equal(verify(body).classification, 'received');
  assert.equal(verify(changed(p => { p.updatedFrom.stateId = p.data.stateId; })).classification, 'ignored');
  assert.equal(verify(changed(p => { delete p.updatedFrom; })).classification, 'ignored');
  assert.equal(verify(changed(p => { p.updatedFrom = null; })).classification, 'ignored');
});
test('documented previous null is explicit while a missing previous state is not a transition', () => {
  assert.equal(verify(changed(p => { p.updatedFrom.stateId = null; })).classification, 'received');
});
for (const actor of [null, undefined, { id: id(90), type: 'user' }, { id: id(6), type: 'integration' }, { id: id(6), type: 'User' }]) {
  test('initiating actor requires an exact id and type pair', () => {
    assert.deepEqual(verify(changed(p => { p.actor = actor; })), { classification: 'ignored', reason: 'actor_not_allowed' });
  });
}

for (const mutate of [
  p => { p.data.stateId = id(8); p.updatedFrom.stateId = id(4); },
  p => { p.data.archivedAt = iso(now - 1000); },
  p => { p.action = 'remove'; },
]) {
  test('state exit, archive and remove produce withdrawal even for a non-initiating actor', () => {
    const body = changed(p => { mutate(p); p.actor = null; });
    const event = verify(body);
    assert.equal(event.classification, 'withdrawal');
    assert.equal(event.sourceScopeWasAuthorized, true);
    assert.equal(event.currentScopeMatches, true);
  });
}
for (const field of ['teamId', 'projectId']) {
  test(`moving ${field} out of authority withdraws using the previous scope`, () => {
    const body = changed(p => {
      p.updatedFrom[field] = p.data[field]; p.data[field] = id(90);
      p.actor = { id: id(99), type: 'integration' };
    });
    const event = verify(body);
    assert.equal(event.classification, 'withdrawal');
    assert.equal(event.sourceScopeWasAuthorized, true); assert.equal(event.currentScopeMatches, false);
  });
}
test('removing a project is a withdrawal, and moving into scope alone cannot initiate', () => {
  const exit = changed(p => { p.updatedFrom.projectId = p.data.projectId; p.data.projectId = null; });
  assert.equal(verify(exit).classification, 'withdrawal');
  const entry = changed(p => { p.updatedFrom = { projectId: null }; });
  assert.equal(verify(entry).classification, 'ignored');
  entry.updatedFrom.stateId = id(8);
  const event = verify(entry);
  assert.equal(event.classification, 'received');
  assert.equal(event.sourceScopeWasAuthorized, false); assert.equal(event.currentScopeMatches, true);
});
test('outside updates without proof of a previous authorized scope remain ignored', () => {
  for (const projectId of [null, id(90), undefined]) {
    const body = changed(p => { p.data.projectId = projectId; p.data.stateId = id(8); });
    assert.equal(verify(body).classification, 'ignored');
  }
});
test('non-Todo updates can only supply a withdrawal signal, never a received request', () => {
  const body = changed(p => { p.data.stateId = id(8); p.updatedFrom = { title: 'ordinary update' }; });
  assert.equal(verify(body).classification, 'withdrawal');
});
test('remove payload must retain the documented issue identity, scope, state and revision', () => {
  const body = changed(p => { p.action = 'remove'; p.data = { id: p.data.id }; });
  fixedError(() => verify(body), 'webhook_envelope_invalid');
});

test('invalid authority and empty signing secret never enter event processing', () => {
  fixedError(() => verify(payload(), { authority: { ...authority, activationAt: 'invalid' } }), 'webhook_authority_invalid');
  fixedError(() => verify(payload(), { authority: { ...authority, allowedActors: [] } }), 'webhook_authority_invalid');
  fixedError(() => verify(payload(), { secret: '' }), 'webhook_secret_invalid');
});
test('verification is deterministic and leaves raw inputs, headers and authority unchanged', () => {
  const raw = JSON.stringify(payload()); const h = Object.freeze(headers(raw));
  const a = Object.freeze(structuredClone(authority));
  const first = verifyLinearEvent(raw, h, secret, a, now);
  assert.deepEqual(verifyLinearEvent(raw, h, secret, a, now), first);
  assert.deepEqual(a, authority);
});
