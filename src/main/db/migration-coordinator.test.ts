import Database from 'better-sqlite3';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {assertNoForeignDatabaseHolders} from './database-holder-preflight';
import {mkdtempSync,realpathSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {ResourceStore} from '../core/applications/resource-store';
import {acquireDatabaseAccess,type DatabaseAccessLease} from './database-access-gate';
import {MigrationJournals} from './migration-journal';
import {coordinateMigrations} from './migration-coordinator';
import {bundledMigrations,runMigrations} from './migrations';
let root:string,db:Database.Database,store:ResourceStore,lease:DatabaseAccessLease;
beforeEach(async()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-startup-migration-')));lease=await acquireDatabaseAccess(root,'maintenance');db=new Database(join(root,'smartdd.db'));db.pragma('journal_mode=WAL');store=new ResourceStore(db,root);});
afterEach(()=>{vi.restoreAllMocks();db.close();lease.release();rmSync(root,{recursive:true,force:true});});
const run=(assertNoForeignHolders=async()=>{})=>coordinateMigrations({store,lease,buildId:'test-build',migrations:bundledMigrations(),assertNoForeignHolders});
it('bootstraps the empty database through verified backup and atomic operation, then reopens idempotently',async()=>{
 const preflight=vi.fn(async()=>{});expect((await run(preflight)).length).toBe(bundledMigrations().length);expect(preflight).toHaveBeenCalledTimes(2);
 const operations=new MigrationJournals(store,lease).list();expect(operations).toHaveLength(1);expect(operations[0].state).toBe('complete');
 db.close();db=new Database(join(root,'smartdd.db'));store=new ResourceStore(db,root);expect(await run()).toEqual([]);expect(new MigrationJournals(store,lease).list()).toHaveLength(1);
});
it('recovers a committed operation after mirror failure without restoring or rerunning business migrations',async()=>{
 const original=MigrationJournals.prototype.completeFromDatabase;vi.spyOn(MigrationJournals.prototype,'completeFromDatabase').mockImplementationOnce(()=>{throw new Error('mirror failure');}).mockImplementation(original);
 await expect(run()).rejects.toThrow('mirror failure');expect(db.prepare('SELECT maintenance_state FROM capability_store_state').get()).toEqual({maintenance_state:'pending'});db.exec("CREATE TABLE later(value TEXT); INSERT INTO later VALUES('preserve')");
 db.close();db=new Database(join(root,'smartdd.db'));store=new ResourceStore(db,root);
 expect(await run()).toEqual([]);expect(db.prepare('SELECT * FROM later').all()).toEqual([{value:'preserve'}]);expect(new MigrationJournals(store,lease).list()[0].state).toBe('complete');expect(db.prepare('SELECT maintenance_state,maintenance_operation_id FROM capability_store_state').get()).toEqual({maintenance_state:'ready',maintenance_operation_id:null});
});
it('keeps the precommit journal and refuses a changed verified backup on retry',async()=>{
 let checks=0;await expect(run(async()=>{if(++checks===2)throw new Error('old host appeared');})).rejects.toThrow('old host appeared');
 expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
 const operation=new MigrationJournals(store,lease).list()[0];expect(operation.state).toBe('backed-up');
 appendFileSync(join(root,'backups/m10',operation.backup!.operationId,'smartdd.db'),'changed');
 await expect(run()).rejects.toThrow('备份内容已变化');expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
});

it('preserves another maintenance operation rather than clearing it during a normal restart',async()=>{
 await run();db.prepare("UPDATE capability_store_state SET maintenance_state='recovery-required',maintenance_operation_id='other-maintenance'").run();
 await expect(run()).rejects.toThrow('另有未完成');
 expect(db.prepare('SELECT maintenance_state,maintenance_operation_id FROM capability_store_state').get()).toEqual({maintenance_state:'recovery-required',maintenance_operation_id:'other-maintenance'});
});

it('persists maintenance before backing up an existing schema and resumes the same operation after a failed precommit check',async()=>{
 runMigrations(db,bundledMigrations().slice(0,-1));let calls=0;
 await expect(run(async()=>{if(++calls===2){expect(db.prepare('SELECT maintenance_state FROM capability_store_state').get()).toEqual({maintenance_state:'pending'});throw new Error('precommit interrupted');}})).rejects.toThrow('precommit interrupted');
 const prior=new MigrationJournals(store,lease).list()[0];expect(prior.state).toBe('backed-up');expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:bundledMigrations().length-1});
 expect(await run()).toEqual([bundledMigrations().at(-1)!.tag]);expect(new MigrationJournals(store,lease).list()).toHaveLength(1);expect(new MigrationJournals(store,lease).read(prior.operationId).state).toBe('complete');expect(db.prepare('SELECT maintenance_state,maintenance_operation_id FROM capability_store_state').get()).toEqual({maintenance_state:'ready',maintenance_operation_id:null});
});

