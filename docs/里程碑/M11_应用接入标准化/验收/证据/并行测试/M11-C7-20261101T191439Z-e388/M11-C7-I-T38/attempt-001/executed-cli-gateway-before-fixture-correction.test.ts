import {randomUUID,createHash} from 'node:crypto';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {applicationMcpServerName} from '@shared/application-session';
import {digest} from '../manifest';
import {once} from 'node:events';
import {existsSync,readdirSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {connect,type Socket} from 'node:net';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BridgeResponse} from '@shared/application-bridge';
import {ApplicationCliGateway} from '../cli-gateway';
import {SecretsStore} from '../../../secrets';
import type {UnixPeerIdentity} from '../unix-peer-identity';
import {cliFixture} from './cli-fixture';

let f:Awaited<ReturnType<typeof cliFixture>>,gateway:ApplicationCliGateway,time:number,identity:UnixPeerIdentity|null,peerReads:number;
let issued:ReturnType<ApplicationCliGateway['issue']>;
const evidence=process.env.WILLYOU_TEST_EVIDENCE_DIR!;if(!evidence||!resolve(evidence).includes('/t38-worker/delivery-t38/'))throw Error('Private T38 evidence required');mkdirSync(evidence,{recursive:true});let activeCase='';const fixtureRoots:string[]=[],endpoints:string[]=[];
const record=(event:string,value:unknown)=>appendFileSync(join(evidence,'calls.jsonl'),JSON.stringify({at:new Date().toISOString(),test:activeCase,event,value})+'\n');
const sockets=new Set<Socket>();
async function client(){
 const socket=connect(gateway.endpoint);sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));await once(socket,'connect');
 return{socket,send:(value:Record<string,unknown>)=>new Promise<BridgeResponse>((ok,fail)=>{let text='';const timer=setTimeout(()=>{cleanup();fail(Error('Private CLI fixture deadline'));},5000);const cleanup=()=>{clearTimeout(timer);socket.off('data',data);socket.off('close',closed);};const closed=()=>{cleanup();fail(Error('Private CLI fixture closed'));};const data=(chunk:Buffer)=>{text+=chunk.toString();const end=text.indexOf('\n');if(end>=0){cleanup();const response=JSON.parse(text.slice(0,end));record('response',{response,controlledPeerIdentity:identity,peerReads,businessInvocations:count()});ok(response);}};socket.on('data',data);socket.once('close',closed);record('request',{...value,...(typeof value.token==='string'?{token:'redacted-run-token',tokenSha256:createHash('sha256').update(value.token).digest('hex')}:{})});socket.write(JSON.stringify(value)+'\n');})};
}
const request=(extra:Record<string,unknown>={})=>({schema:'willyou-cli-v1',id:randomUUID(),token:issued.environment.WILLYOU_RUN_TOKEN,method:'capabilities/call',call:{operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}},...extra});
const count=()=>f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get();
beforeEach(async context=>{activeCase=context.task.name;
 f=await cliFixture();time=Date.now();peerReads=0;identity={schema:2,state:'running',uid:process.getuid!(),peer:{pid:921002,startedAt:'darwin-proc-v1:2026:921002',executable:f.executable},ancestors:[{pid:921002,startedAt:'darwin-proc-v1:2026:921002',ppid:921001},{pid:921001,startedAt:'darwin-proc-v1:2026:921001',ppid:1}]};
 gateway=new ApplicationCliGateway(f.runs,f.cli,{read:async()=>{peerReads++;return identity;}},{executable:{path:f.executable,sha256:f.executableHash},now:()=>time,tokenTtlMs:30000});await gateway.start();issued=gateway.issue(f.run);fixtureRoots.push(f.root);endpoints.push(gateway.endpoint);
});
afterEach(async()=>{for(const socket of sockets)socket.destroy();sockets.clear();await gateway?.close();vi.restoreAllMocks();await f?.cleanup();writeFileSync(join(evidence,'fixture-cleanup.json'),JSON.stringify({at:new Date().toISOString(),fixtureRoots,endpoints,remainingRoots:fixtureRoots.filter(existsSync),remainingEndpoints:endpoints.filter(existsSync),openClientSockets:sockets.size,noAppPtyCodexHelperBuild:true})+'\n');});

