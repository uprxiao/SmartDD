import Database from 'better-sqlite3';
import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {ResourceStore} from '../core/applications/resource-store';
import {acquireDatabaseAccess,type DatabaseAccessLease} from './database-access-gate';
import {MigrationJournals} from './migration-journal';
import {createMigrationBackup} from './migration-backup';
import {bundledMigrations,runMigrations} from './migrations';
let root:string,db:Database.Database,store:ResourceStore,lease:DatabaseAccessLease,journal:MigrationJournals;
const before=bundledMigrations().slice(0,7),target=bundledMigrations().slice(0,9);
beforeEach(async()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-migration-journal-')));db=new Database(join(root,'live.db'));db.pragma('journal_mode=WAL');runMigrations(db,before);store=new ResourceStore(db,root);lease=await acquireDatabaseAccess(root,'maintenance');journal=new MigrationJournals(store,lease);});
afterEach(()=>{lease.release();db.close();rmSync(root,{recursive:true,force:true});});
async function prepare(){const value=journal.create({buildId:'fixture-build',before,target});const backup=await createMigrationBackup(db,{backupRoot:join(root,'backups/m10'),operationId:value.operationId,buildId:value.buildId});return journal.backedUp(value.operationId,backup);}
it('recovers a committed migration from its DB receipt after the file mirror was not completed, preserving later business',async()=>{
 const planned=await prepare();runMigrations(db,target,{recordCommit:()=>journal.recordCommit(db,planned.operationId)});
 expect(journal.read(planned.operationId).state).toBe('backed-up');db.exec("CREATE TABLE later_business(value TEXT); INSERT INTO later_business VALUES('must not restore old backup')");
 db.close();db=new Database(join(root,'live.db'));
 const reopened=new MigrationJournals(new ResourceStore(db,root),lease);expect(reopened.completeFromDatabase(planned.operationId).state).toBe('complete');expect(reopened.completeFromDatabase(planned.operationId).state).toBe('complete');
 expect(db.prepare('SELECT * FROM later_business').all()).toEqual([{value:'must not restore old backup'}]);expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:target.length});
});
it('rolls back schema and operation together and refuses to complete an uncommitted operation',async()=>{
 const planned=await prepare();expect(()=>runMigrations(db,target,{recordCommit:()=>{journal.recordCommit(db,planned.operationId);throw new Error('injected before commit');}})).toThrow('injected');
 expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:before.length});expect(()=>journal.completeFromDatabase(planned.operationId)).toThrow('没有可核验');
 runMigrations(db,target,{recordCommit:()=>journal.recordCommit(db,planned.operationId)});expect(journal.completeFromDatabase(planned.operationId).state).toBe('complete');
});
it('refuses corrupted plans and refuses commit receipts outside the migration transaction',async()=>{
 const planned=await prepare();expect(()=>journal.recordCommit(db,planned.operationId)).toThrow('同事务');
 const file=join(store.root,'operations',planned.operationId+'.json'),bytes=JSON.parse(readFileSync(file,'utf8'));bytes.target[0].hash='changed';writeFileSync(file,JSON.stringify(bytes));expect(()=>journal.read(planned.operationId)).toThrow('计划不一致');
});
it('does not finalize an operation without a verified backup or after maintenance ownership ends',()=>{
 const planned=journal.create({buildId:'fixture-build',before,target});expect(()=>db.transaction(()=>journal.recordCommit(db,planned.operationId))()).toThrow('备份');lease.release();expect(()=>journal.read(planned.operationId)).toThrow('释放');
});
