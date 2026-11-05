import {randomUUID} from 'node:crypto';
import {closeSync,constants,fsyncSync,lstatSync,openSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {ApplicationError,isPackagePath} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import {resourceGcPlan,type ResourceGcPlan} from './resource-gc-plan';
import {captureGcTree,gcIdentity,gcPath,gcPresent,gcTreeSchema,verifyGcTree} from './resource-gc-tree';
import {ensureStoreDirectory} from './package-files';
import {withResourceLock} from './resource-lock';
import type {ResourceStore} from './resource-store';
import type {ProcessIdentityReader} from './process-identity';
import type {DirectoryRestorer} from './restore-owned-directory';
import {CapabilitySessionRegistry} from './session-registry';
import type {CleanupWaitControl} from './maintenance-waits';
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.uuid();
const owner=z.object({pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/)}).strict();
const resource=z.object({resourceId:z.string(),kind:z.string(),contentHash:hash,ownerStoreId:uuid,relativePath:z.string().refine(isPackagePath),pathScope:z.enum(['C','H']),scopeIdentity:z.string(),state:z.literal('ready'),generation:z.number().int().positive(),integrity:z.literal('valid'),operationId:z.string().nullable()}).strict();
const node=z.object({childId:uuid,resource,tree:gcTreeSchema,trashRelative:z.string().refine(isPackagePath)}).strict();
const planSchema=z.object({schema:z.literal(1),operationId:uuid,storeId:uuid,rootResourceId:z.string(),graphPlanHash:hash,owner,instanceId:uuid,nodes:z.array(node).min(1).max(16384),catalogs:z.array(z.object({home:z.string(),snapshot:z.unknown()}).strict()).max(64)}).strict();
type Plan=z.infer<typeof planSchema>;
type Node=z.infer<typeof node>;
export type GraphCleanupCheckpoint='intent'|'marked'|'moved'|'catalog'|'deleting'|'removed'|'claimed'|'cancel-intent'|'restored'|'canceled'|'committed';
export interface GraphCleanupResult {operationId:string;rootResourceId:string;state:'removed'|'canceled';resourceIds:string[];removedFileBytes:number;cancelOperationId?:string}
const terminal=new Set(['committed','canceled']);
const stamp=()=>new Date().toISOString();
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
function durable(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}

/** H roots in canonical order -> C -> short SQLite transactions. All node states
 * become deleting in one transaction before the first directory can move. */
