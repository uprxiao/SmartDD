import {randomUUID} from 'node:crypto';
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
  expect(denied.status==='error'&&denied.error.message).toBe('请到项目「agent fixture」的‘应用’页开启邮件');
  expect(execute).not.toHaveBeenCalled();expect(count()).toBe(1);
  expect(await send({method:'capabilities/list',call:undefined})).toMatchObject({status:'ok',value:{capabilities:[]}});
  // Enabling again needs no new run or token: the next call reads the new setting.
  await setMail(true);
  expect(await send()).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list',operation:{origin:'cli'}}});expect(count()).toBe(2);
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
