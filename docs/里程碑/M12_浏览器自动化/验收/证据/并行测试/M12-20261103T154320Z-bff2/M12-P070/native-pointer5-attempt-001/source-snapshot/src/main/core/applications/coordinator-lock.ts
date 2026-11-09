import { randomUUID } from 'node:crypto';
import { closeSync,constants,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,rmdirSync,unlinkSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { ProcessIdentityReader } from './process-identity';

interface Identity { dev:number;ino:number }
export interface CoordinatorLockOptions { timeoutMs?:number;signal?:AbortSignal;processes?:ProcessIdentityReader }
const identity = z.object({ dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative() }).strict();
const ownerSchema = z.object({
  schema:z.literal(2),protocol:z.literal('sqlite-exclusive-v1'),token:z.uuid(),kind:z.enum(['resource','catalog']),
  root:identity.extend({path:z.string()}),gate:identity,directory:identity,pid:z.number().int().positive(),startedAt:z.string().optional(),
}).strict();
const legacyCatalogOwner=z.object({schema:z.literal(1),token:z.uuid(),pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/)}).strict();
const same = (a:Identity,b:Identity) => a.dev === b.dev && a.ino === b.ino;
const recovery = () => new ApplicationError('RESOURCE_RECOVERY_REQUIRED','协调锁归属或内核门闩身份不能核验，保留现场');
const busy = (error:unknown) => ['SQLITE_BUSY','SQLITE_LOCKED'].includes((error as {code?:string}).code ?? '');
const present = (path:string) => { try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;} };
const sync = (path:string) => { const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);} };

/**
 * Persistent SQLite inode supplies the kernel gate; NEVER unlink/replace it.
 * Every v2 directory owner holds BEGIN EXCLUSIVE until its action and cleanup
 * finish. Acquiring that same gate proves the previous v2 critical section has
 * ended, even after SIGKILL. PID/age are not recovery authority. Business journals,
 * install/run leases and native identities are verified by their own services.
 * Legacy C's approximate timestamps cannot prove exit. Legacy H can be handed
 * off only with its exact native kernel identity proved stopped by the caller.
 */