export class ResourceGraphMaintenance {
 constructor(private readonly store:ResourceStore,private readonly processes:ProcessIdentityReader,private readonly move:DirectoryRestorer,private readonly checkpoint?:(phase:GraphCleanupCheckpoint,resourceId?:string)=>void){}
 /** C only (R1.0): the shared discovery catalog is gone. A pre-R1.0 operation that still names one stays pending. */
 private async coordinate<T>(input:string|Plan,work:()=>T,waiting?:CleanupWaitControl):Promise<T>{
  if(typeof input!=='string'&&input.catalogs.length)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','R1.0 前涉及共享发现目录的清理保留现场');
  return withResourceLock(this.store.root,()=>{waiting?.onExecuting();return work();},waiting?.lockOptions());
 }
 plan(rootResourceId:string):Promise<ResourceGcPlan>{return this.coordinate(rootResourceId,()=>resourceGcPlan(this.store,rootResourceId));}
 inspect(rootResourceId:string):Promise<{plan:ResourceGcPlan;bytes:number}>{return this.coordinate(rootResourceId,()=>{const plan=resourceGcPlan(this.store,rootResourceId);let bytes=0;if(plan.canCollect)for(const id of plan.deleteOrder)bytes+=captureGcTree(this.store,plan.resources.find(r=>r.resourceId===id)!).entries.reduce((sum,e)=>sum+(e.size??0),0);return{plan,bytes};});}
 private host(){const current=this.processes.read(process.pid);if(!current||current.pid!==process.pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','清理执行者内核身份无法核验');return owner.parse(current);}
 private mayControl(identity:z.infer<typeof owner>,instanceId:string){const current=this.processes.read(process.pid);return this.processes.state(identity)==='stopped'||instanceId===this.store.instanceId&&identity.pid===process.pid&&current?.startedAt===identity.startedAt&&this.processes.state(identity)==='running';}
 private phase(id:string,state:string){this.store.sqlite.prepare('UPDATE capability_resource_operations SET state=?,updated_at=? WHERE operation_id=? AND owner_store_id=?').run(state,stamp(),id,this.store.storeId);}
 private state(id:string){return this.store.sqlite.prepare('SELECT state,kind,plan_json FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(id,this.store.storeId) as {state:string;kind:string;plan_json:string}|undefined;}
 async cleanup(rootResourceId:string,expectedPlanHash:string,waiting?:CleanupWaitControl):Promise<GraphCleanupResult>{return this.coordinate(rootResourceId,()=>{
  const proposal=resourceGcPlan(this.store,rootResourceId);if(proposal.planHash!==expectedPlanHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','资源图或占用已变化，请重新检查清理计划');if(!proposal.canCollect)throw new ApplicationError('RESOURCE_BUSY','资源图仍有保留依据');
  const operationId=randomUUID(),nodes=proposal.deleteOrder.map(id=>{const r=proposal.resources.find(r=>r.resourceId===id)!;return{childId:randomUUID(),resource:r,tree:captureGcTree(this.store,r),trashRelative:(r.pathScope==='H'?'.agents/smartdd-runtime/':'')+'trash/'+operationId+'/'+digest(id)};});
  const physical=nodes.map(n=>join(n.tree.anchor,n.resource.relativePath));if(physical.some((path,i)=>physical.some((other,j)=>i!==j&&(path===other||path.startsWith(other+'/')))))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','清理图含重叠物理目录，须先核对专用交付协调器');
  if(nodes.some(n=>n.resource.pathScope!=='C'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','清理图含共享目录资源，保留现场');
  const plan=planSchema.parse({schema:1,operationId,storeId:this.store.storeId,rootResourceId,graphPlanHash:proposal.planHash,owner:this.host(),instanceId:this.store.instanceId,nodes,catalogs:[]});
   this.checkpoint?.('intent');
   this.store.sqlite.transaction(()=>{const fresh=resourceGcPlan(this.store,rootResourceId);if(!fresh.canCollect||fresh.planHash!==expectedPlanHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','最终写事务的引用或资源图已变化');
    const insert=this.store.sqlite.prepare('INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'),now=stamp();insert.run(operationId,'cleanup-graph',this.store.storeId,'preparing',canonicalJson(plan),now,now);
    for(const n of plan.nodes){insert.run(n.childId,'cleanup-graph-node',this.store.storeId,'marked',canonicalJson({parent:operationId,planHash:digest(canonicalJson(plan)),resourceId:n.resource.resourceId}),now,now);const update=this.store.sqlite.prepare("UPDATE capability_resources SET state='deleting',generation=generation+1,operation_id=? WHERE resource_id=? AND owner_store_id=? AND state='ready' AND integrity='valid' AND generation=?").run(operationId,n.resource.resourceId,this.store.storeId,n.resource.generation);if(update.changes!==1)throw new ApplicationError('RESOURCE_STATE_CHANGED','最终清理资源已变化');}
   }).immediate();
  this.checkpoint?.('marked');return this.finish(plan);
 },waiting);}
 private load(operationId:string):Plan{uuid.parse(operationId);const row=this.state(operationId);if(!row||row.kind!=='cleanup-graph')throw new ApplicationError('NOT_FOUND','原资源图清理操作不存在');const plan=planSchema.parse(JSON.parse(row.plan_json));if(plan.operationId!==operationId||plan.storeId!==this.store.storeId||new Set(plan.nodes.map(n=>n.resource.resourceId)).size!==plan.nodes.length||new Set(plan.nodes.map(n=>n.childId)).size!==plan.nodes.length||!plan.nodes.some(n=>n.resource.resourceId===plan.rootResourceId)||plan.nodes.some(n=>n.resource.ownerStoreId!==this.store.storeId))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理计划身份不同');return plan;}
 private child(plan:Plan,n:Node){const row=this.state(n.childId);if(!row||row.kind!=='cleanup-graph-node'||!same(JSON.parse(row.plan_json),{parent:plan.operationId,planHash:digest(canonicalJson(plan)),resourceId:n.resource.resourceId}))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理条目进度或身份缺失');return row.state;}
 private assertRows(plan:Plan){
  const ids=plan.nodes.map(n=>n.resource.resourceId),marks=ids.map(()=>'?').join(','),db=this.store.sqlite;
  if(db.prepare(`SELECT 1 FROM capability_session_refs WHERE ref_id IN (${marks}) UNION ALL SELECT 1 FROM capability_resource_leases WHERE resource_id IN (${marks}) AND state<>'released' LIMIT 1`).get(...ids,...ids)||db.prepare(`SELECT 1 FROM capability_active_packages a JOIN capability_packages p ON p.package_hash=a.package_hash WHERE p.resource_id IN (${marks}) LIMIT 1`).get(...ids)||db.prepare(`SELECT 1 FROM capability_resource_dependencies d JOIN capability_resources r ON r.resource_id=d.resource_id WHERE d.dependency_id IN (${marks}) AND d.resource_id NOT IN (${marks}) AND r.state<>'removed' LIMIT 1`).get(...ids,...ids))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理图出现新的引用或消费者');
  const sessions=new CapabilitySessionRegistry(this.store,{assertInitialSelection:()=>{throw Error('read-only');},verifyExtraResource:()=>{throw Error('read-only');}}),snapshots=db.prepare('SELECT task_id FROM capability_session_snapshots').all() as {task_id:string}[];
  if(db.prepare("SELECT 1 FROM tasks WHERE (native_session_id IS NOT NULL OR runtime_snapshot IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM capability_session_snapshots s WHERE s.task_id=tasks.id) LIMIT 1").get())throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','出现未映射的原生历史，保留清理现场');
  for(const s of snapshots)if(sessions.inspectCoordinated(s.task_id).retention==='hold')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原生历史尚待核查');
  for(const n of plan.nodes){const current=this.store.get(n.resource.resourceId),state=this.child(plan,n),removed=state==='removed';if(!same({...current,state:'ready',generation:n.resource.generation,integrity:'valid',operationId:n.resource.operationId},n.resource)||current.state!==(removed?'removed':'deleting')||current.integrity!==(removed?'unknown':'valid')||current.generation!==n.resource.generation+(removed?2:1)||current.operationId!==plan.operationId)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理资源身份或代次已变化');}
 }
 private trash(plan:Plan,n:Node,create=true){
  if(!same(gcIdentity(n.tree.anchor),n.tree.anchorIdentity))throw new ApplicationError('OWNERSHIP_CONFLICT','原清理根inode或权限已变化');
  const expected=(n.resource.pathScope==='H'?'.agents/smartdd-runtime/':'')+'trash/'+plan.operationId+'/'+digest(n.resource.resourceId);if(n.trashRelative!==expected)throw new ApplicationError('OWNERSHIP_CONFLICT','原清理暂存路径不同');
  const existing=join(n.tree.anchor,n.trashRelative);if(!create&&!gcPresent(existing))return{dir:existing,payload:join(existing,'payload'),target:join(n.tree.anchor,n.resource.relativePath)};
  const dir=create?ensureStoreDirectory(n.tree.anchor,n.trashRelative):gcPath(n.tree.anchor,n.trashRelative),marker=join(dir,'owner.json'),receipt=canonicalJson({schema:1,operationId:plan.operationId,planHash:digest(canonicalJson(plan)),resourceId:n.resource.resourceId})+'\n';
  if(gcPresent(marker)){const s=lstatSync(marker);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>4096||readFileSync(marker,'utf8')!==receipt)throw new ApplicationError('OWNERSHIP_CONFLICT','原清理暂存归属不同');}
  else{if(!create||readdirSync(dir).length)throw new ApplicationError('OWNERSHIP_CONFLICT','清理暂存包含未知内容或缺少原收据');writeFileSync(marker,receipt,{flag:'wx',mode:0o600});durable(marker);durable(dir);}
  if(readdirSync(dir).some(name=>!['owner.json','payload'].includes(name)))throw new ApplicationError('OWNERSHIP_CONFLICT','清理暂存有未知条目');return{dir,payload:join(dir,'payload'),target:join(n.tree.anchor,n.resource.relativePath)};
 }
 private transfer(n:Node,from:string,to:string){this.move({root:n.tree.anchor,from,to,rootIdentity:n.tree.anchorIdentity,sourceIdentity:n.tree.directory,scope:n.resource.pathScope});}
 private finish(plan:Plan):GraphCleanupResult{
  this.assertRows(plan);const main=this.state(plan.operationId)!;
  if(main.state==='canceling')return this.finishCancel(plan);
  if(terminal.has(main.state))throw new ApplicationError('RESOURCE_STATE_CHANGED','原清理已经结束');
  for(const n of plan.nodes){const state=this.child(plan,n),p=this.trash(plan,n);if(state==='removed'){if(gcPresent(p.target)||gcPresent(p.payload))throw new ApplicationError('OWNERSHIP_CONFLICT','已清理条目重新出现，保留现场');continue;}
   if(gcPresent(p.target)){if(state!=='marked'||gcPresent(p.payload))throw new ApplicationError('OWNERSHIP_CONFLICT','原路径被占用或出现两个副本');gcPath(n.tree.anchor,n.resource.relativePath);verifyGcTree(p.target,n.tree);this.transfer(n,n.resource.relativePath,n.trashRelative+'/payload');durable(dirname(p.target));durable(p.dir);this.phase(n.childId,'moved');this.checkpoint?.('moved',n.resource.resourceId);}
   else if(gcPresent(p.payload)){gcPath(n.tree.anchor,n.trashRelative+'/payload');verifyGcTree(p.payload,n.tree,state==='deleting');if(state==='marked')this.phase(n.childId,'moved');}
   else if(state!=='deleting')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','缺少完整源或已删除依据');
  }
  this.phase(plan.operationId,'quarantined');this.checkpoint?.('catalog');
  for(const n of plan.nodes){if(this.child(plan,n)==='removed')continue;this.assertRows(plan);const p=this.trash(plan,n);if(gcPresent(p.target))throw new ApplicationError('OWNERSHIP_CONFLICT','原清理路径出现新内容');if(gcPresent(p.payload)){gcPath(n.tree.anchor,n.trashRelative+'/payload');verifyGcTree(p.payload,n.tree,this.child(plan,n)==='deleting');this.phase(n.childId,'deleting');this.checkpoint?.('deleting',n.resource.resourceId);rmSync(p.payload,{recursive:true});durable(p.dir);}else if(this.child(plan,n)!=='deleting')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','文件缺失但没有删除依据');if(gcPresent(p.payload))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','物理删除尚未完成');
   this.store.sqlite.transaction(()=>{this.assertRows(plan);this.store.sqlite.prepare("UPDATE capability_resources SET state='removed',integrity='unknown',generation=generation+1 WHERE resource_id=? AND operation_id=? AND state='deleting'").run(n.resource.resourceId,plan.operationId);this.phase(n.childId,'removed');}).immediate();this.checkpoint?.('removed',n.resource.resourceId);
  }
  this.phase(plan.operationId,'committed');this.checkpoint?.('committed');return this.result(plan,'removed');
 }
 private result(plan:Plan,state:'removed'|'canceled'):GraphCleanupResult{return{operationId:plan.operationId,rootResourceId:plan.rootResourceId,state,resourceIds:plan.nodes.map(n=>n.resource.resourceId),removedFileBytes:state==='removed'?plan.nodes.reduce((sum,n)=>sum+n.tree.entries.reduce((n,e)=>n+(e.size??0),0),0):0,...(state==='canceled'?{cancelOperationId:this.cancellation(plan)?.operation_id}:{})};}
 private claim(plan:Plan,write=true){
  const claims=this.store.sqlite.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='claim-cleanup-graph' AND owner_store_id=? ORDER BY created_at,operation_id").all(this.store.storeId) as {plan_json:string}[];
  const schema=z.object({parent:uuid,planHash:hash,owner,instanceId:uuid}).strict(),rows=claims.map(r=>schema.parse(JSON.parse(r.plan_json))).filter(r=>r.parent===plan.operationId);
  if(!this.mayControl(plan.owner,plan.instanceId)||rows.some(r=>r.planHash!==digest(canonicalJson(plan))||!this.mayControl(r.owner,r.instanceId)))throw new ApplicationError('RESOURCE_BUSY','原清理或恢复进程尚未确认退出');
  if(!write)return;
  const current=this.host();if(rows.some(r=>r.instanceId===this.store.instanceId&&same(r.owner,current)))return;
  const now=stamp();this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'claim-cleanup-graph',?,'claimed',?,?,?)").run(randomUUID(),this.store.storeId,canonicalJson({parent:plan.operationId,planHash:digest(canonicalJson(plan)),owner:current,instanceId:this.store.instanceId}),now,now);this.checkpoint?.('claimed');
 }
 private complete(plan:Plan){for(const n of plan.nodes){if(this.child(plan,n)==='removed')throw new ApplicationError('HASH_MISMATCH','清理图已有物理删除，不能恢复为可用');const p=this.trash(plan,n,false);if(gcPresent(p.target)&&gcPresent(p.payload))throw new ApplicationError('OWNERSHIP_CONFLICT','原路径已被其他目录占用');const source=gcPresent(p.payload)?p.payload:p.target;if(!gcPresent(source))throw new ApplicationError('HASH_MISMATCH','原资源已部分或全部清理');gcPath(n.tree.anchor,source===p.target?n.resource.relativePath:n.trashRelative+'/payload');verifyGcTree(source,n.tree);if(source===p.payload)gcPath(n.tree.anchor,dirname(n.resource.relativePath));}}
 async previewCancel(rootResourceId:string):Promise<{operationId:string;planHash:string;state:string;canCancel:boolean;issueCode:string|null}|null>{const resource=await withResourceLock(this.store.root,()=>this.store.get(rootResourceId)),row=resource.operationId?this.state(resource.operationId):null;if(!row||row.kind!=='cleanup-graph')return null;const plan=this.load(resource.operationId!);if(plan.rootResourceId!==rootResourceId)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理根身份不同');return this.coordinate(plan,()=>{let issueCode:string|null=null;try{this.assertRows(plan);this.claim(plan,false);this.complete(plan);if(row.state==='canceling'&&!this.cancellation(plan))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图缺失');}catch(e){issueCode=e instanceof ApplicationError?e.code:'RESOURCE_RECOVERY_REQUIRED';}return{operationId:plan.operationId,planHash:digest(canonicalJson(plan)),state:row.state,canCancel:issueCode===null,issueCode};});}
 private cancellation(plan:Plan){const schema=z.object({parent:uuid,planHash:hash,owner,instanceId:uuid}).strict(),rows=(this.store.sqlite.prepare("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='cancel-cleanup-graph' AND owner_store_id=?").all(this.store.storeId) as {operation_id:string;state:string;plan_json:string}[]).map(r=>({...r,plan:schema.parse(JSON.parse(r.plan_json))})).filter(r=>r.plan.parent===plan.operationId);if(rows.length>1||rows[0]&&rows[0].plan.planHash!==digest(canonicalJson(plan)))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原清理取消意图不唯一或身份不同');return rows[0];}
 async cancel(operationId:string,expectedPlanHash:string,expectedRoot?:string):Promise<GraphCleanupResult>{const plan=this.load(operationId);if(expectedPlanHash!==digest(canonicalJson(plan))||expectedRoot!==undefined&&expectedRoot!==plan.rootResourceId)throw new ApplicationError('RESOURCE_STATE_CHANGED','原清理计划或版本不同');return this.coordinate(plan,()=>{const state=this.state(operationId)?.state;if(state==='canceled'&&this.cancellation(plan)?.state==='committed')return this.result(plan,'canceled');if(state==='committed')throw new ApplicationError('RESOURCE_STATE_CHANGED','原清理已经完成');this.assertRows(plan);this.complete(plan);this.claim(plan);const prior=this.cancellation(plan);if(state==='canceling'&&!prior||state!=='canceling'&&prior)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图与清理状态不同');if(!prior)this.store.sqlite.transaction(()=>{const now=stamp();this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'cancel-cleanup-graph',?,'preparing',?,?,?)").run(randomUUID(),this.store.storeId,canonicalJson({parent:operationId,planHash:digest(canonicalJson(plan)),owner:this.host(),instanceId:this.store.instanceId}),now,now);this.phase(operationId,'canceling');}).immediate();this.checkpoint?.('cancel-intent');return this.finishCancel(plan);});}
 private finishCancel(plan:Plan):GraphCleanupResult{
  const cancellation=this.cancellation(plan);if(!cancellation||cancellation.state!=='preparing'||!this.mayControl(cancellation.plan.owner,cancellation.plan.instanceId))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原取消意图缺失或执行者尚未退出');
  this.complete(plan);for(const n of [...plan.nodes].reverse()){const p=this.trash(plan,n);if(gcPresent(p.payload)){this.transfer(n,n.trashRelative+'/payload',n.resource.relativePath);durable(p.dir);durable(dirname(p.target));}verifyGcTree(gcPath(n.tree.anchor,n.resource.relativePath),n.tree);this.checkpoint?.('restored',n.resource.resourceId);}
  this.store.sqlite.transaction(()=>{this.assertRows(plan);for(const n of plan.nodes){this.store.sqlite.prepare("UPDATE capability_resources SET state='ready',integrity='valid',generation=generation+1 WHERE resource_id=? AND operation_id=? AND state='deleting'").run(n.resource.resourceId,plan.operationId);this.phase(n.childId,'canceled');}this.phase(cancellation.operation_id,'committed');this.phase(plan.operationId,'canceled');}).immediate();this.checkpoint?.('canceled');return this.result(plan,'canceled');
 }
 async recover():Promise<{recovered:string[];pending:string[]}>{
  const rows=await withResourceLock(this.store.root,()=>this.store.sqlite.prepare("SELECT operation_id FROM capability_resource_operations WHERE kind='cleanup-graph' AND owner_store_id=? ORDER BY created_at").all(this.store.storeId) as {operation_id:string}[]),out={recovered:[] as string[],pending:[] as string[]};
  for(const row of rows)try{const plan=this.load(row.operation_id);if(terminal.has(this.state(plan.operationId)!.state))continue;await this.coordinate(plan,()=>{const state=this.state(plan.operationId)!.state;if(terminal.has(state))return;this.claim(plan);this.finish(plan);out.recovered.push(plan.operationId);});}catch{out.pending.push(row.operation_id);}
  return out;
 }
}
