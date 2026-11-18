import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { existsSync,realpathSync,statSync } from 'node:fs';
import {rangeOf} from './agent-task-service';
import {sha256} from './agent-store';
import { AgentStore } from './agent-store';
import type { DiffJob,TreeRef } from './turn-diff-worker';
interface ChangeRow {ordinal:number;turn_id:string;task_id:string;run_id:string|null;before_ref:string|null;after_ref:string|null;changed_files_json:string;status:string;incomplete_reason:string|null}
interface DiffPatch {path:string;binary:boolean;patch:string|null;reason?:string;beforeText?:string;afterText?:string;bodyHash?:string}
export interface ObservedFile {path:string;added:number|null;removed:number|null;binary:boolean}
/** Canonical changes are observed worktree intervals, never an edit/rollback API. */
export class TurnDiffs {
 private readonly locks=new Map<string,{writer?:Promise<void>;readers:Set<Promise<void>>}>();
 private readonly privateBytes=new Map<string,{identity:string;bytes:number}>();
 private readonly removing=new Set<string>();
 private readonly reclaiming=new Set<string>();private readonly jobs=new Map<string,Promise<unknown>>();private readonly readers=new Set<Promise<unknown>>();private readonly cancellations=new Map<string,()=>void>();private readonly progress=new Map<string,{files:number;bytes:number}>();private readonly warm=new Set<string>();private readonly leases=new Map<string,number>();private readonly preparing=new Map<string,Promise<unknown>>();private closed=false;private patchCache?:{key:string;value:DiffPatch;text:string;hash:string};
 constructor(private readonly d:{store:AgentStore;storage:string;workerPath?:string;execute?(job:DiffJob):Promise<unknown>;excluded?(taskId:string,cwd:string):string[];storageLimit?:number;stable?(taskId:string,turnId:string):boolean;changed(taskId:string):void}){
  d.store.sqlite.prepare("UPDATE agent_turn_changes SET status='incomplete',incomplete_reason='宿主在快照期间退出，不能补造历史差异' WHERE status='capturing'").run();
 }
 private job(job:DiffJob):Promise<any>{
  if(this.d.execute)return this.d.execute(job);
  return new Promise((resolve,reject)=>{
   const worker=new Worker(this.d.workerPath??join(__dirname,'agent-diff-worker.js'),{workerData:{kind:'willyou-turn-diff-job',...job}});
   const key=job.action==='capture'?job.side+':'+job.turnId:randomUUID();
   const cancel=()=>worker.postMessage('cancel');
   this.cancellations.set(key,cancel);
   const clear=()=>{if(this.cancellations.get(key)===cancel)this.cancellations.delete(key);};
   const onMessage=(message:{ok?:boolean;value?:unknown;error?:string;progress?:{files:number;bytes:number}})=>{
    if(message.progress){
     this.progress.set(job.turnId,message.progress);
     const taskId=this.d.store.turn(job.turnId)?.task_id;
     if(taskId)this.d.changed(taskId);
     return;
    }
    worker.off('message',onMessage);
    clear();
    if(message.ok)resolve(message.value);
    else reject(Error(message.error));
   };
   worker.on('message',onMessage);
   worker.once('error',error=>{clear();reject(error);});
   worker.once('exit',code=>{clear();reject(Error(`差异工作线程退出（${code}）`));});
  });
 }
 private task(taskId:string,write=false){const task=this.d.store.task(taskId);if(!task||write&&task.archived_at)throw Error('任务不存在或已归档');return task;}
 private row(taskId:string,turnId:string){this.task(taskId);const r=this.d.store.sqlite.prepare('SELECT rowid AS ordinal,* FROM agent_turn_changes WHERE task_id=? AND turn_id=?').get(taskId,turnId) as ChangeRow|undefined;if(!r)throw Error('本轮尚无差异记录');return r;}
 private card(taskId:string,turnId:string,payload:Record<string,unknown>){return this.d.store.upsertItem({taskId,turnId,runId:null,nativeKey:'host:turn-diff:'+turnId,type:'files_changed',payload,terminalState:'completed'});}
 private report(taskId:string,turnId:string,reason:string){this.d.store.sqlite.prepare("UPDATE agent_turn_changes SET status='incomplete',incomplete_reason=? WHERE task_id=? AND turn_id=?").run(reason.slice(0,2000),taskId,turnId);this.card(taskId,turnId,{turnId,fileCount:0,status:'incomplete',reason:reason.slice(0,2000),observed:true});this.d.changed(taskId);}
 private async locked<T>(root:string,mode:'capture'|'cleanup',perform:()=>Promise<T>):Promise<T>{
  const gate=this.locks.get(root)??{readers:new Set<Promise<void>>()};
  this.locks.set(root,gate);
  const preceding=mode==='cleanup'?[gate.writer,...gate.readers]:[gate.writer];
  let release!:()=>void;
  const done=new Promise<void>(resolve=>{release=resolve;});
  if(mode==='cleanup')gate.writer=done;
  else gate.readers.add(done);
  try {
   await Promise.all(preceding);
   return await perform();
  } finally {
   if(gate.writer===done)gate.writer=undefined;
   gate.readers.delete(done);
   if(!gate.writer&&!gate.readers.size)this.locks.delete(root);
   release();
  }
 }
 private async releaseRefs(row:Pick<ChangeRow,'before_ref'|'after_ref'|'turn_id'>,cwd:string){
  const before=row.before_ref?JSON.parse(row.before_ref) as TreeRef:undefined,after=row.after_ref?JSON.parse(row.after_ref) as TreeRef:undefined;
  await this.job({action:'release',cwd,storage:this.d.storage,turnId:row.turn_id,before,after});
  return (before??after)?.private===true;
 }
 async cleanupRemovedTurn(row:Pick<ChangeRow,'before_ref'|'after_ref'|'turn_id'>) {
  const ref=JSON.parse((row.before_ref??row.after_ref)!) as TreeRef;
  await this.locked(ref.cwd,'cleanup',async()=>{
   if(await this.releaseRefs(row,ref.cwd)){
    this.privateBytes.delete(ref.cwd);
    const used=this.d.store.listTasks(true).some(task=>{
     try{return realpathSync(task.cwd)===ref.cwd;}catch{return false;}
    });
    await this.job({action:used?'collect':'discardPrivate',cwd:ref.cwd,storage:this.d.storage,turnId:row.turn_id});
   }
  });
 }
 private async reclaim(cwd:string,turnId:string,force:boolean){
  const storage=this.d.storage,limit=this.d.storageLimit??1024**3;
  const measure=async ()=>(await this.job({action:'space',cwd,storage,turnId})).bytes as number;
  this.privateBytes.delete(cwd);
  await this.job({action:'collect',cwd,storage,turnId});
  const rows=this.d.store.sqlite.prepare(`SELECT c.* FROM agent_turn_changes c JOIN agent_tasks a ON a.task_id=c.task_id
    JOIN agent_turns t ON t.turn_id=c.turn_id
    WHERE c.turn_id<>? AND c.status IN ('complete','incomplete')
    AND ((json_extract(c.before_ref,'$.private')=1 AND json_extract(c.before_ref,'$.cwd')=?)
      OR (json_extract(c.after_ref,'$.private')=1 AND json_extract(c.after_ref,'$.cwd')=?))
    ORDER BY a.archived_at IS NULL,t.accepted_at,c.rowid`).all(turnId,cwd,cwd) as ChangeRow[];
  if(!force&&(await measure())<limit*.9)return true;
  for(const row of rows){
   if(this.leases.has(row.turn_id)||this.jobs.has('before:'+row.turn_id)||this.jobs.has('after:'+row.turn_id))continue;
   this.reclaiming.add(row.turn_id);
   try{
    await this.releaseRefs(row,cwd);
    const reason='快照已清理（空间回收）';
    this.d.store.sqlite.prepare("UPDATE agent_turn_changes SET status='none',incomplete_reason=?,before_ref=NULL,after_ref=NULL WHERE turn_id=?").run(reason,row.turn_id);
    this.card(row.task_id,row.turn_id,{turnId:row.turn_id,fileCount:0,status:'none',reason,observed:true});
    this.d.changed(row.task_id);
    await this.job({action:'collect',cwd,storage,turnId});
    if((await measure())<limit*.9)return true;
   }finally{this.reclaiming.delete(row.turn_id);}
  }
  return true;
 }
 private async capture(taskId:string,job:DiffJob):Promise<TreeRef>{
  const cwd=realpathSync(job.cwd),stat=statSync(cwd),identity=stat.dev+':'+stat.ino;
  const limits=this.d.storageLimit===undefined?undefined:{storage:this.d.storageLimit};
  const attempt=(afterReclaim=false)=>this.locked(cwd,'capture',async()=>{
   const cached=this.privateBytes.get(cwd);
   try {
    const {privateBytes,...ref}=await this.job({...job,cwd,excluded:this.d.excluded?.(taskId,job.cwd),limits,afterReclaim,
     knownPrivateBytes:cached?.identity===identity?cached.bytes:undefined}) as TreeRef;
    if(privateBytes!==undefined&&ref.dev+':'+ref.ino===identity)this.privateBytes.set(cwd,{identity,bytes:privateBytes});
    return ref;
   } catch(error) {
    this.privateBytes.delete(cwd);
    throw error;
   }
  });
  return attempt().catch(async error=>{
   if(!String(error).includes('影子库空间已满'))throw error;
   await this.locked(cwd,'cleanup',()=>this.reclaim(cwd,job.turnId,!String(error).includes('达到回收阈值')));
   return attempt(true);
  });
 }
 hold(taskId:string,turnId:string) {
  this.row(taskId,turnId);
  if(this.removing.has(taskId))throw Error('任务正在删除');
  if(this.reclaiming.has(turnId))throw Error('快照正在清理');
  const timerToken=randomUUID();
  const release=this.lease(turnId),timer=setTimeout(()=>{this.viewerLeases.delete(timerToken);release();},60_000);
  timer.unref();
  this.viewerLeases.set(timerToken,{taskId,turnId,release:()=>{clearTimeout(timer);release();}});
  return timerToken;
 }
 releaseView(taskId:string,token:string){
  const held=this.viewerLeases.get(token);
  if(held?.taskId!==taskId)return;
  this.viewerLeases.delete(token);held.release();
 }
 private readonly viewerLeases=new Map<string,{taskId:string;turnId:string;release:()=>void}>();
 private lease(turnId:string) {
  this.leases.set(turnId,(this.leases.get(turnId)??0)+1);
  return ()=>{const count=(this.leases.get(turnId)??1)-1;if(count)this.leases.set(turnId,count);else this.leases.delete(turnId);};
 }
 capturing(taskId:string){
  return [...this.jobs.keys()].some(key=>this.d.store.turn(key.slice(key.indexOf(':')+1))?.task_id===taskId);
 }
 beginTaskRemoval(taskIds:string[]){
  const ids=new Set(taskIds);
  for(const id of ids)this.removing.add(id);
  for(const [token,held] of this.viewerLeases)if(ids.has(held.taskId))this.releaseView(held.taskId,token);
  return ()=>{for(const id of ids)this.removing.delete(id);};
 }
 async before(taskId:string,turnId:string,runId:string){
  if(this.closed||this.removing.has(taskId))return;const task=this.task(taskId,true);const known=this.d.store.sqlite.prepare('SELECT * FROM agent_turn_changes WHERE turn_id=?').get(turnId) as ChangeRow|undefined;if(known)return;
  this.d.store.sqlite.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,run_id,status) VALUES(?,?,?,'capturing')").run(turnId,taskId,runId);
  const prior=this.d.store.sqlite.prepare(`SELECT 1 FROM agent_turn_changes
   WHERE task_id=? AND status='complete' AND json_extract(before_ref,'$.cwd')=? LIMIT 1`).get(taskId,realpathSync(task.cwd));
  if(prior)this.warm.add(task.cwd);
  const work=this.capture(taskId,{action:'capture',cwd:task.cwd,storage:this.d.storage,turnId,side:'before',timeoutMs:this.warm.has(task.cwd)?5000:120000} as DiffJob);
  this.preparing.set(task.cwd,work);
  void work.finally(()=>{if(this.preparing.get(task.cwd)===work)this.preparing.delete(task.cwd);}).catch(()=>{});
  let adopted=true;const capture=work.then(async(ref:TreeRef)=>{this.warm.add(task.cwd);if(adopted&&this.d.store.sqlite.prepare("UPDATE agent_turn_changes SET before_ref=? WHERE turn_id=? AND status='capturing'").run(JSON.stringify(ref),turnId).changes===1)return;await this.locked(realpathSync(task.cwd),'cleanup',()=>this.job({action:'release',cwd:task.cwd,storage:this.d.storage,turnId,before:ref}));}).catch(e=>{if(adopted)this.report(taskId,turnId,(e as Error).message);});
  const key='before:'+turnId;this.jobs.set(key,capture);void capture.finally(()=>{this.jobs.delete(key);this.progress.delete(turnId);this.d.changed(taskId);});
  const done=capture.then(()=>true);let timer:ReturnType<typeof setTimeout>|undefined;const ready=await Promise.race([done,new Promise<false>(r=>{timer=setTimeout(()=>r(false),this.warm.has(task.cwd)?5500:250);})]);if(timer)clearTimeout(timer);
  if(!ready){adopted=false;this.report(taskId,turnId,'首次快照仍在后台准备，本轮前态缺失；任务可以继续，不能以较晚状态补造');}

 }
 async after(taskId:string,turnId:string){
  if(this.closed||this.removing.has(taskId))return;
  const key='after:'+turnId;if(this.jobs.has(key))return this.jobs.get(key);let row:ChangeRow;try{row=this.row(taskId,turnId);}catch{const turn=this.d.store.turn(turnId);if(!turn||turn.task_id!==taskId)throw Error('回合不属于任务');this.d.store.sqlite.prepare("INSERT OR IGNORE INTO agent_turn_changes(turn_id,task_id,run_id,status) VALUES(?,?,?,'capturing')").run(turnId,taskId,turn.run_id);this.report(taskId,turnId,'原生自动回合开始前未取得可证明的快照边界，本轮差异不完整');return;}if(row.status!=='capturing'||!row.before_ref){if(row.status==='incomplete'&&!row.before_ref)this.prepareIdle(taskId,turnId);return;}
  const work=(async()=>{try{const before=JSON.parse(row.before_ref!) as TreeRef;const after=await this.capture(taskId,{action:'capture',cwd:before.cwd,storage:this.d.storage,turnId,side:'after',timeoutMs:5000} as DiffJob) as TreeRef;this.d.store.sqlite.prepare('UPDATE agent_turn_changes SET after_ref=? WHERE turn_id=?').run(JSON.stringify(after),turnId);const changes=await this.job({action:'changes',cwd:before.cwd,storage:this.d.storage,turnId,before,after}) as {files:ObservedFile[]};if(this.d.stable&&!this.d.stable(taskId,turnId))throw Error('快照期间原生执行器又开始写入，无法证明本轮差异边界');const published=this.d.store.sqlite.prepare("UPDATE agent_turn_changes SET after_ref=?,changed_files_json=?,status='complete',incomplete_reason=NULL WHERE turn_id=? AND status='capturing'").run(JSON.stringify(after),JSON.stringify(changes.files),turnId);if(published.changes!==1)return;this.card(taskId,turnId,{turnId,fileCount:changes.files.length,status:'complete',observed:true,note:'记录这个区间观察到的工作区变化，可能包含用户或外部写入'});this.d.changed(taskId);}catch(e){this.report(taskId,turnId,(e as Error).message);}})();this.jobs.set(key,work);try{await work;}finally{this.jobs.delete(key);}
 }
 private prepareIdle(taskId:string,turnId:string){
  const task=this.task(taskId);if(this.closed||this.warm.has(task.cwd)||this.preparing.has(task.cwd)||this.d.stable&&!this.d.stable(taskId,turnId))return;
  const key='before:'+turnId,work=this.capture(taskId,{action:'capture',cwd:task.cwd,storage:this.d.storage,turnId,side:'before',timeoutMs:120000}).then(async(ref:TreeRef)=>{this.warm.add(task.cwd);await this.locked(ref.cwd,'cleanup',()=>this.job({action:'release',cwd:ref.cwd,storage:this.d.storage,turnId,before:ref}));}).catch(()=>{/* Retain the explicit incomplete result. A future idle boundary may retry. */});
  this.preparing.set(task.cwd,work);this.jobs.set(key,work);void work.finally(()=>{if(this.preparing.get(task.cwd)===work)this.preparing.delete(task.cwd);this.jobs.delete(key);this.progress.delete(turnId);this.d.changed(taskId);});
 }
 async drained(taskId:string){const turns=this.d.store.sqlite.prepare("SELECT turn_id FROM agent_turn_changes WHERE task_id=? AND status='capturing'").all(taskId) as {turn_id:string}[];for(const t of turns)await this.after(taskId,t.turn_id);}
 private recordCount(taskId:string,before:number){
  return this.d.store.sqlite.prepare('SELECT COUNT(*) FROM agent_turn_changes WHERE task_id=? AND rowid<?').pluck().get(taskId,before) as number;
 }
 private summary(r:ChangeRow,recordNumber:number){
  const all=JSON.parse(r.changed_files_json) as ObservedFile[],files:ObservedFile[]=[];
  for(const f of all.slice(0,20)){if(Buffer.byteLength(JSON.stringify([...files,f]))>8192)break;files.push(f);}
  return {turnId:r.turn_id,recordNumber,status:r.status,reason:r.incomplete_reason,files,filesTotal:all.length,observed:true as const,preparing:this.jobs.has('before:'+r.turn_id)||this.jobs.has('after:'+r.turn_id),progress:this.progress.get(r.turn_id)};
 }
 list(taskId:string){return this.page(taskId).items;}
 page(taskId:string,before=Number.MAX_SAFE_INTEGER) {
  this.task(taskId);
  if(!Number.isSafeInteger(before)||before<1)throw Error('差异分页无效');
  const rows=this.d.store.sqlite.prepare('SELECT rowid AS ordinal,* FROM agent_turn_changes WHERE task_id=? AND rowid<? ORDER BY rowid DESC LIMIT 51').all(taskId,before) as (ChangeRow&{ordinal:number})[];
  const items:ReturnType<TurnDiffs['summary']>[]=[];
  const count=this.recordCount(taskId,before);
  for(const row of rows.slice(0,50)){
   const item=this.summary(row,count-items.length);
   if(Buffer.byteLength(JSON.stringify([...items,item]))>128*1024)break;
   items.push(item);
  }
  return {items,next:rows.length>items.length?rows[items.length-1]?.ordinal??null:null};
 }
 turn(taskId:string,turnId:string){const row=this.row(taskId,turnId);return this.summary(row,this.recordCount(taskId,row.ordinal)+1);}
 files(taskId:string,turnId:string,offset=0){if(!Number.isSafeInteger(offset)||offset<0)throw Error('差异分页无效');const all=JSON.parse(this.row(taskId,turnId).changed_files_json) as ObservedFile[],files:ObservedFile[]=[];for(const f of all.slice(offset,offset+100)){if(Buffer.byteLength(JSON.stringify([...files,f]))>48*1024)break;files.push(f);}return{files,total:all.length,next:offset+files.length,hasMore:offset+files.length<all.length};}
 private async patchData(taskId:string,turnId:string,path:string){
  if(this.removing.has(taskId))throw Error('任务正在删除');
  if(typeof path!=='string'||path.length>16384)throw Error('差异路径无效');const r=this.row(taskId,turnId);if(this.reclaiming.has(turnId)||r.status!=='complete'||!r.before_ref||!r.after_ref)throw Error(r.incomplete_reason??'快照尚未完整');
  const before=JSON.parse(r.before_ref) as TreeRef,after=JSON.parse(r.after_ref) as TreeRef,current=this.task(taskId);
  if(realpathSync(current.cwd)!==before.cwd||!existsSync(before.cwd)||String(statSync(before.cwd).ino)!==before.ino)throw Error('工作目录或快照身份已变化');
  const key=JSON.stringify([taskId,turnId,path,r.before_ref,r.after_ref]);if(this.patchCache?.key===key)return this.patchCache;
  const release=this.lease(turnId);const read=this.locked(before.cwd,'capture',()=>this.job({action:'patch',cwd:before.cwd,storage:this.d.storage,turnId,before,after,path}));this.readers.add(read);
  try{const value=await read as DiffPatch,text=JSON.stringify(value),entry={key,value,text,hash:sha256(text)};this.patchCache=entry;return entry;}finally{this.readers.delete(read);release();}
 }
 async patch(taskId:string,turnId:string,path:string):Promise<DiffPatch>{const data=await this.patchData(taskId,turnId,path);return Buffer.byteLength(data.text)<=240*1024?data.value:{path:data.value.path,binary:data.value.binary,patch:null,bodyHash:data.hash};}
 async patchBody(taskId:string,turnId:string,path:string,hash:string,offset:number){if(!Number.isSafeInteger(offset)||offset<0||!/^([a-f0-9]{64})$/.test(hash))throw Error('差异分段读取参数无效');const data=await this.patchData(taskId,turnId,path);if(data.hash!==hash)throw Error('差异版本已变化，请重新打开');return rangeOf(data.text,offset);}
 cancel(taskId:string,turnId:string){this.task(taskId,true);this.row(taskId,turnId);for(const side of ['before','after'])this.cancellations.get(side+':'+turnId)?.();this.report(taskId,turnId,'用户取消差异捕获；本轮不可补造');return{canceled:true};}
 async close(){
  this.closed=true;
  for(const cancel of this.cancellations.values())cancel();
  for(const lease of this.viewerLeases.values())lease.release();
  this.viewerLeases.clear();
  await Promise.allSettled([...this.jobs.values(),...this.readers]);
 }
}
