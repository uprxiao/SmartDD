import Database from 'better-sqlite3';
import {constants,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,openSync,closeSync,fsyncSync,writeFileSync,existsSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import type {ResourceStore} from './resource-store';
import type {DirectoryRestorer} from './restore-owned-directory';
import {acquireMailCacheAccess,mailCacheControlUsage} from './mail-cache-access';

const KIND='mail-cache-repair',MAX_ENTRIES=100000,MAX_PLANS=64;
const identity=z.object({dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative()}).strict();
const planSchema=z.object({schema:z.literal(1),id:z.uuid(),storeId:z.string(),parent:identity.extend({path:z.string()}),old:identity,new:identity,treeHash:z.string().regex(/^[a-f0-9]{64}$/),oldBytes:z.number().int().nonnegative()}).strict();
type Plan=z.infer<typeof planSchema>;
type Row={operation_id:string;owner_store_id:string;state:string;plan_json:string};
export interface MailCacheRecoveryOptions {move:DirectoryRestorer;assertNoForeignHolders(path:string):Promise<unknown>;signal?:AbortSignal;operationId?:string;timeoutMs?:number;checkpoint?:(phase:'prepared'|'retained'|'published'|'committed')=>void|Promise<void>}
const fail=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','邮件缓存恢复记录或目录身份不能核验，保留原件');
const same=(a:{dev:number;ino:number},b:{dev:number;ino:number})=>a.dev===b.dev&&a.ino===b.ino;
const present=(path:string)=>{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
const sync=(path:string)=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
function directory(path:string){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw fail();return{dev:s.dev,ino:s.ino};}
function rows(store:ResourceStore):{row:Row;plan:Plan}[]{
 // Ordinary standalone caches predate/have no C operation journal. Absence
 // means no recorded repair; actually rebuilding still requires this journal.
 if(!store.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_resource_operations'").get())return[];
 const found=store.sqlite.prepare('SELECT operation_id,owner_store_id,state,plan_json FROM capability_resource_operations WHERE kind=? ORDER BY rowid').all(KIND) as Row[];
 if(found.length>MAX_PLANS)throw fail();return found.map(row=>{let plan:Plan;try{plan=planSchema.parse(JSON.parse(row.plan_json));}catch{throw fail();}if(row.operation_id!==plan.id||row.owner_store_id!==store.storeId||plan.storeId!==store.storeId||!['prepared','retained','published','committed'].includes(row.state)||plan.parent.path!==join(dirname(store.root),'cache')||!same(directory(plan.parent.path),plan.parent))throw fail();return{row,plan};});
}
export function hasPendingMailCacheRepair(store:ResourceStore):boolean{return rows(store).some(x=>x.row.state!=='committed');}
/** Count every retained entry without following links or deleting unknown data.
 * Content hashes are checked at publication, not on every ordinary quota read. */
function treeBytes(root:string,max=500000000,budget={entries:0}):number{
 let bytes=0;const anchor=lstatSync(root);
 function visit(path:string,depth:number){const before=lstatSync(path);if(++budget.entries>MAX_ENTRIES||depth>32)throw fail();if(before.isDirectory()&&!before.isSymbolicLink()){
   if(before.dev!==anchor.dev)throw fail();for(const name of readdirSync(path))visit(join(path,name),depth+1);const after=lstatSync(path);if(!same(before,after)||!after.isDirectory()||after.isSymbolicLink())throw fail();
  }else{bytes+=before.size;if(!Number.isSafeInteger(bytes)||bytes>max)throw new ApplicationError('RESOURCE_BUSY','故障保留缓存已达到预算，未扩张或删除原件');}}
 visit(root,0);return bytes;
}
export function mailCacheRetention(store:ResourceStore,activeRoot:string):{bytes:number;authorizedV2:boolean}{
 const recorded=rows(store),committed=recorded.filter(x=>x.row.state==='committed');
 for(const {row,plan}of recorded){if(row.state!=='committed')throw fail();const path=join(plan.parent.path,'mail-retained-'+plan.id);if(!same(directory(path),plan.old))throw fail();}
 let authorizedV2=false;if(committed.length){const latest=committed[committed.length-1].plan;if(!same(directory(activeRoot),latest.new))throw fail();authorizedV2=true;}
 const parent=join(dirname(store.root),'cache');let bytes=0;const budget={entries:0};
 // Unknown/orphan slots are preserved and charged too. Names never authorize deletion.
 for(const name of readdirSync(parent))if(name.startsWith('mail-retained-')||name.startsWith('mail-rebuild-'))bytes+=treeBytes(join(parent,name),500000000,budget);
 if(!Number.isSafeInteger(bytes)||bytes>500000000)throw new ApplicationError('RESOURCE_BUSY','故障保留缓存已达到预算，未删除原件');
 return{bytes,authorizedV2};
}
async function treeHash(root:string,signal?:AbortSignal):Promise<{hash:string;bytes:number}>{
 const manifest:unknown[]=[];let bytes=0,entries=0;const anchor=directory(root);
 const check=()=>{if(signal?.aborted)throw new ApplicationError('CANCELED','已取消缓存恢复，原件保持');};
 async function visit(path:string,relative:string,depth:number):Promise<void>{
  check();const s=lstatSync(path);if(++entries>MAX_ENTRIES||depth>32||s.dev!==anchor.dev)throw fail();
  if(s.isDirectory()&&!s.isSymbolicLink()){
   manifest.push({relative,dev:s.dev,ino:s.ino,kind:'directory'});for(const name of readdirSync(path).sort())await visit(join(path,name),relative?relative+'/'+name:name,depth+1);const after=lstatSync(path);if(!same(s,after)||!after.isDirectory()||after.isSymbolicLink())throw fail();return;
  }
  bytes+=s.size;if(!Number.isSafeInteger(bytes)||bytes>500000000)throw new ApplicationError('RESOURCE_BUSY','故障缓存超出恢复预算，原件保持');let hash:string|null=null;
  // A hardlink may point to someone else's file: retain/count its entry, never read its content.
  if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1){const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await fd.stat();if(!same(s,before)||before.size!==s.size)throw fail();const h=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;while(offset<s.size){check();const {bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,s.size-offset),offset);if(!bytesRead)throw fail();h.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}const after=await fd.stat();if(!same(s,after)||after.size!==s.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fail();hash=h.digest('hex');}finally{await fd.close();}}
  manifest.push({relative,dev:s.dev,ino:s.ino,kind:s.isSymbolicLink()?'link':s.isFile()?'file':'other',size:s.size,nlink:s.nlink,hash});
 }
 await visit(root,'',0);return{hash:digest(canonicalJson(manifest)),bytes};
}
function verifyMarker(root:string,storeId:string){const p=join(root,'.willyou-mail-cache.json'),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>4096)throw fail();let marker;try{marker=JSON.parse(readFileSync(p,'utf8'));}catch{throw fail();}if(marker.schema!==1||marker.storeId!==storeId)throw fail();}
function proveCorruption(index:string,maxIndex:number):void{
 const s=lstatSync(index);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>maxIndex)throw fail();let db:Database.Database|undefined;
 try{db=new Database(index,{readonly:true,fileMustExist:true,timeout:0});const checks=db.pragma('quick_check') as {quick_check:string}[];if(checks.length&&checks.some(x=>x.quick_check!=='ok'))return;}
 catch(error){if(['SQLITE_NOTADB','SQLITE_CORRUPT'].includes((error as {code?:string}).code??''))return;throw error;}
 finally{db?.close();}
 throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','索引未证实损坏，未替换原缓存');
}
export async function rebuildMailCache(store:ResourceStore,options:MailCacheRecoveryOptions,limits:{maxBytes:number;indexBytes:number}):Promise<void>{
 if(!Number.isSafeInteger(limits.maxBytes)||!Number.isSafeInteger(limits.indexBytes)||limits.indexBytes<128*1024||limits.indexBytes%4096||limits.maxBytes<=4*limits.indexBytes||limits.maxBytes>500000000)throw fail();
 const lease=await acquireMailCacheAccess(store,'maintenance',{signal:options.signal,timeoutMs:options.timeoutMs});
 const check=()=>{lease.assertHeld();if(options.signal?.aborted)throw new ApplicationError('CANCELED','已取消缓存恢复，原件保持');};
 const phase=async(plan:Plan,state:'prepared'|'retained'|'published'|'committed')=>{check();const row=rows(store).find(x=>x.plan.id===plan.id);if(!row||canonicalJson(row.plan)!==canonicalJson(plan))throw fail();const phases=['prepared','retained','published','committed'];if(phases.indexOf(row.row.state)<phases.indexOf(state)){const changed=store.sqlite.prepare('UPDATE capability_resource_operations SET state=?,updated_at=? WHERE operation_id=? AND owner_store_id=? AND kind=? AND plan_json=?').run(state,new Date().toISOString(),plan.id,store.storeId,KIND,canonicalJson(plan));if(changed.changes!==1)throw fail();await options.checkpoint?.(state);}check();};
 try{
  check();if(!store.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_resource_operations'").get())throw fail();const parent=lease.root,parentId=directory(parent),active=join(parent,'mail'),recorded=rows(store),pending=recorded.filter(x=>x.row.state!=='committed');if(pending.length>1)throw fail();let plan:Plan;
  const completed=recorded.find(x=>x.plan.id===options.operationId&&x.row.state==='committed');if(completed){if(!same(directory(active),completed.plan.new)||!same(directory(join(parent,'mail-retained-'+completed.plan.id)),completed.plan.old))throw fail();return;}
  if(pending.length)plan=pending[0].plan;
  else{
   const old=directory(active);verifyMarker(active,store.storeId);const index=join(active,'index.sqlite');await options.assertNoForeignHolders(index);check();proveCorruption(index,limits.indexBytes);const tree=await treeHash(active,options.signal);check();const previous=mailCacheRetention(store,active).bytes,control=mailCacheControlUsage(lease).bytes;
   // No full copy; reserve a bounded fresh empty index before creating its slot.
   if(tree.bytes+previous+control+128*1024>limits.maxBytes)throw new ApplicationError('RESOURCE_BUSY','缓存预算不足以安全重建索引，原件保持');
   const id=options.operationId??randomUUID();if(!z.uuid().safeParse(id).success)throw fail();const fresh=join(parent,'mail-rebuild-'+id);if(present(fresh)||present(join(parent,'mail-retained-'+id)))throw new ApplicationError('OWNERSHIP_CONFLICT','恢复路径已被占用，保留双方');mkdirSync(fresh,{mode:0o700});mkdirSync(join(fresh,'objects'),{mode:0o700});mkdirSync(join(fresh,'staging'),{mode:0o700});writeFileSync(join(fresh,'.willyou-mail-cache.json'),canonicalJson({schema:1,storeId:store.storeId}),{flag:'wx',mode:0o600});const db=new Database(join(fresh,'index.sqlite'));
   try{db.pragma('page_size=4096');db.pragma('journal_mode=DELETE');db.pragma('synchronous=FULL');db.pragma('fullfsync=ON');db.pragma('user_version=2');}finally{db.close();}sync(join(fresh,'index.sqlite'));sync(fresh);sync(parent);
   plan={schema:1,id,storeId:store.storeId,parent:{path:parent,...parentId},old,new:directory(fresh),treeHash:tree.hash,oldBytes:tree.bytes};await options.assertNoForeignHolders(index);check();if(!same(directory(active),old)||!same(directory(parent),parentId))throw fail();const now=new Date().toISOString();store.sqlite.prepare('INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,?,?,\'prepared\',?,?,?)').run(id,KIND,store.storeId,canonicalJson(plan),now,now);await options.checkpoint?.('prepared');check();
  }
  const retained=join(parent,'mail-retained-'+plan.id),fresh=join(parent,'mail-rebuild-'+plan.id);check();
  if(present(active)&&same(lstatSync(active),plan.old)){
   if(present(retained))throw new ApplicationError('OWNERSHIP_CONFLICT','故障保留路径被占用，原件保持');verifyMarker(active,store.storeId);await options.assertNoForeignHolders(join(active,'index.sqlite'));check();const before=await treeHash(active,options.signal);if(before.hash!==plan.treeHash||before.bytes!==plan.oldBytes)throw fail();options.move({root:parent,from:'mail',to:'mail-retained-'+plan.id,rootIdentity:plan.parent,sourceIdentity:plan.old});
  }
  if(!present(retained)||!same(directory(retained),plan.old))throw fail();verifyMarker(retained,store.storeId);const original=await treeHash(retained,options.signal);if(original.hash!==plan.treeHash||original.bytes!==plan.oldBytes)throw fail();await phase(plan,'retained');
  if(!present(active)){
   if(!present(fresh)||!same(directory(fresh),plan.new))throw fail();verifyMarker(fresh,store.storeId);options.move({root:parent,from:'mail-rebuild-'+plan.id,to:'mail',rootIdentity:plan.parent,sourceIdentity:plan.new});
  }
  if(!same(directory(active),plan.new)||present(fresh))throw new ApplicationError('OWNERSHIP_CONFLICT','恢复目标或原slot身份不同，保留双方');verifyMarker(active,store.storeId);await phase(plan,'published');await phase(plan,'committed');
 }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError(['SQLITE_BUSY','SQLITE_LOCKED','SQLITE_FULL','ENOSPC'].includes((error as {code?:string}).code??'')?'RESOURCE_BUSY':'RESOURCE_RECOVERY_REQUIRED','邮件缓存恢复未完成，故障原件与记录保持');}finally{lease.release();}
}
