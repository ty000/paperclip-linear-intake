import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {isolatedDatabase} from './intake-db-helper.mjs';
import {publicationFixture,setState} from '../helpers/publication-fixture.mjs';
import {sourceIds as ids} from '../helpers/source-fixture.mjs';
import {uuid} from '../helpers/council-handoff-fixture.mjs';
import {createPublicationStore} from '../../dist/publication-store.js';
import {publicationEffects,dispatchPublication} from '../../dist/publication-engine.js';
import {openPublicationClient} from '../../dist/publication-client.js';
import {contentDigest} from '../../dist/content-digest.js';
let database;
before(async()=>{database=await isolatedDatabase();});after(async()=>database?.close());beforeEach(async()=>database.reset());
const state=(id,value)=>({sourceId:id,state:value});
test('authenticated native request publishes comment then members then terminal root with exact receipts',async()=>{
 const f=await publicationFixture(database.db);f.addIntent([state(ids.root,'completed'),state(ids.child,'completed')]);await f.sendContinuity();
 assert.equal(f.continuityResults.at(-1)?.availability,'available');assert.equal(f.continuityResults.at(-1).acknowledgements.length,1);
 assert.deepEqual(f.writes.map(w=>[w.role,w.args.id??w.args.issueId]),[['saveComment',ids.root],['saveIssue',ids.child],['saveIssue',ids.root]]);
 assert.deepEqual(f.continuityResults.at(-1).capabilities,['fixed-source','publication-readback']);assert.deepEqual(f.continuityResults.at(-1).changes,[]);
 assert.equal(f.continuityReferences.at(-1).key,contentDigest(f.continuityResults.at(-1)));
 assert.equal(f.continuityReferences.at(-1).key.length,64);
 assert.equal(f.continuityResults.at(-1).acknowledgements[0].publicationReceipt.key,`linear-publication-${uuid(40)}`);
 const first=f.continuityResults.at(-1).acknowledgements;await f.sendContinuity();assert.equal(f.writes.length,3);assert.deepEqual(f.continuityResults.at(-1).acknowledgements,first);
});
test('lost comment response reconciles original intent after reconstructed worker context without another comment',async()=>{
 let lost=false;const f=await publicationFixture(database.db,{afterCall(_f,role){if(role==='saveComment'&&!lost){lost=true;throw Error('lost');}}});f.addIntent([state(ids.child,'started')]);await f.sendContinuity();assert.equal(f.writes.length,1);
 const resumed=await publicationFixture(database.db);resumed.comments=f.comments;resumed.addIntent([state(ids.child,'started')]);await resumed.sendContinuity();
 assert.equal(resumed.writes.filter(w=>w.role==='saveComment').length,0);assert.equal(resumed.continuityResults.at(-1)?.acknowledgements.length,1);
});
test('lost status response first reconciles confirmed own state before ongoing source validation',async()=>{
 let lost=false;const f=await publicationFixture(database.db,{afterCall(_f,role){if(role==='saveIssue'&&!lost){lost=true;throw Error('lost');}}});f.addIntent([state(ids.child,'started')]);await f.sendContinuity();assert.equal(f.writes.length,2);
 f.current=false;f.request.status='withdrawn';f.request.version++;await f.sendContinuity();assert.equal(f.writes.length,2);assert.equal(f.continuityResults.at(-1)?.availability,'available');assert.equal(f.continuityResults.at(-1).acknowledgements.length,1);
});
test('manual started state or material edits block all writes without adopting source',async()=>{
 const f=await publicationFixture(database.db);f.addIntent();setState(f,ids.child,ids.started);await f.sendContinuity();assert.equal(f.writes.length,0);assert.equal(f.continuityResults.at(-1)?.availability,'unavailable');
 setState(f,ids.child,ids.todo);f.issues.get(ids.child).description+='scope changed';await f.sendContinuity();assert.equal(f.writes.length,0);
});
test('unobserved send remains claimed and blocks a different intent without blind retry',async()=>{
 const f=await publicationFixture(database.db,{beforeCall(_f,role){if(role==='saveComment')throw Error('lost before remote');}});f.addIntent();await f.sendContinuity();await f.sendContinuity();f.addIntent([],uuid(41));await f.sendContinuity();
 const rows=await createPublicationStore(database.db).list(ids.company,uuid(30));assert.equal(rows[0].effects[0].state,'claimed');assert.equal(f.writes.length,0);assert.ok(rows.length>=1);
});
test('revoked publisher remains read-only and never advances pending effects',async()=>{
 const f=await publicationFixture(database.db);f.config.publisher.enabled=false;f.addIntent([state(ids.child,'started')]);await f.sendContinuity();assert.equal(f.writes.length,0);assert.equal(f.continuityResults.at(-1)?.acknowledgements.length,0);
});
test('forged actor is rejected before configuration, source or journal I/O',async()=>{
 const f=await publicationFixture(database.db);f.addIntent();const before=f.configReads.length;await f.sendContinuity({actorType:'user',actorId:'private.paperclip-council'});assert.equal(f.configReads.length,before);assert.equal(f.writes.length,0);assert.equal(f.continuityResults.length,0);
});
test('PostgreSQL CAS concurrent original-intent dispatch emits once across independent stores',async()=>{
 const f=await publicationFixture(database.db),{intentId,payload}=f.addIntent();const a=createPublicationStore(database.db),b=createPublicationStore(database.db);await a.bind(f.requestWire,f.request);
 const client=await openPublicationClient(f.harness.ctx,ids.company,async()=>{});const row=await a.ensure(f.requestWire,intentId,payload,publicationEffects(f.requestWire,intentId,payload,new Set([ids.root]),client.publisher.states));
 await Promise.allSettled([dispatchPublication(a,client,structuredClone(row),async()=>{}),dispatchPublication(b,client,structuredClone(row),async()=>{})]);assert.equal(f.writes.length,1);assert.equal((await a.get(ids.company,intentId)).effects[0].state,'confirmed');
});
test('a later intent can read back an already-confirmed own status without sending it again',async()=>{
 const f=await publicationFixture(database.db);f.addIntent([state(ids.child,'started')]);await f.sendContinuity();f.requestWire.publications=[];f.addIntent([state(ids.child,'started')],uuid(41));await f.sendContinuity();
 assert.equal(f.continuityResults.at(-1)?.acknowledgements.length,1);assert.equal(f.writes.filter(w=>w.role==='saveIssue').length,1);assert.equal(f.comments.length,2);
});
test('manual completed state blocks publication before any comment',async()=>{
 const f=await publicationFixture(database.db);f.addIntent([state(ids.child,'completed')]);setState(f,ids.child,ids.done);await f.sendContinuity();assert.equal(f.writes.length,0);
});
test('revocation between durable claim and send leaves unknown original identity and never sends after resume',async()=>{
 const f=await publicationFixture(database.db);f.addIntent();const execute=f.harness.ctx.db.execute;
 f.harness.ctx.db.execute=async(sql,args)=>{const out=await execute(sql,args);if(sql.includes('SET effects=')&&JSON.parse(args[0])[0].state==='claimed')f.config.publisher.enabled=false;return out;};
 await f.sendContinuity();assert.equal(f.writes.length,0);f.config.publisher.enabled=true;await f.sendContinuity();assert.equal(f.writes.length,0);assert.equal((await createPublicationStore(database.db).list(ids.company,uuid(30)))[0].effects[0].state,'claimed');
});
test('two different campaign intents cannot acquire a publication slot concurrently',async()=>{
 const f=await publicationFixture(database.db),a=createPublicationStore(database.db),b=createPublicationStore(database.db);await a.bind(f.requestWire,f.request);
 const one=f.addIntent([],uuid(40)),two=f.addIntent([],uuid(41));const effects=p=>publicationEffects(f.requestWire,p.intentId,p.payload,new Set([ids.root]),f.config.publisher.states);
 const rows=await Promise.all([a.ensure(f.requestWire,one.intentId,one.payload,effects(one)),b.ensure(f.requestWire,two.intentId,two.payload,effects(two))]);const results=await Promise.allSettled([a.acquire(rows[0]),b.acquire(rows[1])]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('status mapping must name the enrolled semantic state, not just a valid UUID',async()=>{
 const f=await publicationFixture(database.db,{configure(config){[config.publisher.states.started,config.publisher.states.completed]=[config.publisher.states.completed,config.publisher.states.started];}});
 f.addIntent([{sourceId:ids.child,state:'started'}]);await f.sendContinuity();assert.equal(f.writes.length,0);assert.equal(f.continuityResults.at(-1)?.availability,'unavailable');
});
test('pause after lost final response still acknowledges original confirmed publication',async()=>{
 let lost=false;const f=await publicationFixture(database.db,{afterCall(_f,role){if(role==='saveIssue'&&!lost){lost=true;throw Error('lost');}}});
 f.addIntent([{sourceId:ids.child,state:'started'}]);await f.sendContinuity();f.requestWire.control='paused';await f.sendContinuity();assert.equal(f.writes.length,2);assert.equal(f.continuityResults.at(-1)?.acknowledgements.length,1);
});
test('an entirely pending started intent does not suppress a cancellation comment',async()=>{
 const f=await publicationFixture(database.db);f.config.publisher.enabled=false;f.addIntent([{sourceId:ids.child,state:'started'}]);await f.sendContinuity();
 f.requestWire.control='cancel_requested';f.config.publisher.enabled=true;f.addIntent([],uuid(41),'cancellation');await f.sendContinuity();
 assert.equal(f.comments.length,1);assert.equal(f.writes.filter(w=>w.role==='saveIssue').length,0);assert.deepEqual(f.continuityResults.at(-1)?.acknowledgements.map(a=>a.intentId),[uuid(41)]);
});

test('control comment can publish after prior comment readback while its started status stays pending',async()=>{
 const f=await publicationFixture(database.db);f.addIntent([{sourceId:ids.child,state:'started'}]);const execute=f.harness.ctx.db.execute;
 f.harness.ctx.db.execute=async(sql,args)=>{const out=await execute(sql,args);if(sql.includes('SET effects=')&&JSON.parse(args[0])[0].state==='confirmed')f.config.publisher.enabled=false;return out;};
 await f.sendContinuity();assert.equal(f.comments.length,1);const rows=await createPublicationStore(database.db).list(ids.company,uuid(30));assert.equal(rows[0].effects[1].state,'pending');
 f.harness.ctx.db.execute=execute;f.config.publisher.enabled=true;f.requestWire.control='paused';f.addIntent([],uuid(41),'decision');await f.sendContinuity();
 assert.equal(f.comments.length,2);assert.equal(f.writes.filter(w=>w.role==='saveIssue').length,0);assert.deepEqual(f.continuityResults.at(-1)?.acknowledgements.map(a=>a.intentId),[uuid(41)]);
 f.requestWire.control='running';await f.sendContinuity();assert.equal(f.writes.filter(w=>w.role==='saveIssue').length,1);assert.equal(f.continuityResults.at(-1)?.acknowledgements.length,2);
});