export async function withCoordinatorLock<T>(rootInput:string,kind:'resource'|'catalog',action:()=>T|Promise<T>,options:CoordinatorLockOptions={},host?:{pid:number;startedAt:string}):Promise<T>{
  if(options.signal?.aborted)throw new ApplicationError('CANCELED','已取消等待资源协调');
  const root=realpathSync(rootInput),rootId=lstatSync(root),path=join(root,kind+'.lock'),gatePath=join(root,'.'+kind+'.lock.gate.sqlite'),deadline=performance.now()+(options.timeoutMs??3000);
  const assertRoot=()=>{const current=lstatSync(root);if(!current.isDirectory()||current.isSymbolicLink()||realpathSync(root)!==root||!same(current,rootId))throw recovery();};assertRoot();
  try{const fd=openSync(gatePath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);closeSync(fd);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const gateId=lstatSync(gatePath);
  const assertGate=()=>{
    assertRoot();const current=lstatSync(gatePath);
    if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||current.size>1024*1024||!same(current,gateId))throw recovery();
    for(const suffix of ['-journal','-wal','-shm']){const side=present(gatePath+suffix);if(side&&(!side.isFile()||side.isSymbolicLink()||side.nlink!==1))throw recovery();}
  };assertGate();
  let gate:Database.Database;try{gate=new Database(gatePath,{timeout:0,fileMustExist:true});}catch{throw recovery();}
  let entered=false;
  const rootIdentity={path:root,dev:rootId.dev,ino:rootId.ino},gateIdentity={dev:gateId.dev,ino:gateId.ino},binding=JSON.stringify({schema:1,kind,root:rootIdentity,gate:gateIdentity});
  const wait=async()=>{if(options.signal?.aborted)throw new ApplicationError('CANCELED','已取消等待资源协调');if(performance.now()>=deadline)throw new ApplicationError('RESOURCE_BUSY','资源仍有协调者，请稍后重试');await new Promise<void>(resolve=>setTimeout(resolve,Math.min(20,Math.max(1,deadline-performance.now()))));};
  try{
    for(;;){
      assertGate();if(options.signal?.aborted)throw new ApplicationError('CANCELED','已取消等待资源协调');
      try{gate.exec('BEGIN EXCLUSIVE');}catch(error){if(!busy(error))throw error;await wait();continue;}
      if(gate.pragma('journal_mode',{simple:true})!=='delete')throw recovery();
      // Initialization commits before any directory owner can be published.
      const tables=gate.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string;sql:string}[];
      const application=gate.pragma('application_id',{simple:true}),version=gate.pragma('user_version',{simple:true});
      const schema='CREATE TABLE coordinator_identity (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL)';
      if(!tables.length&&application===0&&version===0){
        gate.exec(schema);gate.prepare('INSERT INTO coordinator_identity VALUES(1,?)').run(binding);gate.pragma('application_id = 1465470027');gate.pragma('user_version = 1');gate.exec('COMMIT');continue;
      }
      if(application!==1465470027||version!==1||tables.length!==1||tables[0].name!=='coordinator_identity'||tables[0].sql!==schema)throw recovery();
      const rows=gate.prepare('SELECT id,identity FROM coordinator_identity').all() as {id:number;identity:string}[];
      if(rows.length!==1||rows[0].id!==1||rows[0].identity!==binding){
        // A previously canonical root now routed through an alias is an
        // ownership conflict, not an invitation to rebind its existing gate.
        let known:{root?:{path?:unknown}}|null=null;try{known=JSON.parse(rows[0]?.identity??'null');}catch{/* Unknown gate stays recovery-required. */}
        if(root!==rootInput&&known?.root?.path===rootInput)throw new ApplicationError('OWNERSHIP_CONFLICT','原资源根的规范位置已被链接替换，保留原路径');
        throw recovery();
      }
      break;
    }
    const readOwner=()=>{try{
      const directory=lstatSync(path),file=join(path,'owner.json'),stat=lstatSync(file);
      if(!directory.isDirectory()||directory.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8192||readdirSync(path).join(',')!=='owner.json')throw recovery();
      const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);let value:unknown;
      try{value=JSON.parse(readFileSync(fd,'utf8'));}catch{throw recovery();}finally{closeSync(fd);}
      return {directory,value};
    }catch{throw recovery();}
    };
    const assertOwned=(expected:z.infer<typeof ownerSchema>)=>{
      assertGate();const current=readOwner(),owner=ownerSchema.safeParse(current.value);
      if(!owner.success||JSON.stringify(owner.data)!==JSON.stringify(expected)||!same(current.directory,expected.directory))throw recovery();
    };
    const remove=(owner:z.infer<typeof ownerSchema>)=>{assertOwned(owner);unlinkSync(join(path,'owner.json'));rmdirSync(path);sync(root);};
    for(;;){
      if(!present(path)){try{mkdirSync(path,{mode:0o700});break;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')continue;throw error;}}
      const current=readOwner(),parsed=ownerSchema.safeParse(current.value);
      if(parsed.success){
        const owner=parsed.data;
        if(owner.kind!==kind||owner.root.path!==root||!same(owner.root,rootId)||!same(owner.gate,gateId)||!same(owner.directory,current.directory))throw recovery();
        // Exact SQLite inode is exclusively held: no compliant v2 publisher or
        // reclaimer can still act on, remove or replace this directory.
        remove(owner);continue;
      }
      const legacy=current.value as {schema?:unknown;token?:unknown;pid?:unknown;startedAt?:unknown};
      if(!legacy||legacy.schema===2||typeof legacy.token!=='string'||!Number.isSafeInteger(legacy.pid)||(legacy.pid as number)<1||kind==='catalog'&&typeof legacy.startedAt!=='string')throw recovery();
      const old=kind==='catalog'?legacyCatalogOwner.safeParse(current.value):null;
      if(old?.success&&options.processes?.state({pid:old.data.pid,startedAt:old.data.startedAt})==='stopped'){
        // Gate serializes all reclaimers. Prior versions never reap a lock; a
        // waiting old process can only win mkdir AFTER this exact dir is removed.
        assertGate();const fresh=readOwner();if(!same(fresh.directory,current.directory)||JSON.stringify(fresh.value)!==JSON.stringify(current.value))throw recovery();
        unlinkSync(join(path,'owner.json'));rmdirSync(path);sync(root);continue;
      }
      await wait();assertGate(); // Legacy owner may release normally; never steal.
    }
    assertGate();
    // An interrupted owner-file write remains unknown; absence is not authority.
    const dirId=lstatSync(path),owner=ownerSchema.parse({schema:2,protocol:'sqlite-exclusive-v1',token:randomUUID(),kind,root:rootIdentity,gate:gateIdentity,directory:{dev:dirId.dev,ino:dirId.ino},pid:process.pid,...(host?{startedAt:host.startedAt}:{})});
    writeFileSync(join(path,'owner.json'),JSON.stringify(owner),{flag:'wx',mode:0o600});sync(join(path,'owner.json'));sync(path);sync(root);
    try{assertOwned(owner);if(options.signal?.aborted)throw new ApplicationError('CANCELED','资源操作已取消');entered=true;return await action();}
    finally{remove(owner);}
  }catch(error){if(entered||error instanceof ApplicationError)throw error;throw recovery();
  }finally{try{if(gate.inTransaction)gate.exec('ROLLBACK');}finally{gate.close();}}
}
