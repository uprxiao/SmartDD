import {mkdtempSync,realpathSync,rmSync,renameSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {openManagedDatabase} from './managed-client';
import {acquireDatabaseAccess} from './database-access-gate';
import {agentFixture} from '../core/applications/__tests__/agent-fixture';
import {FixtureProcessReader,runFixture} from '../core/applications/__tests__/run-fixture';
import {fixtureBundle} from '../core/applications/__tests__/fixtures';
import {PackageRegistry} from '../core/applications/package-registry';
import {activatePreparedPackages} from '../core/applications/activation-maintenance';
import {bundledMigrations} from './migrations';
import {CapabilityBundleSource} from '../core/applications/bundle-source';
import {BuiltinPackageRegistry} from '../core/applications/builtin-package-registry';
import {RuntimeRegistry} from '../core/applications/runtime-registry';
import {canonicalJson,digest} from '../core/applications/manifest';
import {resolve} from 'node:path';
it.skipIf(process.platform!=='darwin')('holds shared ownership for the live client and releases it on close, then reopens retained data',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-managed-db-')));let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  client=await openManagedDatabase(join(root,'smartdd.db'));
  client.sqlite.exec("CREATE TABLE retained_business(value TEXT); INSERT INTO retained_business VALUES('retained')");
  await expect(acquireDatabaseAccess(root,'maintenance',{timeoutMs:30})).rejects.toThrow('仍有宿主');
  const second=await openManagedDatabase(join(root,'smartdd.db'));
  try{client.close();client.close();await expect(acquireDatabaseAccess(root,'maintenance',{timeoutMs:30})).rejects.toThrow('仍有宿主');}finally{second.close();}
  const maintenance=await acquireDatabaseAccess(root,'maintenance');maintenance.release();
  client=await openManagedDatabase(join(root,'smartdd.db'));
  expect(client.sqlite.prepare('SELECT * FROM retained_business').all()).toEqual([{value:'retained'}]);
 }finally{client?.close();rmSync(root,{recursive:true,force:true});}
},20000);

// Controlled historical read/lease and kernel reader; actual U/database gate,
// migration backup/SQL and package activation. No App/CLI acceptance claim.
it.skipIf(process.platform!=='darwin').each(['activation','migration-and-activation'].flatMap(gate=>['stopped','running','unknown'].map(owner=>({gate,owner}))))('recovers only proved stopped reads before $gate; original owner $owner',async({gate,owner})=>{
 const f=await agentFixture(),reader=new FixtureProcessReader(),pid=77129,birth='darwin-proc-v1:500:21',id=randomUUID(),leaseId=randomUUID();let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  const source=fixtureBundle('2.0.0');source.manifest.runtime.hash=f.source.manifest.runtime.hash;const target=await f.packages.install(source),prior=f.packages.active('zentao')!,original=f.snapshotTree(join(f.store.root,f.application.relativePath));
  f.sqlite.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES(?,'ui','project','p1','zentao',?,1,'ui.zentao.work','read',?,'running',?)").run(id,f.application.packageHash,'a'.repeat(64),new Date().toISOString());
  f.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'ui',?,?,?,?, 'active',?)").run(leaseId,f.application.resourceId,id,randomUUID(),pid,birth,new Date().toISOString());
  if(gate==='migration-and-activation'){
   // Exact old boundary: the latest migration only adds this empty audit table.
   // Dropping that empty table and its receipt restores the preceding schema.
   const last=bundledMigrations().at(-1)!;expect(last.tag).toBe('0028_capability_broker_denials');expect(f.sqlite.prepare('SELECT count(*) n FROM capability_broker_denials').get()).toEqual({n:0});f.sqlite.exec('DROP TABLE capability_broker_denials');f.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE hash=?').run(last.hash);
  }
  const watermark=f.sqlite.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all();
  if(owner!=='stopped')reader.identities.set(pid,birth);if(owner==='unknown')reader.unknown.add(pid);
  f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));let activated=false;
  const open=()=>openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>new PackageRegistry(store,'read-upgrade').active('zentao')?.packageHash!==target.packageHash,activate:async(store,maintenance)=>{await activatePreparedPackages({packages:new PackageRegistry(store,'read-upgrade'),lease:maintenance,buildId:'read-upgrade',requests:[{hash:target.packageHash,expectedGeneration:prior.generation}]});activated=true;}});
  if(owner==='stopped'){
   client=await open();expect(activated).toBe(true);expect(client.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'released'});expect(client.sqlite.prepare('SELECT state,error_code FROM application_data_operations WHERE operation_id=?').get(id)).toEqual({state:'cancelled',error_code:'CANCELED'});expect(client.sqlite.prepare('SELECT package_hash FROM capability_active_packages WHERE app_id=?').get('zentao')).toEqual({package_hash:target.packageHash});expect(client.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='capability_broker_denials'").get()).toBeTruthy();expect(f.snapshotTree(join(f.store.root,f.application.relativePath))).toEqual(original);
  }else{await expect(open()).rejects.toThrow(/尚未停妥|在途操作/);expect(activated).toBe(false);const retained=new Database(join(f.root,'smartdd.db'),{readonly:true,fileMustExist:true});try{expect(retained.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all()).toEqual(watermark);expect(retained.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'active'});expect(retained.prepare('SELECT state FROM application_data_operations WHERE operation_id=?').get(id)).toEqual({state:'running'});}finally{retained.close();}if(gate==='activation'){client=await openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:()=>false});expect(client.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'active'});}}
 }finally{client?.close();if(f.sqlite.open)f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}
},20000);

