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

const AGENT_TABLES=['agent_resource_refs','agent_turn_changes','agent_goals','agent_commit_provenance','agent_intents','agent_workspaces','agent_directory_queue','agent_delegation_attempts','agent_delegations','agent_transfers','agent_requests','agent_events','agent_items','agent_turns'];
/** Undo 0037 exactly: restore capability_runs to its 0036 shape and drop the M14 agent tables. */
function revertAgentWorkspace(db:Database.Database){
 const removed=bundledMigrations().slice(37);expect(removed.map(m=>m.tag)).toEqual(['0037_agent_workspace','0038_agent_resource_cleanup','0039_agent_task_pin','0040_agent_reply_like','0041_rare_skrulls']);expect(db.prepare("SELECT count(*) n FROM capability_runs WHERE binding_id IS NOT NULL").get()).toEqual({n:0});
 const fk=db.pragma('foreign_keys',{simple:true});db.pragma('foreign_keys=OFF');
 db.exec(`DROP TRIGGER capability_runs_owner_insert; DROP TRIGGER capability_runs_owner_update; DROP INDEX capability_runs_binding_generation; DROP TABLE agent_retained_run_identity; DROP TABLE agent_pending_cleanup;
 CREATE TABLE capability_runs_old (run_id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT, project_id TEXT NOT NULL, runner TEXT NOT NULL, pid INTEGER, process_started_at TEXT, state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, error_code TEXT, snapshot_hash TEXT, owner_instance_id TEXT, owner_pid INTEGER, owner_started_at TEXT, bindings_json TEXT NOT NULL DEFAULT '[]', pty_id TEXT, revocation_state TEXT NOT NULL DEFAULT 'open', binding_mode TEXT NOT NULL DEFAULT 'current' CHECK(binding_mode IN ('current','run')));
 INSERT INTO capability_runs_old SELECT run_id,task_id,project_id,runner,pid,process_started_at,state,started_at,ended_at,error_code,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id,revocation_state,binding_mode FROM capability_runs;
 DROP TABLE capability_runs; ALTER TABLE capability_runs_old RENAME TO capability_runs;
 ${AGENT_TABLES.map(t=>`DROP TABLE ${t};`).join(' ')} DROP TABLE agent_capability_sessions; DROP TABLE agent_driver_probes; DROP TABLE agent_bindings; DROP TABLE agent_tasks;`);
 db.prepare('DELETE FROM __drizzle_migrations WHERE created_at>=?').run(removed[0].when);db.pragma('foreign_keys='+(fk?'ON':'OFF'));
}
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
   // Restore the exact preceding schema: undo 0037 (M14 agent tables), then 0036 adds only the retention timestamp column.
   revertAgentWorkspace(f.sqlite);const last=bundledMigrations().find(m=>m.tag==='0036_connection_history_retention')!;expect(last.sql.trim()).toBe('ALTER TABLE application_connections ADD COLUMN deleted_at TEXT;');expect(f.sqlite.prepare('SELECT count(*) n FROM browser_operations').get()).toEqual({n:0});f.sqlite.exec('ALTER TABLE application_connections DROP COLUMN deleted_at');expect(f.sqlite.prepare("SELECT name FROM pragma_table_info('application_connections') WHERE name='deleted_at'").get()).toBeUndefined();f.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE hash=?').run(last.hash);
  }
  const watermark=f.sqlite.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all();
  if(owner!=='stopped')reader.identities.set(pid,birth);if(owner==='unknown')reader.unknown.add(pid);
  f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));let activated=false;
  const open=()=>openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>new PackageRegistry(store,'read-upgrade').active('zentao')?.packageHash!==target.packageHash,activate:async(store,maintenance)=>{await activatePreparedPackages({packages:new PackageRegistry(store,'read-upgrade'),lease:maintenance,buildId:'read-upgrade',requests:[{hash:target.packageHash,expectedGeneration:prior.generation}]});activated=true;}});
  if(owner==='stopped'){
   client=await open();expect(activated).toBe(true);expect(client.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'released'});expect(client.sqlite.prepare('SELECT state,error_code FROM application_data_operations WHERE operation_id=?').get(id)).toEqual({state:'cancelled',error_code:'CANCELED'});expect(client.sqlite.prepare('SELECT package_hash FROM capability_active_packages WHERE app_id=?').get('zentao')).toEqual({package_hash:target.packageHash});expect(client.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='capability_broker_denials'").get()).toBeTruthy();expect(client.sqlite.prepare("SELECT count(*) n FROM browser_operations").get()).toEqual({n:0});expect(client.sqlite.prepare("SELECT name FROM pragma_table_info('application_connections') WHERE name='deleted_at'").get()).toEqual({name:'deleted_at'});expect(f.snapshotTree(join(f.store.root,f.application.relativePath))).toEqual(original);
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
  const bundles=new CapabilityBundleSource(resolve('out/capability-bundles-compatibility-v1'));await new RuntimeRegistry(f.store).install(bundles.runtime());const mail=await new BuiltinPackageRegistry(f.store).install(bundles,bundles.index.apps.find(a=>a.appId==='mail')!);
  const source=fixtureBundle('2.0.0');source.manifest.runtime.hash=f.source.manifest.runtime.hash;const target=await f.packages.install(source),prior=f.packages.active('zentao')!,id=randomUUID(),leaseId=randomUUID();
  const action='application.cache.'+kind,semantics=kind==='clear'?'write':'read';
  const scope=digest(canonicalJson({callerKind:'ui',scopeKind:'connection-management',projectId:null,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:'mail',packageHash:mail.packageHash,action,semantics,policy:null}));
  f.sqlite.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES(?,'ui','connection-management','mail',?,1,?,?,?,'running',?)").run(id,mail.packageHash,action,semantics,scope,new Date().toISOString());
  f.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'ui',?,?,77161,'darwin-proc-v1:500:61','active',?)").run(leaseId,mail.resourceId,id,randomUUID(),new Date().toISOString());
  const projects=f.sqlite.prepare('SELECT * FROM projects').all();
  if(gate==='migration-and-activation'){revertAgentWorkspace(f.sqlite);const last=bundledMigrations().find(m=>m.tag==='0036_connection_history_retention')!;expect(last.sql.trim()).toBe('ALTER TABLE application_connections ADD COLUMN deleted_at TEXT;');expect(f.sqlite.prepare('SELECT count(*) n FROM browser_operations').get()).toEqual({n:0});f.sqlite.exec('ALTER TABLE application_connections DROP COLUMN deleted_at');expect(f.sqlite.prepare("SELECT name FROM pragma_table_info('application_connections') WHERE name='deleted_at'").get()).toBeUndefined();f.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE hash=?').run(last.hash);}
  f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));
  client=await openManagedDatabase(join(f.root,'smartdd.db'),{processes:reader,activationRequired:store=>new PackageRegistry(store,'cache-upgrade').active('zentao')?.packageHash!==target.packageHash,activate:async(store,lease)=>{await activatePreparedPackages({packages:new PackageRegistry(store,'cache-upgrade'),lease,buildId:'cache-upgrade',requests:[{hash:target.packageHash,expectedGeneration:prior.generation}]});}});
  expect(client.sqlite.prepare('SELECT state,error_code FROM application_data_operations WHERE operation_id=?').get(id)).toEqual(kind==='clear'?{state:'unknown',error_code:'RESOURCE_RECOVERY_REQUIRED'}:{state:'cancelled',error_code:'CANCELED'});expect(client.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'released'});expect(client.sqlite.prepare("SELECT package_hash FROM capability_active_packages WHERE app_id='zentao'").get()).toEqual({package_hash:target.packageHash});expect(client.sqlite.prepare('SELECT * FROM projects').all()).toEqual(projects);expect(client.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='capability_broker_denials'").get()).toBeTruthy();expect(client.sqlite.prepare("SELECT count(*) n FROM browser_operations").get()).toEqual({n:0});expect(client.sqlite.prepare("SELECT name FROM pragma_table_info('application_connections') WHERE name='deleted_at'").get()).toEqual({name:'deleted_at'});
 }finally{client?.close();if(f.sqlite.open)f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}
},20000);

// Same original H operation must finish before a compatible startup activation.
// The publisher and process identities are explicit software fixtures; no App or
// real CLI/process-exit acceptance is inferred from this matrix.
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
