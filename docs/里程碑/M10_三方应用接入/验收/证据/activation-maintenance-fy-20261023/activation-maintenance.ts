import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {DatabaseAccessLease} from '../../db/database-access-gate';
import {assertNoForeignDatabaseHolders} from '../../db/database-holder-preflight';
import {createMigrationBackup,readApplicationMigrationState} from '../../db/migration-backup';
import {canonicalJson} from './manifest';
import {PackageRegistry} from './package-registry';

/** Startup-only commit of preflighted, materialized packages. Requires the
 * exclusive host lease before any business services are started. Failure keeps
 * the durable operation/pending marker; it never restores the business DB. */
export async function activatePreparedPackages(input:{packages:PackageRegistry;lease:DatabaseAccessLease;buildId:string;requests:readonly {hash:string;expectedGeneration:number}[]}):Promise<{operationId:string;result:{packageHash:string;generation:number}[]}>{
 const {packages,lease,buildId}=input,requests=input.requests.map(({hash,expectedGeneration})=>({hash,expectedGeneration})),store=packages.store,db=store.sqlite,operationId=randomUUID();
 const assertLease=()=>{lease.assertHeld();if(lease.mode!=='maintenance'||lease.root!==realpathSync(dirname(store.root))||realpathSync(dirname(db.name))!==lease.root)throw new Error('应用升级必须持有本数据库独占维护权');};
 assertLease();await assertNoForeignDatabaseHolders(db.name);assertLease();
 const before=readApplicationMigrationState(db),plan={schema:1,operationId,storeId:store.storeId,buildId,requests,before};
 // Refuse live or uncertain child processes; never infer stopped from no UI.
 const busy=db.prepare("SELECT 1 FROM capability_run_processes WHERE state NOT IN ('exited','canceled') LIMIT 1").get();
 if(db.prepare("SELECT 1 FROM capability_resource_leases WHERE state<>'released' LIMIT 1").get()||busy||db.prepare("SELECT 1 FROM capability_run_activities WHERE state='active' LIMIT 1").get())throw new Error('受管运行或在途操作尚未停妥');
 db.transaction(()=>{
  const state=db.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
  if(state&&(state.store_id!==store.storeId||state.maintenance_state!=='ready'))throw new Error('已有未完成维护操作');
  const now=new Date().toISOString();
  db.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'application-activation',?,'preparing',?,?,?)").run(operationId,store.storeId,canonicalJson(plan),now,now);
  db.prepare("INSERT INTO capability_store_state(singleton,store_id,resource_generation,maintenance_state,maintenance_operation_id) VALUES(?,?,1,'pending',?) ON CONFLICT(singleton) DO UPDATE SET maintenance_state='pending',maintenance_operation_id=excluded.maintenance_operation_id").run(1,store.storeId,operationId);
 }).immediate();
 const backupRoot=join(lease.root,'backups/m10'),backup=await createMigrationBackup(db,{backupRoot,operationId,buildId});
 if(canonicalJson(backup.applications)!==canonicalJson(before))throw new Error('备份应用水位与预检不符');
 const proof={...plan,backup},encoded=canonicalJson(proof);
 db.prepare("UPDATE capability_resource_operations SET state='verified',plan_json=?,updated_at=? WHERE operation_id=? AND owner_store_id=? AND state='preparing'").run(encoded,new Date().toISOString(),operationId,store.storeId);
 await assertNoForeignDatabaseHolders(db.name);assertLease();
 const hash=createHash('sha256');for await(const chunk of createReadStream(join(backupRoot,operationId,backup.file)))hash.update(chunk);
 if(hash.digest('hex')!==backup.sha256)throw new Error('升级备份hash变化');
 const assert=()=>{
  assertLease();
  const state=db.prepare('SELECT store_id,maintenance_state,maintenance_operation_id FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string;maintenance_operation_id:string}|undefined;
  const operation=db.prepare('SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(operationId,store.storeId) as {state:string;plan_json:string}|undefined;
  if(state?.store_id!==store.storeId||state.maintenance_state!=='pending'||state.maintenance_operation_id!==operationId||operation?.state!=='verified'||operation.plan_json!==encoded)throw new Error('升级维护操作身份已变化');
 };
 if(canonicalJson(readApplicationMigrationState(db))!==canonicalJson(before))throw new Error('升级备份后应用水位变化');
 const result=await packages.activateSet(requests,{assert,recordCommit(result){
  assert();if(!db.inTransaction)throw new Error('激活回执必须同事务');
  db.prepare("UPDATE capability_resource_operations SET state='committed',plan_json=?,updated_at=? WHERE operation_id=?").run(canonicalJson({...proof,result}),new Date().toISOString(),operationId);
  db.prepare("UPDATE capability_store_state SET maintenance_state='ready',maintenance_operation_id=NULL WHERE singleton=1 AND maintenance_operation_id=?").run(operationId);
 }});
 return{operationId,result};
}
