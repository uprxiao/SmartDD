import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { constants,existsSync,lstatSync,mkdirSync,openSync,closeSync,fstatSync,fsyncSync,readFileSync,realpathSync,renameSync,rmdirSync,unlinkSync,writeFileSync,readdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { boundedJson } from '@shared/application-bridge';
import { canonicalJson,digest } from './manifest';
import type { ResourceStore } from './resource-store';
import type { ProcessIdentity,ProcessIdentityReader } from './process-identity';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9-]{36}$/;
const DAY=24*60*60*1000,PAGE=4096;
export const MAIL_CACHE_LIMIT=500000000;
export const MAIL_CACHE_TTL=30*DAY;
export interface MailCacheRef {key:string;sourceKey:string;contentHash:string;size:number;generation:string}
interface ObjectRow {object_key:string;source_key:string;content_hash:string;generation:string;byte_size:number;state:'writing'|'ready'|'deleting';write_id:string|null;device:string|null;inode:string|null;created_ms:number;last_access_ms:number;delete_owner:string|null}
interface WriteRow {write_id:string;object_key:string;generation:string;owner_session:string;stage_name:string;device:string;inode:string}
interface SessionRow {session_id:string;pid:number;started_at:string;state:'open'|'closed'}
export interface MailCacheOptions {
  /** Private fixture limits; production uses500MB/30UTCdays and a16MiB index ceiling. */
  maxBytes?:number;indexBytes?:number;ttlMs?:number;objectMaxBytes?:number;now?:()=>number;
  checkpoint?:(phase:'reserved'|'written'|'renamed'|'published'|'deleting',id:string)=>void|Promise<void>;
}
export interface MailCacheUsage {limit:number;indexLimit:number;metadataReserved:number;chargedObjectBytes:number;pendingWriteBytes:number;readyObjects:number;activeLeases:number;actual:{index:number;auxiliary:number;objects:number;staging:number;other:number;total:number};unrecognized:string[];overBudget:boolean;availableForObjects:number}
const SQL=`
CREATE TABLE IF NOT EXISTS cache_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),store_id TEXT NOT NULL,max_bytes INTEGER NOT NULL,index_bytes INTEGER NOT NULL,ttl_ms INTEGER NOT NULL,last_clock_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cache_sessions(session_id TEXT PRIMARY KEY,pid INTEGER NOT NULL,started_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('open','closed')));
CREATE TABLE IF NOT EXISTS cache_sources(source_key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS cache_objects(object_key TEXT PRIMARY KEY,source_key TEXT NOT NULL REFERENCES cache_sources(source_key),content_hash TEXT NOT NULL,generation TEXT NOT NULL,byte_size INTEGER NOT NULL CHECK(byte_size>=0),state TEXT NOT NULL CHECK(state IN ('writing','ready','deleting')),write_id TEXT,device TEXT,inode TEXT,created_ms INTEGER NOT NULL,last_access_ms INTEGER NOT NULL,delete_owner TEXT,UNIQUE(object_key,generation));
CREATE INDEX IF NOT EXISTS cache_objects_lru ON cache_objects(state,last_access_ms,created_ms,object_key);
CREATE TABLE IF NOT EXISTS cache_writes(write_id TEXT PRIMARY KEY,object_key TEXT NOT NULL UNIQUE,generation TEXT NOT NULL,owner_session TEXT NOT NULL REFERENCES cache_sessions(session_id),stage_name TEXT NOT NULL,device TEXT NOT NULL,inode TEXT NOT NULL,FOREIGN KEY(object_key,generation) REFERENCES cache_objects(object_key,generation));
CREATE TABLE IF NOT EXISTS cache_leases(lease_id TEXT PRIMARY KEY,object_key TEXT NOT NULL,generation TEXT NOT NULL,owner_session TEXT NOT NULL REFERENCES cache_sessions(session_id),FOREIGN KEY(object_key,generation) REFERENCES cache_objects(object_key,generation));
CREATE INDEX IF NOT EXISTS cache_leases_objects ON cache_leases(object_key,generation);
CREATE TABLE IF NOT EXISTS cache_records(record_id TEXT PRIMARY KEY,source_key TEXT NOT NULL REFERENCES cache_sources(source_key),logical_key TEXT NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,created_ms INTEGER NOT NULL,last_access_ms INTEGER NOT NULL,UNIQUE(source_key,logical_key));
CREATE TABLE IF NOT EXISTS cache_record_items(record_id TEXT NOT NULL REFERENCES cache_records(record_id),object_key TEXT NOT NULL,generation TEXT NOT NULL,PRIMARY KEY(record_id,object_key,generation),FOREIGN KEY(object_key,generation) REFERENCES cache_objects(object_key,generation));
`;
function safeError(error:unknown):ApplicationError{
  if(error instanceof ApplicationError)return error;
  const code=(error as {code?:string})?.code;
  return new ApplicationError(code==='SQLITE_BUSY'||code==='SQLITE_FULL'||code==='ENOSPC'?'RESOURCE_BUSY':code==='ENOENT'||code==='ELOOP'?'SOURCE_UNAVAILABLE':'RESOURCE_RECOVERY_REQUIRED',code==='SQLITE_FULL'?'邮件缓存索引预算已满，请清理可回收缓存':code==='ENOSPC'?'磁盘空间不足，缓存写入未完成':'邮件缓存暂不可用，请核对缓存状态');
}
/** A shared U-local cache. SQLite serializes reservations; every binary copy is outside its write transaction. */
export class MailCache {
  readonly root:string;readonly sessionId=randomUUID();readonly host:ProcessIdentity;
  readonly maxBytes:number;readonly indexBytes:number;readonly metadataEnvelope:number;readonly ttlMs:number;readonly objectMaxBytes:number;
  private readonly db:Database.Database;
  private readonly abort=new AbortController();
  private readonly pending=new Set<Promise<unknown>>();
  private readonly activeWrites=new Set<string>();
  private readonly puts=new Map<string,{work:Promise<MailCacheRef>;abort:AbortController;waiters:number}>();
  private closed=false;private closing?:Promise<void>;private foreign:string[]=[];
  private constructor(private readonly store:ResourceStore,private readonly processes:ProcessIdentityReader,private readonly options:MailCacheOptions){
    this.maxBytes=options.maxBytes??MAIL_CACHE_LIMIT;this.indexBytes=options.indexBytes??16*1024*1024;this.metadataEnvelope=4*this.indexBytes;this.ttlMs=options.ttlMs??MAIL_CACHE_TTL;this.objectMaxBytes=options.objectMaxBytes??32*1024*1024;
    if(!Number.isSafeInteger(this.indexBytes)||this.indexBytes<128*1024||this.indexBytes%PAGE||!Number.isSafeInteger(this.maxBytes)||this.maxBytes<=this.metadataEnvelope||!Number.isSafeInteger(this.ttlMs)||this.ttlMs<1||!Number.isSafeInteger(this.objectMaxBytes)||this.objectMaxBytes<1)throw new ApplicationError('INVALID_INPUT','缓存预算参数无效');
    const identity=processes.read(process.pid);if(!identity||identity.pid!==process.pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验缓存宿主进程身份');this.host=Object.freeze({...identity});
    const userData=dirname(store.root);this.directory(join(userData,'cache'));this.root=join(userData,'cache/mail');this.directory(this.root);
    const marker=join(this.root,'.willyou-mail-cache.json');
    if(!existsSync(marker)){
      const existing=readdirSync(this.root);if(existing.length)throw new ApplicationError('OWNERSHIP_CONFLICT','邮件缓存目录包含未登记内容');
      try{writeFileSync(marker,canonicalJson({schema:1,storeId:store.storeId}),{flag:'wx',mode:0o600});this.sync(this.root);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    }
    const ms=lstatSync(marker);if(!ms.isFile()||ms.isSymbolicLink()||ms.nlink!==1||ms.size>4096)throw new ApplicationError('OWNERSHIP_CONFLICT','邮件缓存标记无效');
    const owner=JSON.parse(readFileSync(marker,'utf8'));if(owner.schema!==1||owner.storeId!==store.storeId)throw new ApplicationError('OWNERSHIP_CONFLICT','邮件缓存属于其他存储或版本');
    this.directory(join(this.root,'objects'));this.directory(join(this.root,'staging'));
    const index=join(this.root,'index.sqlite');for(const file of ['index.sqlite','index.sqlite-journal'])if(existsSync(join(this.root,file))){const st=lstatSync(join(this.root,file));if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>(file==='index.sqlite'?this.indexBytes:this.metadataEnvelope-this.indexBytes))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存索引大小或归属异常');}
    if(existsSync(index+'-wal')||existsSync(index+'-shm'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存索引存在非本版本的辅助文件，保留现场');
    this.db=new Database(index,{timeout:50});
    try{
      this.db.pragma('foreign_keys=ON');this.db.pragma('busy_timeout=50');
      if(this.db.pragma('journal_mode=DELETE',{simple:true})!=='delete')throw new Error('journal');
      this.db.pragma('synchronous=FULL');this.db.pragma('fullfsync=ON');this.db.pragma('locking_mode=NORMAL');this.db.pragma('temp_store=MEMORY');this.db.pragma('cache_spill=OFF');this.db.pragma('journal_size_limit=0');this.db.pragma('mmap_size=0');
      if(this.db.pragma('page_size',{simple:true})!==PAGE||this.db.pragma('temp_store',{simple:true})!==2||this.db.pragma('cache_spill',{simple:true})!==0||Number(this.db.pragma('user_version',{simple:true}))>1)throw new Error('cache format');
      if(this.db.pragma('max_page_count='+this.indexBytes/PAGE,{simple:true})!==this.indexBytes/PAGE)throw new Error('page ceiling');
      const compiled=this.db.pragma('compile_options') as {compile_options:string}[];if(compiled.some(c=>c.compile_options==='TEMP_STORE=0'))throw new Error('disk temporary storage');
      this.db.transaction(()=>{
        this.db.exec(SQL);const state=this.db.prepare('SELECT * FROM cache_state WHERE singleton=1').get() as {store_id:string;max_bytes:number;index_bytes:number;ttl_ms:number}|undefined;
        if(state&&(state.store_id!==store.storeId||state.max_bytes!==this.maxBytes||state.index_bytes!==this.indexBytes||state.ttl_ms!==this.ttlMs))throw new ApplicationError('CONFIG_INCOMPATIBLE','已有缓存的归属或预算与当前引擎不同');
        if(!state)this.db.prepare('INSERT INTO cache_state VALUES(1,?,?,?,?,?)').run(store.storeId,this.maxBytes,this.indexBytes,this.ttlMs,this.now());
        this.db.pragma('user_version=1');this.db.prepare("INSERT INTO cache_sessions VALUES(?,?,?,'open')").run(this.sessionId,this.host.pid,this.host.startedAt);
      }).immediate();
    }catch(error){this.db.close();throw safeError(error);}
  }
  static async open(store:ResourceStore,processes:ProcessIdentityReader,options:MailCacheOptions={}):Promise<MailCache>{
    let cache:MailCache|undefined;try{cache=new MailCache(store,processes,options);await cache.recover();await cache.maintain();return cache;}catch(error){await cache?.dispose();throw safeError(error);}
  }
  private now(){return this.options.now?.()??Date.now();}
  private clock():number{const old=this.db.prepare('SELECT last_clock_ms t FROM cache_state WHERE singleton=1').get() as {t:number},value=Math.max(old.t,this.now());if(value!==old.t)this.db.prepare('UPDATE cache_state SET last_clock_ms=? WHERE singleton=1').run(value);return value;}
  private directory(path:string){try{mkdirSync(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(path)!==path)throw new ApplicationError('OWNERSHIP_CONFLICT','缓存目录不是独立受管目录');}
  private sync(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
  private alive(){if(this.closed)throw new ApplicationError('CANCELED','邮件缓存已停止');}
  private signal(signal?:AbortSignal){return AbortSignal.any([this.abort.signal,...(signal?[signal]:[])]);}
  private check(signal:AbortSignal){if(signal.aborted)throw new ApplicationError('CANCELED','缓存操作已取消');}
  private track<T>(work:Promise<T>):Promise<T>{this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work;}
  private async tx<T>(work:()=>T,signal?:AbortSignal):Promise<T>{
    const until=performance.now()+3000;for(;;){if(signal)this.check(signal);let entered=false;try{return this.db.transaction(()=>{entered=true;return work();}).immediate();}catch(error){if((error as {code?:string}).code==='SQLITE_BUSY'&&!entered&&performance.now()<until){await new Promise<void>(r=>setTimeout(r,20));continue;}throw safeError(error);}}
  }
  private row(key:string):ObjectRow|undefined{return this.db.prepare('SELECT * FROM cache_objects WHERE object_key=?').get(key) as ObjectRow|undefined;}
  private ref(row:ObjectRow):MailCacheRef{return{key:row.object_key,sourceKey:row.source_key,contentHash:row.content_hash,size:row.byte_size,generation:row.generation};}
  private validate(row:ObjectRow){if(!HASH.test(row.source_key)||!HASH.test(row.content_hash)||row.object_key!==row.source_key+':'+row.content_hash||!UUID.test(row.generation)||!Number.isSafeInteger(row.byte_size)||row.byte_size<0||row.byte_size>this.objectMaxBytes)throw new ApplicationError('HASH_MISMATCH','缓存对象登记损坏');}
  private path(row:ObjectRow){this.validate(row);this.directory(join(this.root,'objects',row.source_key));return join(this.root,'objects',row.source_key,row.content_hash);}
  private sameFile(path:string,row:{device:string|null;inode:string|null},size?:number):boolean{
    try{const st=lstatSync(path,{bigint:true});return st.isFile()&&!st.isSymbolicLink()&&st.nlink===1n&&String(st.dev)===row.device&&String(st.ino)===row.inode&&(size===undefined||st.size===BigInt(size));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  }
  private objectBudget(){return(this.db.prepare('SELECT COALESCE(SUM(byte_size),0) n FROM cache_objects').get() as {n:number}).n;}
  private growth(extra=1024){const used=Number(this.db.pragma('page_count',{simple:true}))-Number(this.db.pragma('freelist_count',{simple:true})),max=this.indexBytes/PAGE,reserve=Math.min(256,Math.floor(max/8));if(used+Math.ceil(extra/PAGE)*2+4>max-reserve)throw new ApplicationError('RESOURCE_BUSY','缓存索引接近预算，需回收后继续');}
  private lease(row:ObjectRow,touch=true):string{
    this.validate(row);if(row.state!=='ready')throw new ApplicationError('SOURCE_UNAVAILABLE','缓存尚未完成或已回收');
    const path=this.path(row);if(!this.sameFile(path,row,row.byte_size))throw new ApplicationError('SOURCE_UNAVAILABLE','缓存文件缺失或身份已变化');
    const id=randomUUID();this.db.prepare('INSERT INTO cache_leases VALUES(?,?,?,?)').run(id,row.object_key,row.generation,this.sessionId);if(touch)this.db.prepare('UPDATE cache_objects SET last_access_ms=? WHERE object_key=?').run(this.clock(),row.object_key);return id;
  }
  private unlease(id:string){this.db.prepare('DELETE FROM cache_leases WHERE lease_id=? AND owner_session=?').run(id,this.sessionId);}
  find(sourceKey:string,hash:string):Promise<MailCacheRef|null>{this.alive();if(!HASH.test(sourceKey)||!HASH.test(hash))throw new ApplicationError('INVALID_INPUT','缓存对象标识无效');return this.track(this.tx(()=>{const row=this.row(sourceKey+':'+hash);if(!row||row.state!=='ready')return null;this.validate(row);return this.ref(row);}));}
  private async bytes(path:string,row:ObjectRow):Promise<Buffer>{
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const before=await fd.stat({bigint:true});if(!before.isFile()||before.nlink!==1n||String(before.dev)!==row.device||String(before.ino)!==row.inode||before.size!==BigInt(row.byte_size))throw new ApplicationError('HASH_MISMATCH','缓存文件身份不同');
      const bytes=Buffer.alloc(row.byte_size);let offset=0;while(offset<bytes.length){const {bytesRead}=await fd.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw new ApplicationError('HASH_MISMATCH','缓存内容在读取中缺失');offset+=bytesRead;}const after=await fd.stat({bigint:true});if(after.size!==BigInt(row.byte_size)||digest(bytes)!==row.content_hash||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new ApplicationError('HASH_MISMATCH','缓存内容已损坏或在读取中变化');return bytes;
    }finally{await fd.close();}
  }
  withRead<T>(reference:MailCacheRef,read:(bytes:Buffer)=>Promise<T>|T,signal?:AbortSignal,options:{touch?:boolean}={}):Promise<T>{
    this.alive();const abort=this.signal(signal);return this.track((async()=>{
      let lease='',row!:ObjectRow,verified=false;
      try{
        await this.tx(()=>{this.check(abort);const current=this.row(reference.key);if(!current||canonicalJson(this.ref(current))!==canonicalJson(reference))throw new ApplicationError('SOURCE_UNAVAILABLE','原缓存已回收，请从当前来源重建');row=current;lease=this.lease(row,options.touch??true);},abort);
        const value=await this.bytes(this.path(row),row);verified=true;this.check(abort);const result=await read(value);this.check(abort);return result;
      }catch(error){if(row&&!verified&&this.damaged(error))await this.tx(()=>this.invalidateObject(row));throw safeError(error);}
      finally{if(lease)await this.tx(()=>this.unlease(lease));}
    })());
  }
  private damaged(error:unknown):boolean{return error instanceof ApplicationError&&['SOURCE_UNAVAILABLE','HASH_MISMATCH'].includes(error.code)||['ENOENT','ELOOP'].includes((error as NodeJS.ErrnoException)?.code??'');}
  private invalidateObject(row:ObjectRow):void{const current=this.row(row.object_key);if(!current||current.generation!==row.generation)return;this.invalidate(current);if(current.state==='ready')this.db.prepare("UPDATE cache_objects SET state='deleting',delete_owner=? WHERE object_key=? AND generation=?").run(this.sessionId,current.object_key,current.generation);}
  private invalidate(row:ObjectRow){for(const link of this.db.prepare('SELECT record_id FROM cache_record_items WHERE object_key=? AND generation=?').all(row.object_key,row.generation) as {record_id:string}[])this.deleteRecord(link.record_id);}
  private deleteRecord(id:string){for(const item of this.db.prepare('SELECT object_key,generation FROM cache_record_items WHERE record_id=?').all(id) as {object_key:string;generation:string}[])this.db.prepare('DELETE FROM cache_record_items WHERE record_id=? AND object_key=? AND generation=?').run(id,item.object_key,item.generation);this.db.prepare('DELETE FROM cache_records WHERE record_id=?').run(id);}
  put(sourceKey:string,input:Uint8Array,options:{signal?:AbortSignal;used?:boolean}={}):Promise<MailCacheRef>{
    this.alive();if(options.signal?.aborted)return Promise.reject(new ApplicationError('CANCELED','缓存等待已取消'));
    if(!HASH.test(sourceKey)||!(input instanceof Uint8Array)||input.byteLength>this.objectMaxBytes)throw new ApplicationError('TOO_LARGE','缓存对象超过本次预算或身份无效');
    const stable=Buffer.from(input),hash=digest(stable),key=sourceKey+':'+hash;let shared=this.puts.get(key);
    if(!shared){
      const abort=new AbortController(),work=this.track(this.write(sourceKey,hash,stable,{signal:abort.signal,used:false}));shared={work,abort,waiters:0};this.puts.set(key,shared);
      const original=shared;void work.finally(()=>{if(this.puts.get(key)===original)this.puts.delete(key);}).catch(()=>{});
    }
    shared.waiters++;const job=shared;
    return this.track(this.wait(job.work,options.signal).then(ref=>options.used?this.withRead(ref,()=>ref,options.signal):ref).finally(()=>{job.waiters--;if(!job.waiters)job.abort.abort();}));
  }
  private wait<T>(work:Promise<T>,caller?:AbortSignal):Promise<T>{
    if(!caller)return work;if(caller.aborted)return Promise.reject(new ApplicationError('CANCELED','缓存等待已取消'));
    let cancel!:()=>void;const interrupted=new Promise<never>((_,reject)=>{cancel=()=>reject(new ApplicationError('CANCELED','缓存等待已取消'));caller.addEventListener('abort',cancel,{once:true});});return this.track(Promise.race([work,interrupted]).finally(()=>caller.removeEventListener('abort',cancel)));
  }
  private async write(sourceKey:string,hash:string,data:Buffer,options:{signal?:AbortSignal;used?:boolean}):Promise<MailCacheRef>{
    const abort=this.signal(options.signal),key=sourceKey+':'+hash,until=performance.now()+3000;
    let allocation:{path:string;device:string;inode:string;sourceCreated:boolean}|undefined,activeWriteId:string|undefined;
    let writing:WriteRow|undefined,row:ObjectRow|undefined,handle:Awaited<ReturnType<typeof open>>|undefined;
    for(;;){
      this.check(abort);await this.maintain({signal:abort});
      const existing=await this.tx(()=>this.row(key),abort);
      if(existing?.state==='ready')return this.withRead(this.ref(existing),()=>this.ref(existing),abort,{touch:options.used??false});
      if(existing){if(performance.now()>=until)throw new ApplicationError('RESOURCE_BUSY','相同缓存仍在写入或回收');await new Promise<void>(r=>setTimeout(r,20));continue;}
      await this.maintain({needBytes:data.length,signal:abort});
      try{
        const state=await this.tx(()=>{
          this.check(abort);this.inventory();if(this.foreign.length)throw new ApplicationError('OWNERSHIP_CONFLICT','缓存含未登记文件，保留现场且不再扩张');if(this.row(key))return null;
          this.growth();if(this.objectBudget()+data.length+this.metadataEnvelope>this.maxBytes)throw new ApplicationError('RESOURCE_BUSY','活动缓存或暂存已占满预算，请稍后重试');
          this.db.prepare('INSERT OR IGNORE INTO cache_sources VALUES(?)').run(sourceKey);const sourceCreated=!existsSync(join(this.root,'objects',sourceKey));this.directory(join(this.root,'objects',sourceKey));if(sourceCreated)this.sync(join(this.root,'objects'));
          const writeId=randomUUID(),generation=randomUUID(),stageName=writeId+'.part',path=join(this.root,'staging',stageName),fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600),st=fstatSync(fd,{bigint:true});closeSync(fd);allocation={path,device:String(st.dev),inode:String(st.ino),sourceCreated};
          const now=this.clock();this.db.prepare("INSERT INTO cache_objects VALUES(?,?,?,?,?,'writing',?,?,?,?,?,NULL)").run(key,sourceKey,hash,generation,data.length,writeId,String(st.dev),String(st.ino),now,now);
          this.db.prepare('INSERT INTO cache_writes VALUES(?,?,?,?,?,?,?)').run(writeId,key,generation,this.sessionId,stageName,String(st.dev),String(st.ino));this.activeWrites.add(writeId);activeWriteId=writeId;
          return{writeId,stageName};
        },abort);
        if(!state)continue;
        writing=await this.tx(()=>this.db.prepare('SELECT * FROM cache_writes WHERE write_id=?').get(state.writeId) as WriteRow,abort);row=await this.tx(()=>this.row(key)!,abort);
        await this.options.checkpoint?.('reserved',writing.write_id);this.check(abort);
        const stage=join(this.root,'staging',writing.stage_name);handle=await open(stage,constants.O_WRONLY|constants.O_NOFOLLOW);const st=await handle.stat({bigint:true});if(String(st.dev)!==writing.device||String(st.ino)!==writing.inode||st.nlink!==1n)throw new ApplicationError('OWNERSHIP_CONFLICT','缓存暂存文件身份变化');
        await handle.writeFile(data);await handle.sync();await handle.close();handle=undefined;
        await this.bytes(stage,row);await this.options.checkpoint?.('written',writing.write_id);this.check(abort);
        await this.tx(()=>{
          this.check(abort);const current=this.row(key);if(!current||current.write_id!==writing!.write_id||current.generation!==row!.generation)throw new ApplicationError('RESOURCE_STATE_CHANGED','缓存写入登记变化');
          const final=this.path(current);if(existsSync(final))throw new ApplicationError('OWNERSHIP_CONFLICT','缓存目标存在未登记文件');
          renameSync(stage,final);this.sync(dirname(final));this.sync(join(this.root,'staging'));
        },abort);
        await this.options.checkpoint?.('renamed',writing.write_id);this.check(abort);
        await this.publish(writing,row,options.used??false,abort);await this.options.checkpoint?.('published',writing.write_id);this.check(abort);return this.ref({...row,state:'ready',write_id:null});
      }catch(error){if(handle){await handle.close().catch(()=>{});handle=undefined;}if(writing&&row)await this.removeWrite(writing,row).catch(()=>{});else if(allocation)await this.tx(()=>{if(this.sameFile(allocation!.path,allocation!,0)){unlinkSync(allocation!.path);this.sync(dirname(allocation!.path));}if(allocation!.sourceCreated&&!this.db.prepare('SELECT 1 FROM cache_sources WHERE source_key=?').get(sourceKey)){try{rmdirSync(join(this.root,'objects',sourceKey));this.sync(join(this.root,'objects'));}catch{}}}).catch(()=>{});throw safeError(error);}
      finally{if(activeWriteId){this.activeWrites.delete(activeWriteId);activeWriteId=undefined;}}
    }
  }
  private publish(write:WriteRow,row:ObjectRow,used:boolean,signal?:AbortSignal){return this.tx(()=>{
    if(signal)this.check(signal);const current=this.row(row.object_key);if(!current||current.write_id!==write.write_id||current.generation!==row.generation||!this.sameFile(this.path(current),current,current.byte_size))throw new ApplicationError('RESOURCE_STATE_CHANGED','缓存发布内容或登记变化');
    this.db.prepare("UPDATE cache_objects SET state='ready',write_id=NULL,last_access_ms=? WHERE object_key=? AND generation=?").run(used?this.clock():current.last_access_ms,current.object_key,current.generation);this.db.prepare('DELETE FROM cache_writes WHERE write_id=?').run(write.write_id);
  },signal);}
  private async removeWrite(write:WriteRow,row:ObjectRow):Promise<void>{
    await this.tx(()=>{
      const current=this.row(row.object_key);if(!current||current.write_id!==write.write_id||current.generation!==row.generation)return;
      for(const path of [join(this.root,'staging',write.stage_name),this.path(current)])if(existsSync(path)){if(!this.sameFile(path,write))throw new ApplicationError('OWNERSHIP_CONFLICT','暂存或目标文件已被替换，未删除');unlinkSync(path);this.sync(dirname(path));}
      this.db.prepare('DELETE FROM cache_writes WHERE write_id=?').run(write.write_id);this.invalidate(current);this.db.prepare('DELETE FROM cache_objects WHERE object_key=?').run(current.object_key);
    });
  }
  putRecord(sourceKey:string,key:string,value:unknown,refs:readonly MailCacheRef[]):Promise<void>{this.alive();return this.track(this.putRecordValue(sourceKey,key,value,refs));}
  private async putRecordValue(sourceKey:string,key:string,value:unknown,refs:readonly MailCacheRef[]):Promise<void>{
    this.alive();if(!HASH.test(sourceKey)||!key||key.length>1024||!boundedJson(value)||refs.length>512||refs.some(r=>r.sourceKey!==sourceKey))throw new ApplicationError('INVALID_INPUT','缓存记录或来源无效');const payload=canonicalJson(value);if(Buffer.byteLength(payload)>256*1024)throw new ApplicationError('TOO_LARGE','缓存索引记录过大，请分批保存');
    await this.tx(()=>{this.growth(Buffer.byteLength(payload));const id=digest(canonicalJson({sourceKey,key}));for(const ref of refs){const row=this.row(ref.key);if(!row||row.state!=='ready'||canonicalJson(this.ref(row))!==canonicalJson(ref))throw new ApplicationError('SOURCE_UNAVAILABLE','记录所需缓存已回收');}
      this.db.prepare('INSERT OR IGNORE INTO cache_sources VALUES(?)').run(sourceKey);this.deleteRecord(id);const now=this.clock();this.db.prepare('INSERT INTO cache_records VALUES(?,?,?,?,?,?,?)').run(id,sourceKey,key,payload,digest(payload),now,now);
      for(const ref of refs)this.db.prepare('INSERT OR IGNORE INTO cache_record_items VALUES(?,?,?)').run(id,ref.key,ref.generation);
    });
  }
  withRecord<T>(sourceKey:string,key:string,read:(value:unknown,refs:MailCacheRef[],load:(ref:MailCacheRef)=>Promise<Buffer>)=>Promise<T>,signal?:AbortSignal):Promise<T|null>{
    this.alive();if(!HASH.test(sourceKey)||!key||key.length>1024)throw new ApplicationError('INVALID_INPUT','缓存记录标识无效');
    const abort=this.signal(signal);return this.track((async()=>{
      const leases:string[]=[],loads=new Set<Promise<Buffer>>(),loadFailures:unknown[]=[];let accepting=true;
      try{
        const captured=await this.tx(()=>{
          this.check(abort);const id=digest(canonicalJson({sourceKey,key})),record=this.db.prepare('SELECT payload_json,payload_hash FROM cache_records WHERE record_id=?').get(id) as {payload_json:string;payload_hash:string}|undefined;if(!record)return null;
          if(digest(record.payload_json)!==record.payload_hash)throw new ApplicationError('HASH_MISMATCH','缓存索引记录损坏');const value=JSON.parse(record.payload_json);if(!boundedJson(value))throw new ApplicationError('HASH_MISMATCH','缓存索引结构损坏');
          const count=(this.db.prepare('SELECT count(*) n FROM cache_record_items WHERE record_id=?').get(id) as {n:number}).n;
          const rows=this.db.prepare('SELECT o.* FROM cache_record_items i JOIN cache_objects o ON i.object_key=o.object_key AND i.generation=o.generation WHERE i.record_id=?').all(id) as ObjectRow[];
          if(count!==rows.length){this.deleteRecord(id);return null;}
          for(const row of rows){
            try{leases.push(this.lease(row,false));}catch(error){
              for(const lease of leases)this.unlease(lease);leases.length=0;
              if(!this.damaged(error))throw error;this.invalidateObject(row);this.deleteRecord(id);return null;
            }
          }
          const used=this.clock();for(const row of rows)this.db.prepare('UPDATE cache_objects SET last_access_ms=? WHERE object_key=?').run(used,row.object_key);
          this.db.prepare('UPDATE cache_records SET last_access_ms=? WHERE record_id=?').run(used,id);return{value,rows};
        },abort);
        if(!captured)return null;
        const known=new Map(captured.rows.map(r=>[r.object_key,r]));
        const load=(ref:MailCacheRef):Promise<Buffer>=>{
          const work=(async()=>{
            if(!accepting)throw new ApplicationError('SCOPE_DENIED','缓存记录读取已结束');this.check(abort);
            const row=known.get(ref.key);if(!row||canonicalJson(this.ref(row))!==canonicalJson(ref))throw new ApplicationError('SCOPE_DENIED','读取对象不属于本缓存记录');
            try{const bytes=await this.bytes(this.path(row),row);this.check(abort);return bytes;}
            catch(error){if(this.damaged(error))await this.tx(()=>this.invalidateObject(row));throw safeError(error);}
          })();
          loads.add(work);void work.then(()=>loads.delete(work),error=>{loadFailures.push(error);loads.delete(work);});return work;
        };
        const result=await read(captured.value,captured.rows.map(r=>this.ref(r)),load);accepting=false;await Promise.allSettled([...loads]);if(loadFailures.length)throw loadFailures[0];this.check(abort);return result;
      }catch(error){throw safeError(error);}
      finally{
        accepting=false;await Promise.allSettled([...loads]);
        if(leases.length)await this.tx(()=>{for(const id of leases)this.unlease(id);});
      }
    })());
  }
  private async remove(row:ObjectRow):Promise<boolean>{
    const selected=await this.tx(()=>{
      const current=this.row(row.object_key);if(!current||current.generation!==row.generation||current.state==='writing'||this.db.prepare('SELECT 1 FROM cache_leases WHERE object_key=? LIMIT 1').get(row.object_key))return false;
      if(current.state==='deleting'&&current.delete_owner!==this.sessionId)return false;
      this.db.prepare("UPDATE cache_objects SET state='deleting',delete_owner=? WHERE object_key=?").run(this.sessionId,row.object_key);return true;
    });
    if(!selected)return false;await this.options.checkpoint?.('deleting',row.object_key);
    await this.tx(()=>{
      const current=this.row(row.object_key);if(!current||current.generation!==row.generation||current.delete_owner!==this.sessionId)return;
      const path=this.path(current);if(existsSync(path)){if(!this.sameFile(path,current))throw new ApplicationError('OWNERSHIP_CONFLICT','缓存文件已被替换，未删除');unlinkSync(path);this.sync(dirname(path));}
      this.invalidate(current);this.db.prepare('DELETE FROM cache_objects WHERE object_key=?').run(current.object_key);
    });return true;
  }
  maintain(options:{needBytes?:number;clear?:boolean;signal?:AbortSignal;limit?:number}={}):Promise<{removed:number;blocked:boolean}>{this.alive();return this.track(this.maintenance(options));}
  private async maintenance(options:{needBytes?:number;clear?:boolean;signal?:AbortSignal;limit?:number}):Promise<{removed:number;blocked:boolean}>{
    const signal=this.signal(options.signal);this.check(signal);let removed=0;
    await this.tx(()=>{const now=this.clock();for(const record of this.db.prepare('SELECT record_id FROM cache_records WHERE last_access_ms<=?').all(now-this.ttlMs) as {record_id:string}[])this.deleteRecord(record.record_id);},signal);
    for(let n=0;n<(options.limit??50);n++){
      const row=await this.tx(()=>{
        this.check(signal);const current=this.db.prepare("SELECT o.* FROM cache_objects o WHERE (o.state='ready' OR (o.state='deleting' AND o.delete_owner=?)) AND NOT EXISTS(SELECT 1 FROM cache_leases l WHERE l.object_key=o.object_key) ORDER BY CASE WHEN o.state='deleting' THEN 0 ELSE 1 END,o.last_access_ms,o.created_ms,o.object_key LIMIT 1").get(this.sessionId) as ObjectRow|undefined;
        if(!current)return null;const now=this.clock();if(current.state!=='deleting'&&!options.clear&&current.last_access_ms>now-this.ttlMs&&this.objectBudget()+(options.needBytes??0)+this.metadataEnvelope<=this.maxBytes)return null;
        this.db.prepare("UPDATE cache_objects SET state='deleting',delete_owner=? WHERE object_key=?").run(this.sessionId,current.object_key);return{...current,state:'deleting' as const,delete_owner:this.sessionId};
      },signal);
      if(!row)break;if(await this.remove(row))removed++;
    }
    await this.tx(()=>this.pruneSources(),signal);
    return{removed,blocked:await this.tx(()=>this.objectBudget()+(options.needBytes??0)+this.metadataEnvelope>this.maxBytes,signal)};
  }
  clear(signal?:AbortSignal):Promise<MailCacheUsage>{this.alive();return this.track(this.clearOwned(signal));}
  private async clearOwned(caller?:AbortSignal):Promise<MailCacheUsage>{
    const signal=this.signal(caller);for(;;){const result=await this.maintain({clear:true,signal});if(!result.removed)break;await new Promise<void>(r=>setImmediate(r));}
    await this.tx(()=>{this.check(signal);for(const row of this.db.prepare('SELECT record_id FROM cache_records').all() as {record_id:string}[])this.deleteRecord(row.record_id);this.pruneSources();},signal);return this.usage();
  }
  private pruneSources():void{
    for(const source of this.db.prepare('SELECT source_key FROM cache_sources s WHERE NOT EXISTS(SELECT 1 FROM cache_objects o WHERE o.source_key=s.source_key) AND NOT EXISTS(SELECT 1 FROM cache_records r WHERE r.source_key=s.source_key)').all() as {source_key:string}[]){
      if(!HASH.test(source.source_key))throw new ApplicationError('HASH_MISMATCH','缓存来源登记损坏');const path=join(this.root,'objects',source.source_key);
      if(existsSync(path)){
        const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink())continue;
        try{rmdirSync(path);this.sync(join(this.root,'objects'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOTEMPTY')continue;throw error;}
      }
      this.db.prepare('DELETE FROM cache_sources WHERE source_key=?').run(source.source_key);
    }
  }
  recover():Promise<void>{this.alive();return this.track(this.recoverOwned());}
  private async recoverOwned():Promise<void>{
    const sessions=await this.tx(()=>this.db.prepare('SELECT * FROM cache_sessions').all() as SessionRow[]),stopped=new Set<string>();
    for(const owner of sessions){if(owner.session_id===this.sessionId)continue;if(owner.state==='closed'||this.processes.state({pid:owner.pid,startedAt:owner.started_at})==='stopped')stopped.add(owner.session_id);}
    await this.tx(()=>{for(const owner of stopped){for(const lease of this.db.prepare('SELECT lease_id FROM cache_leases WHERE owner_session=?').all(owner) as {lease_id:string}[])this.db.prepare('DELETE FROM cache_leases WHERE lease_id=?').run(lease.lease_id);this.db.prepare("UPDATE cache_sessions SET state='closed' WHERE session_id=?").run(owner);}});
    const writes=await this.tx(()=>this.db.prepare('SELECT * FROM cache_writes').all() as WriteRow[]);
    for(const original of writes)if(stopped.has(original.owner_session)||original.owner_session===this.sessionId&&!this.activeWrites.has(original.write_id)){
      let claimedId:string|undefined;
      try{
        const write=await this.tx(()=>{
          const current=this.db.prepare('SELECT * FROM cache_writes WHERE write_id=?').get(original.write_id) as WriteRow|undefined;
          if(!current||current.owner_session!==original.owner_session||current.owner_session===this.sessionId&&this.activeWrites.has(current.write_id))return null;
          this.db.prepare('UPDATE cache_writes SET owner_session=? WHERE write_id=?').run(this.sessionId,current.write_id);this.activeWrites.add(current.write_id);claimedId=current.write_id;return{...current,owner_session:this.sessionId};
        });if(!write)continue;
        const row=await this.tx(()=>this.row(write.object_key));if(!row||row.generation!==write.generation)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存写入与对象登记不符');
        const final=this.path(row),stage=join(this.root,'staging',write.stage_name);
        try{
          const path=existsSync(final)?final:stage;await this.bytes(path,row);
          if(path===stage)await this.tx(()=>{if(existsSync(final))throw new ApplicationError('OWNERSHIP_CONFLICT','恢复目标被其他文件占用');renameSync(stage,final);this.sync(dirname(final));this.sync(join(this.root,'staging'));});
          await this.publish(write,row,false);
        }catch(error){await this.removeWrite(write,row);}
      }finally{if(claimedId)this.activeWrites.delete(claimedId);}
    }
    const deleting=await this.tx(()=>this.db.prepare("SELECT * FROM cache_objects WHERE state='deleting'").all() as ObjectRow[]);
    for(const row of deleting)if(row.delete_owner===this.sessionId||row.delete_owner&&stopped.has(row.delete_owner)){const claimed=await this.tx(()=>this.db.prepare("UPDATE cache_objects SET delete_owner=? WHERE object_key=? AND generation=? AND state='deleting' AND delete_owner=?").run(this.sessionId,row.object_key,row.generation,row.delete_owner).changes===1);if(claimed)await this.remove({...row,delete_owner:this.sessionId});}
    await this.tx(()=>{for(const row of this.db.prepare("SELECT * FROM cache_objects WHERE state='ready'").all() as ObjectRow[])if(!this.sameFile(this.path(row),row,row.byte_size))this.invalidateObject(row);});
    const missing=await this.tx(()=>this.db.prepare("SELECT 1 FROM cache_objects o WHERE o.state='writing' AND NOT EXISTS(SELECT 1 FROM cache_writes w WHERE w.object_key=o.object_key AND w.generation=o.generation)").get());if(missing)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存缺少原写入记录');
    const usage=await this.usage();this.foreign=usage.unrecognized;
    await this.tx(()=>{for(const owner of stopped)if(!this.db.prepare('SELECT 1 FROM cache_writes WHERE owner_session=?').get(owner)&&!this.db.prepare('SELECT 1 FROM cache_leases WHERE owner_session=?').get(owner)&&!this.db.prepare('SELECT 1 FROM cache_objects WHERE delete_owner=?').get(owner))this.db.prepare('DELETE FROM cache_sessions WHERE session_id=?').run(owner);});
  }
  usage():Promise<MailCacheUsage>{this.alive();return this.track(this.usageOwned());}
  private usageOwned():Promise<MailCacheUsage>{return this.tx(()=>this.inventory());}
  /** Namespace mutations hold the same SQLite reservation lock as this bounded, no-follow inventory. */
  private inventory():MailCacheUsage{
    const data={rows:this.db.prepare('SELECT * FROM cache_objects').all() as ObjectRow[],writes:this.db.prepare('SELECT * FROM cache_writes').all() as WriteRow[],leases:(this.db.prepare('SELECT count(*) n FROM cache_leases').get() as {n:number}).n,sources:(this.db.prepare('SELECT source_key FROM cache_sources').all() as {source_key:string}[]).map(s=>s.source_key)};
    const known=new Set(['.willyou-mail-cache.json','index.sqlite','index.sqlite-journal']),identities=new Map<string,{device:string|null;inode:string|null;maxSize:number;exact:boolean}>();
    for(const source of data.sources){if(!HASH.test(source))throw new ApplicationError('HASH_MISMATCH','缓存来源目录登记损坏');known.add('objects/'+source);}
    for(const row of data.rows){this.validate(row);if(row.state!=='writing'){const rel='objects/'+row.source_key+'/'+row.content_hash;known.add(rel);identities.set(rel,{device:row.device,inode:row.inode,maxSize:row.byte_size,exact:row.state==='ready'});}}
    for(const write of data.writes){
      if(!UUID.test(write.write_id)||write.stage_name!==write.write_id+'.part')throw new ApplicationError('HASH_MISMATCH','缓存暂存登记损坏');
      const stage='staging/'+write.stage_name;known.add(stage);const row=data.rows.find(r=>r.object_key===write.object_key);
      if(row){identities.set(stage,{...write,maxSize:row.byte_size,exact:false});const target='objects/'+row.source_key+'/'+row.content_hash;known.add(target);identities.set(target,{...write,maxSize:row.byte_size,exact:false});}
    }
    const actual={index:0,auxiliary:0,objects:0,staging:0,other:0,total:0},unrecognized=new Set<string>();let entries=0;
    const scan=(folder:string,relative:string,depth:number)=>{
      if(depth>32)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存目录层级异常，磁盘统计未完成');
      const parent=lstatSync(folder,{bigint:true});if(!parent.isDirectory()||parent.isSymbolicLink())throw new ApplicationError('OWNERSHIP_CONFLICT','缓存目录身份发生变化');
      for(const entry of readdirSync(folder,{withFileTypes:true})){
        if(++entries>100000)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存文件数超出统计预算，磁盘统计未完成');
        const rel=relative?relative+'/'+entry.name:entry.name,path=join(folder,entry.name),st=lstatSync(path,{bigint:true});
        if(st.isDirectory()&&!st.isSymbolicLink()){
          if(rel!=='objects'&&rel!=='staging'&&!known.has(rel))unrecognized.add(rel);
          scan(path,rel,depth+1);continue;
        }
        // Count link entries themselves and every regular file, including unknown directories and hardlinks.
        // Never follow a symlink to include or touch its target.
        const identity=identities.get(rel);
        if(!known.has(rel)||!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||identity&&(String(st.dev)!==identity.device||String(st.ino)!==identity.inode||st.size>BigInt(identity.maxSize)||identity.exact&&st.size!==BigInt(identity.maxSize)))unrecognized.add(rel);
        const size=Number(st.size);if(!Number.isSafeInteger(size)||size<0)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缓存文件大小无法完整统计');
        const part=rel==='index.sqlite'?'index':rel.startsWith('index.sqlite-')?'auxiliary':rel.startsWith('objects/')?'objects':rel.startsWith('staging/')?'staging':'other';actual[part]+=size;actual.total+=size;
      }
      const after=lstatSync(folder,{bigint:true});if(after.dev!==parent.dev||after.ino!==parent.ino||!after.isDirectory()||after.isSymbolicLink())throw new ApplicationError('OWNERSHIP_CONFLICT','磁盘统计期间缓存目录已替换');
    };
    scan(this.root,'',0);const chargedObjectBytes=data.rows.reduce((n,r)=>n+r.byte_size,0),pendingWriteBytes=data.rows.filter(r=>r.state==='writing').reduce((n,r)=>n+r.byte_size,0);
    const overBudget=actual.index+actual.auxiliary+actual.other>this.metadataEnvelope||actual.total>this.maxBytes;
    this.foreign=[...unrecognized];
    if(overBudget&&!this.foreign.length)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','实际缓存文件超出当前预算，停止扩张并保留现场');
    return{limit:this.maxBytes,indexLimit:this.indexBytes,metadataReserved:this.metadataEnvelope,chargedObjectBytes,pendingWriteBytes,readyObjects:data.rows.filter(r=>r.state==='ready').length,activeLeases:data.leases,actual,unrecognized:this.foreign,overBudget,availableForObjects:this.foreign.length||overBudget?0:Math.max(0,this.maxBytes-this.metadataEnvelope-chargedObjectBytes)};
  }
  dispose():Promise<void>{
    if(this.closing)return this.closing;this.closed=true;this.abort.abort();
    this.closing=(async()=>{await Promise.allSettled([...this.pending]);try{await this.tx(()=>this.db.prepare("UPDATE cache_sessions SET state='closed' WHERE session_id=?").run(this.sessionId));}finally{this.db.close();}})();return this.closing;
  }
}
