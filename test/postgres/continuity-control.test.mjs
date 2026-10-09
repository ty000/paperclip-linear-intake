import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {isolatedDatabase} from './intake-db-helper.mjs';
import {publicationFixture,setState} from '../helpers/publication-fixture.mjs';
import {sourceIds as ids} from '../helpers/source-fixture.mjs';
import {uuid} from '../helpers/council-handoff-fixture.mjs';
import {createPublicationStore} from '../../dist/publication-store.js';

let database;
before(async()=>{database=await isolatedDatabase();});
after(async()=>database?.close());
beforeEach(async()=>database.reset());
const terminal=[{sourceId:ids.child,state:'completed'},{sourceId:ids.root,state:'completed'}];
const last=f=>f.continuityResults.at(-1);

test('source restoration alone cannot resume publication across a worker restart or stale request',async()=>{
 const f=await publicationFixture(database.db);f.addIntent();
 const original=f.issues.get(ids.child).description;
 f.issues.get(ids.child).description+=' private changed requirement';await f.sendContinuity();
 assert.equal(last(f).availability,'unavailable');assert.equal(last(f).diagnostic.code,'source_changed');
 assert.deepEqual(last(f).diagnostic.changedSourceIds,[ids.child]);assert.deepEqual(last(f).diagnostic.changedFields,['description']);
 assert.equal(JSON.stringify(last(f)).includes('private changed requirement'),false);
 f.issues.get(ids.child).description=original;await f.sendContinuity();assert.equal(last(f).availability,'available');assert.equal(f.writes.length,0);
 // Council may have missed the first unavailable notification. The durable
 // diagnostic must still force suspension after source restoration.
 assert.equal(last(f).diagnostic.code,'source_changed');
 const restarted=await publicationFixture(database.db);restarted.addIntent();await restarted.sendContinuity();assert.equal(restarted.writes.length,0);
 assert.deepEqual(last(restarted).diagnostic,last(f).diagnostic);
 restarted.requestWire.resumeVersion=9;await restarted.sendContinuity();assert.equal(restarted.comments.length,1);
 assert.equal(last(restarted).diagnostic,undefined);
 restarted.requestWire.publications=[];restarted.addIntent([],uuid(41));restarted.requestWire.resumeVersion=0;
 await restarted.sendContinuity();assert.equal(restarted.comments.length,1);
 restarted.requestWire.resumeVersion=9;await restarted.sendContinuity();assert.equal(restarted.comments.length,2);
});

test('each new source divergence requires a newer explicit resume',async()=>{
 const f=await publicationFixture(database.db);f.addIntent();
 const original=structuredClone(f.issues.get(ids.child));
 setState(f,ids.child,ids.started);await f.sendContinuity();assert.equal(last(f).availability,'unavailable');
 f.issues.set(ids.child,structuredClone(original));f.requestWire.resumeVersion=3;await f.sendContinuity();assert.equal(f.comments.length,1);
 f.requestWire.publications=[];f.addIntent([],uuid(41));setState(f,ids.child,ids.started);await f.sendContinuity();
 f.issues.set(ids.child,structuredClone(original));await f.sendContinuity();assert.equal(f.comments.length,1);
 f.requestWire.resumeVersion=4;await f.sendContinuity();assert.equal(f.comments.length,2);
});

test('scoped blocker comment can explain drift while status and terminal comments stay blocked',async()=>{
 const f=await publicationFixture(database.db);f.issues.get(ids.child).title+=' changed';
 f.addIntent([{sourceId:ids.child,state:'started'}]);f.addIntent([],uuid(41),'blocker');
 f.addIntent(terminal,uuid(42),'closure');f.grantTerminal(uuid(42));await f.sendContinuity();
 assert.equal(last(f).availability,'unavailable');assert.deepEqual(last(f).acknowledgements.map(a=>a.intentId),[uuid(41)]);
 assert.deepEqual(f.writes.map(w=>w.role),['saveComment']);assert.match(f.comments[0].body,/blocage/i);
});

