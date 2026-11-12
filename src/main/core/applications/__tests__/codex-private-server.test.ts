import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {realpathSync} from 'node:fs';
import {once} from 'node:events';
import * as childProcesses from 'node:child_process';
import {CodexPrivateServer} from '../codex-private-server';
import {RunBackendAuthority} from '../run-backend-authority';
import {MacProcessIdentityReader,type ProcessIdentityReader} from '../process-identity';
import {MacUnixPeerIdentityReader} from '../unix-peer-identity';
import {digest} from '../manifest';
import {cliFixture} from './cli-fixture';
import {resolve} from 'node:path';

vi.mock('node:child_process',async importOriginal=>{const actual=await importOriginal<typeof import('node:child_process')>();return {...actual,spawn:vi.fn(actual.spawn)};});
let f:Awaited<ReturnType<typeof cliFixture>>,authority:RunBackendAuthority,server:CodexPrivateServer|undefined,abort:AbortController;
let processes:ProcessIdentityReader,reader:MacProcessIdentityReader,log:string,skill:string;
beforeEach(async()=>{
  f=await cliFixture();abort=new AbortController();reader=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
  processes={read:(pid:number)=>{const value=reader.read(pid);if(value)f.reader.identities.set(pid,value.startedAt);return value;},state:identity=>identity.pid===921001?f.reader.state(identity):reader.state(identity)};
  authority=new RunBackendAuthority(f.runs,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),processes,{pollMs:10000,disposeWaitMs:20});
  skill=join(f.root,'skill');mkdirSync(skill);writeFileSync(join(skill,'SKILL.md'),'---\nname: synthetic-frozen-skill\ndescription: Synthetic only\n---\nNo real service.\n');log=join(f.root,'native-control.log');
  vi.mocked(childProcesses.spawn).mockClear();
});
afterEach(async()=>{
  await server?.stop();
  for(const result of vi.mocked(childProcesses.spawn).mock.results){const child=result.type==='return'?result.value:undefined;if(child&&child.exitCode===null&&child.signalCode===null&&child.pid){const ended=once(child,'exit');child.kill('SIGKILL');await ended;}}
  await vi.waitFor(()=>expect(f.sqlite.prepare("SELECT count(*) n FROM capability_run_processes WHERE kind='bridge' AND state NOT IN ('exited','canceled')").get()).toEqual({n:0}),{timeout:3000});
  await authority.poll();await server?.stop();await authority.dispose();await f.cleanup();server=undefined;vi.restoreAllMocks();
});
const rows=()=>f.sqlite.prepare("SELECT state,pid FROM capability_run_processes WHERE kind='bridge' ORDER BY rowid").all();
const ownedSpawn=()=>{
  const calls=vi.mocked(childProcesses.spawn).mock.calls;
  const index=calls.findIndex(call=>call[0]===process.execPath&&Array.isArray(call[1])&&call[1][0]===resolve('src/main/core/applications/__tests__/fixtures/codex-private-server.cjs'));
  if(index<0)throw Error('Original private service launch missing');return {call:calls[index],child:vi.mocked(childProcesses.spawn).mock.results[index].value as childProcesses.ChildProcess};
};
async function prepare(mode='ok',cwd=f.home){
  server=await CodexPrivateServer.prepare({run:f.run,version:'0.167.1',storeId:f.store.storeId,executable:{path:realpathSync(process.execPath),sha256:digest(readFileSync(process.execPath))},args:['--fixture-mode',mode],executablePrefix:[resolve('src/main/core/applications/__tests__/fixtures/codex-private-server.cjs')],environment:{ELECTRON_RUN_AS_NODE:'1',WILLYOU_TEST_LOG:log,HOME:f.home},cwd,skills:[{path:skill,name:'synthetic-frozen-skill'}],signal:abort.signal},authority,processes,{startupMs:1500,requestMs:150,stopMs:100});return server;
}

