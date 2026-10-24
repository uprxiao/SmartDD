import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import type {ResourceStore} from '../core/applications/resource-store';
import type {DatabaseAccessLease} from './database-access-gate';
import {MigrationJournals,type MigrationJournal} from './migration-journal';
import {createMigrationBackup} from './migration-backup';
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
 const unfinished:MigrationJournal[]=[];
 for(const operation of operations){
  const committed=hasOperations&&db.prepare('SELECT 1 FROM capability_resource_operations WHERE operation_id=?').get(operation.operationId);
  if(committed)journals.completeFromDatabase(operation.operationId);
  else if(operation.state==='complete')throw new Error('迁移文件已完成但数据库提交记录缺失');
  else unfinished.push(operation);
 }
 if(unfinished.length>1)throw new Error('存在多个未完成迁移计划，保留原库等待核查');
 if(!initial.pending.length){if(unfinished.length)throw new Error('迁移水位已更新但缺少同事务提交记录');return [];}
 const compact=(rows:readonly MigrationRecord[])=>rows.map(({tag,hash,when})=>({tag,hash,when}));
 let operation=unfinished[0];
 if(operation&&(operation.buildId!==input.buildId||JSON.stringify(operation.target)!==JSON.stringify(compact(migrations))||JSON.stringify(operation.before)!==JSON.stringify(compact(initial.before))))throw new Error('未完成迁移计划与当前程序或数据库不一致');
 operation??=journals.create({buildId:input.buildId,before:initial.before,target:migrations});
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
 await input.assertNoForeignHolders();guard();
 const current=planMigrations(db,migrations);
 if(JSON.stringify(current.before)!==JSON.stringify(initial.before))throw new Error('备份期间迁移水位变化');
 const applied=runMigrations(db,migrations,{recordCommit:()=>journals.recordCommit(db,operation.operationId)});
 journals.completeFromDatabase(operation.operationId);
 return applied;
}
