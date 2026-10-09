import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueDocumentKeySchema } from '@paperclipai/shared';
import { ensureContinuityDocument, readContinuityDocument } from '../dist/continuity-documents.js';

function documentStore() {
  const documents = new Map(), calls = [];
  const ctx = { issues: { documents: {
    async get(issueId, key, companyId) {
      assert.equal(issueDocumentKeySchema.parse(key), key);
      calls.push(['get', issueId, key, companyId]);
      return documents.get(key) ?? null;
    },
    async upsert(input) {
      assert.equal(issueDocumentKeySchema.parse(input.key), input.key);
      calls.push(['upsert', input.key]);
      documents.set(input.key, { ...input, id: 'document', latestRevisionId: 'revision' });
    },
  } } };
  return { ctx, calls };
}

for (const length of [1, 32, 64]) {
  test(`native document key length ${length} keeps the original identity on readback and replay`, async () => {
    const { ctx, calls } = documentStore(), key = 'a'.repeat(length), payload = { challenge: 'original' };
    const reference = await ensureContinuityDocument(ctx, 'company', 'issue', key, payload);
    assert.equal(reference.key, key);
    assert.deepEqual(await readContinuityDocument(ctx, 'company', 'issue', reference), payload);
    assert.deepEqual(await ensureContinuityDocument(ctx, 'company', 'issue', key, payload), reference);
    await assert.rejects(ensureContinuityDocument(ctx, 'company', 'issue', key, { challenge: 'changed' }), /continuity_document_unknown/);
    assert.equal(calls.filter(call => call[0] === 'upsert').length, 1);
  });
}

for (const key of ['', 'a'.repeat(65), 'Uppercase', '-prefix', '_prefix', 'slash/key', ' padded ', 'é']) {
  test(`invalid document identity ${JSON.stringify(key)} is rejected before any native access`, async () => {
    const { ctx, calls } = documentStore();
    await assert.rejects(ensureContinuityDocument(ctx, 'company', 'issue', key, {}), /continuity_document_key/);
    await assert.rejects(readContinuityDocument(ctx, 'company', 'issue', { key }), /continuity_document_key/);
    assert.deepEqual(calls, []);
  });
}

test('the native schema rejects the previous response key while retaining a full digest and the existing receipt key', () => {
  const challengeId = '00000000-0000-4000-8000-000000000001', digest = 'a'.repeat(64);
  assert.equal(issueDocumentKeySchema.safeParse(`linear-continuity-${challengeId}-${digest}`).success, false);
  assert.equal(issueDocumentKeySchema.parse(digest), digest);
  const receiptKey = `linear-publication-${challengeId}`;
  assert.equal(issueDocumentKeySchema.parse(receiptKey), receiptKey);
});
