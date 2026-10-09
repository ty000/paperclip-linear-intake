import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publicationFixture,publicationConfig} from './helpers/publication-fixture.mjs';
import {sourceIds as ids} from './helpers/source-fixture.mjs';
import {uuid} from './helpers/council-handoff-fixture.mjs';
import {parseConfig} from '../dist/config.js';
import {fingerprint} from '../dist/intake-authority.js';
import {validateContinuityRequest,parseContinuityNotice,publicationPayloadSchema} from '../dist/continuity-contract.js';
import {publicationEffects,confirmedPublicationStates} from '../dist/publication-engine.js';
import {openPublicationClient} from '../dist/publication-client.js';
import {contentDigest} from '../dist/content-digest.js';
const noDb={namespace:'plugin_linear_intake_e8c339297d',query:async()=>{assert.fail('unexpected DB');},execute:async()=>{assert.fail('unexpected DB');}};
const notice=f=>({companyId:ids.company,missionId:uuid(30),nativeRootId:uuid(7),challengeId:f.requestWire.challengeId,requestSha256:contentDigest(f.requestWire)});
test('fixed request rejects mode/control/source identity widening, expired challenge and duplicate intents',async()=>{
 const f=await publicationFixture(noDb);f.addIntent();assert.deepEqual(validateContinuityRequest(notice(f),f.requestWire),f.requestWire);
 for(const edit of [r=>r.mode='legacy',r=>r.consumedSequence=1,r=>r.binding.campaignId=uuid(99),r=>r.expiresAt='2020-01-01T00:00:00.000Z',r=>r.publications.push(r.publications[0]),r=>r.publications[0].document.key='a'.repeat(65)]){
  const r=structuredClone(f.requestWire);edit(r);assert.throws(()=>validateContinuityRequest({...notice(f),requestSha256:contentDigest(r)},r));
 }
 assert.equal(parseContinuityNotice({payload:notice(f)}),undefined);
});
test('separate publication profile and exact secret scope; disabling writes preserves enrollment fingerprint',async()=>{
 const f=await publicationFixture(noDb);const base=parseConfig(f.config),fp=fingerprint(base);f.config.publisher.enabled=false;assert.equal(fingerprint(parseConfig(f.config)),fp);
 assert.throws(()=>parseConfig({...f.config,publisher:{...publicationConfig(),gatewayUrl:f.config.gatewayUrl}}),/profile_not_separate/);
 assert.throws(()=>parseConfig({...f.config,publisher:{...publicationConfig(),gatewayTokenRef:f.config.gatewayTokenRef}}),/profile_not_separate/);
 const c=await openPublicationClient(f.harness.ctx,ids.company,async()=>{});assert.equal(f.secretReads.at(-1).scope.configPath,'publisher.gatewayTokenRef');await c.comments(ids.root);await assert.rejects(c.comment(ids.root,'blocked'),/publication_disabled/);assert.equal(f.writes.length,0);
});
test('publisher paginates completely and honors exact input pin despite false write annotations',async()=>{
 const f=await publicationFixture(noDb);for(let i=0;i<5;i++)f.comments.push({id:uuid(600+i),body:`comment ${i}`,issueId:ids.root});
 const c=await openPublicationClient(f.harness.ctx,ids.company,async()=>{});assert.equal((await c.comments(ids.root)).length,5);assert.equal(f.publisherReads.length,3);
 f.config.publisher.tools.saveIssue.inputSchemaSha256='f'.repeat(64);await assert.rejects(openPublicationClient(f.harness.ctx,ids.company,async()=>{}),/catalog_changed/);
});
test('effects only target active membership, exact binding and bounded distinct status requests',async()=>{
 const f=await publicationFixture(noDb),{payload,intentId}=f.addIntent([{sourceId:ids.child,state:'started'}]);const active=new Set([ids.root,ids.child]);
 assert.equal(publicationEffects(f.requestWire,intentId,payload,active,f.config.publisher.states).length,2);
 assert.throws(()=>publicationEffects(f.requestWire,intentId,payload,new Set([ids.root]),f.config.publisher.states),/outside_campaign/);
 assert.throws(()=>publicationEffects(f.requestWire,intentId,{...payload,statusUpdates:[payload.statusUpdates[0],payload.statusUpdates[0]]},active,f.config.publisher.states),/duplicate_status/);
 assert.equal(publicationPayloadSchema.safeParse({...payload,statusUpdates:[{sourceId:ids.child,state:'Todo'}]}).success,false);
 assert.equal(publicationPayloadSchema.safeParse({...payload,statusUpdates:Array(34).fill(payload.statusUpdates[0])}).success,false);
});
test('ongoing state authority requires confirmed readback and terminal result dominates clock skew',()=>{
 const row=(state,stateId,confirmedAt,kind='confirmed')=>({payload:{statusUpdates:[{sourceId:ids.child,state}]},effects:[{kind:'status',sourceId:ids.child,state:kind,stateId,confirmedAt,readback:{stateId}}]});
 const rows=[row('completed',ids.done,'2020-01-01'),row('started',ids.started,'2040-01-01'),row('cancelled',ids.canceled,'2041-01-01','claimed')];
 assert.equal(confirmedPublicationStates(rows).get(ids.child),ids.done);assert.throws(()=>confirmedPublicationStates([...rows,row('cancelled',ids.canceled,'2019-01-01')]),/conflict/);
});
test('comment readback rejects missing continuation, duplicate IDs, scope drift and unknown output shapes',async()=>{
 const {readPublicationComments}=await import('../dist/publication-comments.js');
 for(const page of [{comments:[],hasNextPage:true},{comments:[{id:uuid(1),body:'a'},{id:uuid(1),body:'b'}],hasNextPage:false},
  {comments:[{id:uuid(1),body:'a',issueId:ids.outside}],hasNextPage:false},{nodes:[],pageInfo:{hasNextPage:false}}]){
  await assert.rejects(readPublicationComments(ids.root,2,async()=>page),/publication_comments_/);
 }
 let pages=0;await assert.rejects(readPublicationComments(ids.root,3,async()=>({comments:[{id:uuid(++pages),body:'a'}],hasNextPage:true,cursor:'same'})),/incomplete/);
});
test('human comment renders source scope, next step, PR and coverage without internal bindings or JSON',async()=>{
 const {renderPublicationComment}=await import('../dist/publication-comments.js');const f=await publicationFixture(noDb),{payload,intentId}=f.addIntent([{sourceId:ids.child,state:'completed'}]);
 const body=renderPublicationComment({...payload,kind:'closure',observation:{state:'complete',nextAction:'Vérification terminée.'},
  campaignDelivery:{result:{pullRequestUrl:'https://github.com/example/project/pull/7'}},
  campaignClosure:{coverage:[{criterionId:'internal-criterion',label:'Export lisible'}],report:{verdict:'approved',rows:[{criterionId:'internal-criterion',result:'satisfied',verification:{environment:'isolation',method:'test de lecture'},remainder:null}]}}},intentId,
  {sources:[{sourceId:ids.child,label:'SYN-2 — Export'}],references:[{label:'PRD',url:'https://example.test/prd'}]});
 assert.match(body,/Export lisible — Satisfait/);assert.match(body,/1\/1 critères satisfaits/);assert.match(body,/pull\/7/);assert.match(body,/SYN-2 — Export : Terminé/);assert.match(body,/Vérification terminée/);
 const main=body.split('<!--')[0];for(const value of [payload.binding.missionId,'internal-criterion','binding','sourceSha256','"protocol"'])assert.equal(main.includes(value),false);
});
test('human comments preserve delivery order and show blocked global coverage',async()=>{
 const {renderPublicationComment}=await import('../dist/publication-comments.js');const f=await publicationFixture(noDb),{payload,intentId}=f.addIntent([]);
 const context={sources:[{sourceId:ids.root,label:'Campaign'},{sourceId:ids.child,label:'First delivery'}],references:[]};
 const plan=renderPublicationComment({...payload,campaignPlan:{leaves:[{sourceId:ids.child},{sourceId:ids.root}]}},intentId,context);
 assert.match(plan,/1\. First delivery/);assert.match(plan,/2\. Campaign/);
 const blocked=renderPublicationComment({...payload,kind:'blocker',campaignReview:{coverage:[{criterionId:'shared',label:'Both files retained'}],report:{verdict:'blocked',rows:[{criterionId:'shared',result:'unknown',verification:{environment:'isolation',method:'integrated check'},remainder:'The second file is absent'}]}}},intentId,context);
 assert.match(blocked,/revue globale bloque la clôture/);assert.match(blocked,/Both files retained — À vérifier/);assert.match(blocked,/The second file is absent/);
});
