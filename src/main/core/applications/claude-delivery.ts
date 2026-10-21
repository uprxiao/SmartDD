import {randomUUID} from 'node:crypto';
import {closeSync,constants,fsyncSync,lstatSync,openSync,renameSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {ResourceStore,ResourceRecord} from './resource-store';
import type {CapabilitySessionRegistry} from './session-registry';
import type {SessionCapabilityProjector,ClaudeProjectionSource} from './session-projector';
import type {ProcessIdentityReader} from './process-identity';
import {canonicalJson,digest} from './manifest';
import {ensureStoreDirectory} from './package-files';
import {verifyOwnedBundle,writeOwnedBundle} from './owned-bundle';
import {withResourceLock} from './resource-lock';
import {assertClaudeInstallLease,assertClaudePreparation,assertClaudeRunDelivery,claudeAnchor,claudeRoot,claudeSlotId,deliveryOwner,normalizedSelection,readClaudeSlot,verifyClaudeDelivery,writeClaudeSlot,type ClaudeSlot,type ClaudeDeliveryToken,type ClaudeRunDelivery,type DeliveryOwner} from './claude-delivery-state';
export type ClaudeDeliveryCheckpoint='registered'|'claimed'|'copied'|'backed-up'|'delivered'|'committed';
const recovery=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','Claude原目录交付或占用未能核验，保留原路径和现场');
const present=(p:string)=>{try{return lstatSync(p);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
const sync=(p:string)=>{const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
/** Per-task canonical delivery.All filesystem replacement is covered by a durable
 * pending intent and an independent root occupancy;immutable depot is never an alias. */
export class ClaudeDeliveryCoordinator{
 private readonly owner:DeliveryOwner;private readonly operations=new Set<string>();private readonly preparations=new Set<string>();
 constructor(private readonly store:ResourceStore,private readonly sessions:CapabilitySessionRegistry,private readonly projector:SessionCapabilityProjector,private readonly processes:ProcessIdentityReader,instanceId:string,private readonly checkpoint?:(phase:ClaudeDeliveryCheckpoint)=>void){const host=processes.read(process.pid);if(!host)throw recovery();this.owner=deliveryOwner.parse({instanceId,pid:host.pid,startedAt:host.startedAt});}
 has(taskId:string):boolean{return readClaudeSlot(this.store,taskId)!==null;}
 private putLease(id:string,anchor:string,kind:string,ownerId:string,owner:DeliveryOwner):void{this.store.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,?,?,?,?,?,'active',?)").run(id,anchor,kind,ownerId,owner.instanceId,owner.pid,owner.startedAt,new Date().toISOString());}
 private release(id:string):void{this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=?").run(new Date().toISOString(),id);}
 private sameOwner(a:DeliveryOwner,b:DeliveryOwner):boolean{return canonicalJson(a)===canonicalJson(b);}
 private assertNoRuns(taskId:string):void{if(this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").get(taskId))throw new ApplicationError('RESOURCE_BUSY','原会话仍有运行或待核验启动窗口，暂不替换Claude目录');}
 private idle(slot:ClaudeSlot):void{
  // Durable consumer records survive missing run/lease rows.Neither absence nor
  // an expired PID can prove a reader ended;RunRegistry must finish the lifecycle.
  for(const c of slot.consumers){const r=this.store.sqlite.prepare('SELECT task_id,owner_instance_id,owner_pid,owner_started_at,state,revocation_state,ended_at FROM capability_runs WHERE run_id=?').get(c.runId) as {task_id:string;owner_instance_id:string;owner_pid:number;owner_started_at:string;state:string;revocation_state:string;ended_at:string|null}|undefined;
   const l=this.store.sqlite.prepare('SELECT resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state FROM capability_resource_leases WHERE lease_id=?').get(c.leaseId) as {resource_id:string;owner_kind:string;owner_id:string;host_instance_id:string;pid:number;process_started_at:string;state:string}|undefined;
   if(!r||!l||r.task_id!==slot.taskId||r.owner_instance_id!==c.owner.instanceId||r.owner_pid!==c.owner.pid||r.owner_started_at!==c.owner.startedAt||l.resource_id!==slot.anchorId||l.owner_kind!=='run'||l.owner_id!==c.runId||l.host_instance_id!==c.owner.instanceId||l.pid!==c.owner.pid||l.process_started_at!==c.owner.startedAt)throw recovery();
   const children=this.store.sqlite.prepare('SELECT state FROM capability_run_processes WHERE run_id=?').all(c.runId) as {state:string}[];
   if(!['stopped','failed'].includes(r.state)||r.revocation_state!=='revoked'||!r.ended_at||l.state!=='released'||!children.length||children.some(p=>!['exited','canceled'].includes(p.state))||this.store.sqlite.prepare("SELECT 1 FROM capability_run_activities WHERE run_id=? AND state='active'").get(c.runId))throw new ApplicationError('RESOURCE_BUSY','原Claude目录仍被原生进程或业务读取，等待其正常结束');
  }
  this.assertNoRuns(slot.taskId);slot.consumers=[];
  const ownLeases=new Set(slot.pending?.participants.map(p=>p.leaseId)??[]);if(slot.preparation)ownLeases.add(slot.preparation.leaseId);
  const roots=(this.store.sqlite.prepare("SELECT resource_id,COALESCE(scope_relative_path,relative_path) AS path FROM capability_resources WHERE path_scope='C' AND owner_store_id=?").all(this.store.storeId) as {resource_id:string;path:string}[]).filter(r=>r.path===slot.root||r.path.startsWith(slot.root+'/')||slot.root.startsWith(r.path+'/')).map(r=>r.resource_id);
  for(const l of this.store.sqlite.prepare("SELECT lease_id,resource_id FROM capability_resource_leases WHERE state<>'released'").all() as {lease_id:string;resource_id:string}[]){if(ownLeases.has(l.lease_id))continue;const extra=this.store.sqlite.prepare('SELECT resource_id FROM capability_lease_resources WHERE lease_id=?').all(l.lease_id) as {resource_id:string}[];if(roots.includes(l.resource_id)||extra.some(e=>roots.includes(e.resource_id)))throw new ApplicationError('RESOURCE_BUSY','原Claude目录或其别名仍有占用，保留交付现场');}
 }
 private recoverPreparation(slot:ClaudeSlot):void{if(!slot.preparation)return;assertClaudePreparation(this.store,slot);if(this.processes.state(slot.preparation.owner)!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原Claude交付准备仍由其他启动持有');this.release(slot.preparation.leaseId);slot.preparation=null;writeClaudeSlot(this.store,slot);}
 private assertPending(slot:ClaudeSlot):void{assertClaudeInstallLease(this.store,slot);const p=slot.pending!,row=this.store.sqlite.prepare('SELECT kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(p.id) as {kind:string;owner_store_id:string;state:string;plan_json:string}|undefined;
  const expected=canonicalJson({slotId:claudeSlotId(slot.taskId),resourceId:p.resourceId,sourceId:p.sourceId,hash:p.hash,generation:p.generation,root:slot.root});if(!row||row.kind!=='claude-delivery-install'||row.owner_store_id!==this.store.storeId||row.state!=='preparing'||row.plan_json!==expected)throw recovery();
 }
 private claim(slot:ClaudeSlot):void{this.assertPending(slot);const p=slot.pending!;for(const participant of p.participants){const mine=this.sameOwner(participant.owner,this.owner)&&this.operations.has(p.id);if(!mine&&this.processes.state(participant.owner)!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原Claude发布者或恢复者仍存活或无法核实');}
  if(!this.sameOwner(p.activeOwner,this.owner)||!this.operations.has(p.id)){if(p.participants.length>=64)throw recovery();const leaseId=randomUUID();this.putLease(leaseId,slot.anchorId,'claude-delivery-install',p.id,this.owner);p.participants.push({owner:this.owner,leaseId});p.activeOwner=this.owner;writeClaudeSlot(this.store,slot);this.operations.add(p.id);}
 }
 private preparation(slot:ClaudeSlot):ClaudeDeliveryToken{const v=slot.current!;if(!v||slot.pending||slot.preparation)throw recovery();const id=randomUUID(),leaseId=randomUUID();this.putLease(leaseId,slot.anchorId,'claude-delivery-preparation',id,this.owner);slot.preparation={id,leaseId,owner:this.owner,revision:slot.revision};writeClaudeSlot(this.store,slot);this.preparations.add(id);return{taskId:slot.taskId,preparationId:id,leaseId,revision:slot.revision,resourceId:v.resourceId,hash:v.hash,generation:v.generation,appIds:[...v.appIds]};}
 async prepare(taskId:string,appIds:readonly string[]):Promise<ClaudeDeliveryToken>{
  if(readClaudeSlot(this.store,taskId)?.pending){const recovered=await this.recover(taskId);if(recovered)await this.cancel(recovered);}
  const current=await this.sessions.get(taskId),source=await this.projector.claudeSource(taskId,appIds);if(!source.applicationScope.length)throw recovery();
  const relative=claudeRoot(taskId),root=join(this.store.root,relative);let archiveId:string|null=null;
  // Before the first canonical change, preserve the actual registered complete
  // original tree.Archive creation never guesses a missing original body.
  if(!readClaudeSlot(this.store,taskId)&&present(root)){const refs=await this.sessions.references(taskId),original=refs.filter(r=>r.refKind==='session-projection'&&r.relativePath===relative);if(original.length!==1)throw new ApplicationError('OWNERSHIP_CONFLICT','原Claude路径不是唯一已登记的完整插件');archiveId=(await this.projector.archiveClaude(taskId,original[0].refId)).resource.resourceId;}
  let token:ClaudeDeliveryToken|undefined;
  await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
   let slot=readClaudeSlot(this.store,taskId);if(!slot){const anchorId=claudeAnchor(taskId),selectionHash=normalizedSelection(current.snapshot);slot={schema:1,storeId:this.store.storeId,taskId,selectionHash,root:relative,anchorId,revision:1,current:null,pending:null,preparation:null,consumers:[]};this.assertNoRuns(taskId);
    if(present(root)&&!archiveId)throw new ApplicationError('OWNERSHIP_CONFLICT','原目录在准备期间被其他内容占用');
    this.store.sqlite.prepare("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,scope_relative_path,state,generation,integrity,operation_id) VALUES(?,'claude-delivery-root',?,?,'C',?,?,'recovery-required',1,'unknown',?)").run(anchorId,digest(canonicalJson({taskId,selectionHash,root:relative})),this.store.storeId,`claude-deliveries/${taskId}/anchor`,relative,claudeSlotId(taskId));writeClaudeSlot(this.store,slot);
   }
   if(slot.selectionHash!==current.selectionHash||slot.pending)throw recovery();this.recoverPreparation(slot);this.idle(slot);
   if(slot.current?.hash===source.bundle.hash){verifyClaudeDelivery(this.store,this.store.get(slot.current.resourceId),current.snapshot);token=this.preparation(slot);return;}
   const priorIds=(this.store.sqlite.prepare("SELECT resource_id FROM capability_resources WHERE path_scope='C' AND COALESCE(scope_relative_path,relative_path)=? AND resource_id<>?").all(relative,slot.anchorId) as {resource_id:string}[]).map(r=>r.resource_id);
   const refs=this.store.sqlite.prepare('SELECT ref_id FROM capability_session_refs WHERE task_id=?').all(taskId) as {ref_id:string}[];
   for(const id of priorIds){const resource=this.store.get(id);if(!['session-projection','claude-delivery'].includes(resource.kind)||!refs.some(r=>r.ref_id===id)&&id!==slot.current?.resourceId||['staged','verified','deleting'].includes(resource.state))throw recovery();}
   let priorHash:string|null=null;if(present(root)){priorHash=slot.current?.hash??(archiveId?this.store.get(archiveId).contentHash:null);if(!priorHash)throw recovery();verifyOwnedBundle(root,priorHash,this.store.storeId);}
   const id=randomUUID(),resourceId=`claude-delivery:${taskId}:${source.bundle.hash}`,known=this.store.sqlite.prepare('SELECT generation FROM capability_resources WHERE resource_id=?').get(resourceId) as {generation:number}|undefined,generation=(known?.generation??0)+1,leaseId=randomUUID(),stage=`claude-deliveries/${taskId}/${id}/stages/${randomUUID()}`;
   slot.pending={id,sourceId:source.resource.resourceId,hash:source.bundle.hash,appIds:[...source.applicationScope],resourceId,generation,priorHash,priorResourceIds:priorIds,stage,backup:`claude-deliveries/${taskId}/${id}/previous`,abandonedStages:[],participants:[{owner:this.owner,leaseId}],activeOwner:this.owner};
   for(const priorId of priorIds)this.store.sqlite.prepare("UPDATE capability_resources SET state='recovery-required',integrity='unknown' WHERE resource_id=?").run(priorId);
   this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'claude-delivery-install',?,'preparing',?,?,?)").run(id,this.store.storeId,canonicalJson({slotId:claudeSlotId(taskId),resourceId,sourceId:source.resource.resourceId,hash:source.bundle.hash,generation,root:relative}),new Date().toISOString(),new Date().toISOString());
   this.store.sqlite.prepare("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,scope_relative_path,state,generation,integrity,operation_id) VALUES(?,'claude-delivery',?,?,'C',?,?,'staged',?,'unknown',?) ON CONFLICT(resource_id) DO UPDATE SET state='staged',integrity='unknown',generation=excluded.generation,operation_id=excluded.operation_id").run(resourceId,source.bundle.hash,this.store.storeId,`claude-deliveries/${taskId}/records/${source.bundle.hash}`,relative,generation,id);
   const deps=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=?').all(resourceId) as {dependency_id:string}[]).map(r=>r.dependency_id);if(deps.length&&canonicalJson(deps)!==canonicalJson([source.resource.resourceId]))throw recovery();this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_resource_dependencies(resource_id,dependency_id) VALUES(?,?)').run(resourceId,source.resource.resourceId);
   this.putLease(leaseId,slot.anchorId,'claude-delivery-install',id,this.owner);writeClaudeSlot(this.store,slot);this.operations.add(id);
  }).immediate());
  if(token){try{await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,token.resourceId);return token;}catch(error){await this.cancel(token).catch(()=>{});throw error;}}
  this.checkpoint?.('registered');return this.finish(taskId,source);
 }
 private async finish(taskId:string,source?:ClaudeProjectionSource):Promise<ClaudeDeliveryToken>{
  let slot=readClaudeSlot(this.store,taskId);if(!slot?.pending)throw recovery();const id=slot.pending.id;
  await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{slot=readClaudeSlot(this.store,taskId);if(!slot?.pending||slot.pending.id!==id)throw recovery();this.claim(slot);this.idle(slot);}).immediate());
  this.checkpoint?.('claimed');
  slot=readClaudeSlot(this.store,taskId)!;const artifact=source??await this.projector.readClaudeArtifact(taskId,slot.pending!.sourceId);if(artifact.role!=='view'||artifact.bundle.hash!==slot.pending!.hash||canonicalJson(artifact.applicationScope)!==canonicalJson(slot.pending!.appIds))throw recovery();
  let stage=join(this.store.root,slot.pending!.stage);
  if(present(stage)){try{verifyOwnedBundle(stage,artifact.bundle.hash,this.store.storeId);}catch{
   await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{const fresh=readClaudeSlot(this.store,taskId)!;this.assertPending(fresh);if(!this.sameOwner(fresh.pending!.activeOwner,this.owner)||!this.operations.has(id))throw recovery();if(fresh.pending!.abandonedStages.length>=64)throw recovery();fresh.pending!.abandonedStages.push(fresh.pending!.stage);fresh.pending!.stage=`claude-deliveries/${taskId}/${id}/stages/${randomUUID()}`;writeClaudeSlot(this.store,fresh);slot=fresh;}).immediate());stage=join(this.store.root,slot.pending!.stage);
  }}
  ensureStoreDirectory(this.store.root,dirname(slot.pending!.stage));if(!present(stage))writeOwnedBundle(stage,artifact.bundle,this.store.storeId);verifyOwnedBundle(stage,artifact.bundle.hash,this.store.storeId);this.checkpoint?.('copied');
  let token!:ClaudeDeliveryToken;
  await withResourceLock(this.store.root,()=>{
   const fresh=readClaudeSlot(this.store,taskId);if(!fresh?.pending||fresh.pending.id!==id||!this.sameOwner(fresh.pending.activeOwner,this.owner)||!this.operations.has(id))throw recovery();this.claim(fresh);this.idle(fresh);const p=fresh.pending,root=join(this.store.root,fresh.root),backup=join(this.store.root,p.backup);ensureStoreDirectory(this.store.root,dirname(fresh.root));ensureStoreDirectory(this.store.root,dirname(p.backup));
   if(present(backup)){if(!p.priorHash)throw recovery();verifyOwnedBundle(backup,p.priorHash,this.store.storeId);}
   if(present(root)){let next=false;try{verifyOwnedBundle(root,p.hash,this.store.storeId);next=true;}catch{if(!p.priorHash||present(backup))throw recovery();verifyOwnedBundle(root,p.priorHash,this.store.storeId);renameSync(root,backup);sync(dirname(root));sync(dirname(backup));this.checkpoint?.('backed-up');}
    if(next&&p.priorHash&&!present(backup))throw recovery();
   }else if(p.priorHash&&!present(backup))throw recovery();
   if(!present(root)){verifyOwnedBundle(stage,p.hash,this.store.storeId);renameSync(stage,root);sync(dirname(stage));sync(dirname(root));}this.checkpoint?.('delivered');verifyOwnedBundle(root,p.hash,this.store.storeId);
   this.store.sqlite.transaction(()=>{this.assertPending(fresh);const resource=this.store.get(p.resourceId);if(resource.operationId!==p.id||resource.contentHash!==p.hash||resource.relativePath!==fresh.root||resource.generation!==p.generation||resource.state!=='staged')throw recovery();
    this.store.sqlite.prepare("UPDATE capability_resources SET state='ready',integrity='valid' WHERE resource_id=?").run(p.resourceId);
    for(const priorId of p.priorResourceIds){const prior=this.store.get(priorId);const expected=[...new Set((artifact.bundle.manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))].sort(),deps=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(priorId) as {dependency_id:string}[]).map(d=>d.dependency_id);if(prior.kind==='session-projection'&&prior.contentHash===p.hash&&canonicalJson(deps)===canonicalJson(expected))this.store.sqlite.prepare("UPDATE capability_resources SET state='ready',integrity='valid',generation=generation+1 WHERE resource_id=?").run(priorId);}
    fresh.revision++;fresh.current={resourceId:p.resourceId,sourceId:p.sourceId,hash:p.hash,generation:p.generation,appIds:[...p.appIds]};fresh.pending=null;writeClaudeSlot(this.store,fresh);const snapshot=this.sessions.inspectCoordinated(taskId).snapshot;this.projector.verify(this.store.get(p.sourceId),snapshot);verifyClaudeDelivery(this.store,this.store.get(p.resourceId),snapshot);for(const participant of p.participants)this.release(participant.leaseId);this.store.sqlite.prepare("UPDATE capability_resource_operations SET state='committed',plan_json=?,updated_at=? WHERE operation_id=?").run(canonicalJson({slotId:claudeSlotId(taskId),completedPending:p}),new Date().toISOString(),p.id);token=this.preparation(fresh);
   }).immediate();
  });this.operations.delete(id);try{this.checkpoint?.('committed');const current=await this.sessions.get(taskId);await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,token.resourceId);return token;}catch(error){await this.cancel(token).catch(()=>{});throw error;}
 }
 async recover(taskId:string):Promise<ClaudeDeliveryToken|null>{const slot=readClaudeSlot(this.store,taskId);if(!slot)return null;if(slot.pending)return this.finish(taskId);await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{const fresh=readClaudeSlot(this.store,taskId)!;this.recoverPreparation(fresh);this.idle(fresh);writeClaudeSlot(this.store,fresh);}).immediate());return null;}
 async cancel(token:ClaudeDeliveryToken):Promise<void>{if(!this.preparations.has(token.preparationId))throw recovery();await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{const slot=readClaudeSlot(this.store,token.taskId);if(!slot)throw recovery();if(!slot.preparation){const lease=this.store.sqlite.prepare("SELECT 1 FROM capability_resource_leases WHERE lease_id=? AND owner_id=? AND state='released'").get(token.leaseId,token.preparationId);if(!lease)throw recovery();return;}assertClaudePreparation(this.store,slot);if(slot.preparation.id!==token.preparationId||slot.preparation.leaseId!==token.leaseId||!this.sameOwner(slot.preparation.owner,this.owner))throw recovery();this.release(token.leaseId);slot.preparation=null;writeClaudeSlot(this.store,slot);}).immediate());this.preparations.delete(token.preparationId);}
 proof(runId:string,token:ClaudeDeliveryToken):ClaudeRunDelivery{const slot=readClaudeSlot(this.store,token.taskId),consumer=slot?.consumers.find(c=>c.runId===runId);if(!consumer)throw recovery();const {preparationId:_unused,...rest}=token;const proof={...rest,leaseId:consumer.leaseId};this.assertRun(runId,proof);this.preparations.delete(token.preparationId);return proof;}
 assertRun(runId:string,proof:ClaudeRunDelivery):void{assertClaudeRunDelivery(this.store,runId,proof);const slot=readClaudeSlot(this.store,proof.taskId)!;const snapshot=this.sessions.inspectCoordinated(proof.taskId).snapshot;verifyClaudeDelivery(this.store,this.store.get(slot.current!.resourceId),snapshot);}
}
