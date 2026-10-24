import Database from 'better-sqlite3';
import {mkdtempSync,realpathSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {ResourceStore} from '../core/applications/resource-store';
import {acquireDatabaseAccess,type DatabaseAccessLease} from './database-access-gate';
import {MigrationJournals} from './migration-journal';
import {coordinateMigrations} from './migration-coordinator';
import {bundledMigrations} from './migrations';
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
 await expect(run()).rejects.toThrow('mirror failure');db.exec("CREATE TABLE later(value TEXT); INSERT INTO later VALUES('preserve')");
 db.close();db=new Database(join(root,'smartdd.db'));store=new ResourceStore(db,root);
 expect(await run()).toEqual([]);expect(db.prepare('SELECT * FROM later').all()).toEqual([{value:'preserve'}]);expect(new MigrationJournals(store,lease).list()[0].state).toBe('complete');
});
it('keeps the precommit journal and refuses a changed verified backup on retry',async()=>{
 let checks=0;await expect(run(async()=>{if(++checks===2)throw new Error('old host appeared');})).rejects.toThrow('old host appeared');
 expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
 const operation=new MigrationJournals(store,lease).list()[0];expect(operation.state).toBe('backed-up');
 appendFileSync(join(root,'backups/m10',operation.backup!.operationId,'smartdd.db'),'changed');
 await expect(run()).rejects.toThrow('备份内容已变化');expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
});
