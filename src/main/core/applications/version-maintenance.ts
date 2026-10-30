import {randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {ApplicationError,APP_HASH_PATTERN,isPackagePath} from '@shared/applications';
import {applicationIdSchema,type ApplicationId} from '@shared/application-connections';
import type {ApplicationVersionUsage,ApplicationVersions,ApplicationVersionCleanup,ApplicationVersionCleanupResult,ApplicationCleanupCancel,ApplicationCleanupCanceled} from '@shared/application-maintenance';
import {assertHostCompatible,canonicalJson,digest} from './manifest';
import {ensureStoreDirectory,fileNames,verifyPackageTree} from './package-files';
import {PackageRegistry} from './package-registry';
import type {ProcessIdentityReader} from './process-identity';
import type {ResourceStore} from './resource-store';
import {withResourceLock} from './resource-lock';
import type {CleanupWaitControl} from './maintenance-waits';
import {CapabilitySessionRegistry} from './session-registry';
import type {DirectoryRestorer} from './restore-owned-directory';
import {RuntimeRegistry} from './runtime-registry';
import {resourceGcPlan,resourceGcPlans,type ResourceGcPlan} from './resource-gc-plan';
import type {ResourceGraphMaintenance} from './resource-graph-maintenance';
const hash=z.string().regex(APP_HASH_PATTERN),cleanupInput=z.object({appId:applicationIdSchema,packageHash:hash,planHash:hash}).strict();
const inode=z.object({dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative()}).strict();
const file=z.object({path:z.string().refine(isPackagePath),dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative(),size:z.number().int().nonnegative(),hash}).strict();
const planSchema=z.object({schema:z.literal(1),storeId:z.uuid(),resourceId:z.string(),packageHash:hash,relativePath:z.string().refine(isPackagePath),generation:z.number().int().positive(),owner:z.object({pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/)}).strict(),instanceId:z.uuid(),directory:inode,files:z.array(file).min(1)}).strict();
const cancelInput=cleanupInput.extend({operationId:z.uuid()});
const cancelPlanSchema=z.object({schema:z.literal(1),storeId:z.uuid(),cleanupOperationId:z.uuid(),cleanupPlanHash:hash,owner:planSchema.shape.owner,instanceId:z.uuid(),resumers:z.array(z.object({owner:planSchema.shape.owner,instanceId:z.uuid()}).strict()).max(64).optional()}).strict();
type CancelPlan=z.infer<typeof cancelPlanSchema>;
type Plan=z.infer<typeof planSchema>;
export type VersionCleanupCheckpoint='marked'|'renamed'|'deleting'|'removed'|'cancel-intent'|'cancel-owner'|'cancel-restored'|'cancel-committed';
function present(path:string):boolean{try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
/** Resolve every existing segment without following a substituted parent or dangling link. */
function ownedPath(root:string,relative:string):string{
 if(!isPackagePath(relative)||lstatSync(root).isSymbolicLink())throw new ApplicationError('OWNERSHIP_CONFLICT','受管资源路径归属无法核验');
 let at=root;for(const part of relative.split('/')){at=join(at,part);if(!present(at))throw new ApplicationError('NOT_FOUND','受管版本目录已缺失');const st=lstatSync(at);if(st.isSymbolicLink()||!st.isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','受管版本目录被其他内容占用');}return at;
}
function identity(path:string){const st=lstatSync(path);return{dev:st.dev,ino:st.ino};}
function bytes(root:string,seen=new Set<string>()):number{return fileNames(root).reduce((n,p)=>{const st=lstatSync(join(root,p)),key=st.dev+':'+st.ino;if(seen.has(key))return n;seen.add(key);return n+st.size;},0);}
function durable(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
/** Version inventory is derived from authoritative immutable identities. Cleanup never
 * infers zero references from missing/corrupt snapshots, nor reaps another store or H. */
export class ApplicationVersionMaintenance {
 private readonly packages:PackageRegistry;
 private readonly sessions:CapabilitySessionRegistry;
 constructor(private readonly store:ResourceStore,private readonly processes:ProcessIdentityReader,private readonly checkpoint?:(phase:VersionCleanupCheckpoint)=>void,private readonly restoreDirectory?:DirectoryRestorer,private readonly graph?:ResourceGraphMaintenance){
  this.packages=new PackageRegistry(store,'maintenance-reader');this.sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw new Error('read only');},verifyExtraResource:()=>{throw new Error('read only');}});
 }
 private publicationRecord(resourceId:string,hash:string,relativePath:string,operationId:string|null):ApplicationVersionUsage['publication']{
  const unknown={state:'unknown' as const,errorCode:null,updatedAt:null};if(!operationId)return unknown;
  const row=this.store.sqlite.prepare('SELECT kind,state,plan_json,error_code,updated_at FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(operationId,this.store.storeId) as {kind:string;state:string;plan_json:string;error_code:string|null;updated_at:string}|undefined;if(!row)return unknown;
  if(!['install-application-package','restore-application-package'].includes(row.kind))return undefined;
  try{const plan=JSON.parse(row.plan_json);if(plan?.resourceId!==resourceId||plan.hash!==hash||plan.relativePath!==relativePath)return unknown;}catch{return unknown;}
  const state=z.enum(['preparing','verified','published','failed','committed']).safeParse(row.state);if(!state.success)return unknown;
  const codes=new Set(['INSTALL_FAILED','HASH_MISMATCH','OWNERSHIP_CONFLICT','RESOURCE_BUSY','RESOURCE_RECOVERY_REQUIRED','RESOURCE_STATE_CHANGED','CANCELED','NOT_FOUND','INVALID_PACKAGE','HOST_INCOMPATIBLE','SOURCE_UNAVAILABLE']);
  const date=new Date(row.updated_at),updatedAt=Number.isFinite(date.valueOf())&&date.toISOString()===row.updated_at?row.updated_at:null;
  return{state:state.data,errorCode:row.error_code&&codes.has(row.error_code)?row.error_code:null,updatedAt};
 }
 private metadata(){
  const db=this.store.sqlite;
  const snapshots=db.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all() as {task_id:string}[];
  const unresolved:string[]=[];
  for(const row of snapshots)try{const known=this.sessions.inspectCoordinated(row.task_id);if(known.retention==='hold')unresolved.push(row.task_id);}catch{unresolved.push(row.task_id);}
  const unmapped=db.prepare("SELECT t.id FROM tasks t WHERE (t.native_session_id IS NOT NULL OR t.runtime_snapshot IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM capability_session_snapshots s WHERE s.task_id=t.id)").all() as {id:string}[];
  for(const t of unmapped)unresolved.push(t.id);
  return{unresolved};
 }
 private proof(resourceId:string,appId:ApplicationId,unresolved:string[],graphHash?:string):string{
  const db=this.store.sqlite,resources=db.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT r.* FROM capability_resources r JOIN consumers c ON c.id=r.resource_id ORDER BY r.resource_id`).all(resourceId) as {resource_id:string}[];
  const ids=resources.map(r=>r.resource_id),marks=ids.map(()=>'?').join(','),refs=db.prepare(`SELECT * FROM capability_session_refs WHERE ref_id IN (${marks}) ORDER BY task_id,ref_kind,ref_id`).all(...ids) as {task_id:string}[];
  const taskIds=[...new Set(refs.map(r=>r.task_id))],taskMarks=taskIds.map(()=>'?').join(',');
  const histories=taskIds.length?['capability_session_snapshots','capability_session_identities','capability_session_mcp_names','capability_session_holds','capability_runs'].map(table=>db.prepare(`SELECT * FROM ${table} WHERE task_id IN (${taskMarks}) ORDER BY rowid`).all(...taskIds)):[];
  const leases=db.prepare(`SELECT * FROM capability_resource_leases WHERE resource_id IN (${marks}) AND state<>'released' ORDER BY lease_id`).all(...ids);
  const dependencies=db.prepare(`SELECT * FROM capability_resource_dependencies WHERE resource_id IN (${marks}) OR dependency_id IN (${marks}) ORDER BY resource_id,dependency_id`).all(...ids,...ids);
  const active=db.prepare('SELECT * FROM capability_active_packages WHERE app_id=?').get(appId)??null;
  if(!graphHash)try{graphHash=resourceGcPlan(this.store,resourceId).planHash;}catch{graphHash='unavailable';}
  return digest(canonicalJson({resources,refs,histories,leases,dependencies,active,unresolved,graphHash}));
 }

 private inventory(appId:ApplicationId):ApplicationVersions{
  const db=this.store.sqlite,{unresolved}=this.metadata(),active=this.packages.active(appId),gcPlans=resourceGcPlans(this.store);
  const rows=db.prepare('SELECT package_hash AS hash,version,resource_id AS resourceId FROM capability_packages WHERE app_id=? ORDER BY installed_at DESC,version DESC').all(appId) as {hash:string;version:string;resourceId:string}[];
  const items:ApplicationVersionUsage[]=rows.map(row=>{
   const reasons=new Set<string>(),issues:string[]=[],isDefault=active?.packageHash===row.hash;
   if(isDefault)reasons.add('新会话默认版本');if(unresolved.length)reasons.add('历史资源保留原因待核查');
   const related=db.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT id FROM consumers ORDER BY id`).all(row.resourceId) as {id:string}[];
   const ids=new Set(related.map(r=>r.id)),refs=db.prepare('SELECT s.task_id,s.retention_state,r.ref_id,t.title FROM capability_session_refs r JOIN capability_session_snapshots s ON s.task_id=r.task_id LEFT JOIN tasks t ON t.id=s.task_id ORDER BY s.task_id').all() as {task_id:string;retention_state:string;ref_id:string;title:string|null}[];
   const taskIds=new Set(refs.filter(ref=>ids.has(ref.ref_id)).map(ref=>ref.task_id));
   const references=[...taskIds].map(taskId=>{const known=this.sessions.inspectCoordinated.bind(this.sessions);let projectId='',runner='unknown';try{const saved=known(taskId);projectId=saved.snapshot.projectId;runner=saved.snapshot.runner;}catch{/* unresolved is already a global cleanup hold */}const ref=refs.find(r=>r.task_id===taskId)!;return{taskId,title:ref.title,projectId,runner,deleted:ref.title===null||ref.retention_state==='tombstone',retention:ref.retention_state};});
   const sessionRefCount=references.filter(r=>!r.deleted).length,tombstoneRefCount=references.filter(r=>r.deleted).length;
   if(sessionRefCount)reasons.add('历史会话引用');if(tombstoneRefCount)reasons.add('已删除任务保留的原生历史引用');
   const runs=db.prepare("SELECT run_id,task_id FROM capability_runs WHERE state NOT IN ('stopped','failed')").all() as {run_id:string;task_id:string}[];
   const runIds=new Set(runs.filter(r=>taskIds.has(r.task_id)).map(r=>r.run_id));
   const leases=db.prepare("SELECT resource_id,owner_kind,owner_id FROM capability_resource_leases WHERE state<>'released'").all() as {resource_id:string;owner_kind:string;owner_id:string}[];
   const held=leases.filter(l=>ids.has(l.resource_id));for(const l of held)if(l.owner_kind==='run')runIds.add(l.owner_id);
   if(held.length||runIds.size)reasons.add('运行或资源操作仍有占用');
   const measured=new Set<string>();let publication:ApplicationVersionUsage['publication'];
   let sourceBytes:number|null=null,projectionBytes:number|null=0,integrity:ApplicationVersionUsage['integrity']='unknown',compatibility:ApplicationVersionUsage['compatibility']='unknown',state='recovery-required',generation=0;
   try{
    const resource=this.store.get(row.resourceId);state=resource.state;generation=resource.generation;publication=this.publicationRecord(row.resourceId,row.hash,resource.relativePath,resource.operationId);
    const installed=this.packages.get(row.hash);try{assertHostCompatible(installed.manifest);compatibility='compatible';}catch{compatibility='incompatible';issues.push('原版本与当前宿主契约不兼容');}
    if(state==='removed'){integrity='removed';sourceBytes=0;reasons.add('版本文件已清理，保留身份记录');}
    else if(resource.pathScope!=='C'){reasons.add('版本原件归属待核查');}
    else{
     const path=ownedPath(this.store.root,resource.relativePath);sourceBytes=bytes(path,measured);verifyPackageTree(path,installed,this.store.storeId);integrity='valid';if(fileNames(path).some(name=>lstatSync(join(path,name)).nlink!==1))reasons.add('版本目录含共享文件，保留原因待核查');
     try{new RuntimeRegistry(this.store).verify(installed.manifest.runtime.hash,installed.manifest.runtime);}catch{compatibility='unknown';issues.push('原运行时缺失、损坏或尚未就绪');}
    }
   }catch(error){integrity=error instanceof ApplicationError&&error.code==='NOT_FOUND'?'missing':'invalid';issues.push('原版本内容缺失、损坏或归属不符');reasons.add('版本完整性待恢复');}
   if(!['ready','removed'].includes(state))reasons.add('版本发布或清理尚未完成');
   for(const dep of related.filter(r=>r.id!==row.resourceId)){
    try{const resource=this.store.get(dep.id);const directory=this.store.directory(resource),scopeRoot=directory.slice(0,-resource.relativePath.length).replace(/\/$/,'');const path=ownedPath(scopeRoot,resource.relativePath);projectionBytes=projectionBytes===null?null:projectionBytes+bytes(path,measured);reasons.add(resource.pathScope==='H'?'共享发现目录仍保留此版本':'派生资源或其他依赖仍保留此版本');}catch{projectionBytes=null;reasons.add('派生资源保留原因待核查');}
   }
   let graph:ResourceGcPlan|undefined;try{graph=gcPlans(row.resourceId);if(graph.issues.length)reasons.add('资源依赖与保留依据待核查');}catch{reasons.add('资源依赖与保留依据待核查');}
   const canCleanup=state==='ready'&&integrity==='valid'&&reasons.size===0&&graph?.canCollect===true;
   return{appId,version:row.version,packageHash:row.hash,resourceId:row.resourceId,state,publication,defaultForNewSessions:isDefault,sessionRefCount,tombstoneRefCount,activeRunCount:runIds.size,references,sourceBytes,projectionBytes,reclaimableBytes:canCleanup?sourceBytes:0,integrity,compatibility,retentionReasons:[...reasons],issues,canCleanup,planHash:digest(canonicalJson({resourceId:row.resourceId,generation,proof:this.proof(row.resourceId,appId,unresolved,graph?.planHash)})),cleanupRecovery:state==='deleting'?this.cleanupPreview(row.resourceId,row.hash):undefined,cleanupGraph:graph?{planHash:graph.planHash,deleteOrder:graph.deleteOrder,retained:graph.retained,issues:graph.issues,requiresSharedCoordinator:graph.resources.some(r=>r.pathScope==='H')}:undefined};
  });
  return{appId,items,checkedAt:new Date().toISOString(),recoveryPending:(db.prepare("SELECT count(*) AS n FROM capability_resource_operations WHERE kind='cleanup-application' AND owner_store_id=? AND state NOT IN ('committed','canceled')").get(this.store.storeId) as {n:number}).n};
 }
 async list(appId:ApplicationId):Promise<ApplicationVersions>{applicationIdSchema.parse(appId);const result=await withResourceLock(this.store.root,()=>this.inventory(appId));if(!this.graph)return result;
  for(const item of result.items)try{
   if(item.state==='deleting'){const recovery=await this.graph.previewCancel(item.resourceId);if(recovery)item.cleanupRecovery=recovery;continue;}
   if(item.state!=='ready')continue;
   const {plan,bytes}=await this.graph.inspect(item.resourceId);item.planHash=plan.planHash;item.cleanupGraph={planHash:plan.planHash,deleteOrder:plan.deleteOrder,retained:plan.retained,issues:plan.issues,requiresSharedCoordinator:plan.resources.some(r=>r.pathScope==='H')};
   if(plan.canCollect)item.retentionReasons=item.retentionReasons.filter(reason=>!['共享发现目录仍保留此版本','派生资源或其他依赖仍保留此版本'].includes(reason));
   item.canCleanup=plan.canCollect&&item.integrity==='valid'&&item.retentionReasons.length===0;item.reclaimableBytes=item.canCleanup?bytes:0;
  }catch{item.canCleanup=false;item.reclaimableBytes=0;item.issues.push('资源图完整性或共享协调待核查');if(item.state==='deleting'&&item.cleanupRecovery)item.cleanupRecovery={...item.cleanupRecovery,canCancel:false,issueCode:'RESOURCE_RECOVERY_REQUIRED'};}
  result.recoveryPending+=await withResourceLock(this.store.root,()=>(this.store.sqlite.prepare("SELECT count(*) AS n FROM capability_resource_operations WHERE kind='cleanup-graph' AND owner_store_id=? AND state NOT IN ('committed','canceled')").get(this.store.storeId) as {n:number}).n);return result;
 }
 private phase(id:string,state:string){this.store.sqlite.prepare('UPDATE capability_resource_operations SET state=?,updated_at=? WHERE operation_id=? AND owner_store_id=?').run(state,new Date().toISOString(),id,this.store.storeId);}
 private mayControl(owner:Plan['owner'],instanceId:string):boolean{
  if(owner.pid===process.pid&&instanceId===this.store.instanceId){const current=this.processes.read(process.pid);if(current?.startedAt===owner.startedAt&&this.processes.state(owner)==='running')return true;}
  return this.processes.state(owner)==='stopped';
 }
 private cancelOwners(intent:CancelPlan){return[{owner:intent.owner,instanceId:intent.instanceId},...(intent.resumers??[])];}
 private mayControlCancel(intent:CancelPlan){return this.cancelOwners(intent).every(info=>this.mayControl(info.owner,info.instanceId));}
 private claimCancellation(id:string,intent:CancelPlan):CancelPlan{
  const owner=this.processes.read(process.pid);if(!owner||owner.pid!==process.pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验本次恢复进程身份');
  const owners=this.cancelOwners(intent),last=owners.at(-1)!;
  if(last.owner.pid===owner.pid&&last.owner.startedAt===owner.startedAt&&last.instanceId===this.store.instanceId&&this.processes.state(owner)==='running')return intent;
  if(!owners.every(info=>this.processes.state(info.owner)==='stopped'))throw new ApplicationError('RESOURCE_BUSY','原取消或恢复进程尚未确认退出');
  const next=cancelPlanSchema.parse({...intent,resumers:[...(intent.resumers??[]),{owner,instanceId:this.store.instanceId}]});
  const changed=this.store.sqlite.prepare("UPDATE capability_resource_operations SET plan_json=?,updated_at=? WHERE operation_id=? AND owner_store_id=? AND kind='cancel-cleanup-application' AND state<>'committed' AND plan_json=?").run(canonicalJson(next),new Date().toISOString(),id,this.store.storeId,canonicalJson(intent));if(changed.changes!==1)throw new ApplicationError('RESOURCE_STATE_CHANGED','原取消恢复者记录已变化');this.checkpoint?.('cancel-owner');return next;
 }
 private cancelRecords(cleanupOperationId:string){
  const rows=this.store.sqlite.prepare("SELECT operation_id,plan_json,state FROM capability_resource_operations WHERE kind='cancel-cleanup-application' AND owner_store_id=? ORDER BY created_at").all(this.store.storeId) as {operation_id:string;plan_json:string;state:string}[];
  const matches=rows.map(row=>({...row,plan:cancelPlanSchema.parse(JSON.parse(row.plan_json))})).filter(row=>row.plan.cleanupOperationId===cleanupOperationId);if(matches.length>1)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理存在重复取消意图，保留现场');return matches[0];
 }
 private assertNoConsumers(plan:Plan){
  if(this.metadata().unresolved.length)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','历史资源仍待核查');
  const ids=this.store.sqlite.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT id FROM consumers`).all(plan.resourceId) as {id:string}[];
  for(const {id} of ids)if(this.store.sqlite.prepare("SELECT 1 FROM capability_session_refs WHERE ref_id=? UNION ALL SELECT 1 FROM capability_resource_leases WHERE resource_id=? AND state<>'released' LIMIT 1").get(id,id))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理资源出现新的保留依据');
  if(ids.length!==1||this.store.sqlite.prepare('SELECT 1 FROM capability_active_packages WHERE package_hash=?').get(plan.packageHash))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原版本仍被依赖或默认选择');
 }
 private completeSource(operationId:string,plan:Plan){
  const row=this.store.get(plan.resourceId),installed=this.packages.get(plan.packageHash);
  if(plan.storeId!==this.store.storeId||row.ownerStoreId!==this.store.storeId||row.pathScope!=='C'||row.kind!=='application-package'||row.state!=='deleting'||row.operationId!==operationId||row.generation!==plan.generation||row.relativePath!==plan.relativePath||row.contentHash!==plan.packageHash||installed.resourceId!==row.resourceId||installed.relativePath!==plan.relativePath)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理计划与资源身份不符');
  const target=join(this.store.root,plan.relativePath),trashRelative='trash/'+operationId,trash=join(this.store.root,trashRelative),payload=join(trash,'payload');
  if(present(trash)){ownedPath(this.store.root,trashRelative);const marker=join(trash,'owner.json'),expected=canonicalJson({schema:1,operationId,storeId:this.store.storeId,planHash:digest(canonicalJson(plan))})+'\n';if(!present(marker)||lstatSync(marker).isSymbolicLink()||readFileSync(marker,'utf8')!==expected||readdirSync(trash).some(n=>!['owner.json','payload'].includes(n)))throw new ApplicationError('OWNERSHIP_CONFLICT','清理暂存区归属不符');}
  const source=present(payload)?payload:target;if(present(payload)&&present(target))throw new ApplicationError('OWNERSHIP_CONFLICT','原路径被其他目录占用，保留双方内容');
  if(!present(source))throw new ApplicationError('HASH_MISMATCH','原版本已部分或全部清理，不能直接恢复为可用');
  if(source===target)ownedPath(this.store.root,plan.relativePath);else ownedPath(this.store.root,trashRelative+'/payload');
  this.verifyRemainder(source,plan,false);verifyPackageTree(source,installed,this.store.storeId);
  if(source===payload){ownedPath(this.store.root,dirname(plan.relativePath));if(!this.restoreDirectory)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原目录完整恢复入口尚未验证');}
  return{source,target,payload,trashRelative};
 }
 private cleanupPreview(resourceId:string,packageHash:string){
  const resource=this.store.get(resourceId),row=this.store.sqlite.prepare("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE operation_id=? AND kind='cleanup-application' AND owner_store_id=?").get(resource.operationId,this.store.storeId) as {operation_id:string;state:string;plan_json:string}|undefined;
  if(!row)return{operationId:resource.operationId!,planHash:digest('unknown-cleanup'),state:'unverified',canCancel:false,issueCode:'RESOURCE_RECOVERY_REQUIRED'};
  let planHash=digest(row.plan_json),issueCode:string|null=null;
  try{const plan=planSchema.parse(JSON.parse(row.plan_json));planHash=digest(canonicalJson(plan));if(plan.packageHash!==packageHash||plan.resourceId!==resourceId)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理身份不符');if(row.state==='canceling'){const cancel=this.cancelRecords(row.operation_id);if(!cancel||cancel.state==='committed')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图待核查');if(!this.mayControlCancel(cancel.plan))throw new ApplicationError('RESOURCE_BUSY','原取消进程尚未确认退出');}if(!this.mayControl(plan.owner,plan.instanceId))throw new ApplicationError('RESOURCE_BUSY','原清理进程尚未确认退出');this.assertNoConsumers(plan);this.completeSource(row.operation_id,plan);}catch(error){issueCode=error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED';}
  return{operationId:row.operation_id,planHash,state:row.state,canCancel:issueCode===null,issueCode};
 }
 async cancelCleanup(input:ApplicationCleanupCancel):Promise<ApplicationCleanupCanceled>{
  const value=cancelInput.parse(input);
  if(this.graph){const operation=await withResourceLock(this.store.root,()=>this.store.sqlite.prepare('SELECT kind FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(value.operationId,this.store.storeId) as {kind:string}|undefined);if(operation?.kind==='cleanup-graph'){const pkg=this.packages.get(value.packageHash);if(pkg.appId!==value.appId)throw new ApplicationError('RESOURCE_STATE_CHANGED','原清理应用身份不同');const result=await this.graph.cancel(value.operationId,value.planHash,pkg.resourceId);if(!result.cancelOperationId)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消收据缺失');return{packageHash:value.packageHash,operationId:value.operationId,cancelOperationId:result.cancelOperationId,state:'canceled'};}}
  return withResourceLock(this.store.root,()=>{
   const row=this.store.sqlite.prepare("SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=? AND kind='cleanup-application' AND owner_store_id=?").get(value.operationId,this.store.storeId) as {state:string;plan_json:string}|undefined;
   if(!row)throw new ApplicationError('NOT_FOUND','原清理操作不存在');const plan=planSchema.parse(JSON.parse(row.plan_json));
   if(plan.packageHash!==value.packageHash||this.packages.get(plan.packageHash).appId!==value.appId||digest(canonicalJson(plan))!==value.planHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','原清理计划已变化，请重新核对');
   const prior=this.cancelRecords(value.operationId);
   if(row.state==='canceled'&&prior?.state==='committed')return{packageHash:plan.packageHash,operationId:value.operationId,cancelOperationId:prior.operation_id,state:'canceled'};
   if((prior&&row.state!=='canceling')||(!prior&&row.state==='canceling'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图与清理状态不符');
   if(['committed','canceled'].includes(row.state))throw new ApplicationError('RESOURCE_STATE_CHANGED','本次清理已经结束，不能再次取消');
   if(!this.mayControl(plan.owner,plan.instanceId))throw new ApplicationError('RESOURCE_BUSY','原清理进程尚未确认退出');this.assertNoConsumers(plan);this.completeSource(value.operationId,plan);
   if(prior){if(!this.mayControlCancel(prior.plan))throw new ApplicationError('RESOURCE_BUSY','原取消进程尚未确认退出');return this.finishCancel(value.operationId,plan,prior.operation_id,this.claimCancellation(prior.operation_id,prior.plan));}
   const owner=this.processes.read(process.pid);if(!owner||owner.pid!==process.pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验本次取消进程身份');
   const cancelOperationId=randomUUID(),intent=cancelPlanSchema.parse({schema:1,storeId:this.store.storeId,cleanupOperationId:value.operationId,cleanupPlanHash:value.planHash,owner,instanceId:this.store.instanceId}),now=new Date().toISOString();
   this.store.sqlite.transaction(()=>{this.assertNoConsumers(plan);this.store.sqlite.prepare("INSERT INTO capability_resource_operations VALUES(?,'cancel-cleanup-application',?,'preparing',?,NULL,?,?)").run(cancelOperationId,this.store.storeId,canonicalJson(intent),now,now);this.phase(value.operationId,'canceling');}).immediate();this.checkpoint?.('cancel-intent');return this.finishCancel(value.operationId,plan,cancelOperationId,intent);
  });
 }
 private finishCancel(operationId:string,plan:Plan,cancelOperationId:string,intent:CancelPlan):ApplicationCleanupCanceled{
  if(intent.storeId!==this.store.storeId||intent.cleanupOperationId!==operationId||intent.cleanupPlanHash!==digest(canonicalJson(plan)))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图与清理计划不符');
  this.assertNoConsumers(plan);const source=this.completeSource(operationId,plan);
  if(source.source===source.payload){this.restoreDirectory!({root:this.store.root,from:source.trashRelative+'/payload',to:plan.relativePath,rootIdentity:identity(this.store.root),sourceIdentity:plan.directory});durable(dirname(source.target));durable(dirname(source.payload));}
  this.verifyRemainder(ownedPath(this.store.root,plan.relativePath),plan,false);verifyPackageTree(source.target,this.packages.get(plan.packageHash),this.store.storeId);this.checkpoint?.('cancel-restored');
  this.store.sqlite.transaction(()=>{this.assertNoConsumers(plan);const row=this.store.get(plan.resourceId);if(row.state!=='deleting'||row.operationId!==operationId||row.generation!==plan.generation)throw new ApplicationError('RESOURCE_STATE_CHANGED','原清理资源已变化');this.store.sqlite.prepare("UPDATE capability_resources SET state='ready',integrity='valid',generation=generation+1,operation_id=? WHERE resource_id=?").run(cancelOperationId,plan.resourceId);this.phase(operationId,'canceled');this.phase(cancelOperationId,'committed');}).immediate();this.checkpoint?.('cancel-committed');
  return{packageHash:plan.packageHash,operationId,cancelOperationId,state:'canceled'};
 }
 async cleanup(input:ApplicationVersionCleanup,waiting?:CleanupWaitControl):Promise<ApplicationVersionCleanupResult>{
  const value=cleanupInput.parse(input);
  if(this.graph){const installed=this.packages.get(value.packageHash);if(installed.appId!==value.appId)throw new ApplicationError('RESOURCE_STATE_CHANGED','清理应用身份不同');const result=await this.graph.cleanup(installed.resourceId,value.planHash,waiting);if(result.state!=='removed')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原资源图未完成删除');return{packageHash:value.packageHash,operationId:result.operationId,state:'removed',removedFileBytes:result.removedFileBytes};}
  return withResourceLock(this.store.root,()=>{
   waiting?.onExecuting();
   const usage=this.inventory(value.appId).items.find(i=>i.packageHash===value.packageHash);
   if(!usage)throw new ApplicationError('NOT_FOUND','本机没有该应用版本');
   if(usage.planHash!==value.planHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','版本占用已变化，请重新检查清理计划');
   if(!usage.canCleanup)throw new ApplicationError('RESOURCE_BUSY','版本仍有保留依据或待核查项，不能常规清理');
   const owner=this.processes.read(process.pid);if(!owner||owner.pid!==process.pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验清理宿主进程身份');
   const installed=this.packages.get(value.packageHash),resource=this.store.get(installed.resourceId),path=ownedPath(this.store.root,resource.relativePath);verifyPackageTree(path,installed,this.store.storeId);
   const files=fileNames(path).map(name=>{const p=join(path,name),st=lstatSync(p);if(st.nlink!==1)throw new ApplicationError('OWNERSHIP_CONFLICT','版本目录含共享文件，保留现场');return{path:name,dev:st.dev,ino:st.ino,size:st.size,hash:digest(readFileSync(p))};});
   const plan=planSchema.parse({schema:1,storeId:this.store.storeId,resourceId:resource.resourceId,packageHash:value.packageHash,relativePath:resource.relativePath,generation:resource.generation+1,owner,instanceId:this.store.instanceId,directory:identity(path),files});
   const operationId=randomUUID(),now=new Date().toISOString();
   this.store.sqlite.transaction(()=>{
    const latest=this.metadata(),fresh=this.store.get(plan.resourceId);if(latest.unresolved.length||fresh.state!=='ready'||digest(canonicalJson({resourceId:plan.resourceId,generation:fresh.generation,proof:this.proof(plan.resourceId,value.appId,latest.unresolved)}))!==value.planHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','清理前原版本占用已变化');
    this.store.sqlite.prepare("INSERT INTO capability_resource_operations VALUES(?,'cleanup-application',?,'preparing',?,NULL,?,?)").run(operationId,this.store.storeId,canonicalJson(plan),now,now);
    this.store.sqlite.prepare("UPDATE capability_resources SET state='deleting',generation=?,operation_id=? WHERE resource_id=? AND state='ready'").run(plan.generation,operationId,plan.resourceId);
   }).immediate();
   this.checkpoint?.('marked');return this.finish(operationId,plan);
  },waiting?.lockOptions());
 }
 private verifyRemainder(path:string,plan:Plan,partial:boolean){
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory()||st.dev!==plan.directory.dev||st.ino!==plan.directory.ino)throw new ApplicationError('OWNERSHIP_CONFLICT','原清理目录身份已改变，保留现场');
  const actual=fileNames(path),allowed=new Map(plan.files.map(f=>[f.path,f]));if(!partial&&actual.length!==plan.files.length)throw new ApplicationError('HASH_MISMATCH','原清理目录文件集合已改变');
  for(const name of actual){const expected=allowed.get(name),p=join(path,name),stat=lstatSync(p);if(!expected||stat.dev!==expected.dev||stat.ino!==expected.ino||stat.size!==expected.size||stat.nlink!==1||digest(readFileSync(p))!==expected.hash)throw new ApplicationError('OWNERSHIP_CONFLICT','原清理文件已被替换或修改，保留现场');}
 }
 private finish(operationId:string,plan:Plan):ApplicationVersionCleanupResult{
  const row=this.store.get(plan.resourceId);if(plan.storeId!==this.store.storeId||row.pathScope!=='C'||row.state!=='deleting'||row.operationId!==operationId||row.generation!==plan.generation||row.relativePath!==plan.relativePath||row.contentHash!==plan.packageHash)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理计划与资源账不符');
  const installed=this.packages.get(plan.packageHash);if(installed.resourceId!==plan.resourceId||installed.relativePath!==plan.relativePath||row.kind!=='application-package')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理版本登记身份不一致');
  const target=join(this.store.root,plan.relativePath),relative='trash/'+operationId,trash=ensureStoreDirectory(this.store.root,relative),payload=join(trash,'payload'),marker=join(trash,'owner.json');
  const receipt=canonicalJson({schema:1,operationId,storeId:this.store.storeId,planHash:digest(canonicalJson(plan))})+'\n';
  if(present(marker)){if(lstatSync(marker).isSymbolicLink()||readFileSync(marker,'utf8')!==receipt)throw new ApplicationError('OWNERSHIP_CONFLICT','清理暂存区归属不符');}else{if(readdirSync(trash).length)throw new ApplicationError('OWNERSHIP_CONFLICT','清理暂存区含未知内容');writeFileSync(marker,receipt,{flag:'wx',mode:0o600});durable(marker);durable(trash);}
  if(present(target)){
   if(present(payload))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原目录与清理暂存同时存在，保留现场');
   ownedPath(this.store.root,plan.relativePath);this.verifyRemainder(target,plan,false);renameSync(target,payload);durable(dirname(target));durable(trash);this.phase(operationId,'renamed');this.checkpoint?.('renamed');
  }
  const operation=this.store.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=?').get(operationId) as {state:string};
  if(present(payload)){this.verifyRemainder(payload,plan,operation.state==='deleting');this.phase(operationId,'deleting');this.checkpoint?.('deleting');rmSync(payload,{recursive:true});durable(trash);}
  else if(!['deleting','removed'].includes(operation.state))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','清理目录缺失且没有删除依据');
  this.phase(operationId,'removed');this.checkpoint?.('removed');
  this.store.sqlite.transaction(()=>{this.store.sqlite.prepare("UPDATE capability_resources SET state='removed',integrity='unknown',generation=generation+1 WHERE resource_id=? AND operation_id=? AND state='deleting'").run(plan.resourceId,operationId);this.phase(operationId,'committed');}).immediate();
  // Keep the tiny durable receipt; no business data, dependencies, or history rows are deleted.
  return{packageHash:plan.packageHash,operationId,state:'removed',removedFileBytes:plan.files.reduce((n,f)=>n+f.size,0)};
 }
 async recover():Promise<{recovered:string[];pending:string[]}>{
  const graph=this.graph?await this.graph.recover():{recovered:[] as string[],pending:[] as string[]};return withResourceLock(this.store.root,()=>{
   const rows=this.store.sqlite.prepare("SELECT operation_id,plan_json,state FROM capability_resource_operations WHERE kind='cleanup-application' AND owner_store_id=? AND state NOT IN ('committed','canceled') ORDER BY created_at").all(this.store.storeId) as {operation_id:string;plan_json:string;state:string}[];
   const result={recovered:[...graph.recovered],pending:[...graph.pending]};
   for(const row of rows)try{
    z.uuid().parse(row.operation_id);const plan=planSchema.parse(JSON.parse(row.plan_json));
    if(plan.storeId!==this.store.storeId||this.processes.state(plan.owner)!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原清理进程尚未确认退出');
    const cancel=this.cancelRecords(row.operation_id);if((row.state==='canceling')!==Boolean(cancel)||cancel?.state==='committed')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图与清理状态不符');if(cancel){if(!this.cancelOwners(cancel.plan).every(info=>this.processes.state(info.owner)==='stopped'))throw new ApplicationError('RESOURCE_BUSY','原取消进程尚未确认退出');this.finishCancel(row.operation_id,plan,cancel.operation_id,this.claimCancellation(cancel.operation_id,cancel.plan));result.recovered.push(row.operation_id);continue;}
    if(this.metadata().unresolved.length)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','历史资源仍待核查');
    // New consumers cannot lease a deleting resource; do not release or guess old leases.
    const ids=this.store.sqlite.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT id FROM consumers`).all(plan.resourceId) as {id:string}[];
    for(const id of ids)if(this.store.sqlite.prepare("SELECT 1 FROM capability_session_refs WHERE ref_id=? UNION ALL SELECT 1 FROM capability_resource_leases WHERE resource_id=? AND state<>'released' LIMIT 1").get(id.id,id.id))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理资源出现新的保留依据');
    if(ids.length!==1||this.store.sqlite.prepare('SELECT 1 FROM capability_active_packages WHERE package_hash=?').get(plan.packageHash))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理版本仍被依赖或默认选择');
    this.finish(row.operation_id,plan);result.recovered.push(row.operation_id);
   }catch{result.pending.push(row.operation_id);}
   return result;
  });
 }
}
