import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import { isolatedDatabase } from './intake-db-helper.mjs';
import { publicationFixture } from '../helpers/publication-fixture.mjs';
import { sourceIds as ids } from '../helpers/source-fixture.mjs';
import { uuid } from '../helpers/council-handoff-fixture.mjs';
import { deferred } from '../helpers/intake-fixture.mjs';
import { createPublicationStore } from '../../dist/publication-store.js';
import { createIntakeStore } from '../../dist/intake-store.js';
import { createIntakeRuntime } from '../../dist/intake-runtime.js';
import { verifyCampaignChange } from '../../dist/webhook-event.js';
import { retainCampaignChange, projectCampaignChanges } from '../../dist/source-invalidation.js';
import { SOURCE_OBSERVATION_PROTOCOL } from '../../dist/continuity-contract.js';

const ns = 'plugin_linear_intake_e8c339297d', secret = 'synthetic-event-webhook-secret';
let database;
before(async () => { database = await isolatedDatabase(); });
beforeEach(async () => { await database.reset(); });
after(async () => { await database?.close(); });
const rows = () => database.db.query(`SELECT generation,event FROM ${ns}.campaign_source_changes ORDER BY generation`);
const last = f => f.continuityResults.at(-1);
function upgraded(f, purpose = 'action', generation = 0) {
  Object.assign(f.requestWire, { sourceObservationProtocol: SOURCE_OBSERVATION_PROTOCOL,
    sourceInvalidationVersion: generation, observationPurpose: purpose, challengeId: randomUUID() });
}
async function enrolled(options) {
  const f = await publicationFixture(database.db, options);
  await createIntakeStore(database.db).activateBinding(f.binding);
  await createPublicationStore(database.db).bind(f.requestWire, f.request);
  const query=f.harness.ctx.db.query;
  f.harness.ctx.db.query=(sql,params=[])=>sql.includes('.intake_binding') && !params.length ? database.db.query(sql,params) : query(sql,params);
  const resolve = f.harness.ctx.secrets.resolve;
  f.harness.ctx.secrets.resolve = (ref, scope) => scope.configPath === 'intake.webhookSecretRef' ? Promise.resolve(secret) : resolve(ref, scope);
  return f;
}
function input(f, mutate = () => {}, delivery = randomUUID()) {
  const body = { organizationId: ids.organization, webhookId: f.binding.authority.webhookId,
    type: 'Issue', action: 'update', createdAt: new Date().toISOString(), webhookTimestamp: Date.now(),
    data: { id: ids.child, teamId: ids.team, projectId: ids.project, stateId: ids.todo,
      updatedAt: new Date().toISOString(), archivedAt: null, description: 'private current requirement' },
    updatedFrom: { description: 'private old requirement' } };
  mutate(body);
  const rawBody = JSON.stringify(body);
  return { endpointKey: 'linear-todo', requestId: randomUUID(), rawBody,
    headers: { 'Linear-Signature': createHmac('sha256', secret).update(rawBody).digest('hex'), 'Linear-Delivery': delivery } };
}
function change(f, value) { return verifyCampaignChange(value.rawBody,value.headers,secret,f.binding.authority,Date.now()); }
async function retain(f, mutate) {
  const event = change(f,input(f,mutate));
  if (event) await retainCampaignChange(database.db,f.binding,event);
}

test('signed description change while still Todo is durable before ACK, with no source HTTP or native hint', async () => {
  const f = await enrolled(), written = deferred(), release = deferred();
  const db = f.harness.ctx.db, execute = db.execute;
  db.execute = async (sql, params) => { const result = await execute(sql,params);
    if (sql.startsWith(`INSERT INTO ${ns}.campaign_source_changes`)) { written.resolve(); await release.promise; } return result; };
  const hints = []; f.harness.ctx.events.on('plugin.ty000.linear-intake.council-source-invalidated', e => hints.push(e));
  const runtime = createIntakeRuntime(f.harness.ctx), event = input(f);
  let ack = false; const receiving = runtime.receive(event).then(() => { ack = true; });
  await written.promise;
  try { assert.equal(ack,false); assert.equal((await rows()).length,1); assert.equal(f.sourceCalls.length,0); assert.equal(hints.length,0); }
  finally { release.resolve(); }
  await receiving; db.execute = execute;
  await runtime.receive(event);
  const retry = JSON.parse(event.rawBody); retry.webhookTimestamp = Date.now();
  const rawBody = JSON.stringify(retry);
  await runtime.receive({ ...event,rawBody,headers:{'Linear-Delivery':randomUUID(),'Linear-Signature':createHmac('sha256',secret).update(rawBody).digest('hex')} });
  assert.equal((await rows()).length,1);
  assert.equal(JSON.stringify(await rows()).includes('private'),false);
  assert.equal(f.sourceCalls.length,0); assert.equal(f.publisherReads.length,0);
});

