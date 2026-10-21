import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {builtinModules} from 'node:module';
import {build as viteBuild} from 'vite';
import {resolve} from 'node:path';
import {MacProcessIdentityReader} from '../process-identity';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import {ResourceStore,type PublishResource} from '../resource-store';
import {FixtureProcessReader} from './run-fixture';
import {canonicalJson,digest} from '../manifest';
let root:string,sqlite:Database.Database,reader:FixtureProcessReader;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'willyou-c-owner-'));sqlite=new Database(join(root,'state.sqlite'));runBundledMigrations(sqlite);reader=new FixtureProcessReader();});
afterEach(()=>{sqlite.close();rmSync(root,{recursive:true,force:true});});
const spec=():PublishResource=>{const text='original immutable C resource';return{resourceId:'original-c-fixture',kind:'legacy-static-plugin',contentHash:digest(text),relativePath:'original-static',dependencies:[],materialize:dir=>{mkdirSync(dir);writeFileSync(join(dir,'entry'),text);},verify:dir=>{if(readFileSync(join(dir,'entry'),'utf8')!==text)throw Error('source differs');}};};
async function interrupted(phase:'registered'|'materialized'|'renamed'='registered'){
 const input=spec(),store=new ResourceStore(sqlite,root,p=>{if(p===phase)throw Error('controlled interruption');},{processes:reader});
 await expect(store.publish(input)).rejects.toThrow('controlled interruption');const resource=store.get(input.resourceId),operation=resource.operationId!;
 // Model a hard termination without inventing evidence of native exit. Actual
 // subprocess termination has a separate test; this exposes persistent states.
 sqlite.prepare("UPDATE capability_resources SET state=?,integrity=? WHERE resource_id=?").run(phase==='registered'?'staged':'verified',phase==='registered'?'unknown':'valid',input.resourceId);
 sqlite.prepare('UPDATE capability_resource_operations SET state=? WHERE operation_id=?').run(phase==='registered'?'preparing':phase==='materialized'?'verified':'published',operation);
 sqlite.prepare("UPDATE capability_resource_leases SET state='active',ended_at=NULL WHERE owner_id=?").run(operation);
 return{input,store,operation,resource};
}
const leases=(operation:string)=>sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=? ORDER BY lease_id').all(operation);
describe('C publication recovery uses original kernel identity and every install owner',()=>{
 it('does not publish ready when target bytes change after rename and before the final transaction',async()=>{
  const input=spec(),store=new ResourceStore(sqlite,root,p=>{if(p==='renamed')writeFileSync(join(store.root,input.relativePath,'entry'),'late changed original bytes');},{processes:reader});await expect(store.publish(input)).rejects.toThrow('source differs');expect(store.get(input.resourceId).state).toBe('recovery-required');expect(readFileSync(join(store.root,input.relativePath,'entry'),'utf8')).toBe('late changed original bytes');
 });
 it('does not publish ready when the recorded dependency set changes after rename',async()=>{
  const input=spec(),store=new ResourceStore(sqlite,root,p=>{if(p==='renamed'){sqlite.prepare("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity) VALUES('late-dependency','fixture',?,?,'C','late-dependency','ready',1,'valid')").run(digest('late-dependency'),store.storeId);sqlite.prepare("INSERT INTO capability_resource_dependencies VALUES(?,'late-dependency')").run(input.resourceId);}},{processes:reader});await expect(store.publish(input)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(store.get(input.resourceId).state).toBe('recovery-required');expect(sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=?').all(input.resourceId)).toEqual([{dependency_id:'late-dependency'}]);
 });

 it.each(['registered','materialized','renamed'] as const)('restores %s only after the original kernel identity has stopped, keeping the exact operation and bytes',async phase=>{
  const x=await interrupted(phase),target=join(x.store.root,x.input.relativePath);reader.identities.set(process.pid,'darwin-proc-v1:999:2');
  const reopened=new ResourceStore(sqlite,root,undefined,{processes:reader}),ready=await reopened.recover(x.input,x.operation);
  expect(ready).toMatchObject({resourceId:x.input.resourceId,operationId:x.operation,state:'ready',contentHash:x.input.contentHash,generation:x.resource.generation});expect(readFileSync(join(target,'entry'),'utf8')).toBe('original immutable C resource');expect(leases(x.operation).every((l:any)=>l.state==='released')).toBe(true);
 });
 it.each(['running','unknown'] as const)('retains %s original owner and unchanged resources, plan and install leases',async state=>{
  const x=await interrupted();if(state==='unknown')reader.unknown.add(process.pid);const before={leases:leases(x.operation),resource:x.store.get(x.input.resourceId),operation:sqlite.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(x.operation)};
  await expect(new ResourceStore(sqlite,root,undefined,{processes:reader}).recover(x.input,x.operation)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect({leases:leases(x.operation),resource:x.store.get(x.input.resourceId),operation:sqlite.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(x.operation)}).toEqual(before);expect(existsSync(join(x.store.root,x.input.relativePath))).toBe(false);
 });
 it('does not release an unknown later install resumer even when the original operation says failed',async()=>{
  const x=await interrupted();sqlite.prepare("UPDATE capability_resource_operations SET state='failed' WHERE operation_id=?").run(x.operation);sqlite.prepare("UPDATE capability_resource_leases SET host_instance_id='unknown-resumer',pid=NULL,process_started_at=NULL,state='recovery-required' WHERE owner_id=?").run(x.operation);const before=leases(x.operation);
  await expect(new ResourceStore(sqlite,root,undefined,{processes:reader}).recover(x.input,x.operation)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(leases(x.operation)).toEqual(before);
 });
 it('preserves unrelated unknown resource readers instead of completing a half-published resource',async()=>{
  const x=await interrupted();reader.identities.set(process.pid,'darwin-proc-v1:999:2');sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,state,created_at) VALUES(?,?,'run',?,'unreachable-reader','recovery-required',?)").run(randomUUID(),x.input.resourceId,randomUUID(),new Date().toISOString());const before=sqlite.prepare('SELECT * FROM capability_resource_leases ORDER BY lease_id').all();
  await expect(new ResourceStore(sqlite,root,undefined,{processes:reader}).recover(x.input,x.operation)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(sqlite.prepare('SELECT * FROM capability_resource_leases ORDER BY lease_id').all()).toEqual(before);
 });
 it('does not infer stopped from a missing PID or an approximate historical timestamp',async()=>{
  const x=await interrupted();const row=sqlite.prepare('SELECT plan_json FROM capability_resource_operations WHERE operation_id=?').get(x.operation) as {plan_json:string},plan=JSON.parse(row.plan_json);delete plan.host;plan.pid=2147483646;sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(canonicalJson(plan),x.operation);sqlite.prepare("UPDATE capability_resource_leases SET pid=2147483646,process_started_at='2026-10-01T00:00:00Z' WHERE owner_id=?").run(x.operation);const before=leases(x.operation);
  await expect(new ResourceStore(sqlite,root,undefined,{processes:reader}).recover(x.input,x.operation)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(leases(x.operation)).toEqual(before);
 });
 it('retains an active second resumer after the original publisher is proven stopped',async()=>{
  const x=await interrupted();reader.identities.set(process.pid,'darwin-proc-v1:999:2');const id=randomUUID();sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'install',?,'second-resumer',?,?,'active',?)").run(id,x.input.resourceId,x.operation,process.pid,reader.read(process.pid)!.startedAt,new Date().toISOString());const before=leases(x.operation);
  await expect(new ResourceStore(sqlite,root,undefined,{processes:reader}).recover(x.input,x.operation)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(leases(x.operation)).toEqual(before);
 });
});


describe.skipIf(process.platform!=='darwin')('actual private C publisher termination at original publication checkpoints',()=>{
 let build:string,native:string;const children=new Set<ChildProcess>();
 beforeAll(async()=>{build=mkdtempSync(join(tmpdir(),'willyou-c-publisher-build-'));native=resolve('out/native/willyou-process-identity');await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/resource-publisher-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});});
 afterAll(()=>rmSync(build,{recursive:true,force:true}));
 afterEach(async()=>{for(const child of children){const done=once(child,'exit');child.kill('SIGKILL');await done;}children.clear();});
 it.each(['registered','materialized','renamed'] as const)('keeps a living %s publisher, then restores the same operation after actual SIGKILL',async phase=>{
  const processes=new MacProcessIdentityReader(native),child=spawn(process.execPath,[join(build,'child.cjs'),root,native,phase],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});children.add(child);let stderr='';child.stderr!.on('data',data=>stderr+=data.toString());
  const message=await new Promise<{phase:string;pid:number}>((resolveMessage,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('private publisher checkpoint timeout '+stderr)),5000);child.stdout!.on('data',data=>{text+=data.toString();if(text.includes('\n')){clearTimeout(timer);try{resolveMessage(JSON.parse(text.split('\n')[0]));}catch(error){reject(error);}}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('private publisher exited before checkpoint '+stderr));});});
  expect(message.phase).toBe(phase);expect(message.pid).toBe(child.pid);const original=processes.read(child.pid!)!,store=new ResourceStore(sqlite,root,undefined,{processes}),record=store.get(spec().resourceId),plan=sqlite.prepare('SELECT plan_json FROM capability_resource_operations WHERE operation_id=?').get(record.operationId) as {plan_json:string};expect(JSON.parse(plan.plan_json).host).toEqual(original);const before=leases(record.operationId!);
  await expect(store.recover(spec(),record.operationId!)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(leases(record.operationId!)).toEqual(before);const done=once(child,'exit');child.kill('SIGKILL');await done;children.delete(child);expect(processes.state(original)).toBe('stopped');
  expect(await store.recover(spec(),record.operationId!)).toMatchObject({state:'ready',operationId:record.operationId,relativePath:'original-static'});expect(readFileSync(join(store.root,'original-static/entry'),'utf8')).toBe('original immutable C resource');expect(leases(record.operationId!).every((x:any)=>x.state==='released')).toBe(true);
 },10000);
});
