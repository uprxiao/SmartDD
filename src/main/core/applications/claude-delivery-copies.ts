import {randomUUID} from 'node:crypto';
import {closeSync,constants,fsyncSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {ApplicationError,isPackagePath} from '@shared/applications';
import type {ResourceStore} from './resource-store';
import type {CapabilitySessionRegistry} from './session-registry';
import type {SessionCapabilityProjector} from './session-projector';
import type {ProcessIdentityReader} from './process-identity';
import {claudeAnchor,claudeDeliveryPendingSchema,claudeRoot,claudeSlotId,deliveryOwner,readClaudeSlot,verifyClaudeDelivery,type DeliveryOwner} from './claude-delivery-state';
import {verifyOwnedBundle} from './owned-bundle';
import {ensureStoreDirectory} from './package-files';
import {canonicalJson,digest} from './manifest';

export type ClaudeCopyCheckpoint='gc-marked'|'gc-renamed'|'gc-file-removed'|'gc-removed';
const hash=z.string().regex(/^[a-f0-9]{64}$/),relative=z.string().refine(isPackagePath);
const inode=z.object({dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative()}).strict();
const file=inode.extend({path:relative,size:z.number().int().nonnegative(),hash,mode:z.number().int().nonnegative()}).strict();
const directory=inode.extend({path:z.string().refine(p=>p===''||isPackagePath(p))}).strict();
const candidate=z.object({taskId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),deliveryId:z.uuid(),relativePath:relative,hash:hash.nullable()}).strict();
type Candidate=z.infer<typeof candidate>;
const planSchema=candidate.extend({schema:z.literal(1),storeId:z.uuid(),originHash:hash,selectionHash:hash,sourceId:z.string(),owner:deliveryOwner,owners:z.array(deliveryOwner).min(1).max(64),instanceId:z.uuid(),directories:z.array(directory).min(1).max(32768),files:z.array(file).min(1).max(4098)}).strict().refine(p=>canonicalJson(p.owner)===canonicalJson(p.owners.at(-1)));
type Plan=z.infer<typeof planSchema>;
interface Operation {operation_id:string;kind:string;owner_store_id:string;state:string;plan_json:string;error_code:string|null}
const kind='cleanup-claude-delivery-copy';
const fail=(code:'RESOURCE_RECOVERY_REQUIRED'|'RESOURCE_BUSY'|'OWNERSHIP_CONFLICT'='RESOURCE_RECOVERY_REQUIRED')=>new ApplicationError(code,'交付副本仍有占用或归属待核验，保留原内容');
const present=(p:string)=>{try{return lstatSync(p);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
const same=(a:{dev:number;ino:number},b:{dev:number;ino:number})=>a.dev===b.dev&&a.ino===b.ino;
const sync=(p:string)=>{const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
const intersects=(a:string,b:string)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
const identity=(c:Candidate)=>'claude-copy-gc:'+c.deliveryId+':'+digest(c.relativePath);
const asCandidate=(c:Candidate):Candidate=>({taskId:c.taskId,deliveryId:c.deliveryId,relativePath:c.relativePath,hash:c.hash});
const envelope=(payload:unknown)=>canonicalJson({payload,evidenceHash:digest(canonicalJson(payload))});
function parseEnvelope(text:string):unknown{const value=JSON.parse(text);if(!value||Object.keys(value).sort().join(',')!=='evidenceHash,payload'||digest(canonicalJson(value.payload))!==value.evidenceHash)throw fail();return value.payload;}

/** Called only while the C coordinator is held and the canonical task is idle.
 * Reclaims complete redundant copies,never original sources or unknown stages. */
export class ClaudeDeliveryCopies {
 private readonly active=new Set<string>();
 private readonly instanceId=randomUUID();
 constructor(private readonly store:ResourceStore,private readonly sessions:CapabilitySessionRegistry,private readonly projector:SessionCapabilityProjector,private readonly processes:ProcessIdentityReader,private readonly owner:DeliveryOwner,private readonly checkpoint?:(phase:ClaudeCopyCheckpoint)=>void){}
 private row(id:string){return this.store.sqlite.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(id) as Operation|undefined;}
 private origin(taskId:string,id:string,checkLeases=true){
  const row=this.row(id);if(!row||row.kind!=='claude-delivery-install'||row.owner_store_id!==this.store.storeId||row.state!=='committed')throw fail();
  const value=z.object({slotId:z.string(),completedPending:claudeDeliveryPendingSchema}).strict().parse(JSON.parse(row.plan_json)),p=value.completedPending,prefix=`claude-deliveries/${taskId}/${id}/stages/`;
  const stage=(v:string)=>v.startsWith(prefix)&&z.uuid().safeParse(v.slice(prefix.length)).success;
  if(value.slotId!==claudeSlotId(taskId)||p.id!==id||p.sourceId!==`claude-projection-source:${taskId}:${p.hash}`||p.resourceId!==`claude-delivery:${taskId}:${p.hash}`||p.backup!==`claude-deliveries/${taskId}/${id}/previous`||!stage(p.stage)||p.abandonedStages.some(v=>!stage(v))||new Set([p.stage,...p.abandonedStages]).size!==p.abandonedStages.length+1||!p.participants.some(v=>canonicalJson(v.owner)===canonicalJson(p.activeOwner)))throw fail();
  if(checkLeases)for(const participant of p.participants){const lease=this.store.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(participant.leaseId) as {resource_id:string;owner_kind:string;owner_id:string;host_instance_id:string;pid:number;process_started_at:string;state:string;ended_at:string|null}|undefined;
   if(!lease||lease.resource_id!==claudeAnchor(taskId)||lease.owner_kind!=='claude-delivery-install'||lease.owner_id!==id||lease.host_instance_id!==participant.owner.instanceId||lease.pid!==participant.owner.pid||lease.process_started_at!==participant.owner.startedAt||lease.state!=='released'||!lease.ended_at)throw fail();
  }
  return{row,p};
 }
 private verifyCandidate(c:Candidate){const origin=this.origin(c.taskId,c.deliveryId),p=origin.p;const expected=c.relativePath===p.backup?p.priorHash:c.relativePath===p.stage||p.abandonedStages.includes(c.relativePath)?p.hash:undefined;if(expected===undefined||c.hash!==expected||!c.hash)throw fail();return origin;}
 private source(c:Candidate,preferred?:string):string{
  const snapshot=this.sessions.inspectCoordinated(c.taskId).snapshot;
  const names=['claude-projection-source','claude-projection-archive'].sort((a,b)=>Number(`${b}:${c.taskId}:${c.hash}`===preferred)-Number(`${a}:${c.taskId}:${c.hash}`===preferred));
  for(const name of names){
   const id=`${name}:${c.taskId}:${c.hash}`,ref=this.store.sqlite.prepare('SELECT 1 FROM capability_session_refs WHERE task_id=? AND ref_id=? AND ref_hash=? AND ref_kind=?').get(c.taskId,id,c.hash,name);if(!ref)continue;
   const resource=this.store.get(id);if(resource.contentHash!==c.hash)throw fail();this.projector.verify(resource,snapshot);return id;
  }
  throw fail();
 }
 private aliases(path:string,trash:string){
  const resources=this.store.sqlite.prepare("SELECT resource_id FROM capability_resources WHERE state<>'removed'").all() as {resource_id:string}[];
  for(const row of resources){const r=this.store.get(row.resource_id),directory=this.store.directory(r);if(intersects(directory,path)||intersects(directory,trash))throw fail('RESOURCE_BUSY');if(present(directory)){const actual=realpathSync(directory);if(intersects(actual,path)||intersects(actual,trash))throw fail('RESOURCE_BUSY');}}
  // An erased resource row is not proof that a retained reader has no alias.
  const refs=this.store.sqlite.prepare("SELECT ref_id AS resource_id FROM capability_session_refs UNION SELECT resource_id FROM capability_resource_leases WHERE state<>'released' UNION SELECT x.resource_id FROM capability_lease_resources x JOIN capability_resource_leases l ON l.lease_id=x.lease_id WHERE l.state<>'released'").all() as {resource_id:string}[];
  for(const ref of refs)this.store.get(ref.resource_id);
 }
 private verify(c:Candidate,idle:()=>void,plan?:Plan){
  const origin=this.verifyCandidate(c),session=this.sessions.inspectCoordinated(c.taskId),slot=readClaudeSlot(this.store,c.taskId);
  if(this.sessions.hasUnresolvedHistory()||session.retention==='hold'||!slot?.current||slot.pending||slot.selectionHash!==session.selectionHash)throw fail();idle();
  verifyClaudeDelivery(this.store,this.store.get(slot.current.resourceId),session.snapshot);
  const sourceId=this.source(c,plan?.sourceId);if(plan&&(plan.storeId!==this.store.storeId||plan.originHash!==digest(origin.row.plan_json)||plan.selectionHash!==session.selectionHash||sourceId!==plan.sourceId))throw fail();
  const path=join(this.store.root,c.relativePath),trash=join(this.store.root,'trash/claude-delivery-copy-'+digest(identity(c)));this.aliases(path,trash);
  return{originHash:digest(origin.row.plan_json),selectionHash:session.selectionHash,sourceId,path,trash};
 }
 private capture(path:string,c:Candidate){
  const manifest=verifyOwnedBundle(path,c.hash!,this.store.storeId),expected=new Set([...manifest.files.map(v=>v.path),'bundle.json','.willyou-owned-bundle.json']),dirs=new Set(['']);
  for(const name of expected){let at=dirname(name);while(at!=='.'){dirs.add(at);at=dirname(at);}}
  const files:z.infer<typeof file>[]=[],directories:z.infer<typeof directory>[]=[];
  const walk=(root:string,local:string)=>{const stat=lstatSync(root);if(stat.isSymbolicLink()||!stat.isDirectory()||!dirs.has(local))throw fail('OWNERSHIP_CONFLICT');directories.push({path:local,dev:stat.dev,ino:stat.ino});for(const name of readdirSync(root)){const rel=local?local+'/'+name:name,p=join(root,name),st=lstatSync(p);if(st.isSymbolicLink())throw fail('OWNERSHIP_CONFLICT');if(st.isDirectory())walk(p,rel);else{if(!expected.has(rel)||!st.isFile()||st.nlink!==1)throw fail('OWNERSHIP_CONFLICT');files.push({path:rel,dev:st.dev,ino:st.ino,size:st.size,hash:digest(readFileSync(p)),mode:st.mode&0o777});}}};walk(path,'');
  if(files.length!==expected.size||directories.length!==dirs.size)throw fail();return{files,directories};
 }
 private remainder(path:string,plan:Plan,partial:boolean){
  if(realpathSync(path)!==path)throw fail('OWNERSHIP_CONFLICT');
  const files=new Map(plan.files.map(v=>[v.path,v])),dirs=new Map(plan.directories.map(v=>[v.path,v]));let count=0,dirCount=0;
  const walk=(at:string,local:string)=>{const before=lstatSync(at),expected=dirs.get(local);if(!expected||!before.isDirectory()||before.isSymbolicLink()||!same(before,expected))throw fail('OWNERSHIP_CONFLICT');dirCount++;for(const name of readdirSync(at)){const rel=local?local+'/'+name:name,p=join(at,name),st=lstatSync(p);if(st.isSymbolicLink())throw fail('OWNERSHIP_CONFLICT');if(st.isDirectory())walk(p,rel);else{const expected=files.get(rel);if(!expected||!st.isFile()||st.nlink!==1||!same(st,expected)||st.size!==expected.size||(st.mode&0o777)!==expected.mode||digest(readFileSync(p))!==expected.hash)throw fail('OWNERSHIP_CONFLICT');count++;}}};walk(path,'');
  if(!partial&&(count!==files.size||dirCount!==dirs.size))throw fail('OWNERSHIP_CONFLICT');
 }
 private parents(root:string,path:string,plan:Plan){
  const known=new Map(plan.directories.map(v=>[v.path,v]));let local='';for(const part of ['',...dirname(path).split('/').filter(v=>v!=='.')]){if(part)local=local?local+'/'+part:part;const at=join(root,local),expected=known.get(local);if(!expected)throw fail('OWNERSHIP_CONFLICT');const stat=present(at);if(!stat)return false;if(!stat.isDirectory()||stat.isSymbolicLink()||!same(stat,expected))throw fail('OWNERSHIP_CONFLICT');}return true;
 }
 private update(id:string,state:string,error:string|null=null){this.store.sqlite.prepare('UPDATE capability_resource_operations SET state=?,error_code=?,updated_at=? WHERE operation_id=?').run(state,error,new Date().toISOString(),id);}
 private hold(c:Candidate,error:unknown){
  const id=identity(c),row=this.row(id),code=error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED';
  if(row){if(row.kind===kind&&row.owner_store_id===this.store.storeId)this.update(id,row.state,code);return;}
  const at=new Date().toISOString();this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,error_code,created_at,updated_at) VALUES(?,?,?,'held',?,?,?,?)").run(id,kind,this.store.storeId,envelope(candidate.parse(c)),code,at,at);
 }
 private attempt(c:Candidate,idle:()=>void){
  const id=identity(c),prior=this.row(id);if(prior&&(prior.kind!==kind||prior.owner_store_id!==this.store.storeId))throw fail();if(prior?.state==='committed'){if(present(join(this.store.root,c.relativePath)))throw fail('OWNERSHIP_CONFLICT');return;}
  const checked=this.verify(c,idle);let plan:Plan;
  if(prior&&prior.state!=='held'){
   if(!['preparing','renamed','deleting','removed'].includes(prior.state))throw fail();plan=planSchema.parse(parseEnvelope(prior.plan_json));if(identity(plan)!==id||canonicalJson(asCandidate(plan))!==canonicalJson(c))throw fail();
   if(!(plan.instanceId===this.instanceId&&this.active.has(id))){if(this.processes.state(plan.owner)!=='stopped')throw fail('RESOURCE_BUSY');if(plan.owners.length>=64)throw fail();plan={...plan,owner:this.owner,owners:[...plan.owners,this.owner],instanceId:this.instanceId};this.store.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(envelope(plan),id);this.active.add(id);}
  }else{
   if(!present(checked.path))return;
   if(prior&&(prior.kind!==kind||prior.owner_store_id!==this.store.storeId||canonicalJson(candidate.parse(parseEnvelope(prior.plan_json)))!==canonicalJson(c)))throw fail();
   plan=planSchema.parse({...c,schema:1,storeId:this.store.storeId,originHash:checked.originHash,selectionHash:checked.selectionHash,sourceId:checked.sourceId,owner:this.owner,owners:[this.owner],instanceId:this.instanceId,...this.capture(checked.path,c)});
   const at=new Date().toISOString();this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,error_code,created_at,updated_at) VALUES(?,?,?,'preparing',?,NULL,?,?) ON CONFLICT(operation_id) DO UPDATE SET state='preparing',plan_json=excluded.plan_json,error_code=NULL,updated_at=excluded.updated_at").run(id,kind,this.store.storeId,envelope(plan),at,at);this.active.add(id);this.checkpoint?.('gc-marked');
  }
  this.finish(id,plan,idle);this.active.delete(id);
 }
 private finish(id:string,plan:Plan,idle:()=>void){
  const {path,trash}=this.verify(plan,idle,plan),payload=join(trash,'payload'),marker=join(trash,'owner.json');ensureStoreDirectory(this.store.root,'trash');
  const receipt=canonicalJson({schema:1,storeId:this.store.storeId,operationId:id,treeHash:digest(canonicalJson({files:plan.files,directories:plan.directories})),relativePath:plan.relativePath})+'\n';
  if(!present(trash))ensureStoreDirectory(this.store.root,trash.slice(this.store.root.length+1));sync(this.store.root);sync(dirname(trash));
  const ts=lstatSync(trash);if(!ts.isDirectory()||ts.isSymbolicLink()||realpathSync(trash)!==trash)throw fail('OWNERSHIP_CONFLICT');
  if(present(marker)){const st=lstatSync(marker);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||readFileSync(marker,'utf8')!==receipt)throw fail('OWNERSHIP_CONFLICT');}
  else{if(readdirSync(trash).length)throw fail('OWNERSHIP_CONFLICT');writeFileSync(marker,receipt,{flag:'wx',mode:0o600});const fd=openSync(marker,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}sync(trash);}
  if(readdirSync(trash).some(name=>!['payload','owner.json'].includes(name)))throw fail('OWNERSHIP_CONFLICT');
  if(present(path)){
   if(present(payload))throw fail('OWNERSHIP_CONFLICT');if(this.row(id)!.state!=='preparing')throw fail();this.remainder(path,plan,false);this.verify(plan,idle,plan);renameSync(path,payload);sync(dirname(path));sync(trash);this.update(id,'renamed');this.checkpoint?.('gc-renamed');
  }
  let state=this.row(id)!.state;
  if(present(payload)){
   this.remainder(payload,plan,state==='deleting');this.verify(plan,idle,plan);this.update(id,'deleting');
   // The C kernel coordinator stays held across this bounded batch. Delete only
   // individually captured files; never recursively remove a late unknown entry.
   for(const f of plan.files){const p=join(payload,f.path);if(!this.parents(payload,f.path,plan)||!present(p))continue;const st=lstatSync(p);if(!st.isFile()||st.isSymbolicLink()||!same(st,f)||st.nlink!==1||st.size!==f.size||digest(readFileSync(p))!==f.hash)throw fail('OWNERSHIP_CONFLICT');unlinkSync(p);sync(dirname(p));if(this.checkpoint){this.checkpoint('gc-file-removed');this.verify(plan,idle,plan);}}
   for(const dir of [...plan.directories].sort((a,b)=>b.path.length-a.path.length)){const p=join(payload,dir.path);if(!this.parents(payload,dir.path?dir.path+'/_':'_',plan)||!present(p))continue;const st=lstatSync(p);if(!st.isDirectory()||st.isSymbolicLink()||!same(st,dir))throw fail('OWNERSHIP_CONFLICT');rmdirSync(p);sync(dirname(p));}
   this.update(id,'removed');this.checkpoint?.('gc-removed');
  }else if(!['deleting','removed'].includes(state))throw fail();
  this.verify(plan,idle,plan);if(present(path)||present(payload))throw fail('OWNERSHIP_CONFLICT');this.update(id,'committed');
 }
 collectCoordinated(taskId:string,idle:()=>void):void{
  if(this.store.sqlite.inTransaction)throw new Error('交付副本文件回收不能在SQLite写事务内执行');
  // The cursor is scheduling metadata only. Every attempted copy still requires
  // all original proofs. Bound a launch to16 journals and4 nonterminal copies.
  const cursorId='claude-copy-maintenance-cursor:'+taskId,cursor=this.row(cursorId),cursorKind='claude-copy-maintenance-cursor';let position={rowId:0,index:0};
  if(cursor)try{if(cursor.kind!==cursorKind||cursor.owner_store_id!==this.store.storeId||cursor.state!=='committed')return;const value=z.object({schema:z.literal(1),storeId:z.literal(this.store.storeId),taskId:z.literal(taskId),rowId:z.number().int().nonnegative(),index:z.number().int().min(0).max(66)}).strict().parse(parseEnvelope(cursor.plan_json));position={rowId:value.rowId,index:value.index};}catch{return;}
  const save=(next:typeof position)=>{const at=new Date().toISOString();this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,?,?,'committed',?,?,?) ON CONFLICT(operation_id) DO UPDATE SET plan_json=excluded.plan_json,updated_at=excluded.updated_at").run(cursorId,cursorKind,this.store.storeId,envelope({schema:1,storeId:this.store.storeId,taskId,...next}),at,at);};
  const query=(after:number)=>this.store.sqlite.prepare("SELECT rowid AS seq,operation_id FROM capability_resource_operations WHERE rowid>=? AND kind='claude-delivery-install' AND owner_store_id=? AND state='committed' AND CASE WHEN json_valid(plan_json) THEN json_extract(plan_json,'$.slotId') ELSE NULL END=? ORDER BY rowid LIMIT16".replace('LIMIT16','LIMIT 16')).all(after,this.store.storeId,claudeSlotId(taskId)) as {seq:number;operation_id:string}[];
  let rows=query(position.rowId);if(!rows.length&&position.rowId){position={rowId:0,index:0};rows=query(0);}let attempts=0;
  for(const row of rows){let p:z.infer<typeof claudeDeliveryPendingSchema>;try{p=this.origin(taskId,row.operation_id,false).p;}catch{continue;}
   const copies=[{relativePath:p.backup,hash:p.priorHash},{relativePath:p.stage,hash:p.hash},...p.abandonedStages.map(relativePath=>({relativePath,hash:p.hash}))];
   for(let index=row.seq===position.rowId?position.index:0;index<copies.length;index++){const v=copies[index],c={...v,taskId,deliveryId:p.id};try{const exists=!!present(join(this.store.root,v.relativePath)),prior=this.row(identity(c));if(!exists&&(!prior||prior.state==='committed'))continue;this.attempt(c,idle);}catch(error){this.hold(c,error);}if(++attempts>=4){save({rowId:row.seq,index:index+1});return;}}
  }
  save(rows.length<16?{rowId:0,index:0}:{rowId:rows.at(-1)!.seq+1,index:0});
 }
}
