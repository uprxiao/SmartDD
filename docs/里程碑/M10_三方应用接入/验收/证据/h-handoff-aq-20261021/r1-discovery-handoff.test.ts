import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {builtinModules} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build as viteBuild} from 'vite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {DiscoveryCatalog,type DiscoveryProjectionSource} from '../discovery-catalog';
import {MacProcessIdentityReader,type ProcessIdentity} from '../process-identity';
import {canonicalJson,digest} from '../manifest';
import {agentFixture} from './agent-fixture';
let build:string,f:Awaited<ReturnType<typeof agentFixture>>,catalog:DiscoveryCatalog,processes:MacProcessIdentityReader,sources:DiscoveryProjectionSource[],input:string;
const children=new Set<ChildProcess>();
beforeAll(async()=>{
 build=mkdtempSync(join(tmpdir(),'willyou-h-handoff-build-'));
 for(const [source,output] of [['discovery-publisher-process.ts','publisher.cjs'],['coordinator-process.ts','coordinator.cjs']])
  await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared'),'@root':resolve('.')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/'+source),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:output,inlineDynamicImports:true}}}});
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{
 f=await agentFixture();processes=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));catalog=new DiscoveryCatalog(f.store,f.home,processes);sources=f.projector.sourceSkills(f.plan('codex'));input=join(f.root,'handoff-sources.json');
 writeFileSync(input,JSON.stringify(sources.map(s=>({...s,executables:[...s.executables],files:Object.fromEntries(Object.entries(s.files).map(([p,b])=>[p,Buffer.from(b).toString('base64')]))}))));
});
async function kill(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}children.delete(child);}
afterEach(async()=>{await Promise.all([...children].map(kill));f.cleanup();});
function launch(file:string,args:string[]){
 const child=spawn(process.execPath,[join(build,file),...args],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});children.add(child);return child;
}
async function ready(child:ChildProcess,phase?:string){
 await new Promise<void>((accept,reject)=>{let text='',errors='';const timer=setTimeout(()=>reject(Error('handoff checkpoint timeout '+errors)),4000);
  child.stderr!.on('data',data=>errors+=data);child.stdout!.on('data',data=>{text+=data;if(text.includes('\n')){clearTimeout(timer);try{const row=JSON.parse(text.split('\n')[0]);expect(row.pid).toBe(child.pid);if(phase)expect(row.phase).toBe(phase);accept();}catch(error){reject(error);}}});
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('handoff child exited before checkpoint '+errors));});
 });
}
const helper=()=>resolve('out/native/willyou-process-identity');
const pendingFile=()=>join(catalog.root,'pending.json');
const pending=()=>JSON.parse(readFileSync(pendingFile(),'utf8'));
const ledger=(id:string)=>f.sqlite.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(id) as {plan_json:string;state:string};
async function original(){const child=launch('publisher.cjs',[f.root,f.home,helper(),'registered',input]);await ready(child,'registered');const intent=pending(),identity=processes.read(child.pid!)!;await kill(child);expect(processes.state(identity)).toBe('stopped');return intent;}
async function interruptedRecovery(id:string){
 const gate=launch('coordinator.cjs',[f.store.root,'C','hold',helper()]);await ready(gate);expect(existsSync(join(f.store.root,'locks/resource.lock'))).toBe(true);
 const before=ledger(id),child=launch('publisher.cjs',[f.root,f.home,helper(),'never-pause',input,id]);let errors='';child.stderr!.on('data',data=>errors+=data);
 try{
  await vi.waitFor(()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('recovery exited early '+errors);expect(pending().owner.pid).toBe(child.pid);},{timeout:2000,interval:10});
  const intent=pending(),identity=processes.read(child.pid!)!;
  expect(ledger(id)).toEqual(before);expect(existsSync(join(catalog.root,'catalog.lock'))).toBe(true);expect(processes.state(identity)).toBe('running');
  await kill(child);expect(processes.state(identity)).toBe('stopped');return intent;
 }finally{await kill(child);await kill(gate);}
}
const state=()=>({operations:f.sqlite.prepare('SELECT * FROM capability_resource_operations ORDER BY operation_id').all(),resources:f.sqlite.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all(),leases:f.sqlite.prepare('SELECT * FROM capability_resource_leases ORDER BY lease_id').all(),refs:f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all()});
describe.skipIf(process.platform!=='darwin')('H recovery interrupted between intent ownership and C registration',()=>{
 it('continues the original operation after two consecutive recovery SIGKILLs before C registration',async()=>{
  await f.sessions.create(f.plan('claude-code'),f.home);
  const first=await original(),refs=state().refs;expect(refs.length).toBeGreaterThan(0);
  const sourceTrees=sources.map(s=>f.snapshotTree(f.store.directory(f.store.get(s.sourceResourceId))));
  await interruptedRecovery(first.operationId);await interruptedRecovery(first.operationId);
  const done=await catalog.recover(first.operationId,sources);catalog.verify(done);expect(done.entries).toHaveLength(sources.length);expect(existsSync(pendingFile())).toBe(false);
  expect(ledger(first.operationId).state).toBe('committed');expect(state().refs).toEqual(refs);expect(sources.map(s=>f.snapshotTree(f.store.directory(f.store.get(s.sourceResourceId))))).toEqual(sourceTrees);
  expect(f.sqlite.prepare("SELECT 1 FROM capability_resource_leases WHERE owner_id=? AND state<>'released'").get(first.operationId)).toBeUndefined();
 },20000);
 it.each(['no-proof','proof-hash','proof-owner','changed-ledger','missing-ledger','unknown-pending','unknown-ledger','foreign-install'] as const)('preserves an unresolved %s instead of adopting or releasing it',async kind=>{
  const first=await original(),next=await interruptedRecovery(first.operationId),plan=JSON.parse(ledger(first.operationId).plan_json);
  if(kind==='no-proof'){delete next.handoff;writeFileSync(pendingFile(),canonicalJson(next));}
  if(kind==='proof-hash'||kind==='proof-owner'){next.handoff={fromOwner:{...plan.owner,...(kind==='proof-owner'?{instanceId:randomUUID()}:{})},fromPlanHash:kind==='proof-hash'?'0'.repeat(64):digest(canonicalJson(plan))};writeFileSync(pendingFile(),canonicalJson(next));}
  if(kind==='changed-ledger')f.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(canonicalJson({...plan,phase:'materializing'}),first.operationId);
  if(kind==='missing-ledger')f.sqlite.prepare("UPDATE capability_resource_operations SET kind='unrecognized-publish-H' WHERE operation_id=?").run(first.operationId);
  if(kind==='foreign-install')f.sqlite.prepare('UPDATE capability_resource_leases SET host_instance_id=? WHERE owner_id=?').run(randomUUID(),first.operationId);
  const unknown:ProcessIdentity=kind==='unknown-pending'?next.owner:first.owner;
  const host=kind.startsWith('unknown-')?new DiscoveryCatalog(f.store,f.home,{read:pid=>processes.read(pid),state:identity=>identity.pid===unknown.pid&&identity.startedAt===unknown.startedAt?'unknown':processes.state(identity)}):catalog;
  const before=state(),bytes=readFileSync(pendingFile());await expect(host.recover(first.operationId,sources)).rejects.toMatchObject({code:kind.startsWith('unknown-')||kind==='foreign-install'?'RESOURCE_BUSY':'RESOURCE_RECOVERY_REQUIRED'});
  expect(readFileSync(pendingFile())).toEqual(bytes);expect(state()).toEqual(before);
 },16000);
});