test('relevant signed status, removal, reparenting, scope exit, new milestone member and new descendant invalidate', async () => {
  const f = await enrolled();
  for (const mutate of [
    b => { b.updatedFrom={stateId:ids.todo};b.data.stateId=ids.started; },
    b => { b.action='remove'; },
    b => { b.updatedFrom={parentId:ids.root};b.data.parentId=ids.outside; },
    b => { b.updatedFrom={projectId:ids.project};b.data.projectId=ids.outside; },
    b => { b.data.id=uuid(81);b.updatedFrom={projectMilestoneId:null};b.data.projectMilestoneId=ids.milestone; },
    b => { b.action='create';b.data.id=uuid(82);b.data.parentId=ids.child; },
    b => { b.updatedFrom={relations:{blockedBy:[]}}; },
    b => { b.updatedFrom={blockedByIds:[]}; },
  ]) await retain(f,mutate);
  assert.equal((await rows()).length,8);
  assert.equal(f.sourceCalls.length,0);
});

test('wrong scope, signatures, unrelated Issue metadata and Comment echoes cannot dirty the campaign', async () => {
  const f = await enrolled();
  for (const mutate of [
    b => { b.data.id=ids.outside; }, b => { b.organizationId=ids.outside; },
    b => { b.webhookId=ids.outside; }, b => { b.updatedFrom={updatedAt:b.data.updatedAt}; },
    b => { b.type='Comment';b.data={body:'publication echo'}; },
  ]) await retain(f,mutate);
  const bad=input(f);bad.headers['Linear-Signature']='0'.repeat(64);
  assert.throws(()=>change(f,bad),/webhook_signature_invalid/);
  assert.equal((await rows()).length,0);
});

test('local binding pagination retains a change beyond sixty-four historical campaigns', async () => {
  const f=await enrolled(), store=createPublicationStore(database.db);
  for(let n=0;n<65;n++){
    const request=structuredClone(f.requestWire);request.binding.missionId=uuid(1000+n);request.binding.campaignId=request.binding.missionId;
    await store.bind(request,f.request);
  }
  await retain(f);assert.equal((await rows()).length,66);
});

test('burst coalesces in a native document; lost hint and restarted projection use no source read', async () => {
  const f = await enrolled();
  await Promise.all(Array.from({length:8},(_,n)=>retain(f,b=>{b.data.id=n%2?ids.child:ids.root;b.data.updatedAt=new Date(Date.now()+n).toISOString();})));
  const emit=f.harness.ctx.events.emit; let emitted=0;
  f.harness.ctx.events.emit=async()=>{emitted++;throw new Error('lost_native_hint');};
  await assert.rejects(projectCampaignChanges(f.harness.ctx,f.binding),/lost_native_hint/);
  const document=JSON.parse(f.documents.get('linear-source-invalidation').body);
  assert.equal(document.generation,Number((await rows()).at(-1).generation));
  assert.deepEqual(document.sourceIds,[ids.root,ids.child].sort());
  f.harness.ctx.events.emit=emit;
  await projectCampaignChanges({...f.harness.ctx},f.binding);
  assert.equal(emitted,1);assert.equal(f.sourceCalls.length,0);
  assert.deepEqual(JSON.parse(f.documents.get('linear-source-invalidation').body),document);
});

test('material invalidation during observation remains newer than the exact echoed request generation', async () => {
  const f=await enrolled();upgraded(f,'event',0);
  const fetch=f.harness.ctx.http.fetch;let changed=false;
  f.harness.ctx.http.fetch=async (...args)=>{if(!changed){changed=true;await retain(f); }return fetch(...args);};
  await f.sendContinuity();
  assert.equal(last(f).sourceObservationProtocol,SOURCE_OBSERVATION_PROTOCOL);
  assert.equal(last(f).sourceInvalidationVersion,0);
  await projectCampaignChanges(f.harness.ctx,f.binding);
  assert.ok(JSON.parse(f.documents.get('linear-source-invalidation').body).generation>0);
});

