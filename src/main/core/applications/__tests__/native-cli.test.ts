import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ApplicationCliGateway} from '../cli-gateway';
import {MacUnixPeerIdentityReader} from '../unix-peer-identity';
import {digest} from '../manifest';
import {cliFixture} from './cli-fixture';

let directory:string,binary:string,f:Awaited<ReturnType<typeof cliFixture>>,gateway:ApplicationCliGateway,environment:Record<string,string>;
const children=new Map<ChildProcess,Promise<{code:number|null;signal:string|null;stdout:string;stderr:string;timedOut:boolean}>>();
function launch(args:string[],options:{path?:string;env?:Record<string,string>}={}){
 const child=spawn(options.path??binary,args,{env:options.env??environment,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},10000);
 const done=new Promise<{code:number|null;signal:string|null;stdout:string;stderr:string;timedOut:boolean}>((ok,fail)=>{child.stdout?.on('data',chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>2*1024*1024)child.kill('SIGKILL');});child.stderr?.on('data',chunk=>{stderr+=chunk;if(Buffer.byteLength(stderr)>65536)child.kill('SIGKILL');});child.once('error',fail);child.once('close',(code,signal)=>{clearTimeout(timer);children.delete(child);ok({code,signal,stdout,stderr,timedOut});});});children.set(child,done);return{child,done};
}
beforeAll(()=>{directory=realpathSync(mkdtempSync('/private/tmp/willyou-m11-cli-native-'));binary=join(directory,'willyou-app');execFileSync(process.execPath,['--input-type=module','-e','import {buildApplicationCli} from "./scripts/applications/build.mjs";buildApplicationCli({output:process.argv[1]});',binary],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});});
afterAll(()=>rmSync(directory,{recursive:true,force:true}));
beforeEach(async()=>{f=await cliFixture({nativeRoot:true});gateway=new ApplicationCliGateway(f.runs,f.cli,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),{executable:{path:binary,sha256:digest(readFileSync(binary))}});await gateway.start();environment={...gateway.issue(f.run).environment};});
afterEach(async()=>{for(const child of children.keys())child.kill('SIGKILL');await Promise.allSettled([...children.values()]);await gateway.close();vi.restoreAllMocks();await f.cleanup();});

describe('M11 native standalone CLI with real kernel peer identification (controlled Agent root)',()=>{
 it('discovers only active CLI commands and invokes the common executor with parseable JSON stdout',async()=>{
  const list=await launch(['--list']).done;expect(list).toMatchObject({code:0,stderr:'',timedOut:false});const catalog=JSON.parse(list.stdout);expect(catalog.capabilities.map((c:{id:string;command:string[]})=>({id:c.id,command:c.command}))).toEqual([{id:'mail.draft.list',command:['mail','draft','list']}]);
  const result=await launch(['mail','draft','list','--limit','1']).done;expect(result).toMatchObject({code:0,stderr:'',timedOut:false});expect(JSON.parse(result.stdout)).toMatchObject({schema:'willyou-app-result-v2',capabilityId:'mail.draft.list',data:{items:[],nextCursor:null},operation:{origin:'cli'}});expect(result.stdout).not.toContain(environment.WILLYOU_RUN_TOKEN);
 });
 it('has local JSON help, explicit context exit status and rejects token arguments without echoing them',async()=>{
  const canary='CLI_CANARY_NOT_A_CREDENTIAL',help=await launch(['--help'],{env:{WILLYOU_RUN_TOKEN:canary}}).done;expect(help.code).toBe(0);expect(JSON.parse(help.stdout).usage).toBeInstanceOf(Array);expect(help.stdout+help.stderr).not.toContain(canary);
  const missing=await launch(['--list'],{env:{}}).done;expect(missing.code).toBe(3);expect(JSON.parse(missing.stdout)).toMatchObject({error:{code:'AUTH_REQUIRED'}});
  const token=await launch(['mail','draft','list','--token',canary]).done;expect(token.code).toBe(2);expect(JSON.parse(token.stdout)).toMatchObject({error:{code:'INVALID_INPUT'}});expect(token.stdout+token.stderr).not.toContain(canary);expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:0});
 });
 it('uses structured argv/JSON and does not grant an unknown command or injected project',async()=>{
  for(const args of [['mail','draft','list','--json','{"projectId":"foreign"}'],['mail','draft','list','--json','[]'],['mail','draft','delete']]){const result=await launch(args).done;expect(result.code).toBe(2);expect(JSON.parse(result.stdout).error.code).toMatch(/INVALID_INPUT|SCOPE_DENIED/);expect(result.timedOut).toBe(false);}
  expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:0});
 });
 it('rejects an actual copied native executable despite a valid token and correct ancestor',async()=>{
  const copy=join(directory,'unmanaged-copy');cpSync(binary,copy);const result=await launch(['--list'],{path:copy}).done;expect(result.code).toBe(2);expect(JSON.parse(result.stdout)).toMatchObject({error:{code:'EXECUTABLE_MISMATCH'}});expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:0});
 });
 it('classifies a disconnected submitted write as unknown and exits 5 without automatic retry',async()=>{
  const path=join(directory,'unknown.sock');let calls=0,connections=0;const sockets=new Set<import('node:net').Socket>();const server=createServer(socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let input='';socket.on('data',chunk=>{input+=chunk;let end;while((end=input.indexOf('\n'))>=0){const req=JSON.parse(input.slice(0,end));input=input.slice(end+1);if(req.method==='capabilities/list')socket.write(JSON.stringify({schema:1,id:req.id,status:'ok',value:{capabilities:[{id:'sample-kv.value.put',contractMajor:2,command:['sample-kv','value','put'],annotations:{readOnlyHint:false}}],unavailable:[]}})+'\n');else{calls++;socket.destroy();}}});});await new Promise<void>(ok=>server.listen(path,ok));
  try{const result=await launch(['sample-kv','value','put','--json','{"key":"fixture"}'],{env:{...environment,WILLYOU_ENDPOINT:path}}).done;expect(result.code).toBe(5);expect(result.timedOut).toBe(false);expect(JSON.parse(result.stdout)).toMatchObject({error:{effectState:'unknown',retryable:false}});expect(calls).toBe(1);expect(connections).toBe(1);}finally{for(const socket of sockets)socket.destroy();await new Promise<void>(ok=>server.close(()=>ok()));}
 });
 it('cancels the owned operation when its actual CLI process exits and keeps its lease until work settles',async()=>{
  let release!:()=>void,started!:()=>void,context!:Parameters<typeof f.applications.data.execute>[0];const gate=new Promise<void>(ok=>{release=ok;}),seen=new Promise<void>(ok=>{started=ok;}),execute=f.applications.data.execute.bind(f.applications.data);vi.spyOn(f.applications.data,'execute').mockImplementationOnce(async(scope,method,args)=>{context=scope;started();await gate;return execute(scope,method,args);});
  const running=launch(['mail','draft','list']);try{await seen;running.child.kill('SIGTERM');const result=await running.done;expect(result.signal).toBe('SIGTERM');await vi.waitFor(()=>expect(context.signal.aborted).toBe(true));expect(f.sqlite.prepare("SELECT count(*) n FROM capability_run_activities WHERE run_id=? AND state='active'").get(f.run.runId)).toEqual({n:1});}finally{release();}
  await vi.waitFor(()=>expect(f.sqlite.prepare("SELECT count(*) n FROM capability_run_activities WHERE run_id=? AND state='active'").get(f.run.runId)).toEqual({n:0}));expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:1});
 });
});