describe('M11 CLI invocation through the common production executor',()=>{
 it('shares draft data and v2 results with the page, fixes CLI origin, and closes the inactive MCP fallback',async()=>{
  expect((await f.cli.list(f.run.runId)).tools.map(t=>t.name)).toEqual(['mail.draft.list']);expect((await f.mcp.list(f.run.runId)).tools).toEqual([]);
  const first=await f.cli.call(f.run.runId,randomUUID(),{operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}});
  expect(first).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',capabilityId:'mail.draft.list',data:{items:[],nextCursor:null},operation:{origin:'cli',effectState:'read-only'}}});
  expect(await f.mcp.call(f.run.runId,randomUUID(),{operation:'smartdd_mail_draft_list_v2',contractMajor:2,connectionId:null,arguments:{}})).toMatchObject({status:'error',error:{code:'ENTRY_NOT_ACTIVE'}});
  expect(count()).toEqual({n:1});
 });
 it('keeps per-request replay without performing the same read twice and rejects changed inputs',async()=>{
  const execute=vi.spyOn(f.applications.data,'execute'),id=randomUUID(),input={operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}};
  const first=await f.cli.call(f.run.runId,id,input),again=await f.cli.call(f.run.runId,id,input);expect(first).toMatchObject({status:'ok'});expect(again).toEqual(first);expect(execute).toHaveBeenCalledTimes(1);
  expect(await f.cli.call(f.run.runId,id,{...input,arguments:{limit:1}})).toMatchObject({status:'error',error:{code:'REQUEST_CONFLICT'}});expect(count()).toEqual({n:1});
 });
});