test('lost result and restarted response cache return the original proof without source or publisher reads', async () => {
  const f=await enrolled();upgraded(f);await f.sendContinuity();
  const result=structuredClone(last(f)), counts=[f.sourceCalls.length,f.publisherReads.length];
  await f.sendContinuity();assert.deepEqual(last(f),result);assert.deepEqual([f.sourceCalls.length,f.publisherReads.length],counts);
  const restarted=await publicationFixture(database.db);restarted.requestWire=structuredClone(f.requestWire);
  await restarted.sendContinuity();assert.deepEqual(last(restarted),result);
  assert.equal(restarted.sourceCalls.length,0);assert.equal(restarted.publisherReads.length,0);
  restarted.requestWire.sourceInvalidationVersion=1;
  await restarted.sendContinuity();assert.equal(restarted.continuityResults.length,1);
});

test('readback only reconciles claimed original effects and never scans source or dispatches pending/new intents', async () => {
  let lose=true;
  const f=await enrolled({afterCall(_f,role){if(lose && role==='saveComment'){lose=false;throw new Error('lost_write_reply');}}});
  f.addIntent([{sourceId:ids.child,state:'started'}]);upgraded(f,'publication');await f.sendContinuity();
  const store=createPublicationStore(database.db), original=await store.get(ids.company,uuid(40));
  assert.equal(original.effects[0].state,'claimed');assert.equal(f.writes.length,1);
  f.addIntent([],uuid(41));f.sourceCalls.length=0;upgraded(f,'readback');await f.sendContinuity();
  const observed=await store.get(ids.company,uuid(40));
  assert.equal(observed.effects[0].state,'confirmed');assert.equal(observed.effects[1].state,'pending');
  assert.equal(await store.get(ids.company,uuid(41)),undefined);
  assert.equal(f.sourceCalls.length,0);assert.equal(f.writes.length,1);
  assert.equal(last(f).observationPurpose,'readback');assert.equal(last(f).acknowledgements.length,0);
});

test('pause retains invalidation silently; explicit resume takes one complete observation', async () => {
  const f=await enrolled();await retain(f);upgraded(f,'event',Number((await rows())[0].generation));
  f.requestWire.control='paused';await f.sendContinuity();await projectCampaignChanges(f.harness.ctx,f.binding);
  assert.equal(f.sourceCalls.length,0);assert.equal(f.publisherReads.length,0);assert.equal(f.writes.length,0);
  f.requestWire.control='running';f.requestWire.resumeVersion=1;upgraded(f,'recovery',f.requestWire.sourceInvalidationVersion);
  await f.sendContinuity();assert.ok(f.sourceCalls.length>0);assert.equal(last(f).availability,'available');
});

for(const mutation of ['body','revision','delete']) test(`readback rejects ${mutation} drift in the exact pinned publication document`,async()=>{
  const f=await enrolled();f.addIntent();upgraded(f,'publication');await f.sendContinuity();
  assert.equal(last(f).acknowledgements.length,1);
  const reference=f.requestWire.publications[0].document, doc=f.documents.get(reference.key);
  if(mutation==='body')doc.body+=' ';
  if(mutation==='revision')doc.latestRevisionId=randomUUID();
  if(mutation==='delete')f.documents.delete(reference.key);
  f.sourceCalls.length=0;f.publisherReads.length=0;upgraded(f,'readback');await f.sendContinuity();
  assert.equal(last(f).availability,'unavailable');assert.equal(last(f).acknowledgements.length,0);
  assert.equal(f.sourceCalls.length,0);assert.equal(f.publisherReads.length,0);assert.equal(f.writes.length,1);
});

test('own status echo before confirmation yields one invalidation; confirmed exact echo is silent', async () => {
  let f;
  f=await enrolled({afterCall:async (_f,role)=>{if(role==='saveIssue')await retain(f,b=>{
    b.data.id=ids.child;b.data.stateId=ids.started;b.data.updatedAt=f.issues.get(ids.child).updatedAt;b.updatedFrom={stateId:ids.todo};
  });}});
  f.addIntent([{sourceId:ids.child,state:'started'}]);upgraded(f,'publication');await f.sendContinuity();
  assert.equal((await rows()).length,1);
  await retain(f,b=>{b.data.id=ids.child;b.data.stateId=ids.started;b.data.updatedAt=f.issues.get(ids.child).updatedAt;b.updatedFrom={stateId:ids.todo};});
  assert.equal((await rows()).length,1);
  upgraded(f,'event',Number((await rows())[0].generation));f.requestWire.publications=[];await f.sendContinuity();
  assert.equal((await rows()).length,1);assert.equal(f.writes.length,2);assert.equal(last(f).availability,'available');
});