it('refuses a resumed backup when application migration watermarks changed after it was captured',async()=>{
 runMigrations(db,bundledMigrations().slice(0,-1));let checks=0;
 await expect(run(async()=>{if(++checks===2)throw new Error('pause after backup');})).rejects.toThrow('pause after backup');
 db.exec("INSERT INTO capability_schema_migrations VALUES('mail','foreign','changed-checksum',0,1,'later','other-build')");
 await expect(run()).rejects.toThrow('应用迁移或默认版本在备份后变化');
 expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:bundledMigrations().length-1});expect(db.prepare('SELECT maintenance_state FROM capability_store_state').get()).toEqual({maintenance_state:'pending'});
});

// An actual legacy writer appears after backup; no mocked lsof or synthetic PID.
it.skipIf(process.platform!=='darwin')('rejects a real SQLite writer appearing after backup and preserves its committed business data on recovery',async()=>{
 runMigrations(db,bundledMigrations().slice(0,-1));
 db.exec("CREATE TABLE concurrent_business(value TEXT); INSERT INTO concurrent_business VALUES('before-backup')");
 let child:ChildProcess|undefined,checks=0;
 const require=createRequire(import.meta.url);
 try{
  await expect(run(async()=>{
   if(++checks===2){
    const script="const Database=require(process.argv[1]);const db=new Database(process.argv[2]);db.exec(\"INSERT INTO concurrent_business VALUES('legacy-writer')\");process.stdout.write('committed\\n');setInterval(()=>{},1000)";
    child=spawn(process.execPath,['-e',script,require.resolve('better-sqlite3'),join(root,'smartdd.db')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});
    await new Promise<void>((resolve,reject)=>{let out='',errors='';const timer=setTimeout(()=>reject(new Error('legacy writer timeout '+errors)),5000);child!.stderr!.on('data',b=>errors+=b);child!.stdout!.on('data',b=>{out+=b;if(out.includes('committed')){clearTimeout(timer);resolve();}});child!.once('error',e=>{clearTimeout(timer);reject(e);});child!.once('exit',()=>{clearTimeout(timer);reject(new Error('legacy writer exited '+errors));});});
   }
   await assertNoForeignDatabaseHolders(join(root,'smartdd.db'));
  })).rejects.toThrow('其他进程');
  const operation=new MigrationJournals(store,lease).list()[0];expect(operation.state).toBe('backed-up');
  expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:bundledMigrations().length-1});
  const stopped=once(child!,'exit');child!.kill('SIGKILL');await stopped;
  expect(await run(()=>assertNoForeignDatabaseHolders(join(root,'smartdd.db')).then(()=>{}))).toEqual([bundledMigrations().at(-1)!.tag]);
  expect(db.prepare('SELECT value FROM concurrent_business ORDER BY rowid').all()).toEqual([{value:'before-backup'},{value:'legacy-writer'}]);
  expect(new MigrationJournals(store,lease).list()).toHaveLength(1);expect(new MigrationJournals(store,lease).read(operation.operationId).state).toBe('complete');
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;}}
},20000);
