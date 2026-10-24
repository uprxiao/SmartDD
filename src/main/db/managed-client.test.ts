import {mkdtempSync,realpathSync,rmSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {openManagedDatabase} from './managed-client';
import {acquireDatabaseAccess} from './database-access-gate';
import {agentFixture} from '../core/applications/__tests__/agent-fixture';
import {FixtureProcessReader} from '../core/applications/__tests__/run-fixture';
import {fixtureBundle} from '../core/applications/__tests__/fixtures';
import {PackageRegistry} from '../core/applications/package-registry';
import {activatePreparedPackages} from '../core/applications/activation-maintenance';
import {bundledMigrations} from './migrations';
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
