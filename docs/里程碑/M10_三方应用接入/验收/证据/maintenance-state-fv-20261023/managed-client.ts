import {mkdirSync,realpathSync,lstatSync} from 'node:fs';
import {dirname,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {openDbClient,type DbClient} from './client';
import {acquireDatabaseAccess} from './database-access-gate';
import {assertNoForeignDatabaseHolders} from './database-holder-preflight';
import {coordinateMigrations} from './migration-coordinator';
import {bundledMigrations,planMigrations} from './migrations';
import {MigrationJournals} from './migration-journal';
import {ResourceStore} from '../core/applications/resource-store';

/** macOS startup before services exist. Business DB closes before releasing
 * maintenance; after taking shared ownership it reopens and revalidates schema.
 * Thus a competing upgrade during handoff cannot expose an unchecked schema. */
export async function openManagedDatabase(path:string):Promise<DbClient>{
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
   const store=new ResourceStore(opened.sqlite,root),journals=new MigrationJournals(store,shared);
   const maintenanceState=opened.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
   if(maintenanceState&&(maintenanceState.store_id!==store.storeId||maintenanceState.maintenance_state!=='ready'))return;
   const operations=journals.list();if(operations.some(operation=>operation.state!=='complete'))return;
   for(const operation of operations)journals.completeFromDatabase(operation.operationId); // Read-only for completed mirrors.
   shared.assertHeld();const client=opened;let closed=false;retained=true;
   return {...client,close(){if(closed)return;closed=true;try{client.close();}finally{shared.release();}}};
  }finally{if(!retained){try{opened?.close();}finally{shared.release();}}}
 }
 const ready=await tryShared();if(ready)return ready;
 const maintenance=await acquireDatabaseAccess(root,'maintenance');let client:DbClient|undefined;
 try{
  await assertNoForeignDatabaseHolders(file);
  client=openDbClient(file);
  await coordinateMigrations({store:new ResourceStore(client.sqlite,root),lease:maintenance,buildId,migrations,assertNoForeignHolders:()=>assertNoForeignDatabaseHolders(file)});
 }finally{try{client?.close();}finally{maintenance.release();}}
 const reopened=await tryShared();if(!reopened)throw new Error('启动交接后数据库仍需维护');return reopened;
}
