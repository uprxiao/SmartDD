import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,realpathSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import type {MigrationBackupReceipt} from '../../db/migration-backup';
import type {DatabaseAccessLease} from '../../db/database-access-gate';
import {assertNoForeignDatabaseHolders} from '../../db/database-holder-preflight';
import {createMigrationBackup,readApplicationMigrationState} from '../../db/migration-backup';
import {canonicalJson,digest} from './manifest';
import {PackageRegistry} from './package-registry';
import {planApplicationActivation,type ActivationTarget} from './activation-preflight';

/** Startup-only commit of preflighted, materialized packages. Requires the
 * exclusive host lease before any business services are started. Failure keeps
 * the durable operation/pending marker; it never restores the business DB. */
export async function activatePreparedPackages(input:{packages:PackageRegistry;lease:DatabaseAccessLease;buildId:string;operationId?:string;prepare?:{additionalStagingBytes?:number;recoveryResources?:readonly string[];targets:readonly ActivationTarget[];materialize:()=>Promise<void>};requests:readonly {hash:string;expectedGeneration:number}[]}):Promise<{operationId:string;result:{packageHash:string;generation:number}[]}>{
 const {packages,lease,buildId}=input,requests=input.requests.map(({hash,expectedGeneration})=>({hash,expectedGeneration})),store=packages.store,db=store.sqlite,operationId=input.operationId??randomUUID();
 const assertLease=()=>{lease.assertHeld();if(lease.mode!=='maintenance'||lease.root!==realpathSync(dirname(store.root))||realpathSync(dirname(db.name))!==lease.root)throw new Error('应用升级必须持有本数据库独占维护权');};
 assertLease();await assertNoForeignDatabaseHolders(db.name);assertLease();
 z.uuid().parse(operationId);
 const saved=input.operationId?db.prepare("SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=? AND kind='application-activation' AND owner_store_id=?").get(operationId,store.storeId) as {state:string;plan_json:string}|undefined:undefined;
 if(input.operationId&&!saved)throw new Error('原升级操作不存在或归属不符');
 const decoded=saved?JSON.parse(saved.plan_json):undefined;
 if(decoded&&(decoded.schema!==1||decoded.operationId!==operationId||decoded.storeId!==store.storeId||decoded.buildId!==buildId||canonicalJson(decoded.requests)!==canonicalJson(requests)))throw new Error('原升级计划与本次恢复请求不一致');
 if(saved?.state==='committed'){
  const result=z.array(z.object({packageHash:z.string().regex(/^[a-f0-9]{64}$/),generation:z.number().int().positive()}).strict()).parse(decoded.result);
  if(result.length!==requests.length||result.some((entry,index)=>entry.packageHash!==requests[index].hash||![requests[index].expectedGeneration,requests[index].expectedGeneration+1].includes(entry.generation)))throw new Error('原激活回执与计划不符');
  return{operationId,result};
 }
 if(saved&&!['preparing','verified'].includes(saved.state))throw new Error('原升级操作状态不可续做');
 const before=readApplicationMigrationState(db);
 if(decoded&&canonicalJson(decoded.before)!==canonicalJson(before))throw new Error('原升级预检之后应用水位已变化');
 const preflight=planApplicationActivation(packages,requests,input.prepare?.targets,input.prepare?.additionalStagingBytes);if(preflight.issues.length)throw new Error('应用升级预检未通过：'+preflight.issues.map(issue=>issue.code).join(','));
 if(decoded){
  if(!decoded.preflight)throw new Error('原升级缺少可核验的预检依据');
  const {planHash,...content}=decoded.preflight;
  if(planHash!==digest(canonicalJson(content))||canonicalJson(content.requests)!==canonicalJson(requests)||content.referenceHash!==preflight.referenceHash||!Array.isArray(content.issues)||content.issues.length)throw new Error('原升级预检依据已变化');
 }
 const plan={schema:1,operationId,storeId:store.storeId,buildId,requests,before,preflight:decoded?.preflight??preflight};

 // Only a verified retry may reach exact-resource publication recovery.
 // This does not release a lease: ResourceStore.recover verifies original kernel
 // identities, and all leases must be released before activation can proceed.
 const assertIdle=(allowRecovery=false)=>{
  const expected=new Set(input.prepare?.recoveryResources??[]);
  const leases=db.prepare("SELECT l.owner_kind,l.owner_id,l.resource_id,r.operation_id,r.state FROM capability_resource_leases l LEFT JOIN capability_resources r ON r.resource_id=l.resource_id AND r.owner_store_id=? WHERE l.state<>'released'").all(store.storeId) as {owner_kind:string;owner_id:string;resource_id:string;operation_id:string|null;state:string|null}[];
  const unresolved=leases.some(item=>!(allowRecovery&&saved?.state==='verified'&&item.owner_kind==='install'&&item.owner_id===item.operation_id&&expected.has(item.resource_id)&&['staged','verified','recovery-required'].includes(item.state??'')));
  if(unresolved||db.prepare("SELECT 1 FROM capability_run_processes WHERE state NOT IN ('exited','canceled') LIMIT 1").get()||db.prepare("SELECT 1 FROM capability_run_activities WHERE state='active' LIMIT 1").get())throw new Error('受管运行或在途操作尚未停妥');
 };
 assertIdle(true);
 db.transaction(()=>{
  const state=db.prepare('SELECT store_id,maintenance_state,maintenance_operation_id FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string;maintenance_operation_id:string}|undefined;
  if(saved){if(state?.store_id!==store.storeId||state.maintenance_state!=='pending'||state.maintenance_operation_id!==operationId)throw new Error('原升级维护占用不符');return;}
  if(state&&(state.store_id!==store.storeId||state.maintenance_state!=='ready'))throw new Error('已有未完成维护操作');
  const now=new Date().toISOString();
  db.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'application-activation',?,'preparing',?,?,?)").run(operationId,store.storeId,canonicalJson(plan),now,now);
  db.prepare("INSERT INTO capability_store_state(singleton,store_id,resource_generation,maintenance_state,maintenance_operation_id) VALUES(?,?,1,'pending',?) ON CONFLICT(singleton) DO UPDATE SET maintenance_state='pending',maintenance_operation_id=excluded.maintenance_operation_id").run(1,store.storeId,operationId);
 }).immediate();
 const backupRoot=join(lease.root,'backups/m10');
 let backup:MigrationBackupReceipt;
 if(saved?.state==='verified'){
  z.object({schema:z.literal(1),operationId:z.uuid(),buildId:z.literal(buildId),state:z.literal('verified'),file:z.literal('smartdd.db'),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(decoded.backup);backup=decoded.backup;
 }else backup=await createMigrationBackup(db,{backupRoot,operationId:saved?randomUUID():operationId,buildId});
 if(canonicalJson(backup.applications)!==canonicalJson(before))throw new Error('备份应用水位与预检不符');
 const proof={...plan,backup},encoded=canonicalJson(proof);
 db.prepare("UPDATE capability_resource_operations SET state='verified',plan_json=?,updated_at=? WHERE operation_id=? AND owner_store_id=? AND state='preparing'").run(encoded,new Date().toISOString(),operationId,store.storeId);
 await assertNoForeignDatabaseHolders(db.name);assertLease();
 const backupFile=join(backupRoot,backup.operationId,backup.file),stat=lstatSync(backupFile);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(backupFile)!==backupFile)throw new Error('升级备份文件身份无效');
 const hash=createHash('sha256');for await(const chunk of createReadStream(backupFile))hash.update(chunk);
 if(hash.digest('hex')!==backup.sha256)throw new Error('升级备份hash变化');
 const assert=()=>{
  assertLease();
  const state=db.prepare('SELECT store_id,maintenance_state,maintenance_operation_id FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string;maintenance_operation_id:string}|undefined;
  const operation=db.prepare('SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(operationId,store.storeId) as {state:string;plan_json:string}|undefined;
  if(state?.store_id!==store.storeId||state.maintenance_state!=='pending'||state.maintenance_operation_id!==operationId||operation?.state!=='verified'||operation.plan_json!==encoded)throw new Error('升级维护操作身份已变化');
 };
 assert();await input.prepare?.materialize();assert();assertIdle();
 const rechecked=planApplicationActivation(packages,requests);if(rechecked.issues.length||rechecked.referenceHash!==preflight.referenceHash)throw new Error('升级期间引用或连接兼容状态变化');
 if(canonicalJson(readApplicationMigrationState(db))!==canonicalJson(before))throw new Error('升级备份后应用水位变化');
 const result=await packages.activateSet(requests,{assert,recordCommit(result){
  assert();if(!db.inTransaction)throw new Error('激活回执必须同事务');
  db.prepare("UPDATE capability_resource_operations SET state='committed',plan_json=?,updated_at=? WHERE operation_id=?").run(canonicalJson({...proof,result}),new Date().toISOString(),operationId);
  db.prepare("UPDATE capability_store_state SET maintenance_state='ready',maintenance_operation_id=NULL WHERE singleton=1 AND maintenance_operation_id=?").run(operationId);
 }});
 return{operationId,result};
}
