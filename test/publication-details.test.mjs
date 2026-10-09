import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPublicationComment, readPublicationComments } from '../dist/publication-comments.js';
import { campaignSourceIdentity } from '../dist/continuity-source.js';
import { parseConfig } from '../dist/config.js';
import { publicationFixture } from './helpers/publication-fixture.mjs';
import { sourceIds as ids } from './helpers/source-fixture.mjs';
import { uuid } from './helpers/council-handoff-fixture.mjs';

const noDb = { namespace:'plugin_linear_intake_e8c339297d', query: async () => assert.fail('DB'), execute: async () => assert.fail('DB') };

test('closure exposes exact criterion proof, obligation, source revision and enrolled campaign navigation', async () => {
  const f = await publicationFixture(noDb), { payload, intentId } = f.addIntent();
  const proofId = 'completion:revision-42:' + 'f'.repeat(64);
  const hash = 'c'.repeat(64), source = 'd'.repeat(64);
  const body = renderPublicationComment({ ...payload, kind:'closure', campaignClosure:{
    coverage:[{criterionId:'one',label:'Both deliveries retained'}],report:{verdict:'approved',rows:[{
      criterionId:'one',sourceSha256:hash,deliveryOrObligationIds:['delivery:leaf-a','transverse:campaign'],
      verification:{environment:'isolated native host',method:'readback plus synthetic test'},result:'satisfied',proofIds:[proofId],remainder:null,
    }]},
  }},intentId,{sources:[], references:[{label:'PRD',url:'https://example.test/prd',version:'commit-123',sha256:source}],
    sourceSha256:source,campaignUrl:`http://127.0.0.1:3210/issues/${uuid(7)}`});
  for (const exact of [proofId,hash,source,'delivery:leaf-a','transverse:campaign','version commit-123',`http://127.0.0.1:3210/issues/${uuid(7)}`]) {
    assert.ok(body.includes(exact), exact);
  }
  assert.ok(body.indexOf(proofId) > body.indexOf('Both deliveries retained'));
  assert.match(body,/1\/1 critères satisfaits/);
});

test('source presentation uses pinned PRD/TAD versions and actual native UUID route without guessing an origin', async () => {
  const f=await publicationFixture(noDb);
  const session={plan:f.plan,request:f.request};
  const original=campaignSourceIdentity(session,f.requestWire);
  assert.equal(original.presentation.campaignUrl,undefined);
  assert.deepEqual(original.presentation.references[0],{label:'PRD',...f.plan.plan.campaign.references.prd});
  assert.equal(original.presentation.sourceSha256,f.requestWire.sourceSha256);
  const present=campaignSourceIdentity(session,f.requestWire,'https://paperclip.example.test');
  assert.equal(present.presentation.campaignUrl,`https://paperclip.example.test/issues/${uuid(7)}`);
});

for (const value of ['https://paperclip.example.test','http://127.0.0.1:3210','http://localhost:3210','http://[::1]:3210']) {
  test(`enrolled display origin accepts ${value}`, async () => {
    const f=await publicationFixture(noDb); f.config.publisher.paperclipBaseUrl=value;
    assert.equal(parseConfig(f.config).publisher.paperclipBaseUrl,value);
  });
}
for (const value of ['http://paperclip.example.test','https://user:private@paperclip.example.test','https://paperclip.example.test?token=private','https://paperclip.example.test/#private','https://paperclip.example.test/issues','javascript:alert(1)']) {
  test('display origin rejects credentials, query, fragment, base path and unsafe schemes', async () => {
    const f=await publicationFixture(noDb); f.config.publisher.paperclipBaseUrl=value;
    assert.throws(()=>parseConfig(f.config),/^Error: invalid_configuration$/);
  });
}

test('missing or unsafe campaign URL is explicit and never rendered as an invented link', async () => {
  const f=await publicationFixture(noDb),{payload,intentId}=f.addIntent();
  for(const campaignUrl of [undefined,'javascript:alert(1)','https://user:private@example.test/']) {
    const body=renderPublicationComment(payload,intentId,{sources:[],references:[],campaignUrl});
    assert.match(body,/Lien vers la campagne Paperclip non configuré/);
    assert.equal(body.includes('[Campagne Paperclip]'),false); assert.equal(body.includes('private'),false);
  }
});

test('cancellation distinguishes retained verification, open PRs and unfinished source work', async () => {
  const f=await publicationFixture(noDb),{payload,intentId}=f.addIntent();
  const summary={schema:'council-linear-cancellation-summary-v1',retainedDeliveries:[
    {sourceId:ids.child,integratedCommit:'a'.repeat(40),url:'https://github.com/example/repo/pull/1',verified:true},
    {sourceId:ids.root,integratedCommit:'b'.repeat(40),url:'https://github.com/example/repo/pull/2',verified:false}],
    openPullRequests:[{sourceId:ids.root,url:'https://github.com/example/repo/pull/3'}],remainingWork:[{sourceId:ids.root}]};
  const body=renderPublicationComment({...payload,kind:'cancellation',cancellationSummary:summary},intentId,
    {sources:[{sourceId:ids.child,label:'SYN-2 — First'},{sourceId:ids.root,label:'SYN-1 — Remaining'}],references:[]});
  for(const value of ['SYN-2 — First : intégré, vérifié','SYN-1 — Remaining : intégré, vérification incomplète','PR ouverte, traitement humain requis','Travail restant : 1.','pull/1','pull/2','pull/3','a'.repeat(40),'b'.repeat(40)]) assert.ok(body.includes(value),value);
});

test('comment readback retains only observed safe URLs and never invents a missing one', async () => {
  const comment={id:uuid(1),body:'readback',issueId:ids.root,url:'https://linear.app/example/comment/observed'};
  assert.equal((await readPublicationComments(ids.root,1,async()=>({comments:[comment],hasNextPage:false})))[0].url,comment.url);
  const {url,...without}=comment;
  assert.equal((await readPublicationComments(ids.root,1,async()=>({comments:[without],hasNextPage:false})))[0].url,undefined);
  await assert.rejects(readPublicationComments(ids.root,1,async()=>({comments:[{...comment,url:'https://user:secret@linear.app/'}],hasNextPage:false})),/publication_comments_unqualified/);
});
