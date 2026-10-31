import {lstatSync,mkdirSync,realpathSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import {canonicalJson} from './manifest';
import type {ResourceRecord,ResourceStore} from './resource-store';
import {retainedLegacySource,assertLegacySessionSource} from './legacy-session-source';
import {LegacyPluginSources,legacyPluginOrigin,legacyStaticPluginResourceId} from './legacy-plugin-source';
import {inspectLegacyRetainedSources,legacyFilesReceipt} from './legacy-session-files';
function present(path:string):boolean{try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
/** C-only original static projection. Its provenance is the original task and
 * immutable source under this exact store. Never reaps a native process/lease,
 * overwrites occupied content, touches H, or makes a native exit claim. */
export class LegacyOriginalPlugin {
 constructor(private readonly store:ResourceStore){}
 private source(taskId:string){
  const row=this.store.sqlite.prepare('SELECT state FROM capability_legacy_migration_preparations WHERE task_id=?').get(taskId) as {state:string}|undefined;
  if(row?.state!=='prepared'&&row?.state!=='migrated')throw new ApplicationError('SESSION_ON_HOLD','原M4来源尚未完整留存');
  const source=retainedLegacySource(this.store,taskId,row.state);
  if(source.identity.runner!=='claude-code'||!source.evidence.pluginRoot||!source.pluginSource)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原Claude完整静态插件来源不可得');return source;
 }
 private target(relativePath:string):void{
  try{const root=lstatSync(this.store.root),path=join(this.store.root,'.store-id.json'),marker=lstatSync(path);
   if(!root.isDirectory()||root.isSymbolicLink()||realpathSync(this.store.root)!==this.store.root||!marker.isFile()||marker.nlink!==1||marker.size>4096)throw Error('store marker');const owner=JSON.parse(readFileSync(path,'utf8'));if(owner.schema!==1||owner.storeId!==this.store.storeId)throw Error('store identity');
  }catch{throw new ApplicationError('OWNERSHIP_CONFLICT','原资源库身份不符');}
  let at=this.store.root;for(const part of relativePath.split('/')){at=join(at,part);if(!present(at))break;const st=lstatSync(at);if(st.isSymbolicLink()||!st.isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','原插件路径被文件或链接占用，保留原路径');}
 }
 async prepare(taskId:string,signal?:AbortSignal):Promise<ResourceRecord>{
  if(signal?.aborted)throw new ApplicationError('CANCELED','已取消原静态路径恢复');
  const source=this.source(taskId),archive=source.pluginSource!,origin=legacyPluginOrigin(source.evidence),reader=new LegacyPluginSources(this.store),proof=inspectLegacyRetainedSources(this.store,source),resourceId=legacyStaticPluginResourceId(taskId,source.evidence.manifestHash),relativePath=relative(this.store.root,source.evidence.runRoot);
  this.target(relativePath);
  const target=source.evidence.runRoot;
  if(present(target))reader.verifyStaticProjection(archive,origin,target);
  const targetReceipt=legacyFilesReceipt([target]);
  if(present(target))reader.verifyStaticProjection(archive,origin,target);
  if(legacyFilesReceipt([target])!==targetReceipt)throw new ApplicationError('RESOURCE_STATE_CHANGED','原目录在恢复检查中变化');
  const sourceRow=canonicalJson(source.row),refRows=()=>canonicalJson(this.store.sqlite.prepare("SELECT * FROM capability_session_refs WHERE task_id=? AND ref_kind<>'legacy-static-plugin' ORDER BY ref_kind,ref_id").all(taskId)),originalRefs=refRows();
  const metadata=()=>{
   const current=this.source(taskId);if(canonicalJson(current.row)!==sourceRow||canonicalJson(current.pluginSource)!==canonicalJson(archive)||refRows()!==originalRefs)throw new ApplicationError('RESOURCE_STATE_CHANGED','原插件来源或引用在恢复中变化');
   const state=this.store.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;if(state&&(state.store_id!==this.store.storeId||state.maintenance_state!=='ready'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原资源库维护尚未结束');
   if(this.store.sqlite.prepare("SELECT 1 FROM capability_resources WHERE path_scope='C' AND relative_path=? AND resource_id<>? LIMIT 1").get(relativePath,resourceId))throw new ApplicationError('OWNERSHIP_CONFLICT','原路径已被另一资源登记，不能改签');
   this.target(relativePath);if(legacyFilesReceipt([target])!==targetReceipt){
    // A known publisher may have just renamed its fully verified stage. Accept
    // only that exact resource's published phase and recheck all source bytes;
    // pre-publication, occupied, changed or unrelated targets remain blocked.
    const projection=this.store.get(resourceId),operation=projection.operationId?this.store.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?').get(projection.operationId,this.store.storeId) as {state:string}|undefined:undefined;
    if(projection.state!=='verified'||operation?.state!=='published')throw new ApplicationError('RESOURCE_STATE_CHANGED','原插件目标在发布前变化，保留原内容');
    reader.verifyStaticProjection(archive,origin,target);
   }
  };
  const guard=(operationId:string)=>{
   metadata();if(this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed') LIMIT 1").get(taskId))throw new ApplicationError('RESOURCE_BUSY','原会话仍有运行或待核查占用，暂不恢复路径');
   if(this.store.sqlite.prepare("SELECT 1 FROM capability_resource_leases l WHERE l.state<>'released' AND NOT(l.owner_id=? AND l.owner_kind='install' AND l.host_instance_id=?) AND (l.resource_id=? OR EXISTS(SELECT 1 FROM capability_lease_resources r WHERE r.lease_id=l.lease_id AND r.resource_id=?)) LIMIT 1").get(operationId,this.store.instanceId,resourceId,resourceId))throw new ApplicationError('RESOURCE_BUSY','原插件仍有资源占用，暂不恢复路径');
  };
  const spec={resourceId,kind:'legacy-static-plugin',contentHash:archive.contentHash,relativePath,dependencies:[archive.resourceId],assertPublish:guard,
   register:()=>{const old=this.store.sqlite.prepare("SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-static-plugin' AND ref_id=?").get(taskId,resourceId) as {ref_hash:string;relative_path:string}|undefined;if(old&&(old.ref_hash!==archive.contentHash||old.relative_path!==relativePath))throw new ApplicationError('SNAPSHOT_CORRUPT','原静态投影引用不同');this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_session_refs VALUES(?,?,?,?,?)').run(taskId,'legacy-static-plugin',resourceId,archive.contentHash,relativePath);},
   materialize:(stage:string)=>{const files=reader.staticProjectionFiles(archive,origin);mkdirSync(stage,{mode:0o700});for(const[name,bytes]of Object.entries(files)){const path=join(stage,name);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{flag:'wx',mode:0o600});}},
   verify:(directory:string)=>{if(!proof.verify())throw new ApplicationError('RESOURCE_STATE_CHANGED','原插件完整来源在恢复中变化');metadata();reader.verifyStaticProjection(archive,origin,directory);},
  };
  const known=this.store.sqlite.prepare('SELECT resource_id FROM capability_resources WHERE resource_id=?').get(resourceId);
  if(known&&!source.originalProjection)throw new ApplicationError('SNAPSHOT_CORRUPT','原静态投影长期引用缺失，保留原登记');
  if(known){const r=this.store.get(resourceId);if(r.state!=='ready'){if(!r.operationId||!['staged','verified','recovery-required'].includes(r.state))throw new ApplicationError('RESOURCE_BUSY','原静态投影发布仍未结束');return this.store.recover(spec,r.operationId,signal);}}
  return this.store.publish(spec,signal);
 }
 verify(resource:ResourceRecord,snapshot:CapabilitySessionSnapshotV2):void{
  const source=assertLegacySessionSource(this.store,snapshot),expected=source.originalProjection;
  if(!expected||canonicalJson(expected)!==canonicalJson(resource)||resource.state!=='ready'||resource.integrity!=='valid'||!source.pluginSource)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原静态投影尚未就绪或未被会话引用');
  const deps=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(resource.resourceId) as {dependency_id:string}[]).map(d=>d.dependency_id);if(canonicalJson(deps)!==canonicalJson([source.pluginSource.resourceId]))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原静态投影依赖缺失或不同');
  this.target(resource.relativePath);new LegacyPluginSources(this.store).verifyOriginalPlugin(source.pluginSource,legacyPluginOrigin(source.evidence));
 }
}
