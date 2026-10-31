import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApplicationError } from '@shared/applications';
import type { CapabilityBundleIndex } from '@shared/capability-bundles';
import { applicationMcpServerName } from '@shared/application-session';
import { runBundledMigrations } from '../../../db/migrations';
import * as schema from '../../../db/schema';
import { SecretsStore } from '../../../secrets';
import { CapabilityService } from '../../capabilities/capability-service';
import { ProjectService } from '../../projects/project-service';
import { AgentSupportService } from '../agent-support-service';
import { CapabilityBundleSource } from '../bundle-source';
import { BuiltinPackageRegistry } from '../builtin-package-registry';
import { ApplicationAdapterRegistry, type ApplicationDataHost } from '../application-adapter-registry';
import { ApplicationToolService, type HostToolOperation } from '../tool-service';
import { canonicalJson, digest, manifestHash } from '../manifest';
import { ResourceStore } from '../resource-store';
import { RuntimeRegistry } from '../runtime-registry';
import { FixtureProcessReader, runFixture } from './run-fixture';

let build:string,output:string,runtimeEntry:string,source:CapabilityBundleSource,root:string,sqlite:Database.Database,store:ResourceStore,builtin:BuiltinPackageRegistry;
const cleanups:Array<()=>void|Promise<void>>=[];
const verifyBundles=createRequire(import.meta.url)('../../../../../scripts/applications/verify-bundles.cjs').verifyCapabilityBundles as (root:string,version:string)=>{apps:{appId:string;skills:number;tools:number}[]};
beforeAll(()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-m10-builtin-build-'));output=join(build,'bundles');runtimeEntry=join(build,'runtime/mcp-bridge.cjs');
  execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
  execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',output,runtimeEntry],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
  source=new CapabilityBundleSource(output);
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{
  root=mkdtempSync(join(tmpdir(),'willyou-m10-builtin-store-'));sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
  store=new ResourceStore(sqlite,root);builtin=new BuiltinPackageRegistry(store);await new RuntimeRegistry(store).install(source.runtime());
});
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();sqlite.close();rmSync(root,{recursive:true,force:true});});
const entry=(appId:string)=>source.index.apps.find(a=>a.appId===appId)!;
const bundle=(appId:string)=>source.application(entry(appId));
const install=(appId:string)=>builtin.install(source,entry(appId));
const approvals=()=>sqlite.prepare('SELECT package_hash,source_index_hash FROM capability_builtin_package_sources ORDER BY package_hash,source_index_hash').all();
function changedDistribution(appId:string,version:string,change?:(files:Record<string,Buffer>)=>void):CapabilityBundleSource{
  const target=join(root,'distribution-'+randomUUID());cpSync(output,target,{recursive:true});
  const index=JSON.parse(readFileSync(join(target,'index.json'),'utf8')) as CapabilityBundleIndex;
  const current=index.apps.find(a=>a.appId===appId)!,original=join(target,current.path),raw=source.application(entry(appId));
  const manifest=structuredClone(raw.manifest),files={...raw.files};manifest.version=version;
  const operations=JSON.parse(files['adapter/operations.json'].toString('utf8'));operations.version=version;files['adapter/operations.json']=Buffer.from(canonicalJson(operations)+'\n');change?.(files);
  manifest.files=Object.entries(files).map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes),executable:false}));
  const hash=manifestHash(manifest),next=`apps/${appId}/${version}/${hash}`;mkdirSync(join(target,'apps',appId,version),{recursive:true});renameSync(original,join(target,next));
  for(const [path,bytes] of Object.entries(files))writeFileSync(join(target,next,path),bytes);
  writeFileSync(join(target,next,'manifest.json'),canonicalJson(manifest)+'\n');Object.assign(current,{version,hash,path:next});
  index.build.resourceSetHash=digest(canonicalJson({adapters:index.adapters,runtimes:index.runtimes,apps:index.apps}));const {indexHash:_,...content}=index;index.indexHash=digest(canonicalJson(content));writeFileSync(join(target,'index.json'),canonicalJson(index)+'\n');
  return new CapabilityBundleSource(target);
}
async function realRun(appId='zentao',distribution=source){
  const selected=distribution.application(distribution.index.apps.find(a=>a.appId===appId)!),reader=new FixtureProcessReader(),f=await runFixture(reader,{application:true,runtime:readFileSync(runtimeEntry),applicationBundle:{manifest:selected.manifest,files:{...selected.files}}});
  cleanups.push(()=>f.cleanup());const owned=await f.create();cleanups.push(()=>owned.cli.exited());await owned.prepare();await owned.cli.arm();reader.identities.set(202601,'darwin-proc-v1:2026:1');await owned.cli.attach(202601);
  const trusted=new BuiltinPackageRegistry(f.store);await trusted.install(distribution,distribution.index.apps.find(a=>a.appId===appId)!);return{f,owned,trusted,selected};
}
const emptyWork=()=>({kind:'bug',items:[],total:0,nextCursor:null,complete:true,checkedAt:new Date().toISOString(),problems:[]});
function dataHost(execute:HostToolOperation['execute'],authorize:HostToolOperation['authorize']=()=>{}):ApplicationDataHost{
 return{resolve:(_version,_method,binding)=>({semantics:binding.toolName.includes('draft_create')?'write':'read',retry:binding.toolName.includes('draft_create')?'never':'safe-read',authorize,execute})};
}

