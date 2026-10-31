import Database from 'better-sqlite3';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import type {ResourceStore} from '../core/applications/resource-store';
import type {DatabaseAccessLease} from './database-access-gate';
import {MigrationJournals,type MigrationJournal} from './migration-journal';
import {createMigrationBackup,readApplicationMigrationState} from './migration-backup';
import {planMigrations,runMigrations,type MigrationRecord} from './migrations';

/** Startup-only coordinator: caller owns maintenance and has not started any
 * business services. Committed operations recover their mirror, never restore DB. */
export async function coordinateMigrations(input:{store:ResourceStore;lease:DatabaseAccessLease;buildId:string;migrations:MigrationRecord[];assertNoForeignHolders:()=>Promise<unknown>}):Promise<string[]>{
 const {store,lease,migrations}=input,db=store.sqlite,journals=new MigrationJournals(store,lease);
 const backupRoot=join(lease.root,'backups/m10');
 const guard=()=>{lease.assertHeld();if(lease.mode!=='maintenance'||db.inTransaction)throw new Error('启动迁移需要独立维护占用');};
 guard();await input.assertNoForeignHolders();guard();
 const initial=planMigrations(db,migrations);
 const operations=journals.list();
 const hasOperations=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_resource_operations'").get();
 const hasState=()=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_store_state'").get();
 const state=()=>hasState()?db.prepare('SELECT store_id,maintenance_state,maintenance_operation_id FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string;maintenance_operation_id:string|null}|undefined:undefined;
 const assertOwner=()=>{const current=state();if(current&&current.store_id!==store.storeId)throw new Error('数据库维护归属不一致');return current;};
 const ready=()=>{const current=assertOwner();if(current&&current.maintenance_state!=='ready')throw new Error('另有未完成维护操作，保留原状态');};
 const markPending=(id:string)=>{
  if(!hasState())return;const current=assertOwner();
  if(current&&current.maintenance_state!=='ready'&&current.maintenance_operation_id!==id)throw new Error('另有未完成维护操作，不能覆盖');
  db.prepare("INSERT INTO capability_store_state(singleton,store_id,resource_generation,maintenance_state,maintenance_operation_id) VALUES(?,?,1,'pending',?) ON CONFLICT(singleton) DO UPDATE SET maintenance_state='pending',maintenance_operation_id=excluded.maintenance_operation_id").run(1,store.storeId,id);
 };
 const releasePending=(id:string)=>{
  const current=assertOwner();if(current?.maintenance_operation_id===id)db.prepare("UPDATE capability_store_state SET maintenance_state='ready',maintenance_operation_id=NULL WHERE singleton=1 AND store_id=? AND maintenance_operation_id=?").run(store.storeId,id);
 };
 assertOwner();
 const unfinished:MigrationJournal[]=[];
 for(const operation of operations){
  const committed=hasOperations&&db.prepare('SELECT 1 FROM capability_resource_operations WHERE operation_id=?').get(operation.operationId);
  if(committed){journals.completeFromDatabase(operation.operationId);releasePending(operation.operationId);}
  else if(operation.state==='complete')throw new Error('迁移文件已完成但数据库提交记录缺失');
  else unfinished.push(operation);
 }
 if(unfinished.length>1)throw new Error('存在多个未完成迁移计划，保留原库等待核查');
 if(!initial.pending.length){if(unfinished.length)throw new Error('迁移水位已更新但缺少同事务提交记录');ready();return [];}
 const compact=(rows:readonly MigrationRecord[])=>rows.map(({tag,hash,when})=>({tag,hash,when}));
 let operation=unfinished[0];
 if(operation&&(operation.buildId!==input.buildId||JSON.stringify(operation.target)!==JSON.stringify(compact(migrations))||JSON.stringify(operation.before)!==JSON.stringify(compact(initial.before))))throw new Error('未完成迁移计划与当前程序或数据库不一致');
 if(!operation)ready();
 operation??=journals.create({buildId:input.buildId,before:initial.before,target:migrations});
 markPending(operation.operationId);
 if(operation.state==='prepared'){
  // A previous failed/partial backup remains immutable; retry has its own ID.
  const receipt=await createMigrationBackup(db,{backupRoot,operationId:randomUUID(),buildId:input.buildId});
  operation=journals.backedUp(operation.operationId,receipt);
 }
 const backup=operation.backup;if(!backup)throw new Error('缺少迁移备份');
 const file=join(backupRoot,backup.operationId,'smartdd.db'),stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file)throw new Error('备份文件身份无法核验');
 const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);
 if(hash.digest('hex')!==backup.sha256)throw new Error('迁移备份内容已变化');
 const copy=new Database(file,{readonly:true,fileMustExist:true});
 try{if(JSON.stringify(readApplicationMigrationState(copy))!==JSON.stringify(readApplicationMigrationState(db)))throw new Error('应用迁移或默认版本在备份后变化，保留现场');}finally{copy.close();}
 await input.assertNoForeignHolders();guard();
 const current=planMigrations(db,migrations);
 if(JSON.stringify(current.before)!==JSON.stringify(initial.before))throw new Error('备份期间迁移水位变化');
 const applied=runMigrations(db,migrations,{recordCommit:()=>{journals.recordCommit(db,operation.operationId);markPending(operation.operationId);}});
 journals.completeFromDatabase(operation.operationId);releasePending(operation.operationId);ready();
 return applied;
}
