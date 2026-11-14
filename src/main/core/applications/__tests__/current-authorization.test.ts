import {CurrentApplicationAuthorization} from '../current-authorization';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest} from '../manifest';
import {once} from 'node:events';
import {connect,type Socket} from 'node:net';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BridgeResponse} from '@shared/application-bridge';
import {ApplicationCliGateway} from '../cli-gateway';
import type {UnixPeerIdentity} from '../unix-peer-identity';
import {cliFixture} from './cli-fixture';

/** M11 R17 / T41, T43, T44, T47: the run token proves identity; each call reads the project's current settings. */
let f:Awaited<ReturnType<typeof cliFixture>>,gateway:ApplicationCliGateway,issued:ReturnType<ApplicationCliGateway['issue']>,identity:UnixPeerIdentity;
const sockets=new Set<Socket>();
const draftList={operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}};
const count=()=>(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get() as {n:number}).n;
async function send(extra:Record<string,unknown>={}):Promise<BridgeResponse>{
 const socket=connect(gateway.endpoint);sockets.add(socket);socket.on('error',()=>{});await once(socket,'connect');
 return new Promise((ok,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('CLI fixture deadline')),5000);socket.on('data',chunk=>{text+=chunk.toString();const end=text.indexOf('\n');if(end>=0){clearTimeout(timer);ok(JSON.parse(text.slice(0,end)));}});socket.write(JSON.stringify({schema:'willyou-cli-v1',id:randomUUID(),token:issued.environment.WILLYOU_RUN_TOKEN,method:'capabilities/call',call:draftList,...extra})+'\n');});
}
const revision=()=>f.applications.selections.projectSettings('p1','mail').revision;
const setMail=(enabled:boolean)=>f.applications.selections.select({projectId:'p1',appId:'mail',enabled,expectedRevision:revision(),connections:{foxmail:null,smtp:null}});
beforeEach(async()=>{
 f=await cliFixture({currentAuthorization:true});
 identity={schema:2,state:'running',uid:process.getuid!(),peer:{pid:921002,startedAt:'darwin-proc-v1:2026:921002',executable:f.executable},ancestors:[{pid:921002,startedAt:'darwin-proc-v1:2026:921002',ppid:921001},{pid:921001,startedAt:'darwin-proc-v1:2026:921001',ppid:1}]};
 gateway=new ApplicationCliGateway(f.runs,f.cli,{read:async()=>identity},{executable:{path:f.executable,sha256:f.executableHash},tokenTtlMs:30000});await gateway.start();issued=gateway.issue(f.run);
});
afterEach(async()=>{for(const socket of sockets)socket.destroy();sockets.clear();await gateway?.close();vi.restoreAllMocks();await f?.cleanup();});