describe('complete trusted built-in mail and ZenTao packages',()=>{
 it('retains approved package identity while unready without turning metadata into executable trust',async()=>{
  const installed=await install('mail'),before=approvals();sqlite.prepare("UPDATE capability_resources SET state='recovery-required',integrity='invalid' WHERE resource_id=?").run(installed.resourceId);expect(builtin.retainedMetadata(installed.packageHash)).toMatchObject({appId:'mail',packageHash:installed.packageHash});expect(()=>builtin.trustedMetadata(installed.packageHash)).toThrow('未就绪');expect(()=>builtin.assertTrusted(installed.packageHash)).toThrow('未就绪');expect(approvals()).toEqual(before);sqlite.prepare("UPDATE capability_builtin_package_sources SET source_index_json='{}' WHERE package_hash=?").run(installed.packageHash);expect(()=>builtin.retainedMetadata(installed.packageHash)).toThrow('分发依据损坏');
 });

 it('builds both immutable packages with three full Skills,17 bounded contracts and the original pinned runtime',()=>{
   expect(verifyBundles(output,source.index.build.appVersion).apps.map(a=>({id:a.appId,skills:a.skills,tools:a.tools}))).toEqual([{id:'zentao',skills:2,tools:3},{id:'mail',skills:1,tools:14}]);
   const apps=source.applications();expect(apps.map(a=>a.manifest.appId).sort()).toEqual(['mail','zentao']);expect(apps.reduce((n,a)=>n+a.manifest.skills.length,0)).toBe(3);expect(apps.reduce((n,a)=>n+a.manifest.tools.length,0)).toBe(17);
   for(const app of apps){expect(app.manifest.runtime.hash).toBe(source.index.runtimes[0].hash);expect(app.manifest.files.some(f=>f.path.endsWith('/references/'+(app.manifest.appId==='mail'?'sending.md':'scope.md')))).toBe(true);expect(app.files['adapter/operations.json']).toBeInstanceOf(Buffer);for(const skill of app.manifest.skills)expect(app.files[skill.entry].toString('utf8')).toContain('smartdd_');}
   const again=join(build,'second-bundles');execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',again,runtimeEntry],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});expect(new CapabilityBundleSource(again).index.build.resourceSetHash).toBe(source.index.build.resourceSetHash);
 });

 it('finishes complete resource preparation with unknown dirty provenance when optional Git metadata stalls',()=>{
   const bin=join(root,'private-metadata-bin'),observation=join(root,'metadata-lock-mode.txt');mkdirSync(bin);
   const script=['#!/bin/sh','printf "%s" "$GIT_OPTIONAL_LOCKS" > "$WY_METADATA_LOCK_OBSERVATION"','exec /bin/sleep 20',''].join('\n');
   writeFileSync(join(bin,'git'),script,{mode:0o700});const target=join(root,'bounded-metadata-bundles');
   execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',target,runtimeEntry],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PATH:bin+delimiter+process.env.PATH,WY_METADATA_LOCK_OBSERVATION:observation},timeout:10000,stdio:'pipe'});
   expect(readFileSync(observation,'utf8')).toBe('0');const prepared=new CapabilityBundleSource(target);expect(prepared.index.build.commit).toBeNull();expect(prepared.index.build.dirty).toBe(true);expect(prepared.index.build.resourceSetHash).toBe(source.index.build.resourceSetHash);expect(verifyBundles(target,source.index.build.appVersion).apps).toHaveLength(2);
 });

 it('keeps model-visible built-in tool identities within the64-byte portable budget without changing the fixed server name',()=>{
   const server=applicationMcpServerName('a'.repeat(64));expect(server).toBe('wy_'+'a'.repeat(24));
   for(const app of source.applications())for(const tool of app.manifest.tools){
     const native=`mcp__${server}__${tool.name}`;expect(Buffer.byteLength(native),native).toBeLessThanOrEqual(64);
   }
 });

 it('compiles all original input/output contracts and rejects injected scope,authorization and out-of-budget resource inputs',()=>{
   const validator=new AjvJsonSchemaValidator();
   for(const app of source.applications())for(const tool of app.manifest.tools)for(const path of [tool.inputSchemaPath,tool.outputSchemaPath])expect(validator.getValidator(JSON.parse(app.files[path].toString('utf8')) as JsonSchemaType)).toBeTypeOf('function');
   const mail=bundle('mail'),send=mail.manifest.tools.find(t=>t.name==='smartdd_mail_send_execute_v1')!,check=validator.getValidator(JSON.parse(mail.files[send.inputSchemaPath].toString('utf8')) as JsonSchemaType),input={intentId:randomUUID(),expectedReviewHash:'a'.repeat(64)};
   expect(check(input).valid).toBe(true);for(const key of ['projectId','taskId','packageHash','approved','authorizationRef'])expect(check({...input,[key]:key==='approved'?true:'spoofed'}).valid).toBe(false);
   const resource=mail.manifest.tools.find(t=>t.name==='smartdd_mail_resource_read_v1')!,read=validator.getValidator(JSON.parse(mail.files[resource.inputSchemaPath].toString('utf8')) as JsonSchemaType);
   expect(read({resource:{id:randomUUID(),revision:'a'.repeat(64),mediaType:'text/plain',size:1},offset:0,length:262145}).valid).toBe(false);
 });
 it('prepares first defaults without adding applications,creating accounts or enabling projects; restarting is idempotent',async()=>{
   const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),capabilities=new CapabilityService({db,projects:new ProjectService(db,secrets),secrets,userData:root});cleanups.push(()=>capabilities.dispose());
   const service=new AgentSupportService(store,capabilities,output);await service.initialize();expect(service.status().state).toBe('ready');expect(service.status().applications).toHaveLength(2);expect(service.status().applications.every(a=>a.filesReady&&a.defaultForNewSessions)).toBe(true);
   for(const table of ['application_catalog_state','application_connections','application_project_settings'])expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({n:0});
   const approvalsBefore=approvals();await new AgentSupportService(store,capabilities,output).initialize();expect(approvals()).toEqual(approvalsBefore);expect(builtin.packages.list()).toHaveLength(2);
 });
 it('T64 repairs an absent original package through trusted startup without replacing an explicitly newer default',async()=>{
   const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),capabilities=new CapabilityService({db,projects:new ProjectService(db,secrets),secrets,userData:root});cleanups.push(()=>capabilities.dispose());
   await new AgentSupportService(store,capabilities,output).initialize();const old=builtin.assertTrusted(entry('zentao').hash),nextDistribution=changedDistribution('zentao','2.0.0'),next=await builtin.install(nextDistribution,nextDistribution.index.apps.find(a=>a.appId==='zentao')!);
   await builtin.packages.activate(next.packageHash,builtin.packages.active('zentao')!.generation);const selected=builtin.packages.active('zentao'),proof=approvals();
   rmSync(join(store.root,old.relativePath),{recursive:true});const restarted=new AgentSupportService(store,capabilities,output);await restarted.initialize();
   expect(restarted.status().state).toBe('ready');expect(restarted.status().applications.find(a=>a.appId==='zentao')).toMatchObject({hash:old.packageHash,filesReady:true,defaultForNewSessions:false,errorCode:null});
   expect(builtin.assertTrusted(old.packageHash)).toEqual(old);expect(builtin.packages.active('zentao')).toEqual(selected);expect(approvals()).toEqual(proof);
   expect(readFileSync(join(store.root,old.relativePath,'adapter/operations.json'))).toEqual(bundle('zentao').files['adapter/operations.json']);
   expect(sqlite.prepare("SELECT state FROM capability_resource_operations WHERE kind='restore-application-package'").all()).toEqual([{state:'committed'}]);
   for(const table of ['application_catalog_state','application_connections','application_project_settings'])expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({n:0});
 },15000); // Multiple trusted installs, full-file verification and cold restoration; no production deadline change.
 it('T64 rejects an altered trusted-distribution copy before repairing a missing original package',async()=>{
   const old=await install('zentao'),proof=approvals(),target=join(store.root,old.relativePath),copy=join(root,'unusable-repair-source');cpSync(output,copy,{recursive:true});
   writeFileSync(join(copy,entry('zentao').path,'skills/'+bundle('zentao').manifest.skills[0].id+'/SKILL.md'),'altered repair content');rmSync(target,{recursive:true});
   await expect(builtin.install(new CapabilityBundleSource(copy),entry('zentao'))).rejects.toMatchObject({code:'HASH_MISMATCH'});
   expect(existsSync(target)).toBe(false);expect(approvals()).toEqual(proof);expect(store.get(old.resourceId).state).toBe('ready');
   expect(sqlite.prepare("SELECT count(*) AS n FROM capability_resource_operations WHERE kind='restore-application-package'").get()).toEqual({n:0});
   expect((await install('zentao')).packageHash).toBe(old.packageHash);expect(builtin.assertTrusted(old.packageHash)).toEqual(old);
 });
 it('retains verified package files but defers the fresh default set until the damaged package is repaired',async()=>{
   const copy=join(root,'damaged-distribution');cpSync(output,copy,{recursive:true});writeFileSync(join(copy,entry('mail').path,'skills/work-assistant/SKILL.md'),'changed');
   const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),capabilities=new CapabilityService({db,projects:new ProjectService(db,secrets),secrets,userData:root});cleanups.push(()=>capabilities.dispose());
   const service=new AgentSupportService(store,capabilities,copy);await service.initialize();expect(service.status()).toMatchObject({state:'partial',errorCode:'HASH_MISMATCH'});expect(service.status().applications.find(a=>a.appId==='zentao')).toMatchObject({filesReady:true,defaultForNewSessions:false,errorCode:null});expect(service.status().applications.find(a=>a.appId==='mail')).toMatchObject({filesReady:false,errorCode:'HASH_MISMATCH'});
   expect(sqlite.prepare('SELECT * FROM capability_active_packages').all()).toEqual([]);
   // The installation/activation design distinguishes verified bytes from the atomically activated set.
   writeFileSync(join(copy,entry('mail').path,'skills/work-assistant/SKILL.md'),bundle('mail').files['skills/work-assistant/SKILL.md']);
   const repaired=new AgentSupportService(store,capabilities,copy);await repaired.initialize();expect(repaired.status().state).toBe('ready');expect(repaired.status().applications.every(a=>a.filesReady&&a.defaultForNewSessions)).toBe(true);
   expect(sqlite.prepare('SELECT app_id FROM capability_active_packages ORDER BY app_id').all()).toEqual([{app_id:'mail'},{app_id:'zentao'}]);
 });
 it('does not follow an indexed package symlink or remove its external source',()=>{
   const copy=join(root,'linked-distribution');cpSync(output,copy,{recursive:true});const target=join(copy,entry('mail').path),outside=join(root,'external-package');renameSync(target,outside);symlinkSync(outside,target);const linked=new CapabilityBundleSource(copy);expect(()=>linked.application(linked.index.apps.find(a=>a.appId==='mail')!)).toThrow('文件树无效');expect(existsSync(join(outside,'manifest.json'))).toBe(true);
 });

 it('rejects a packaged tree with missing contracts or extra files instead of accepting directory existence',()=>{
   const copy=join(root,'packaged-copy');cpSync(output,copy,{recursive:true});const file=join(copy,entry('mail').path,'adapter/operations.json'),bytes=readFileSync(file);rmSync(file);expect(()=>verifyBundles(copy,source.index.build.appVersion)).toThrow('inventory');writeFileSync(file,bytes);writeFileSync(join(copy,entry('mail').path,'unlisted.txt'),'extra');expect(()=>verifyBundles(copy,source.index.build.appVersion)).toThrow('inventory');
 });

 it('keeps exact historical approval after the original distribution is gone,without inferring a latest package',async()=>{
   const copy=join(root,'old-distribution');cpSync(output,copy,{recursive:true});const old=new CapabilityBundleSource(copy),installed=await builtin.install(old,old.index.apps.find(a=>a.appId==='zentao')!);rmSync(copy,{recursive:true});
   const restarted=new BuiltinPackageRegistry(new ResourceStore(sqlite,root));expect(restarted.assertTrusted(installed.packageHash).packageHash).toBe(installed.packageHash);expect(approvals()).toHaveLength(1);
 });
 it('rejects a valid but unapproved package before loading code or resolving a Data API',async()=>{
   const installed=await builtin.packages.install(bundle('zentao'));let resolved=0;const adapters=new ApplicationAdapterRegistry(store,{resolve:()=>{resolved++;throw new Error('must not resolve');}});
   expect(()=>adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1)).toThrow('可信内置分发依据');expect(resolved).toBe(0);expect(approvals()).toEqual([]);
 });
 it('preserves the approved old package and default when same-version bytes change',async()=>{
   const installed=await install('zentao');await builtin.packages.activate(installed.packageHash,0);const before=approvals(),changed=changedDistribution('zentao',installed.version,files=>{files['skills/bug-analysis/SKILL.md']=Buffer.from(files['skills/bug-analysis/SKILL.md'].toString()+'\nchanged\n');});
   await expect(builtin.install(changed,changed.index.apps.find(a=>a.appId==='zentao')!)).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(approvals()).toEqual(before);expect(builtin.packages.active('zentao')?.packageHash).toBe(installed.packageHash);expect(builtin.assertTrusted(installed.packageHash).state).toBe('ready');
 });
 it('withholds execution when the retained original distribution proof is corrupt',async()=>{
   const installed=await install('mail');sqlite.prepare("UPDATE capability_builtin_package_sources SET source_index_json='{}' WHERE package_hash=?").run(installed.packageHash);expect(()=>new BuiltinPackageRegistry(store).assertTrusted(installed.packageHash)).toThrow('分发依据损坏');expect(sqlite.prepare('SELECT source_index_json FROM capability_builtin_package_sources').get()).toEqual({source_index_json:'{}'});
 });
 it('executes the original pure CJS adapter through fixed Data API with real session/run protection and invocation ledger',async()=>{
   const {f,owned,selected}=await realRun();const seen:Array<{method:string;hash:string;project:string}>=[];
   const host:ApplicationDataHost={resolve:(version,method,binding)=>{expect(version).toBe(1);return{semantics:'read',retry:'safe-read',authorize:context=>{expect(context.run.projectId).toBe('p1');},execute:async context=>{seen.push({method,hash:binding.packageHash,project:context.run.projectId});return emptyWork();}};}};
   const adapters=new ApplicationAdapterRegistry(f.store,host),tools=new ApplicationToolService(f.store,f.runs,adapters,{retryDelays:[0,0]}),listed=await tools.list(owned.runId);expect(listed.tools).toHaveLength(3);expect(listed.tools.find(t=>t.name==='smartdd_zentao_work_list_v1')?.description).toContain('分页查询');
   const result=await tools.call(owned.runId,randomUUID(),{operation:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:null,arguments:{kind:'bug'}});expect(result).toMatchObject({status:'ok',value:{complete:true,total:0}});expect(seen).toEqual([{method:'zentao.work.list',hash:selected.packageHash,project:'p1'}]);expect(f.sqlite.prepare('SELECT state,semantics,package_hash FROM application_invocations').get()).toEqual({state:'succeeded',semantics:'read',package_hash:selected.packageHash});
 });

 it('routes the fixed mail write once and preserves an uncertain receipt without transport retries or duplicate execution',async()=>{
   const {f,owned}=await realRun('mail');let submissions=0;
   const adapters=new ApplicationAdapterRegistry(f.store,{resolve:(_version,method,binding)=>{expect(method).toBe('mail.send.execute');expect(binding.permission).toBe('mail.send');return{semantics:'write',retry:'never',authorize:()=>{},execute:async()=>{submissions++;throw new ApplicationError('TIMEOUT','controlled executor submission uncertainty');}};}});
   const tools=new ApplicationToolService(f.store,f.runs,adapters,{retryDelays:[0,0]}),id=randomUUID(),call={operation:'smartdd_mail_send_execute_v1',contractMajor:1,connectionId:null,arguments:{intentId:randomUUID(),expectedReviewHash:'a'.repeat(64)}};
   const result=await tools.call(owned.runId,id,call);expect(result).toMatchObject({status:'error',error:{effectState:'unknown',attemptCount:1,retryable:false}});expect(await tools.call(owned.runId,id,call)).toEqual(result);expect(submissions).toBe(1);expect(f.sqlite.prepare('SELECT state,semantics,attempt_count FROM application_invocations').get()).toEqual({state:'unknown',semantics:'write',attempt_count:1});
 });

 it('keeps old snapshot routing after a new default and refuses replacing the context with the new package',async()=>{
   const {f,owned,selected,trusted}=await realRun();const nextSource=changedDistribution('zentao','2.0.0'),nextEntry=nextSource.index.apps.find(a=>a.appId==='zentao')!,next=await trusted.install(nextSource,nextEntry);await trusted.packages.activate(next.packageHash,1);
   const seen:string[]=[];const adapters=new ApplicationAdapterRegistry(f.store,dataHost(async(_context,_args,operation)=>{seen.push(operation.packageHash);return emptyWork();})),tools=new ApplicationToolService(f.store,f.runs,adapters);
   expect((await tools.call(owned.runId,randomUUID(),{operation:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:null,arguments:{kind:'bug'}})).status).toBe('ok');expect(seen).toEqual([selected.packageHash]);const context=f.runs.assertActive(owned.runId);expect(()=>adapters.resolve(next.packageHash,'smartdd_zentao_work_list_v1',1).authorize(context,null)).toThrow('未选用');
 });
 it('checks original bytes again for a cached module and restores only the exact approved bytes',async()=>{
   const installed=await install('zentao'),adapters=new ApplicationAdapterRegistry(store,dataHost(async()=>emptyWork()));adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1);const path=join(store.root,installed.relativePath,'adapter/index.cjs'),bytes=readFileSync(path);writeFileSync(path,'module.exports = {};');expect(()=>adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1)).toThrow('摘要');writeFileSync(path,bytes);expect(adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1).semantics).toBe('read');
 });
 it('refuses a package route that claims another application or reverses readonly semantics',async()=>{
   const changed=changedDistribution('zentao','2.0.0',files=>{const ops=JSON.parse(files['adapter/operations.json'].toString());ops.operations.smartdd_zentao_work_list_v1.method='mail.send.execute';files['adapter/operations.json']=Buffer.from(canonicalJson(ops)+'\n');}),installed=await builtin.install(changed,changed.index.apps.find(a=>a.appId==='zentao')!);let calls=0;const adapters=new ApplicationAdapterRegistry(store,{resolve:()=>{calls++;throw new Error('must not resolve');}});expect(()=>adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1)).toThrow('语义');expect(calls).toBe(0);
 });
 it('refuses a host executor with incompatible write semantics for an original read',async()=>{
   const installed=await install('zentao'),adapters=new ApplicationAdapterRegistry(store,{resolve:()=>({semantics:'write',retry:'never',authorize:()=>{},execute:async()=>({})})});expect(()=>adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1)).toThrow('执行语义');
 });

 it('prevents a fixed adapter from executing its business method twice in one tool invocation',async()=>{
   const changed=changedDistribution('zentao','2.0.0',files=>{files['adapter/index.cjs']=Buffer.from(`const d=require('./operations.json');module.exports={api:1,dataApi:1,appId:d.appId,version:d.version,operations:d.operations,async execute(name,args,data){await data.v1.invoke(d.operations[name].method,args);return data.v1.invoke(d.operations[name].method,args);}};`);});
   const {f,owned}=await realRun('zentao',changed);let count=0;const adapters=new ApplicationAdapterRegistry(f.store,dataHost(async()=>{count++;return emptyWork();})),tools=new ApplicationToolService(f.store,f.runs,adapters);
   const result=await tools.call(owned.runId,randomUUID(),{operation:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:null,arguments:{kind:'bug'}});expect(result).toMatchObject({status:'error',error:{code:'SCOPE_DENIED',effectState:'read-only'}});expect(count).toBe(1);
 });
 it.each(['host.sql.execute','host.connections.config','host.secrets.read'])('rejects an adapter request for undeclared host method %s before dispatch',async method=>{
   // A private indexed fixture exercises the dispatcher, not third-party sandboxing.
   const changed=changedDistribution('zentao','2.0.0',files=>{files['adapter/index.cjs']=Buffer.from(`const d=require('./operations.json');module.exports={api:1,dataApi:1,appId:d.appId,version:d.version,operations:d.operations,execute(name,args,data){return data.v1.invoke(${JSON.stringify(method)},{sql:'SELECT * FROM app_secrets',connectionId:'not-authorized'});}};`);});
   const {f,owned}=await realRun('zentao',changed);let calls=0;
   const snapshot=structuredClone(f.runs.assertActive(owned.runId).snapshot),before=f.sqlite.prepare('SELECT * FROM app_secrets').all();
   const adapters=new ApplicationAdapterRegistry(f.store,dataHost(async()=>{calls++;return emptyWork();})),tools=new ApplicationToolService(f.store,f.runs,adapters);
   expect(await tools.call(owned.runId,randomUUID(),{operation:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:null,arguments:{kind:'bug'}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED',effectState:'read-only'}});
   expect(calls).toBe(0);expect(f.sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(before);expect(f.runs.assertActive(owned.runId).snapshot).toEqual(snapshot);
 });
 it('rejects a fixed adapter importing a direct SQLite driver before resolving any host method',async()=>{
   const changed=changedDistribution('zentao','2.0.0',files=>{files['adapter/index.cjs']=Buffer.from("const sqlite=require('better-sqlite3');module.exports={};");});
   const installed=await builtin.install(changed,changed.index.apps.find(a=>a.appId==='zentao')!);let calls=0;
   const adapters=new ApplicationAdapterRegistry(store,{resolve:()=>{calls++;throw new Error('must not resolve');}});
   expect(()=>adapters.resolve(installed.packageHash,'smartdd_zentao_work_list_v1',1)).toThrow(expect.objectContaining({code:'HOST_INCOMPATIBLE'}));expect(calls).toBe(0);
 });
 it('does not let a verified adapter receive a different package or contract in its host operation context',async()=>{
   const {f,owned,selected}=await realRun();let count=0;const adapters=new ApplicationAdapterRegistry(f.store,dataHost(async()=>{count++;return emptyWork();})),handler=adapters.resolve(selected.packageHash,'smartdd_zentao_work_list_v1',1);
   await expect(handler.execute(f.runs.assertActive(owned.runId),{kind:'bug'},{operationId:randomUUID(),requestId:randomUUID(),attempt:1,deadline:Date.now()+30000,signal:new AbortController().signal,packageHash:'f'.repeat(64),appId:'zentao',toolName:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:null})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(count).toBe(0);
 });

 it('rechecks current policy before delivering cached invocation results and never asks the adapter to mint authorization',async()=>{
   const {f,owned}=await realRun();let allowed=true,count=0;const adapters=new ApplicationAdapterRegistry(f.store,dataHost(async()=>{count++;return emptyWork();},()=>{if(!allowed)throw new ApplicationError('SCOPE_DENIED','current policy revoked');})),tools=new ApplicationToolService(f.store,f.runs,adapters),id=randomUUID(),call={operation:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:null,arguments:{kind:'bug'}};
   expect((await tools.call(owned.runId,id,call)).status).toBe('ok');allowed=false;expect(await tools.call(owned.runId,id,call)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(count).toBe(1);
   const mail=bundle('mail'),operations=JSON.parse(mail.files['adapter/operations.json'].toString());expect(Object.keys(operations.operations).some(name=>name.includes('authorize')||name.includes('approve'))).toBe(false);expect(operations.operations.smartdd_mail_send_execute_v1).toMatchObject({semantics:'write',retry:'never'});
 });
});