it.skipIf(process.platform!=='darwin')('does not treat a completed file mirror as authority when its DB receipt is missing',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-managed-receipt-')));let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  client=await openManagedDatabase(join(root,'smartdd.db'));
  client.sqlite.exec("DELETE FROM capability_resource_operations WHERE kind='database-migration'");client.close();
  await expect(openManagedDatabase(join(root,'smartdd.db'))).rejects.toThrow('没有可核验');
  const maintenance=await acquireDatabaseAccess(root,'maintenance');maintenance.release();
 }finally{client?.close();rmSync(root,{recursive:true,force:true});}
},20000);

it.skipIf(process.platform!=='darwin').each(['clear','status'].flatMap(kind=>['activation','migration-and-activation'].map(gate=>({kind,gate}))))('recovers proved dead cache $kind before $gate without inventing success',async({kind,gate})=>{
 const f=await agentFixture(),reader=new FixtureProcessReader();let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  const bundles=new CapabilityBundleSource(resolve('out/capability-bundles'));await new RuntimeRegistry(f.store).install(bundles.runtime());const mail=await new BuiltinPackageRegistry(f.store).install(bundles,bundles.index.apps.find(a=>a.appId==='mail')!);
  const source=fixtureBundle('2.0.0');source.manifest.runtime.hash=f.source.manifest.runtime.hash;const target=await f.packages.install(source),prior=f.packages.active('zentao')!,id=randomUUID(),leaseId=randomUUID();
  const action='application.cache.'+kind,semantics=kind==='clear'?'write':'read';
  const scope=digest(canonicalJson({callerKind:'ui',scopeKind:'connection-management',projectId:null,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:'mail',packageHash:mail.packageHash,action,semantics,policy:null}));
  f.sqlite.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES(?,'ui','connection-management','mail',?,1,?,?,?,'running',?)").run(id,mail.packageHash,action,semantics,scope,new Date().toISOString());
  f.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'ui',?,?,77161,'darwin-proc-v1:500:61','active',?)").run(leaseId,mail.resourceId,id,randomUUID(),new Date().toISOString());
  const projects=f.sqlite.prepare('SELECT * FROM projects').all();
  if(gate==='migration-and-activation'){const last=bundledMigrations().at(-1)!;expect(last.tag).toBe('0028_capability_broker_denials');expect(f.sqlite.prepare('SELECT count(*) n FROM capability_broker_denials').get()).toEqual({n:0});f.sqlite.exec('DROP TABLE capability_broker_denials');f.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE hash=?').run(last.hash);}
  f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));
  client=await openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>new PackageRegistry(store,'cache-upgrade').active('zentao')?.packageHash!==target.packageHash,activate:async(store,lease)=>{await activatePreparedPackages({packages:new PackageRegistry(store,'cache-upgrade'),lease,buildId:'cache-upgrade',requests:[{hash:target.packageHash,expectedGeneration:prior.generation}]});}});
  expect(client.sqlite.prepare('SELECT state,error_code FROM application_data_operations WHERE operation_id=?').get(id)).toEqual(kind==='clear'?{state:'unknown',error_code:'RESOURCE_RECOVERY_REQUIRED'}:{state:'cancelled',error_code:'CANCELED'});expect(client.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'released'});expect(client.sqlite.prepare("SELECT package_hash FROM capability_active_packages WHERE app_id='zentao'").get()).toEqual({package_hash:target.packageHash});expect(client.sqlite.prepare('SELECT * FROM projects').all()).toEqual(projects);expect(client.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='capability_broker_denials'").get()).toBeTruthy();
 }finally{client?.close();if(f.sqlite.open)f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}
},20000);

