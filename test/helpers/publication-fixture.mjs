import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handoffFixture, challenge, uuid } from './council-handoff-fixture.mjs';
import { sourceIds as ids } from './source-fixture.mjs';
import { contentDigest } from '../../dist/content-digest.js';
import { CONTINUITY_PROTOCOL, CONTINUITY_REQUEST_EVENT } from '../../dist/continuity-contract.js';
const schema = { type: 'object', properties: {} };
const roles = { saveComment:'save_comment', listComments:'list_comments', saveIssue:'save_issue', getIssue:'get-issue' };
const publicationCatalog = Object.values(roles).map(s => ({ name:`synthetic:${s}`, inputSchema:schema, isWrite:false }));
export function publicationConfig() {
  return { enabled:true, gatewayUrl:'https://gateway.example.test/mcp/gateways/synthetic-publisher',
    gatewayTokenRef:{type:'secret_ref',secretId:uuid(90)}, states:{started:ids.started,completed:ids.done,cancelled:ids.canceled},
    tools:Object.fromEntries(Object.entries(roles).map(([r,s]) => [r,{name:`synthetic:${s}`,inputSchemaSha256:createHash('sha256').update(JSON.stringify(schema)).digest('hex')}])),
    maxCommentPages:10,pageSize:2 };
}
export function setState(f, id, stateId) {
  const i=f.issues.get(id), [name,type] = ({[ids.started]:['In Progress','started'],[ids.done]:['Done','completed'],[ids.canceled]:['Canceled','canceled'],[ids.todo]:['Todo','unstarted']})[stateId];
  i.status=name;i.statusType=type;i.stateHistory=[{state:{id:stateId,name,type},startedAt:'2026-10-07T12:00:00.000Z',endedAt:null}];
  i.completedAt=type==='completed'?'2026-10-07T12:00:00.000Z':null;i.canceledAt=type==='canceled'?'2026-10-07T12:00:00.000Z':null;
}
export async function publicationFixture(db, options={}) {
  const f=await handoffFixture({campaign:true,configure(config){config.councilContinuityEnabled=true;config.publisher=publicationConfig();}});
  const oldDb=f.harness.ctx.db;
  f.harness.ctx.db={namespace:db.namespace,query:(sql,params)=>sql.includes('campaign_publication')?db.query(sql,params):oldDb.query(sql,params),execute:db.execute.bind(db)};
  f.documents=new Map([[f.document.key,f.document]]); let documentNumber=100;
  f.harness.ctx.issues.documents.get=async (issueId,key,companyId)=>{assert.equal(companyId,ids.company);assert.equal(issueId,uuid(7));return structuredClone(f.documents.get(key)??null);};
  f.harness.ctx.issues.documents.upsert=async doc=>{f.documents.set(doc.key,{...doc,id:uuid(documentNumber++),latestRevisionId:uuid(documentNumber++),latestRevisionNumber:1});};
  const oldFetch=f.harness.ctx.http.fetch;
  f.comments=[];f.writes=[];f.publisherReads=[];
  connectPublisher(f, oldFetch, options);
  const c=challenge(f),{schema:_s,challengeId:_c,nonce:_n,stage:_st,admissionId:_a,mandateId:_m,mandateRevisionSha256:_mh,requestedAt:_r,expiresAt:_e,...subject}=c;
  f.bindingWire={companyId:ids.company,projectId:uuid(4),missionId:uuid(30),nativeRootId:uuid(7),campaignId:uuid(30),sourceRootId:ids.root,authoritySha256:'a'.repeat(64),subject};
  f.requestWire={protocol:CONTINUITY_PROTOCOL,mode:'milestone-fixed-v1',binding:f.bindingWire,challengeId:uuid(31),nonce:'b'.repeat(64),requestedAt:c.requestedAt,expiresAt:c.expiresAt,sourceSha256:f.plan.plan.campaign.materialSourceSha256,consumedSequence:0,control:'running',publications:[]};
  const put=(key,payload)=>{const body=JSON.stringify(payload),doc={key,body,id:uuid(documentNumber++),latestRevisionId:uuid(documentNumber++)};f.documents.set(key,doc);return {key,documentId:doc.id,revisionId:doc.latestRevisionId,bodySha256:contentDigest(body)};};
  f.addIntent=(updates=[],intentId=uuid(40))=>{const payload={protocol:CONTINUITY_PROTOCOL,mode:'milestone-fixed-v1',binding:f.bindingWire,sourceSha256:f.requestWire.sourceSha256,kind:'progress',message:'Synthetic campaign progress',statusUpdates:updates};const payloadSha256=contentDigest(payload);f.requestWire.publications.push({intentId,payloadSha256,document:put(`publication-${intentId}`,{intentId,payloadSha256,payload})});return {intentId,payload};};
  f.continuityResults=[];f.harness.ctx.events.on('plugin.ty000.linear-intake.council-continuity-result',event=>{f.continuityResults.push(JSON.parse(f.documents.get(event.payload.response.key).body));});
  f.sendContinuity=async overrides=>{const request=f.requestWire,proof=put(`request-${uuid(documentNumber++)}`,request);await f.harness.emit(CONTINUITY_REQUEST_EVENT,{protocol:CONTINUITY_PROTOCOL,companyId:ids.company,missionId:uuid(30),nativeRootId:uuid(7),challengeId:request.challengeId,requestSha256:contentDigest(request),request:proof},{companyId:ids.company,actorType:'plugin',actorId:'private.paperclip-council',...overrides});};
  return f;
}

function publisherHandlers(f) {
  return {
    listComments(args) {
      f.publisherReads.push('listComments'); const start=Number(args.cursor??0), comments=f.comments.slice(start,start+args.limit);
      const next=start+comments.length, hasNextPage=next<f.comments.length;
      return {comments,hasNextPage,...(hasNextPage?{cursor:String(next)}:{})};
    },
    getIssue(args){f.publisherReads.push('getIssue');return structuredClone(f.issues.get(args.id));},
    saveComment(args){assert.deepEqual(Object.keys(args).sort(),['body','issueId']);f.writes.push({role:'saveComment',args});f.comments.push({id:uuid(500+f.comments.length),body:args.body,issueId:args.issueId});return {id:f.comments.at(-1).id};},
    saveIssue(args){assert.deepEqual(Object.keys(args).sort(),['id','state']);f.writes.push({role:'saveIssue',args});setState(f,args.id,args.state);return {id:args.id};},
  };
}
async function publisherCall(f, options, handlers, rpc) {
  const {name,arguments:args}=rpc.params, role=Object.keys(roles).find(r=>name===`synthetic:${roles[r]}`);assert.ok(role);
  await options.beforeCall?.(f,role,args);
  const result=handlers[role](args);
  await options.afterCall?.(f,role,args);
  return {isError:false,structuredContent:{isError:false,structuredContent:null,content:[{type:'text',text:JSON.stringify(result)}]}};
}
function connectPublisher(f, oldFetch, options) {
  const handlers=publisherHandlers(f);
  const replies={initialize:()=>({protocolVersion:'2025-03-26',capabilities:{tools:{}}}),
    'tools/list':()=>({tools:publicationCatalog}), 'tools/call':rpc=>publisherCall(f,options,handlers,rpc)};
  f.harness.ctx.http.fetch=async(url,init)=>{
    if(url!==f.config.publisher.gatewayUrl)return oldFetch(url,init);
    const rpc=JSON.parse(init.body);
    if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:rpc.id,result:await replies[rpc.method](rpc)});
  };
}