test('drift diagnostic never bypasses the root project boundary or publisher revocation',async()=>{
 for(const change of [f=>{f.issues.get(ids.root).projectId=ids.outside;},f=>{f.config.publisher.enabled=false;}]){
  await database.reset();const f=await publicationFixture(database.db);f.addIntent([],uuid(41),'blocker');
  f.issues.get(ids.child).title+=' changed';change(f);await f.sendContinuity();assert.equal(f.writes.length,0);
 }
});

test('terminal intent waits without a local effect claim, then exact Council grant publishes once',async()=>{
 const f=await publicationFixture(database.db);f.addIntent(terminal,uuid(40),'closure');await f.sendContinuity();
 assert.equal(f.writes.length,0);assert.deepEqual(last(f).terminalClaimRequest,{intentId:uuid(40),payloadSha256:f.requestWire.publications[0].payloadSha256});
 const store=createPublicationStore(database.db);assert.ok((await store.get(ids.company,uuid(40))).effects.every(e=>e.state==='pending'));
 const [binding]=await database.db.query('SELECT active_intent_id FROM plugin_linear_intake_e8c339297d.campaign_publication_bindings');assert.equal(binding.active_intent_id,null);
 await f.sendContinuity();assert.equal(f.writes.length,0);
 f.grantTerminal();await f.sendContinuity();assert.equal(f.writes.length,3);assert.equal(last(f).acknowledgements.length,1);
 await f.sendContinuity();assert.equal(f.writes.length,3);
});

test('old ungranted terminal challenge cannot defeat pause or cancellation',async()=>{
 const f=await publicationFixture(database.db);f.addIntent(terminal,uuid(40),'closure');await f.sendContinuity();
 const old=structuredClone(f.requestWire);
 f.requestWire.control='paused';await f.sendContinuity();assert.equal(last(f).terminalClaimRequest,undefined);
 f.requestWire.control='cancel_requested';await f.sendContinuity();assert.equal(last(f).terminalClaimRequest,undefined);
 f.requestWire=old;await f.sendContinuity();assert.equal(f.writes.length,0);
});

test('grant replay after source drift remains held until explicit resume, including reconstructed worker',async()=>{
 const f=await publicationFixture(database.db);f.addIntent(terminal,uuid(40),'closure');f.grantTerminal();
 f.issues.get(ids.child).description+=' changed';await f.sendContinuity();assert.equal(f.writes.length,0);
 const resumed=await publicationFixture(database.db);resumed.addIntent(terminal,uuid(40),'closure');resumed.grantTerminal();
 await resumed.sendContinuity();assert.equal(last(resumed).availability,'available');assert.equal(resumed.writes.length,0);
 resumed.requestWire.resumeVersion=12;await resumed.sendContinuity();assert.equal(resumed.writes.length,3);
});

test('incompatible protocol, altered claim, and root completion disguised as progress never write',async()=>{
 for(const edit of [r=>{delete r.terminalPublicationProtocol;},r=>{delete r.resumeVersion;},r=>{r.publications[0].terminalClaim.payloadSha256='e'.repeat(64);}]){
  await database.reset();const f=await publicationFixture(database.db);f.addIntent(terminal,uuid(40),'closure');f.grantTerminal();edit(f.requestWire);
  await f.sendContinuity();assert.equal(f.writes.length,0);assert.equal(f.continuityResults.length,0);
 }
 await database.reset();const f=await publicationFixture(database.db);f.addIntent(terminal);await f.sendContinuity();assert.equal(f.writes.length,0);
});

test('real publication path uses configured native campaign URL and retains the original journal body',async()=>{
 const f=await publicationFixture(database.db,{configure(config){config.publisher.paperclipBaseUrl='http://127.0.0.1:3210';}});
 f.addIntent();await f.sendContinuity();assert.match(f.comments[0].body,new RegExp(`http://127.0.0.1:3210/issues/${uuid(7)}`));
 const original=f.comments[0].body;await f.sendContinuity();assert.equal(f.comments.length,1);assert.equal(f.comments[0].body,original);
});
