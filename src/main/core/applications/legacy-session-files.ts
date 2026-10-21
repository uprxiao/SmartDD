import {lstatSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import type {ResourceRecord,ResourceStore} from './resource-store';
import {LegacyTaskEvidenceReader,type LegacySkillVersion} from './legacy-task-evidence';
import {LegacyPluginSources,legacyPluginOrigin} from './legacy-plugin-source';
import {readLegacyOwnedTree} from './legacy-resource-adopter';
import {retainedLegacySource,legacyLogicalEvidence} from './legacy-session-source';

type Source=ReturnType<typeof retainedLegacySource>;
const fail=(message:string):never=>{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED',message);};
function present(path:string):boolean{
 try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
/** Record directory identities as well as file identities. This never reads outside
 * the exact source / original projection roots, follows links or creates a path.
 */
export function legacyFilesReceipt(paths:readonly string[]):string{
 const result:unknown[]=[];let entries=0,bytes=0;
 const walk=(path:string,depth:number)=>{
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory()&&!st.isFile()||depth>32||++entries>16384)fail('原M4来源含链接、特殊文件或超过核对预算');
  if(st.isFile()&&(st.nlink!==1||(st.mode&0o111)!==0||st.size>4*1024*1024||(bytes+=st.size)>128*1024*1024))fail('原M4来源文件归属或预算不符');
  result.push([path,st.dev,st.ino,st.mode,st.nlink,st.size,st.mtimeMs,st.ctimeMs]);
  if(st.isDirectory()){const names=readdirSync(path).sort();if(!names.length)fail('原M4来源含未声明的空目录');for(const name of names)walk(join(path,name),depth+1);}
 };
 for(const path of [...new Set(paths)].sort()){
  // Inspect all existing parents, including a dangling link above an absent T.
  let parent='/';for(const name of relative('/',path).split('/')){parent=join(parent,name);if(!present(parent))break;if(lstatSync(parent).isSymbolicLink())fail('原M4路径含未登记别名');}
  if(!present(path)){result.push([path,'absent']);continue;}
  if(realpathSync(path)!==path)fail('原M4路径不在原规范位置');walk(path,0);
 }
 return digest(canonicalJson(result));
}
/** Verify original immutable files using the initial durable source receipt when
 * normal cleanup removed old context/manifest. This grants no owner/exit proof,
 * does not repair a path, migrate SQL, reserve a run or activate capabilities.
 */
function inspectFiles(store:ResourceStore,source:Source,originalPaths=true){
 const {identity,snapshot,evidence}=source;
 if(!['prepared','migrated'].includes(source.row.state))fail('原M4来源尚未完成留存');
 const state=source.row.state as 'prepared'|'migrated',legacy=new LegacyPluginSources(store),resources:ResourceRecord[]=[],sources=new Map<string,Record<string,string>>();
 const logical=(value:Source)=>{const {originalProjection,originalCodexProjections,...fixed}=value;const{h_binding_hash,...immutableRow}=value.row;return canonicalJson({...fixed,row:originalPaths?value.row:immutableRow,pluginSource:value.pluginSource??null,...(originalPaths&&originalProjection?{originalProjection}:{}),...(originalPaths&&originalCodexProjections?{originalCodexProjections}:{})});},sourceReceipt=logical(source);
 if(logical(retainedLegacySource(store,identity.taskId,state))!==sourceReceipt)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4来源对象与权威持久记录不同');
 const add=(id:string,kind:string,hash:string,path:string)=>{
  const resource=store.get(id);
  if(resource.kind!==kind||resource.pathScope!=='C'||resource.contentHash!==hash||resource.relativePath!==path||resource.state!=='ready'||resource.integrity!=='valid')fail('原M4固定来源资源未就绪或身份不同');
  const ref=store.sqlite.prepare('SELECT ref_kind,ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_id=?').get(identity.taskId,id) as {ref_kind:string;ref_hash:string;relative_path:string}|undefined;
  if(!ref||ref.ref_kind!==kind||ref.ref_hash!==hash||ref.relative_path!==path)fail('原M4固定来源引用缺失或不同');
  resources.push(resource);
 };
 for(const skill of snapshot.skills)add('standard-skill:'+skill.skillId+':'+skill.hash,'standard-skill',skill.hash,'packages/'+skill.skillId+'/'+skill.hash);
 add('legacy-runtime:'+evidence.runtimeHash,'legacy-runtime',evidence.runtimeHash,'runtime/'+evidence.runtimeHash);
 if(source.pluginSource)resources.push(source.pluginSource);
 if(originalPaths&&source.originalProjection)resources.push(source.originalProjection);
 if(originalPaths&&source.originalCodexProjections)resources.push(...source.originalCodexProjections);
 const paths=[...resources.map(r=>store.directory(r)),...(originalPaths?[evidence.runRoot,...(identity.runner==='codex'?evidence.skills.filter(s=>s.enabled).map(s=>dirname(s.projectionPath)):[])]:[])];
 const dependencies=(id:string)=>store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(id);
 const metadata=()=>{
  const current=retainedLegacySource(store,identity.taskId,state);
  if(logical(current)!==sourceReceipt||logical(source)!==sourceReceipt)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4持久来源已不是开始核对时的修订');
  const{h_binding_hash,...immutableRow}=current.row;return canonicalJson({row:originalPaths?current.row:immutableRow,resources:resources.map(r=>store.get(r.resourceId)),dependencies:resources.map(r=>[r.resourceId,dependencies(r.resourceId)]),refs:store.sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_kind,ref_id').all(identity.taskId).filter((r:any)=>originalPaths||!['legacy-static-plugin','legacy-agent-projection'].includes(r.ref_kind)),versions:snapshot.skills.map(s=>store.sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(s.versionId)??null)});
 };
 const metadataReceipt=metadata(),reader=new LegacyTaskEvidenceReader(store.root,identity.home,id=>store.sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(id) as LegacySkillVersion|undefined),inspected=originalPaths?reader.inspect(identity,snapshot):null;
 if(inspected?.state==='verified'&&canonicalJson(legacyLogicalEvidence(inspected.evidence))!==canonicalJson(legacyLogicalEvidence(evidence)))fail('原M4逻辑来源、路径或名称与最初留存不同');
 if(inspected&&inspected.state!=='verified'&&inspected.code!=='LEGACY_MANIFEST_MISSING')fail('原M4运行文件仍需核查');
 const validate=()=>{
  if(metadata()!==metadataReceipt)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4持久来源、引用或版本记录在核对中变化');
  for(const resource of resources)if(resource.kind==='standard-skill'||resource.kind==='legacy-runtime'){
   if(dependencies(resource.resourceId).length)fail('原M4标准来源或运行代码含未声明的依赖');
   sources.set(resource.resourceId,readLegacyOwnedTree(store.directory(resource),resource.contentHash));
  }
  for(const skill of snapshot.skills){
   const version=store.sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(skill.versionId) as LegacySkillVersion|undefined;
   if(!version||version.id!==skill.versionId||version.skillId!==skill.skillId||version.hash!==skill.hash||version.name!==skill.name||version.version!==skill.version)fail('原M4标准Skill版本元数据不同');
  }
  if(source.pluginSource)legacy.verify(source.pluginSource,legacyPluginOrigin(evidence));
  if(originalPaths&&source.originalProjection&&(source.originalProjection.state!=='ready'||source.originalProjection.integrity!=='valid'))fail('原静态投影尚未完成发布');
  if(originalPaths&&source.originalProjection&&canonicalJson(dependencies(source.originalProjection.resourceId))!==canonicalJson([{dependency_id:source.pluginSource!.resourceId}]))fail('原静态投影依赖缺失或不同');
  if(originalPaths&&source.originalCodexProjections)for(const r of source.originalCodexProjections){
   const skill=evidence.skills.find(s=>s.enabled&&dirname(s.projectionPath)===store.directory(r)),deps=dependencies(r.resourceId),original=skill?sources.get('standard-skill:'+skill.skillId+':'+skill.hash):null;
   if(!skill||!original||r.state!=='ready'||r.integrity!=='valid'||canonicalJson(deps)!==canonicalJson([{dependency_id:'standard-skill:'+skill.skillId+':'+skill.hash}])||canonicalJson({...readLegacyOwnedTree(store.directory(r),r.contentHash)})!==canonicalJson({...original}))fail('原共享Skill的长期投影尚未就绪或来源不同');
  }
  if(inspected?.state==='verified'){
   if(!reader.verify(inspected.evidence))throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4完整运行依据在核对中变化');
  }else if(inspected){
   if(identity.runner==='claude-code'&&evidence.pluginRoot){
    if(!source.pluginSource)fail('原静态插件完整来源尚未保留');legacy.verifyOriginalPlugin(source.pluginSource!,legacyPluginOrigin(evidence));
   }else if(present(evidence.runRoot))fail('原运行目录仍有未知或不完整内容，保留原路径');
   if(identity.runner==='codex')for(const skill of evidence.skills.filter(s=>s.enabled)){
    const original=sources.get('standard-skill:'+skill.skillId+':'+skill.hash),projection=readLegacyOwnedTree(dirname(skill.projectionPath),skill.hash);
    if(!original||canonicalJson({...original})!==canonicalJson({...projection}))fail('原Codex投影完整字节或原路径不同');
   }
  }
  if(realpathSync(identity.home)!==identity.home||realpathSync(store.root)!==store.root||metadata()!==metadataReceipt)fail('原M4规范根或持久来源在读取中变化');
 };
 const filesReceipt=legacyFilesReceipt(paths);validate();if(legacyFilesReceipt(paths)!==filesReceipt)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4来源文件在核对中变化');
 return{evidence:inspected?.state==='verified'?inspected.evidence:evidence,mode:!originalPaths?'retained-sources' as const:inspected?.state==='verified'?'original-run' as const:'retained-static' as const,
  verify:():boolean=>{try{if(legacyFilesReceipt(paths)!==filesReceipt)return false;validate();return legacyFilesReceipt(paths)===filesReceipt;}catch{return false;}},
 };
}

export function inspectLegacySessionFiles(store:ResourceStore,source:Source){
 try{return inspectFiles(store,source);}catch(error){if(error instanceof ApplicationError)throw error;return fail('原M4持久来源或原静态文件缺失、损坏或无法核验');}
}

/** Immutable C sources only, for staging a repair. Original paths, derived aliases
 * and their occupancy remain the publisher's separate responsibility. */
export function inspectLegacyRetainedSources(store:ResourceStore,source:Source){
 try{return inspectFiles(store,source,false);}catch(error){if(error instanceof ApplicationError)throw error;return fail('最初留存的M4完整来源无法核验');}
}