// Same original H operation must finish before a compatible startup activation.
// The publisher and process identities are explicit software fixtures; no App or
// real CLI/process-exit acceptance is inferred from this matrix.
it.skipIf(process.platform!=='darwin').each([
 ...(['registered','materialized','renamed','catalog-published','records-committed'] as const).map(phase=>({phase,owner:'stopped' as const})),
 ...(['running','unknown','tampered-source'] as const).map(owner=>({phase:'registered' as const,owner})),
])('recovers recorded H $phase before activation only with proved original sources: $owner',async({phase,owner})=>{
 const f=await agentFixture(),reader=new FixtureProcessReader(),oldBirth='darwin-proc-v1:99:9';let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  const {DiscoveryCatalog}=await import('../core/applications/discovery-catalog');
  const targetSource=fixtureBundle('2.0.0');targetSource.manifest.runtime.hash=f.source.manifest.runtime.hash;const target=await f.packages.install(targetSource),prior=f.packages.active('zentao')!;
  const sources=f.projector.sourceSkills(f.plan('codex')),catalog=new DiscoveryCatalog(f.store,f.home,{read:pid=>({pid,startedAt:oldBirth}),state:()=> 'running'},{checkpoint:at=>{if(at===phase)throw Error('fixture publisher interrupted');}});
  await expect(catalog.publish(sources)).rejects.toThrow('fixture publisher interrupted');
  const pending=join(catalog.root,'pending.json'),intent=readFileSync(pending),original=JSON.parse(String(intent));
  const originalOp=f.sqlite.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(original.operationId),originalLeases=f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=? ORDER BY lease_id').all(original.operationId),projects=f.sqlite.prepare('SELECT * FROM projects ORDER BY id').all(),sourcePaths=sources.map(s=>f.store.directory(f.store.get(s.sourceResourceId))),sourceTrees=sourcePaths.map(path=>f.snapshotTree(path));
  if(owner==='tampered-source')writeFileSync(join(f.store.directory(f.store.get(sources[0].sourceResourceId)),'SKILL.md'),'edited source must stay untrusted');
  f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));let activated=false;
  const processes={read:(pid:number)=>reader.read(pid),state:(identity:{pid:number;startedAt:string})=>identity.startedAt===oldBirth&&owner!=='stopped'&&owner!=='tampered-source'?owner:reader.state(identity)};
  const open=()=>openManagedDatabase(join(f.root,'smartdd.db'),{processes,activationRequired:store=>new PackageRegistry(store,'h-upgrade').active('zentao')?.packageHash!==target.packageHash,activate:async(store,lease)=>{await activatePreparedPackages({packages:new PackageRegistry(store,'h-upgrade'),lease,buildId:'h-upgrade',requests:[{hash:target.packageHash,expectedGeneration:prior.generation}]});activated=true;}});
  if(owner==='stopped'){
   client=await open();expect(activated).toBe(true);expect(existsSync(pending)).toBe(false);expect(client.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=?').get(original.operationId)).toEqual({state:'committed'});expect(client.sqlite.prepare("SELECT 1 FROM capability_resource_leases WHERE owner_id=? AND state<>'released'").get(original.operationId)).toBeUndefined();expect(client.sqlite.prepare("SELECT package_hash FROM capability_active_packages WHERE app_id='zentao'").get()).toEqual({package_hash:target.packageHash});expect(client.sqlite.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(projects);expect(sourcePaths.map(path=>f.snapshotTree(path))).toEqual(sourceTrees);
  }else{
   await expect(open()).rejects.toThrow('受管运行或在途操作尚未停妥');expect(activated).toBe(false);expect(readFileSync(pending)).toEqual(intent);const retained=new Database(join(f.root,'smartdd.db'),{readonly:true,fileMustExist:true});try{expect(retained.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(original.operationId)).toEqual(originalOp);expect(retained.prepare('SELECT * FROM capability_resource_leases WHERE owner_id=? ORDER BY lease_id').all(original.operationId)).toEqual(originalLeases);expect(retained.prepare("SELECT package_hash FROM capability_active_packages WHERE app_id='zentao'").get()).toEqual({package_hash:prior.packageHash});expect(retained.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(projects);}finally{retained.close();}
  }
 }finally{client?.close();if(f.sqlite.open)f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}
},20000);

