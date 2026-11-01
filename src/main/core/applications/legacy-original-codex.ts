import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {canonicalJson,digest} from './manifest';
import {DiscoveryCatalog,type DiscoveryProjectionSource} from './discovery-catalog';
import {LegacyCapabilityResourceAdopter} from './legacy-resource-adopter';
import {retainedLegacySource,assertLegacySessionSource} from './legacy-session-source';
import {originalHBinding} from './legacy-h-binding';
import {LegacyDiscoveryInventory} from './legacy-discovery-inventory';
import {inspectLegacyRetainedSources} from './legacy-session-files';
import {verifyLegacyDiscoveryEntry,legacyDiscoveryEntry} from './legacy-discovery';
import type {ResourceRecord,ResourceStore} from './resource-store';

/** Original task/source authority plus the shared H coordinator. No native exit
 * claim, forced lease release, changed S, new application or CLI activation. */
export class LegacyOriginalCodex{
 constructor(private readonly store:ResourceStore,private readonly catalog:DiscoveryCatalog){}
 private source(taskId:string){
  const state=(this.store.sqlite.prepare('SELECT state FROM capability_legacy_migration_preparations WHERE task_id=?').get(taskId) as {state:string}|undefined)?.state;
  if(state!=='prepared'&&state!=='migrated')throw new ApplicationError('SESSION_ON_HOLD','原Skill来源尚未完成留存');
  const source=retainedLegacySource(this.store,taskId,state);
  if(source.identity.runner!=='codex'||source.identity.home!==this.catalog.home||this.catalog.store!==this.store)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原Skill必须沿用原任务的共享发现根');
  return source;
 }
 async prepare(taskId:string,signal?:AbortSignal){
  if(signal?.aborted)throw new ApplicationError('CANCELED','已取消历史Skill目录恢复');
  const original=this.source(taskId),proof=inspectLegacyRetainedSources(this.store,original),reader=new LegacyCapabilityResourceAdopter(this.store),binding=originalHBinding(this.store,taskId,original.identity.home,original.row.source_snapshot_hash,original.evidence),bytes=canonicalJson(binding),bindingHash=digest(bytes);
  const fixedRow=(s:typeof original)=>{const{h_binding_hash,...row}=s.row;return canonicalJson(row);},row=fixedRow(original),task=()=>this.store.sqlite.prepare('SELECT project_id,runner,state_root,cwd,native_session_id,runtime_snapshot FROM tasks WHERE id=?').get(taskId) as {project_id:string;runner:string;state_root:string;cwd:string;native_session_id:string|null;runtime_snapshot:string}|undefined,initial=task();
  if(!initial||initial.project_id!==original.identity.projectId||initial.runner!=='codex'||initial.state_root!==original.identity.stateRoot||initial.cwd!==original.identity.cwd||initial.native_session_id!==original.row.bound_native_session_id||original.row.state==='prepared'&&initial.runtime_snapshot!==original.row.source_record_json)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原任务的身份或记录不同');
  if(original.row.state==='migrated'){
   const snapshot=this.store.sqlite.prepare('SELECT schema_version,snapshot_json,snapshot_hash FROM capability_session_snapshots WHERE task_id=?').get(taskId) as {schema_version:number;snapshot_json:string;snapshot_hash:string}|undefined;
   let pointer;try{pointer=JSON.parse(initial.runtime_snapshot)?.sessionCapabilities;}catch{}
   if(!snapshot||snapshot.schema_version!==2||digest(snapshot.snapshot_json)!==snapshot.snapshot_hash||canonicalJson(pointer)!==canonicalJson({schema:2,taskId,snapshotHash:snapshot.snapshot_hash}))throw new ApplicationError('SNAPSHOT_CORRUPT','已迁移原任务的固定指针不同');
   assertLegacySessionSource(this.store,JSON.parse(snapshot.snapshot_json) as CapabilitySessionSnapshot);
  }
  const metadata=()=>{
   const source=this.source(taskId),state=this.store.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
   if(fixedRow(source)!==row||canonicalJson(task())!==canonicalJson(initial))throw new ApplicationError('RESOURCE_STATE_CHANGED','原Skill来源或任务在恢复中变化');
   if(state&&(state.store_id!==this.store.storeId||state.maintenance_state!=='ready'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','资源库维护尚未结束');
   if(this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed') LIMIT 1").get(taskId))throw new ApplicationError('RESOURCE_BUSY','原任务仍有运行或待核查占用');
  };
  const sources:DiscoveryProjectionSource[]=original.evidence.skills.filter(s=>s.enabled).map(s=>{
   const entry=legacyDiscoveryEntry(this.store.storeId,this.catalog.home,s.skillId,s.hash),resource=this.store.get(`standard-skill:${s.skillId}:${s.hash}`),files=reader.verify(resource);
   return{format:'legacy-tree-v1',nativeName:entry.nativeName,sourceHash:s.hash,sourceResourceId:resource.resourceId,files:Object.fromEntries(Object.entries(files).map(([p,t])=>[p,Buffer.from(t)])),executables:new Set()};
  });
  metadata();const inventory=await new LegacyDiscoveryInventory(this.store,this.catalog).sources(signal);
  for(const source of inventory)if(!sources.some(s=>s.nativeName===source.nativeName))sources.push(source);
  const register=()=>{
   metadata();const current=this.source(taskId);
   if(current.row.h_binding_hash===null){
    if(this.store.sqlite.prepare('SELECT 1 FROM capability_legacy_h_bindings WHERE task_id=?').get(taskId))throw new ApplicationError('SNAPSHOT_CORRUPT','原Skill登记已有不同依据');
    for(const alias of binding.aliases){const r=this.store.get(alias.resourceId);if(r.kind!=='legacy-agent-projection'||r.pathScope!=='H'||r.scopeIdentity!==binding.homeId||r.relativePath!==alias.relativePath||r.contentHash!==alias.hash)throw new ApplicationError('OWNERSHIP_CONFLICT','原Skill资源身份不同');this.store.sqlite.prepare('INSERT INTO capability_session_refs VALUES(?,?,?,?,?)').run(taskId,r.kind,r.resourceId,r.contentHash,r.relativePath);}
    this.store.sqlite.prepare('INSERT INTO capability_legacy_h_bindings VALUES(?,?,?,?)').run(taskId,bytes,bindingHash,new Date().toISOString());
    const result=this.store.sqlite.prepare('UPDATE capability_legacy_migration_preparations SET h_binding_hash=? WHERE task_id=? AND h_binding_hash IS NULL').run(bindingHash,taskId);if(result.changes!==1)throw new ApplicationError('RESOURCE_STATE_CHANGED','原Skill登记已变化');
   }else if(current.row.h_binding_hash!==bindingHash)throw new ApplicationError('SNAPSHOT_CORRUPT','原Skill登记的固定摘要不同');
  };
  const published=await this.catalog.publishOrRecover(sources,{signal,assertPublish:()=>{metadata();if(!proof.verify())throw new ApplicationError('RESOURCE_STATE_CHANGED','原Skill完整来源在恢复中变化');},register});
  const ready=this.source(taskId);for(const r of ready.originalCodexProjections??[])if(r.state!=='ready'||r.integrity!=='valid')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享Skill投影尚未就绪');
  return published;
 }
 verify(resource:ResourceRecord,snapshot:CapabilitySessionSnapshot):void{
  const original=assertLegacySessionSource(this.store,snapshot),expected=original.originalCodexProjections?.find(r=>r.resourceId===resource.resourceId),skill=original.evidence.skills.find(s=>s.enabled&&s.hash===resource.contentHash&&legacyDiscoveryEntry(this.store.storeId,original.identity.home,s.skillId,s.hash).resourceId===resource.resourceId);
  if(!expected||!skill||canonicalJson(expected)!==canonicalJson(resource)||resource.state!=='ready'||resource.integrity!=='valid'||original.identity.home!==this.catalog.home)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享Skill投影未被本任务完整引用');
  const entry=legacyDiscoveryEntry(this.store.storeId,original.identity.home,skill.skillId,skill.hash),tree=verifyLegacyDiscoveryEntry(entry,original.identity.home).files,source=this.store.get(`standard-skill:${skill.skillId}:${skill.hash}`),files=new LegacyCapabilityResourceAdopter(this.store).verify(source),deps=this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(resource.resourceId);
  if(canonicalJson(deps)!==canonicalJson([{dependency_id:source.resourceId}])||canonicalJson({...tree})!==canonicalJson({...files}))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享Skill投影的依赖或来源不同');
 }
}