describe('M11 R17 per-call authorization from current project settings',()=>{
 it('refuses a disabled application with page guidance and no business work, then serves it again in the same run',async()=>{
  expect(await send()).toMatchObject({status:'ok'});
  await setMail(false);
  const execute=vi.spyOn(f.applications.data,'execute'),denied=await send();
  expect(denied).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED',layer:'auth'}});
  expect(denied.status==='error'&&denied.error.message).toBe('请到项目「agent fixture」的‘插件’页开启邮件');
  expect(execute).not.toHaveBeenCalled();expect(count()).toBe(1);
  expect(await send({method:'capabilities/list',call:undefined})).toMatchObject({status:'ok',value:{capabilities:[]}});
  // Enabling again needs no new run or token: the next call reads the new setting.
  await setMail(true);
  expect(await send()).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list',operation:{origin:'cli'}}});expect(count()).toBe(2);
 });
 // T43 (S6 finding): the native CLI resolves a command against the listed capabilities before calling, so the list
 // carries the guidance for applications this project has not enabled, and the real binary reports it.
 it('lets the native CLI report where to enable an application this project has not enabled',async()=>{
  const binary=resolve('out/native/willyou-app');await gateway.close();identity={...identity,peer:{...identity.peer,executable:binary}};
  gateway=new ApplicationCliGateway(f.runs,f.cli,{read:async()=>identity},{executable:{path:binary,sha256:digest(readFileSync(binary))},tokenTtlMs:30000});await gateway.start();issued=gateway.issue(f.run);
  const guidance='请到项目「agent fixture」的‘插件’页开启邮件';await setMail(false);
  expect(await send({method:'capabilities/list',call:undefined})).toMatchObject({status:'ok',value:{capabilities:[],notEnabled:[{app:'mail',code:'APP_NOT_ENABLED',message:guidance}]}});
  // Asynchronous: the gateway answering this child runs on the same event loop.
  const cli=await new Promise<{status:number|null;stdout:string}>(done=>{execFile(binary,['mail','draft','list'],{env:{PATH:'/usr/bin:/bin',...issued.environment},encoding:'utf8',timeout:10000},(error,stdout)=>done({status:error?(typeof error.code==='number'?error.code:null):0,stdout}));});
  expect(cli.status).toBe(2);expect(JSON.parse(cli.stdout).error).toMatchObject({code:'APP_NOT_ENABLED',message:guidance});expect(count()).toBe(0);
  await setMail(true);expect((await send({method:'capabilities/list',call:undefined}) as {value:{notEnabled:unknown[]}}).value.notEnabled).toEqual([]);
 });
 it('renews a long-running identity without freezing or widening the current application authorization',async()=>{
  await gateway.close();let time=Date.now();
  gateway=new ApplicationCliGateway(f.runs,f.cli,{read:async()=>identity},{executable:{path:f.executable,sha256:f.executableHash},now:()=>time,tokenTtlMs:30000});
  await gateway.start();issued=gateway.issue(f.run);
  expect(await send()).toMatchObject({status:'ok'});
  time+=36*60*1000;
  await setMail(false);const execute=vi.spyOn(f.applications.data,'execute');
  expect(await send()).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});
  expect(execute).not.toHaveBeenCalled();expect(count()).toBe(1);
  await setMail(true);
  expect(await send()).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list'}});expect(count()).toBe(2);
  await f.run.cli.exited();time+=36*60*1000;
  expect(await send()).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});expect(count()).toBe(2);
 });
 it('applies the same current view to the MCP entry and the tool list',async()=>{
  await setMail(false);
  expect((await f.cli.list(f.run.runId)).tools).toEqual([]);
  expect(await f.mcp.call(f.run.runId,randomUUID(),{operation:'smartdd_mail_draft_list_v2',contractMajor:2,connectionId:null,arguments:{}})).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});
  expect(count()).toBe(0);
 });
 it('keeps the token valid when the project selection changes instead of revoking the run',async()=>{
  await setMail(true);
  expect(await send()).toMatchObject({status:'ok'});
 });
 it('still refuses forged, revoked and outsider identities before reading settings',async()=>{
  expect(await send({token:'f'.repeat(64)})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  identity={...identity,ancestors:identity.ancestors.filter(p=>p.pid!==921001)};
  expect(await send()).toMatchObject({status:'error',error:{code:'PEER_MISMATCH'}});
  issued.revoke();expect(await send()).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  expect(count()).toBe(0);
 });
 it('does not let another project enabling the application widen this run',async()=>{
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','other',1,1)");
  await f.applications.selections.select({projectId:'p2',appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  await setMail(false);
  expect(await send()).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});
  expect(count()).toBe(0);
 });
});

it('M13 builtin connection uses this run binding, not project current or original task binding',()=>{
 const current=f.runs.assertActive(f.run.runId),auth=new CurrentApplicationAuthorization(f.store,f.applications.builtin);
 if(current.snapshot.schema!==3)throw new Error('M13 fixture requires a v3 session');
 const original=current.snapshot;const a=randomUUID(),b=randomUUID(),priorTask=randomUUID();
 const row=(connectionId:string)=>({appId:'mail',slot:'smtp',connectionId,identityRevision:1,bindingRevision:7});
 const ui=vi.spyOn(auth,'bindings').mockImplementation((_projectId,appIds)=>appIds.includes('mail')?[row(b)]:[]);
 // Original task was created with priorTask. This is a restored run that started with A; project now B.
 const claim={...current,bindingMode:'run' as const,bindings:[row(a)],snapshot:{...original,packages:original.packages.map(pack=>({...pack,bindings:[{bindingId:'p1:mail:smtp',connectionId:priorTask,identityRevision:1}]}))}};
 const viewed=auth.view(claim);
 expect(viewed.bindings).toEqual([row(a)]);
 expect(viewed.snapshot.packages.find(pack=>pack.appId==='mail')!.bindings).toEqual([{bindingId:'p1:mail:smtp',connectionId:a,identityRevision:1}]);
 // A genuinely new run starts with B; must not inherit either old run A or original task priorTask.
 const next=auth.view({...claim,bindings:[row(b)]});
 expect(next.snapshot.packages.find(pack=>pack.appId==='mail')!.bindings[0].connectionId).toBe(b);
 ui.mockRestore();
});