describe('M11 independent CLI endpoint: authentication always precedes business',()=>{
 it('authenticates the fixed binary and exact managed ancestor before the real data invocation',async()=>{
  const c=await client();expect(await c.send(request())).toMatchObject({status:'ok',value:{operation:{origin:'cli'},data:{items:[]}}});expect(peerReads).toBe(1);expect(count()).toEqual({n:1});
 });
 it('keeps environment-only tokens off disk, declarations and denial audit',async()=>{
  expect(Object.keys(issued.environment).sort()).toEqual(['WILLYOU_ENDPOINT','WILLYOU_RUN_TOKEN']);expect(readdirSync(dirname(gateway.endpoint))).toEqual(['cli.sock']);
  const c=await client(),listed=await c.send(request({method:'capabilities/list',call:undefined}));expect(listed.status).toBe('ok');expect(JSON.stringify(listed)).not.toContain(issued.environment.WILLYOU_RUN_TOKEN);
  await c.send(request({token:'f'.repeat(64)}));expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM capability_broker_denials').all())).not.toContain(issued.environment.WILLYOU_RUN_TOKEN);expect(count()).toEqual({n:0});
 });
 it.each(['missing-token','expired','unknown-peer','wrong-executable','tree-outsider','pid-reuse','revoked','wrong-entry'] as const)('rejects %s without invoking business or reading a secret',async mode=>{
  const secrets=vi.spyOn(SecretsStore.prototype,'get'),execute=vi.spyOn(f.applications.data,'execute');let body=request(),code='AUTH_REQUIRED';
  if(mode==='missing-token'){body=request({token:'f'.repeat(64)});}
  if(mode==='expired'){time+=30001;code='TOKEN_EXPIRED';}
  if(mode==='unknown-peer'){identity=null;code='PEER_UNVERIFIABLE';}
  if(mode==='wrong-executable'){identity!.peer.executable+='.substituted';code='EXECUTABLE_MISMATCH';}
  if(mode==='tree-outsider'){identity!.ancestors=identity!.ancestors.filter(p=>p.pid!==921001);code='PEER_MISMATCH';}
  if(mode==='pid-reuse'){identity!.ancestors[1].startedAt='darwin-proc-v1:2099:1';code='PEER_MISMATCH';}
  if(mode==='revoked'){issued.revoke();}
  if(mode==='wrong-entry'){body=request({call:{operation:'mail.draft.create',contractMajor:2,connectionId:null,arguments:{}}});code='SCOPE_DENIED';}
  const c=await client();expect(await c.send(body)).toMatchObject({status:'error',error:{code}});expect(execute).not.toHaveBeenCalled();expect(secrets).not.toHaveBeenCalled();expect(count()).toEqual({n:0});if(['missing-token','expired','revoked'].includes(mode))expect(peerReads).toBe(0);
 });
 it('rejects MCP exchange/renew and self-reported context fields before kernel or business work',async()=>{
  const c=await client();for(const body of [request({method:'exchange',runId:f.run.runId}),request({method:'renew'}),request({projectId:'p2'}),request({pid:921001}),request({approved:true})])expect(await c.send(body)).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(peerReads).toBe(0);expect(count()).toEqual({n:0});
 });
 it('detects a changed fixed binary even if the peer reports the original expected path',async()=>{
  writeFileSync(f.executable,'replaced fixture');const c=await client();expect(await c.send(request())).toMatchObject({status:'error',error:{code:'EXECUTABLE_MISMATCH'}});expect(count()).toEqual({n:0});
 });
 it('revokes the old environment at run exit and removes only its own endpoint on host close',async()=>{
  const c=await client(),endpoint=gateway.endpoint;await f.run.cli.exited();expect(await c.send(request())).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});expect(count()).toEqual({n:0});await gateway.close();expect(existsSync(endpoint)).toBe(false);
 });
 it('keeps refusing access if denial audit storage fails',async()=>{
  f.sqlite.exec('CREATE TEMP VIEW capability_broker_denials AS SELECT * FROM main.capability_broker_denials');try{const c=await client();expect(await c.send(request({token:'e'.repeat(64)}))).toMatchObject({status:'error',auditUnavailable:true,error:{code:'AUTH_REQUIRED'}});expect(count()).toEqual({n:0});}finally{f.sqlite.exec('DROP VIEW temp.capability_broker_denials');}
 });

 it('T38 a separately active run has a genuinely valid token which is rejected from the first run tree',async()=>{
  const snapshot:CapabilitySessionSnapshot={...structuredClone(f.snapshot),taskId:randomUUID(),createdAt:new Date().toISOString()};
  const bridge=snapshot.mcp.find(m=>m.kind==='applications')!;bridge.serverName=applicationMcpServerName(digest(snapshot.taskId));snapshot.adapterBinding.nativeToolNames=Object.fromEntries(Object.keys(snapshot.packages[0].toolContractMajors).map(name=>[name,'mcp__'+bridge.serverName+'__'+name]));
  const session=await f.sessions.create(snapshot,f.home),second=await f.runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});
  try{
   await second.prepare();await second.cli.arm();f.reader.identities.set(921101,'darwin-proc-v1:2026:921101');await second.cli.attach(921101);const secondIssued=gateway.issue(second);expect(secondIssued.environment.WILLYOU_RUN_TOKEN).not.toBe(issued.environment.WILLYOU_RUN_TOKEN);f.runs.assertActive(f.run.runId);f.runs.assertActive(second.runId);
   identity={schema:2,state:'running',uid:process.getuid!(),peer:{pid:921102,startedAt:'darwin-proc-v1:2026:921102',executable:f.executable},ancestors:[{pid:921102,startedAt:'darwin-proc-v1:2026:921102',ppid:921101},{pid:921101,startedAt:'darwin-proc-v1:2026:921101',ppid:1}]};
   const c=await client(),ownB=await c.send(request({token:secondIssued.environment.WILLYOU_RUN_TOKEN}));expect(ownB).toMatchObject({status:'ok',value:{operation:{origin:'cli'}}});expect(f.sqlite.prepare('SELECT run_id FROM application_invocations WHERE operation_id=?').get(ownB.operationId)).toEqual({run_id:second.runId});
   const before=count(),execute=vi.spyOn(f.applications.data,'execute'),secrets=vi.spyOn(SecretsStore.prototype,'get');
   identity={schema:2,state:'running',uid:process.getuid!(),peer:{pid:921002,startedAt:'darwin-proc-v1:2026:921002',executable:f.executable},ancestors:[{pid:921002,startedAt:'darwin-proc-v1:2026:921002',ppid:921001},{pid:921001,startedAt:'darwin-proc-v1:2026:921001',ppid:1}]};
   const denied=await c.send(request({token:secondIssued.environment.WILLYOU_RUN_TOKEN}));expect(denied).toMatchObject({status:'error',error:{code:'PEER_MISMATCH'}});expect(execute).not.toHaveBeenCalled();expect(secrets).not.toHaveBeenCalled();expect(count()).toEqual(before);f.runs.assertActive(f.run.runId);f.runs.assertActive(second.runId);
   record('other-run-isolation-proof',{firstRunId:f.run.runId,secondRunId:second.runId,secondOwnTreePositive:ownB,firstTreeUsingSecondValidToken:denied,before,after:count(),targetRequestBusinessCalls:execute.mock.calls.length,targetRequestSecretReads:secrets.mock.calls.length,identityReaderLayer:'Controlled Unix peer facts; real registry/issue/socket/gateway/executor'});
   expect(await c.send(request())).toMatchObject({status:'ok',value:{operation:{origin:'cli'}}});
  }finally{await second.cli.exited();}
 });
 it('T38 directly rejects a schema-valid but unselected write capability at the host gateway before any business',async()=>{
  const execute=vi.spyOn(f.applications.data,'execute'),secrets=vi.spyOn(SecretsStore.prototype,'get'),c=await client();
  const content={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['recipient@example.test'],cc:[],bcc:[],subject:'T38 unselected local write',text:'Must never create a draft',html:null,inReplyTo:null,references:[],attachmentIds:[]};
  const response=await c.send(request({call:{operation:'mail.draft.create',contractMajor:2,connectionId:null,arguments:{content}}}));expect(response).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(execute).not.toHaveBeenCalled();expect(secrets).not.toHaveBeenCalled();expect(count()).toEqual({n:0});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get()).toEqual({n:0});
  record('direct-host-write-denial',{response,businessCalls:execute.mock.calls.length,secretReads:secrets.mock.calls.length,drafts:0,invocations:count(),layer:'Actual Unix capabilities/call request; host fixed package/capability allowlist rejects it. No CLI discovery/command-selection shortcut.'});
 });
});
