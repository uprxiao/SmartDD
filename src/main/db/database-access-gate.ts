import Database from 'better-sqlite3';
import {constants,openSync,closeSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

export interface DatabaseAccessLease {root:string;mode:'shared'|'maintenance';assertHeld():void;release():void}
const schema='CREATE TABLE database_access_identity (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL)';
const busy=(error:unknown)=>['SQLITE_BUSY','SQLITE_LOCKED'].includes((error as {code?:string}).code??'');

/** A separate persistent SQLite inode coordinates cooperative host lifetimes.
 * Normal hosts keep a shared transaction; upgrade takes EXCLUSIVE. Business DB
 * backups therefore need no long write transaction. Never unlink this gate.
 * Older hosts that do not participate require an additional preflight check. */
export async function acquireDatabaseAccess(rootInput:string,mode:DatabaseAccessLease['mode'],options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<DatabaseAccessLease>{
 const root=realpathSync(rootInput),rootStat=lstatSync(root),file=join(root,'.database-access.sqlite');
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('数据库协调根无效');
 try{const fd=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);closeSync(fd);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const identity=lstatSync(file),binding=JSON.stringify({schema:1,root:{path:root,dev:rootStat.dev,ino:rootStat.ino},gate:{dev:identity.dev,ino:identity.ino}});
 const check=()=>{
  const current=lstatSync(file),directory=lstatSync(root);
  if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||current.dev!==identity.dev||current.ino!==identity.ino||directory.dev!==rootStat.dev||directory.ino!==rootStat.ino||realpathSync(root)!==root)throw new Error('数据库协调门闩身份已变化');
  for(const suffix of ['-journal','-wal','-shm'])try{const side=lstatSync(file+suffix);if(!side.isFile()||side.isSymbolicLink()||side.nlink!==1)throw new Error('数据库协调旁文件身份无效');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 };check();
 const timeout=options.timeoutMs??3000;if(!Number.isFinite(timeout)||timeout<1||timeout>60_000)throw new Error('数据库协调时间预算无效');
 const deadline=performance.now()+timeout,connection=new Database(file,{fileMustExist:true,timeout:0});let released=false;
 const cancel=()=>{if(options.signal?.aborted)throw new Error('数据库协调等待已取消');};
 const verify=()=>{
  if(connection.pragma('journal_mode',{simple:true})!=='delete')throw new Error('数据库协调模式无效');
  const tables=connection.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string;sql:string}[];
  if(tables.length!==1||tables[0].sql!==schema||tables[0].name!=='database_access_identity'||connection.pragma('application_id',{simple:true})!==1465470028||connection.pragma('user_version',{simple:true})!==1)throw new Error('数据库协调格式无法核验');
  const rows=connection.prepare('SELECT id,binding FROM database_access_identity').all();if(JSON.stringify(rows)!==JSON.stringify([{id:1,binding}]))throw new Error('数据库协调归属无法核验');
 };
 try{
  for(;;){
   cancel();check();
   try{
    const tables=connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if(!tables.length){
     connection.exec('BEGIN EXCLUSIVE');
     const fresh=connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
     if(!fresh.length){
      if(connection.pragma('application_id',{simple:true})!==0||connection.pragma('user_version',{simple:true})!==0)throw new Error('数据库协调初始化身份未知');
      connection.exec(schema);connection.prepare('INSERT INTO database_access_identity VALUES(1,?)').run(binding);connection.pragma('application_id=1465470028');connection.pragma('user_version=1');
     }
     verify();connection.exec('COMMIT');
    }
    connection.exec(mode==='maintenance'?'BEGIN EXCLUSIVE':'BEGIN');verify();check();cancel();
    return{root,mode,assertHeld(){if(released||!connection.open||!connection.inTransaction)throw new Error('数据库协调占用已释放');check();verify();},release(){if(released)return;released=true;try{if(connection.inTransaction)connection.exec('ROLLBACK');}finally{connection.close();}}};
   }catch(error){
    if(connection.inTransaction)connection.exec('ROLLBACK');
    if(!busy(error))throw error;
    cancel();if(performance.now()>=deadline)throw new Error('仍有宿主使用数据库，暂不能进入维护或启动');
    await new Promise<void>(done=>setTimeout(done,Math.min(20,Math.max(1,deadline-performance.now()))));
   }
  }
 }catch(error){connection.close();throw error;}
}
