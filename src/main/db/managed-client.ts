import {mkdirSync,realpathSync,lstatSync} from 'node:fs';
import {dirname,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {openDbClient,type DbClient} from './client';
import {acquireDatabaseAccess,type DatabaseAccessLease} from './database-access-gate';
import {assertNoForeignDatabaseHolders} from './database-holder-preflight';
import {coordinateMigrations} from './migration-coordinator';
import {bundledMigrations,planMigrations} from './migrations';
import {MigrationJournals} from './migration-journal';
import type {ProcessIdentityReader} from '../core/applications/process-identity';
import {ResourceStore} from '../core/applications/resource-store';
import {recoverApplicationReads} from '../core/applications/read-context-recovery';

/** macOS startup before services exist. Business DB closes before releasing
 * maintenance; after taking shared ownership it reopens and revalidates schema.
 * Thus a competing upgrade during handoff cannot expose an unchecked schema. */
export async function openManagedDatabase(path:string,options:{processes?:ProcessIdentityReader;activationRequired?:(store:ResourceStore)=>boolean;activate?:(store:ResourceStore,lease:DatabaseAccessLease)=>Promise<void>;recoverActivation?:(store:ResourceStore,lease:DatabaseAccessLease,operationId:string)=>Promise<void>}={}):Promise<DbClient>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const root=realpathSync(dirname(path)),file=join(root,'smartdd.db');
 if(basename(path)!=='smartdd.db')throw new Error('受管数据库文件名无效');
 const migrations=bundledMigrations();
 const buildId=createHash('sha256').update(JSON.stringify(migrations.map(({tag,hash,when})=>({tag,hash,when})))).digest('hex');
 async function tryShared():Promise<DbClient|undefined>{
  const shared=await acquireDatabaseAccess(root,'shared');let opened:DbClient|undefined,retained=false;
  try{
   let stat;try{stat=lstatSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('数据库文件身份不能核验');
   for(const suffix of ['-wal','-shm'])try{const side=lstatSync(file+suffix);if(!side.isFile()||side.isSymbolicLink()||side.nlink!==1)throw new Error('数据库旁文件身份不能核验');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   opened=openDbClient(file);
   if(planMigrations(opened.sqlite,migrations).pending.length)return;
   const store=new ResourceStore(opened.sqlite,root,undefined,{processes:options.processes}),journals=new MigrationJournals(store,shared);
   if(opened.sqlite.prepare("SELECT 1 FROM capability_resource_leases WHERE owner_kind='application-activation' AND state<>'released' LIMIT 1").get())return;
   const maintenanceState=opened.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
   if(maintenanceState&&(maintenanceState.store_id!==store.storeId||maintenanceState.maintenance_state!=='ready'))return;
   const operations=journals.list();if(operations.some(operation=>operation.state!=='complete'))return;
   for(const operation of operations)journals.completeFromDatabase(operation.operationId); // Read-only for completed mirrors.
   if(options.activationRequired?.(store))return;
   shared.assertHeld();const client=opened;let closed=false;retained=true;
   return {...client,close(){if(closed)return;closed=true;try{client.close();}finally{shared.release();}}};
  }finally{if(!retained){try{opened?.close();}finally{shared.release();}}}
 }
 const ready=await tryShared();if(ready)return ready;
 const maintenance=await acquireDatabaseAccess(root,'maintenance');let client:DbClient|undefined;
 try{
  await assertNoForeignDatabaseHolders(file);
  client=openDbClient(file);
  const store=new ResourceStore(client.sqlite,root,undefined,{processes:options.processes});
  // Services have not started yet. Recover proved dead C read consumers before
  // either an old activation retry or new schema/default activation can run.
  if(options.processes){const reads=await recoverApplicationReads(store,options.processes);if(reads.pending.length)throw new Error('受管读取或在途操作尚未停妥，保留原数据库与占用');}
  if(client.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_store_state'").get()){
   const pending=client.sqlite.prepare("SELECT s.store_id,s.maintenance_operation_id AS id,o.kind FROM capability_store_state s LEFT JOIN capability_resource_operations o ON o.operation_id=s.maintenance_operation_id AND o.owner_store_id=s.store_id WHERE s.singleton=1 AND s.maintenance_state<>'ready'").get() as {store_id:string;id:string;kind:string|null}|undefined;
   if(pending?.kind==='application-activation'){
    if(pending.store_id!==store.storeId||planMigrations(client.sqlite,migrations).pending.length||!options.recoverActivation)throw new Error('应用升级待恢复，需原兼容构建完成维护后再启动');
    await options.recoverActivation(store,maintenance,pending.id);
   }
  }
  await coordinateMigrations({store,lease:maintenance,buildId,migrations,assertNoForeignHolders:()=>assertNoForeignDatabaseHolders(file)});
  const abandoned=client.sqlite.prepare("SELECT DISTINCT owner_id FROM capability_resource_leases WHERE owner_kind='application-activation' AND state<>'released'").all() as {owner_id:string}[];
  for(const row of abandoned)await store.recoverActivationLeases(row.owner_id,maintenance);
  if(options.activationRequired?.(store)){if(!options.activate)throw new Error('缺少应用升级执行入口');await options.activate(store,maintenance);}
 }finally{try{client?.close();}finally{maintenance.release();}}
 const reopened=await tryShared();if(!reopened)throw new Error('启动交接后数据库仍需维护');return reopened;
}
