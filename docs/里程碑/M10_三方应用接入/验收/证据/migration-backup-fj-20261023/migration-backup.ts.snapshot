import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod,lstat,mkdir,open,realpath,rename,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export interface MigrationBackupInput {
  backupRoot:string;
  operationId:string;
  buildId:string;
  signal?:AbortSignal;
  timeoutMs?:number;
}
export interface MigrationBackupReceipt {
  schema:1;
  operationId:string;
  buildId:string;
  state:'verified';
  file:string;
  sha256:string;
  bytes:number;
  createdAt:string;
  sqliteSchemaVersion:number;
  sqliteUserVersion:number;
  migrations:{id:number;hash:string;created_at:number|null}[];
}
async function sync(path:string){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}

/** Backup primitive only: its caller must first own the persistent maintenance
 * gate and quiesce all writers. This never restores a backup or runs migrations. */
export async function createMigrationBackup(connection:Database.Database,input:MigrationBackupInput):Promise<MigrationBackupReceipt>{
  if(connection.inTransaction)throw new Error('一致性备份不能在数据库事务内执行');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)||!input.buildId||input.buildId.length>256)throw new Error('备份操作身份无效');
  const timeout=input.timeoutMs??60_000;if(!Number.isFinite(timeout)||timeout<1||timeout>300_000)throw new Error('备份时间预算无效');
  const deadline=performance.now()+timeout;
  const check=()=>{if(input.signal?.aborted)throw new Error('备份已取消');if(performance.now()>=deadline)throw new Error('备份超时');};check();
  const root=resolve(input.backupRoot);await mkdir(root,{recursive:true,mode:0o700});
  if(!(await lstat(root)).isDirectory()||await realpath(root)!==root)throw new Error('备份根必须是已核验的普通目录');
  check();const directory=join(root,input.operationId);await mkdir(directory,{mode:0o700});
  const file=join(directory,'smartdd.db'),receiptPath=join(directory,'operation.json');
  const identity={schema:1,operationId:input.operationId,buildId:input.buildId,createdAt:new Date().toISOString()};
  async function record(value:unknown){const stage=join(directory,'operation.next.json');await writeFile(stage,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await sync(stage);await rename(stage,receiptPath);await sync(directory);}
  try{
    await record({...identity,state:'copying'});await sync(root);check();
    await connection.backup(file,{progress:()=>{check();return 128;}});
    await chmod(file,0o600);check();
    const backup=new Database(file,{readonly:true,fileMustExist:true});
    let sqliteSchemaVersion:number,sqliteUserVersion:number,migrations:MigrationBackupReceipt['migrations'];
    try{
      const integrity=backup.pragma('integrity_check') as {integrity_check:string}[];
      if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('备份完整性校验失败');
      sqliteSchemaVersion=Number(backup.pragma('schema_version',{simple:true}));sqliteUserVersion=Number(backup.pragma('user_version',{simple:true}));
      const hasJournal=backup.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get();
      migrations=hasJournal?backup.prepare('SELECT id,hash,created_at FROM __drizzle_migrations ORDER BY id').all() as MigrationBackupReceipt['migrations']:[];
    }finally{backup.close();}
    check();await sync(file);const hash=createHash('sha256');let bytes=0;
    for await(const chunk of createReadStream(file)){check();hash.update(chunk);bytes+=chunk.length;}
    const receipt:MigrationBackupReceipt={...identity,schema:1,state:'verified',file:'smartdd.db',sha256:hash.digest('hex'),bytes,sqliteSchemaVersion,sqliteUserVersion,migrations};
    check();await record(receipt);return receipt;
  }catch(error){
    // Retain the private partial file for operation-bound recovery/diagnosis.
    // A failed copy never becomes verified and cannot overwrite an existing op.
    try{await record({...identity,state:'failed',reason:input.signal?.aborted?'canceled':performance.now()>=deadline?'timeout':'backup-failed'});}catch{/* Initial journal still identifies the unfinished operation. */}
    throw error;
  }
}