describe.skipIf(process.platform!=='darwin')('per-run private Codex service lifecycle (actual native process, synthetic protocol)',()=>{
  it('reserves before spawn, checks real socket identity, discovers exact roots, keeps default state env, and stops both records',async()=>{
    const s=await prepare();expect(rows()).toEqual([{state:'reserved',pid:null},{state:'reserved',pid:null}]);expect(vi.mocked(childProcesses.spawn)).not.toHaveBeenCalled();
    await s.start();expect(s.state).toBe('ready');const records=rows() as {state:string;pid:number}[];expect(records).toHaveLength(2);expect(records[0]).toEqual(records[1]);expect(records[0].state).toBe('active');
    const input=ownedSpawn().call;expect(input[2]?.env).not.toHaveProperty('CODEX_HOME');expect(input[2]?.env?.HOME).toBe(f.home);
    const events=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));expect(events.filter(e=>e.method).map(e=>e.method)).toEqual(['initialize','initialized','skills/extraRoots/set','skills/list']);expect(events.find(e=>e.method==='skills/extraRoots/set').params.extraRoots).toEqual([skill]);
    expect(readdirSync(s.endpoint.directory).sort()).toEqual(['c.sock','owner.json']);await s.stop();expect(s.state).toBe('stopped');expect(existsSync(s.endpoint.directory)).toBe(false);expect(rows()).toEqual([{state:'exited',pid:records[0].pid},{state:'exited',pid:records[0].pid}]);
  });
  it('cancels prepared and armed-but-unforked windows without manufacturing exit evidence',async()=>{
    const s=await prepare();abort.abort();await expect(s.start()).rejects.toMatchObject({code:'CANCELED'});expect(vi.mocked(childProcesses.spawn)).not.toHaveBeenCalled();expect(rows()).toEqual([{state:'canceled',pid:null},{state:'canceled',pid:null}]);expect(existsSync(s.endpoint.directory)).toBe(false);
  });
  it('records an actual OS spawn rejection as never forked',async()=>{
    const cwd=join(f.root,'empty-cwd');mkdirSync(cwd);const s=await prepare('ok',cwd);rmdirSync(cwd);await expect(s.start()).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});expect(rows()).toEqual([{state:'canceled',pid:null},{state:'canceled',pid:null}]);expect(s.state).toBe('stopped');
  });
  it.each([['startup-exit','CAPABILITY_UNAVAILABLE'],['hang-request','TIMEOUT'],['malformed','INVALID_RESPONSE'],['wrong-root','INVALID_RESPONSE'],['premature-close','CANCELED']] as const)('bounds %s and closes original process/windows',async(mode,code)=>{
    const s=await prepare(mode);await expect(s.start()).rejects.toMatchObject({code});await vi.waitFor(()=>expect(s.state).toBe('stopped'),{timeout:3000});expect(rows()).toMatchObject([{state:'exited'},{state:'exited'}]);
  });
  it('retains unknown exit instead of treating a control close or signal as process exit',async()=>{
    const s=await prepare('ignore-term');await s.start();const child=ownedSpawn().child;
    await s.stop();expect(s.state).toBe('stopping');expect(s.recoveryWarnings).toContain('backend-exit-unknown');expect(rows()).toMatchObject([{state:'active'},{state:'active'}]);expect(existsSync(s.endpoint.directory)).toBe(true);
    const ended=once(child,'exit');child.kill('SIGKILL');await ended;await vi.waitFor(()=>expect(rows()).toMatchObject([{state:'exited'},{state:'exited'}]));await s.stop();expect(s.state).toBe('stopped');
  });
  it('retains altered endpoint contents after normal process exit',async()=>{
    const s=await prepare();await s.start();writeFileSync(join(s.endpoint.directory,'unexpected'),'preserve');await s.stop();expect(s.recoveryWarnings).toContain('backend-endpoint-retained');expect(readFileSync(join(s.endpoint.directory,'unexpected'),'utf8')).toBe('preserve');
    // The test owns this synthetic directory; production deliberately did not remove it.
    const {rmSync}=await import('node:fs');rmSync(s.endpoint.directory,{recursive:true});
  });
  it.runIf(!!process.env.WILLYOU_P1_CODEX_BINARY)('starts the installed native Codex server with isolated HOME, delivers exact roots and confirms original process exit (no model)',async()=>{
    const binary=realpathSync(process.env.WILLYOU_P1_CODEX_BINARY!),environment={HOME:f.home,PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'};
    const version=childProcesses.execFileSync(binary,['--version'],{env:environment,encoding:'utf8',timeout:5000}).trim();expect(version).toBe('codex-cli 0.167.1');
    const control:{method:string;response:unknown}[]=[];
    server=await CodexPrivateServer.prepare({run:f.run,version:'0.167.1',storeId:f.store.storeId,executable:{path:binary,sha256:digest(readFileSync(binary))},args:['--disable','plugins','-c','analytics.enabled=false','-c','model="synthetic-p1"','-c','model_provider="synthetic_p1"','-c','model_providers.synthetic_p1={name="P1 local refusal",base_url="http://127.0.0.1:9/v1",wire_api="responses",requires_openai_auth=false}','-c','sandbox_mode="read-only"','-c','approval_policy="on-request"'],environment,cwd:f.home,skills:[{path:skill,name:'synthetic-frozen-skill'}],signal:abort.signal},authority,processes,{startupMs:10000,requestMs:5000,stopMs:3000,observe:(method,response)=>control.push({method,response})});
    try{await server.start();}catch(error){const evidence=process.env.WILLYOU_P1_CODEX_SERVER_EVIDENCE;if(evidence?.startsWith('/private/tmp/willyou-m13-'))writeFileSync(evidence,JSON.stringify({schema:1,status:'failed',socketObservations:server.endpoint.socketObservations,control,rows:rows(),code:(error as {code?:string}).code},null,2)+'\n');throw error;}
    const nativeRows=rows() as {state:string;pid:number}[];expect(nativeRows[0].pid).toBe(nativeRows[1].pid);const identity=reader.read(nativeRows[0].pid)!;expect(identity).toBeTruthy();
    expect(server.state).toBe('ready');expect(control.map(e=>e.method)).toEqual(['initialize','skills/extraRoots/set','skills/list']);
    const index=vi.mocked(childProcesses.spawn).mock.calls.findIndex(call=>call[0]===binary);expect(index).toBeGreaterThanOrEqual(0);const original=vi.mocked(childProcesses.spawn).mock.results[index].value as childProcesses.ChildProcess;
    await server.stop();expect(server.state).toBe('stopped');expect(reader.state(identity)).toBe('stopped');expect(rows()).toMatchObject([{state:'exited'},{state:'exited'}]);expect(existsSync(server.endpoint.directory)).toBe(false);
    const evidence=process.env.WILLYOU_P1_CODEX_SERVER_EVIDENCE;
    if(evidence){if(!evidence.startsWith('/private/tmp/willyou-m13-'))throw Error('Private evidence destination required');writeFileSync(evidence,JSON.stringify({schema:1,version,binaryHash:digest(readFileSync(binary)),control,identity,nativeRows,exit:{code:original.exitCode,signal:original.signalCode},state:server.state,endpointRemoved:!existsSync(server.endpoint.directory),actualNativeCodex:true,actualTui:false,modelTurn:false,authCopied:false},null,2)+'\n');}
  },20000);
});