// Original startup/upgrade recovery: use real run registration and a controlled
// historical kernel ledger; no actual CLI/process exit is fabricated as live E2E.
it.skipIf(process.platform!=='darwin').each(['all-stopped','live-child','armed-unknown'] as const)('recovers proven abandoned runs before distribution activation while preserving $0 protection',async(mode)=>{
 const reader=new FixtureProcessReader(),f=await runFixture(reader,{application:true});let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  const source=fixtureBundle('2.0.0');source.manifest.runtime.hash=f.applicationSource!.manifest.runtime.hash;const packages=f.packageRegistry!,prior=packages.active('zentao')!,target=await packages.install(source),run=await f.create();await run.prepare();await run.cli.arm();const pid=77217,birth='darwin-proc-v1:500:71';reader.identities.set(pid,birth);await run.cli.attach(pid);
  if(mode==='armed-unknown'){const bridge=await run.reserveBridge();await bridge.arm();}
  const originals={snapshots:f.sqlite.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all(),refs:f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY ref_kind,ref_id').all(),packages:f.sqlite.prepare('SELECT package_hash,relative_path FROM capability_packages ORDER BY package_hash').all()};
  if(mode!=='live-child')reader.identities.delete(pid);reader.identities.set(process.pid,'darwin-proc-v1:999:71');f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));let activated=false;
  const open=()=>openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>new PackageRegistry(store,'run-upgrade').active('zentao')?.packageHash!==target.packageHash,activate:async(store,lease)=>{await activatePreparedPackages({packages:new PackageRegistry(store,'run-upgrade'),lease,buildId:'run-upgrade',requests:[{hash:target.packageHash,expectedGeneration:prior.generation}]});activated=true;}});
  if(mode==='all-stopped'){
   client=await open();expect(activated).toBe(true);expect(client.sqlite.prepare('SELECT state,revocation_state,error_code FROM capability_runs WHERE run_id=?').get(run.runId)).toEqual({state:'stopped',revocation_state:'revoked',error_code:'HOST_INTERRUPTED'});expect(client.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=? AND state<>'released'").get(run.runId)).toEqual({n:0});expect(client.sqlite.prepare('SELECT package_hash FROM capability_active_packages WHERE app_id=?').get('zentao')).toEqual({package_hash:target.packageHash});
  }else{await expect(open()).rejects.toThrow('受管运行或在途操作尚未停妥');expect(activated).toBe(false);}
  const db=client?.sqlite??new Database(join(f.root,'smartdd.db'),{readonly:true,fileMustExist:true});try{expect(db.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all()).toEqual(originals.snapshots);expect(db.prepare('SELECT * FROM capability_session_refs ORDER BY ref_kind,ref_id').all()).toEqual(originals.refs);expect(db.prepare('SELECT package_hash,relative_path FROM capability_packages ORDER BY package_hash').all()).toEqual(originals.packages);if(mode!=='all-stopped'){expect(db.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=? AND state<>'released'").get(run.runId)).toMatchObject({n:expect.any(Number)});expect((db.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=? AND state<>'released'").get(run.runId) as {n:number}).n).toBeGreaterThan(0);expect(db.prepare('SELECT package_hash FROM capability_active_packages WHERE app_id=?').get('zentao')).toEqual({package_hash:prior.packageHash});}}finally{if(db!==client?.sqlite)db.close();}
 }finally{client?.close();if(f.sqlite.open)f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}
},20000);
