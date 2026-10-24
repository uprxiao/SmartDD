import Database from 'better-sqlite3';
import {mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createMigrationBackup} from './migration-backup';
let root:string,db:Database.Database;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-migration-backup-')));db=new Database(join(root,'live.db'));db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');db.exec("CREATE TABLE business(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT,created_at NUMERIC); INSERT INTO __drizzle_migrations VALUES(1,'original-hash',123); PRAGMA user_version=7;");});
afterEach(()=>{if(db.open)db.close();rmSync(root,{recursive:true,force:true});});
const input=()=>({backupRoot:join(root,'backups'),operationId:randomUUID(),buildId:'fixture-build'});
it('backs up committed WAL data and records the exact independent snapshot and hash',async()=>{
 db.exec("INSERT INTO business VALUES(1,'committed in WAL')");expect(statSync(join(root,'live.db-wal')).size).toBeGreaterThan(0);
 const request=input(),receipt=await createMigrationBackup(db,request),file=join(request.backupRoot,request.operationId,receipt.file);
 expect(receipt.migrations).toEqual([{id:1,hash:'original-hash',created_at:123}]);expect(receipt.sqliteUserVersion).toBe(7);expect(receipt.sha256).toBe(createHash('sha256').update(readFileSync(file)).digest('hex'));
 expect(JSON.parse(readFileSync(join(request.backupRoot,request.operationId,'operation.json'),'utf8'))).toEqual(receipt);
 db.exec("INSERT INTO business VALUES(2,'later business')");const copy=new Database(file,{readonly:true});try{expect(copy.prepare('SELECT * FROM business').all()).toEqual([{id:1,value:'committed in WAL'}]);}finally{copy.close();}
 expect(db.prepare('SELECT count(*) n FROM business').get()).toEqual({n:2});expect(statSync(file).mode&0o777).toBe(0o600);
});
it('refuses an active transaction and a canceled operation before creating backup files',async()=>{
 const request=input();db.exec('BEGIN IMMEDIATE');try{await expect(createMigrationBackup(db,request)).rejects.toThrow('事务');}finally{db.exec('ROLLBACK');}expect(existsSync(request.backupRoot)).toBe(false);
 const controller=new AbortController();controller.abort();await expect(createMigrationBackup(db,{...request,signal:controller.signal})).rejects.toThrow('取消');expect(existsSync(request.backupRoot)).toBe(false);
});
it('never overwrites a completed operation or follows a linked backup root',async()=>{
 const request=input(),receipt=await createMigrationBackup(db,request),file=join(request.backupRoot,request.operationId,receipt.file),bytes=readFileSync(file);
 await expect(createMigrationBackup(db,request)).rejects.toThrow();expect(readFileSync(file)).toEqual(bytes);
 const outside=join(root,'outside'),linked=join(root,'linked');mkdirSync(outside);symlinkSync(outside,linked);await expect(createMigrationBackup(db,{...input(),backupRoot:linked})).rejects.toThrow('普通目录');
});

it('retains a failed receipt when canceled during the real SQLite backup and leaves the live database intact',async()=>{
 const request=input(),controller=new AbortController(),original=db.backup.bind(db);
 db.exec("INSERT INTO business VALUES(1,'retained live row')");
 const spy=vi.spyOn(db,'backup').mockImplementation((file,options)=>original(file,{progress:info=>{controller.abort();return options!.progress(info);}}));
 try{await expect(createMigrationBackup(db,{...request,signal:controller.signal})).rejects.toThrow('取消');}finally{spy.mockRestore();}
 expect(JSON.parse(readFileSync(join(request.backupRoot,request.operationId,'operation.json'),'utf8'))).toMatchObject({state:'failed',reason:'canceled'});
 expect(db.prepare('SELECT * FROM business').all()).toEqual([{id:1,value:'retained live row'}]);
 await expect(createMigrationBackup(db,request)).rejects.toThrow();
});
