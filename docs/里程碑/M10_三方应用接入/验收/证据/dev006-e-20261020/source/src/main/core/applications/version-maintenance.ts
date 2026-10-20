import {randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {ApplicationError,APP_HASH_PATTERN,isPackagePath} from '@shared/applications';
import {applicationIdSchema,type ApplicationId} from '@shared/application-connections';
import type {ApplicationVersionUsage,ApplicationVersions,ApplicationVersionCleanup,ApplicationVersionCleanupResult} from '@shared/application-maintenance';
import {assertHostCompatible,canonicalJson,digest} from './manifest';
import {ensureStoreDirectory,fileNames,verifyPackageTree} from './package-files';
import {PackageRegistry} from './package-registry';
import type {ProcessIdentityReader} from './process-identity';
import type {ResourceStore} from './resource-store';
import {withResourceLock} from './resource-lock';
import {CapabilitySessionRegistry} from './session-registry';
import {RuntimeRegistry} from './runtime-registry';
const hash=z.string().regex(APP_HASH_PATTERN),cleanupInput=z.object({appId:applicationIdSchema,packageHash:hash,planHash:hash}).strict();
const inode=z.object({dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative()}).strict();
const file=z.object({path:z.string().refine(isPackagePath),dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative(),size:z.number().int().nonnegative(),hash}).strict();
const planSchema=z.object({schema:z.literal(1),storeId:z.uuid(),resourceId:z.string(),packageHash:hash,relativePath:z.string().refine(isPackagePath),generation:z.number().int().positive(),owner:z.object({pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/)}).strict(),instanceId:z.uuid(),directory:inode,files:z.array(file).min(1)}).strict();
type Plan=z.infer<typeof planSchema>;
export type VersionCleanupCheckpoint='marked'|'renamed'|'deleting'|'removed';
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
 constructor(private readonly store:ResourceStore,private readonly processes:ProcessIdentityReader,private readonly checkpoint?:(phase:VersionCleanupCheckpoint)=>void){
  this.packages=new PackageRegistry(store,'maintenance-reader');this.sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw new Error('read only');},verifyExtraResource:()=>{throw new Error('read only');}});
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
 private proof(resourceId:string,appId:ApplicationId,unresolved:string[]):string{
  const db=this.store.sqlite,resources=db.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT r.* FROM capability_resources r JOIN consumers c ON c.id=r.resource_id ORDER BY r.resource_id`).all(resourceId) as {resource_id:string}[];
  const ids=resources.map(r=>r.resource_id),marks=ids.map(()=>'?').join(','),refs=db.prepare(`SELECT * FROM capability_session_refs WHERE ref_id IN (${marks}) ORDER BY task_id,ref_kind,ref_id`).all(...ids) as {task_id:string}[];
  const taskIds=[...new Set(refs.map(r=>r.task_id))],taskMarks=taskIds.map(()=>'?').join(',');
  const histories=taskIds.length?['capability_session_snapshots','capability_session_identities','capability_session_mcp_names','capability_session_holds','capability_runs'].map(table=>db.prepare(`SELECT * FROM ${table} WHERE task_id IN (${taskMarks}) ORDER BY rowid`).all(...taskIds)):[];
  const leases=db.prepare(`SELECT * FROM capability_resource_leases WHERE resource_id IN (${marks}) AND state<>'released' ORDER BY lease_id`).all(...ids);
  const dependencies=db.prepare(`SELECT * FROM capability_resource_dependencies WHERE resource_id IN (${marks}) OR dependency_id IN (${marks}) ORDER BY resource_id,dependency_id`).all(...ids,...ids);
  const active=db.prepare('SELECT * FROM capability_active_packages WHERE app_id=?').get(appId)??null;
  return digest(canonicalJson({resources,refs,histories,leases,dependencies,active,unresolved}));
 }

 private inventory(appId:ApplicationId):ApplicationVersions{
  const db=this.store.sqlite,{unresolved}=this.metadata(),active=this.packages.active(appId);
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
   const measured=new Set<string>();
   let sourceBytes:number|null=null,projectionBytes:number|null=0,integrity:ApplicationVersionUsage['integrity']='unknown',compatibility:ApplicationVersionUsage['compatibility']='unknown',state='recovery-required',generation=0;
   try{
    const resource=this.store.get(row.resourceId);state=resource.state;generation=resource.generation;
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
   const canCleanup=state==='ready'&&integrity==='valid'&&reasons.size===0;
   return{appId,version:row.version,packageHash:row.hash,resourceId:row.resourceId,state,defaultForNewSessions:isDefault,sessionRefCount,tombstoneRefCount,activeRunCount:runIds.size,references,sourceBytes,projectionBytes,reclaimableBytes:canCleanup?sourceBytes:0,integrity,compatibility,retentionReasons:[...reasons],issues,canCleanup,planHash:digest(canonicalJson({resourceId:row.resourceId,generation,proof:this.proof(row.resourceId,appId,unresolved)}))};
  });
  return{appId,items,checkedAt:new Date().toISOString(),recoveryPending:(db.prepare("SELECT count(*) AS n FROM capability_resource_operations WHERE kind='cleanup-application' AND owner_store_id=? AND state<>'committed'").get(this.store.storeId) as {n:number}).n};
 }
 list(appId:ApplicationId):Promise<ApplicationVersions>{applicationIdSchema.parse(appId);return withResourceLock(this.store.root,()=>this.inventory(appId));}
 private phase(id:string,state:string){this.store.sqlite.prepare('UPDATE capability_resource_operations SET state=?,updated_at=? WHERE operation_id=? AND owner_store_id=?').run(state,new Date().toISOString(),id,this.store.storeId);}
 async cleanup(input:ApplicationVersionCleanup):Promise<ApplicationVersionCleanupResult>{
  const value=cleanupInput.parse(input);
  return withResourceLock(this.store.root,()=>{
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
  });
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
  return withResourceLock(this.store.root,()=>{
   const rows=this.store.sqlite.prepare("SELECT operation_id,plan_json FROM capability_resource_operations WHERE kind='cleanup-application' AND owner_store_id=? AND state<>'committed' ORDER BY created_at").all(this.store.storeId) as {operation_id:string;plan_json:string}[];
   const result={recovered:[] as string[],pending:[] as string[]};
   for(const row of rows)try{
    z.uuid().parse(row.operation_id);const plan=planSchema.parse(JSON.parse(row.plan_json));
    if(plan.storeId!==this.store.storeId||this.processes.state(plan.owner)!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原清理进程尚未确认退出');
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
