import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { campaignReadinessSchema, parseCampaignMarker, resolveCampaignReference, textSha256 } from '../dist/campaign-contract.js';

const ref = content => ({ url: 'https://example.invalid/prd', version: '0.3', sha256: textSha256(content) });
const marker = value => `Human context\n\n\`\`\`paperclip-campaign\n${JSON.stringify(value)}\n\`\`\`\n`;

test('the shared campaign readiness fixture is strict and consumer-ready', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/campaign-readiness-contract.json', import.meta.url)));
  assert.deepEqual(campaignReadinessSchema.parse(fixture), fixture);
  assert.throws(() => campaignReadinessSchema.parse({ ...fixture, capabilities: ['fixed-source'] }));
});

test('one exact fenced marker is accepted without title heuristics', () => {
  const prd = ref('prd'), tad = { ...ref('tad'), url: 'https://example.invalid/tad', version: '0.2' };
  const parsed = parseCampaignMarker(marker({ schema: 'linear-milestone-campaign.v1',
    milestoneId: '10000000-0000-4000-8000-000000000003', prd, tad }));
  assert.deepEqual(parsed, { schema: 'linear-milestone-campaign.v1',
    milestoneId: '10000000-0000-4000-8000-000000000003', prd, tad });
});

test('missing fences remain historical Todo while malformed, repeated and widened markers fail closed', () => {
  assert.equal(parseCampaignMarker('ordinary Todo'), undefined);
  assert.throws(() => parseCampaignMarker('```paperclip-campaign\n{}\n```'), /campaign_marker_invalid/);
  const valid = marker({ schema: 'linear-milestone-campaign.v1', milestoneId: '10000000-0000-4000-8000-000000000003',
    prd: ref('prd'), tad: { ...ref('tad'), url: 'https://example.invalid/tad' } });
  assert.throws(() => parseCampaignMarker(valid + valid), /campaign_marker_invalid/);
  assert.throws(() => parseCampaignMarker(`${valid}\n\`\`\`paperclip-campaign\n{`), /campaign_marker_invalid/);
  assert.throws(() => parseCampaignMarker(valid.replace('"milestoneId"', '"unknown":true,"milestoneId"')), /campaign_marker_invalid/);
});

test('reference content is resolved only from the exact enrolled tuple and verified bytes', () => {
  const content = 'validated PRD'; const reference = ref(content);
  assert.equal(resolveCampaignReference(reference, [{ ...reference, content }]).content, content);
  assert.throws(() => resolveCampaignReference(reference, []), /campaign_reference_missing/);
  assert.throws(() => resolveCampaignReference(reference, [{ ...reference, content: 'changed' }]), /campaign_reference_invalid/);
  assert.throws(() => resolveCampaignReference(reference, [{ ...reference, content }, { ...reference, content }]), /campaign_reference_missing/);
});
