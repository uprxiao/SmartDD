import {claudeProjectionSelection,selectedStandardSkills} from './claude-projection-selection';
import {verifyClaudeDelivery} from './claude-delivery-state';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { ApplicationError } from '@shared/applications';
import type { CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { canonicalJson, digest } from './manifest';
import { verifyPackageTree } from './package-files';
import { PackageRegistry } from './package-registry';
import { LegacyCapabilityResourceAdopter } from './legacy-resource-adopter';
import { ownedBundle, writeOwnedBundle, verifyOwnedBundle,type OwnedBundle,type OwnedBundleManifest } from './owned-bundle';
import type { ResourceRecord, ResourceStore } from './resource-store';
import type { CapabilitySessionRegistry } from './session-registry';
export const standardNativeSkillName = (skillId: string,hash: string): string => {
  const name = `smartdd-s-${skillId}-${hash.slice(0,12)}`;
  if (name.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) throw new ApplicationError('INVALID_PACKAGE','标准Skill原生名称超过已验证范围'); return name;
};
export function projectSkillName(input: Buffer,name: string): Buffer {
  if (!Buffer.from(input.toString('utf8'),'utf8').equals(input)) throw new ApplicationError('INVALID_PACKAGE','Skill入口必须为完整UTF-8文本');
  const text = input.toString('utf8'), front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!front) throw new ApplicationError('INVALID_PACKAGE','Skill入口缺少元数据');
  const doc = parseDocument(front[1],{ uniqueKeys: true,logLevel: 'silent' });
  if (doc.errors.length || typeof doc.get('name') !== 'string' || typeof doc.get('description') !== 'string') throw new ApplicationError('INVALID_PACKAGE','Skill元数据无效');
  doc.set('name',name); return Buffer.from('---\n' + doc.toString() + '---\n' + text.slice(front[0].length),'utf8');
}

export type ClaudeProjectionSource={role:'view'|'archive';resource:ResourceRecord;bundle:OwnedBundle;applicationScope:readonly string[]};
/** Full source trees are copied; relative scripts/references/assets remain alongside SKILL.md. */
export class SessionCapabilityProjector {
  private readonly packages: PackageRegistry;
  private readonly legacy: LegacyCapabilityResourceAdopter;
  constructor(readonly store: ResourceStore,private readonly sessions: CapabilitySessionRegistry) { this.packages = new PackageRegistry(store,'projection-reader'); this.legacy = new LegacyCapabilityResourceAdopter(store); }
  sourceSkills(snapshot: CapabilitySessionSnapshotV2,applicationScope?:readonly string[],independent=false,standardSkillScope?:readonly string[]): { nativeName: string;path: string;sourceHash: string;sourceResourceId: string;files: Record<string,Buffer>;executables: Set<string> }[] {
    if(applicationScope&&((!applicationScope.length&&!independent)||(independent&&applicationScope.length!==0)||new Set(applicationScope).size!==applicationScope.length||applicationScope.some(id=>!snapshot.packages.some(p=>p.appId===id))))throw new ApplicationError('INVALID_INPUT','Skill加载范围须来自原固定应用');
    const result: ReturnType<SessionCapabilityProjector['sourceSkills']> = [];
    for (const application of snapshot.packages.filter(p=>applicationScope===undefined||applicationScope.includes(p.appId))) {
      const installed = this.packages.get(application.packageHash); verifyPackageTree(join(this.store.root,installed.relativePath),installed,this.store.storeId);
      for (const skill of application.skills) {
        const prefix = skill.sourceRelativePath + '/', files: Record<string,Buffer> = {},executables = new Set<string>();
        for (const source of installed.manifest.files.filter(f => f.path.startsWith(prefix))) { const relative = source.path.slice(prefix.length), bytes = readFileSync(join(this.store.root,installed.relativePath,source.path));if(bytes.length!==source.size||digest(bytes)!==source.sha256)throw new ApplicationError('HASH_MISMATCH','原Skill文件在读取时已改变'); files[relative] = relative === 'SKILL.md' ? projectSkillName(bytes,skill.nativeName) : bytes; if (source.executable) executables.add(relative); }
        if (!files['SKILL.md']) throw new ApplicationError('INVALID_PACKAGE','原Skill完整目录缺少入口');
        result.push({ nativeName: skill.nativeName,path: skill.projectionPath,sourceHash: skill.contentHash,sourceResourceId: installed.resourceId,files,executables });
      }
      verifyPackageTree(join(this.store.root,installed.relativePath),installed,this.store.storeId);
    }
    for (const standard of selectedStandardSkills(snapshot,standardSkillScope)) {
      const resource = this.store.get(`standard-skill:${standard.skillId}:${standard.hash}`);
      const files: Record<string,Buffer> = Object.fromEntries(Object.entries(this.legacy.verify(resource)).map(([path,text]) => [path,Buffer.from(text,'utf8')]));
      const nativeName = standardNativeSkillName(standard.skillId,standard.hash);
      if (!files['SKILL.md']) throw new ApplicationError('INVALID_PACKAGE','原标准Skill缺少入口'); files['SKILL.md'] = projectSkillName(files['SKILL.md'],nativeName);
      result.push({ nativeName,path: standard.projectionPath,sourceHash: standard.hash,sourceResourceId: resource.resourceId,files,executables: new Set() });
    }
    if (new Set(result.map(s => s.nativeName)).size !== result.length) throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','所选Skill原生名称冲突'); return result;
  }
  private claudeBundle(snapshot:CapabilitySessionSnapshotV2,selectionHash:string,applicationScope?:readonly string[],independent=false,standardSkillScope?:readonly string[]):OwnedBundle{
    if(snapshot.runner!=='claude-code'||snapshot.provenance!=='created'||snapshot.legacyBinding)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此投影入口只处理有新会话依据的Claude能力；旧历史不猜测重建');
    const root=join(this.store.root,'sessions',snapshot.taskId,'claude/plugin'),skills=this.sourceSkills(snapshot,applicationScope,independent,standardSkillScope),files:Record<string,Buffer>={},executables=new Set<string>();
    files['.claude-plugin/plugin.json']=Buffer.from(JSON.stringify({name:'smartdd-session',version:'1.0.0',description:'WillYou session capabilities'},null,2)+'\n');
    for(const skill of skills){
      if(skill.path!==join(root,'skills',skill.nativeName,'SKILL.md'))throw new ApplicationError('SNAPSHOT_IMMUTABLE','Skill投影路径不等于原快照');
      for(const[path,bytes]of Object.entries(skill.files)){const target=`skills/${skill.nativeName}/${path}`;files[target]=bytes;if(skill.executables.has(path))executables.add(target);}
    }
    return ownedBundle({kind:'claude-session-projection',taskId:snapshot.taskId,selectionHash,...(standardSkillScope?{formatVersion:2,standardSkillScope:[...standardSkillScope]}:{formatVersion:1}),sources:skills.map(s=>({resourceId:s.sourceResourceId,sourceHash:s.sourceHash,nativeName:s.nativeName}))},files,executables);
  }
  /** Verify a complete view against the full original S;never infer a new selection. */
  private claudeScope(manifest:OwnedBundleManifest,snapshot:CapabilitySessionSnapshotV2,requireFull=false):string[]{
    return claudeProjectionSelection(manifest,snapshot,requireFull).appIds;
  }
  private sourceIdentity(taskId:string,hash:string,archive=false){const kind=archive?'claude-projection-archive':'claude-projection-source';return{kind,resourceId:`${kind}:${taskId}:${hash}`,relativePath:`projection-sources/claude/${taskId}/${archive?'archives':'views'}/${hash}`};}
  /** Immutable depot only;this does not publish or activate the native plugin root. */
  async claudeSource(taskId:string,applicationScope?:readonly string[],independent=false,standardSkillScope?:readonly string[]):Promise<ClaudeProjectionSource>{
    const current=await this.sessions.get(taskId),bundle=this.claudeBundle(current.snapshot,current.selectionHash,applicationScope,independent,standardSkillScope),scope=this.claudeScope(bundle.manifest,current.snapshot),identity=this.sourceIdentity(taskId,bundle.hash);
    const dependencies=[...new Set((bundle.manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))];
    const resource=await this.store.publish({...identity,contentHash:bundle.hash,dependencies,materialize:stage=>writeOwnedBundle(stage,bundle,this.store.storeId),verify:directory=>{this.claudeScope(verifyOwnedBundle(directory,bundle.hash,this.store.storeId),current.snapshot);}});
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId);return{role:'view',resource,bundle,applicationScope:Object.freeze(scope)};
  }
  /** Preserve verified original full bytes even if their source packages are now
   * unavailable.Archives carry no execution dependency or native-loading grant. */
  async archiveClaude(taskId:string,resourceId:string):Promise<ClaudeProjectionSource>{
    const current=await this.sessions.get(taskId),original=this.store.get(resourceId),refs=await this.sessions.references(taskId);
    if(!refs.some(r=>r.refId===resourceId)||original.kind!=='session-projection')throw new ApplicationError('SCOPE_DENIED','只归档原会话已登记的完整插件');
    this.verify(original,current.snapshot);const root=this.store.directory(original),manifest=verifyOwnedBundle(root,original.contentHash,this.store.storeId),scope=this.claudeScope(manifest,current.snapshot,true),files:Record<string,Buffer>={},executables=new Set<string>();
    for(const file of manifest.files){const bytes=readFileSync(join(root,file.path));if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw new ApplicationError('HASH_MISMATCH','原插件在归档读取时已变化');files[file.path]=bytes;if(file.executable)executables.add(file.path);}
    const bundle=ownedBundle(manifest.metadata,files,executables);if(bundle.hash!==original.contentHash)throw new ApplicationError('HASH_MISMATCH','原插件归档字节与原身份不同');verifyOwnedBundle(root,original.contentHash,this.store.storeId);
    const identity=this.sourceIdentity(taskId,bundle.hash,true),resource=await this.store.publish({...identity,contentHash:bundle.hash,dependencies:[],materialize:stage=>writeOwnedBundle(stage,bundle,this.store.storeId),verify:directory=>{this.claudeScope(verifyOwnedBundle(directory,bundle.hash,this.store.storeId),current.snapshot,true);}});
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId);return{role:'archive',resource,bundle,applicationScope:Object.freeze(scope)};
  }
  /** Read verified static depot bytes.This is not a canonical-root lease or a
   * native loading receipt;the delivery coordinator must obtain those separately. */
  async readClaudeArtifact(taskId:string,resourceId:string):Promise<ClaudeProjectionSource>{
    const current=await this.sessions.get(taskId),resource=this.store.get(resourceId),refs=await this.sessions.references(taskId);
    if(!['claude-projection-source','claude-projection-archive'].includes(resource.kind)||!refs.some(r=>r.refId===resourceId))throw new ApplicationError('SCOPE_DENIED','来源必须是此原会话已登记的静态副本');
    this.verify(resource,current.snapshot);const root=this.store.directory(resource),manifest=verifyOwnedBundle(root,resource.contentHash,this.store.storeId),files:Record<string,Buffer>={},executables=new Set<string>();
    for(const file of manifest.files){const bytes=readFileSync(join(root,file.path));if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw new ApplicationError('HASH_MISMATCH','投影来源在读取时已变化');files[file.path]=bytes;if(file.executable)executables.add(file.path);}
    const bundle=ownedBundle(manifest.metadata,files,executables);if(bundle.hash!==resource.contentHash)throw new ApplicationError('HASH_MISMATCH','静态副本与原内容身份不同');this.verify(resource,current.snapshot);
    if(canonicalJson(this.store.get(resourceId))!==canonicalJson(resource))throw new ApplicationError('RESOURCE_STATE_CHANGED','读取期间静态副本登记已变化');
    const archive=resource.kind==='claude-projection-archive';return{role:archive?'archive':'view',resource,bundle,applicationScope:Object.freeze(this.claudeScope(manifest,current.snapshot,archive))};
  }
  async claude(taskId: string): Promise<{ resource: ResourceRecord;root: string }> {
    const current=await this.sessions.get(taskId),bundle=this.claudeBundle(current.snapshot,current.selectionHash),relativePath=`sessions/${taskId}/claude/plugin`,root=join(this.store.root,relativePath);
    const resource=await this.store.publish({resourceId:`session-projection:${taskId}:${bundle.hash}`,kind:'session-projection',contentHash:bundle.hash,relativePath,dependencies:[...new Set((bundle.manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))],materialize:stage=>writeOwnedBundle(stage,bundle,this.store.storeId),verify:directory=>{verifyOwnedBundle(directory,bundle.hash,this.store.storeId);}});
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId);return{resource,root};
  }
  verify(resource: ResourceRecord,snapshot: CapabilitySessionSnapshotV2): void {
    if(resource.kind==='claude-delivery'){verifyClaudeDelivery(this.store,resource,snapshot);return;}
    if(['claude-projection-source','claude-projection-archive'].includes(resource.kind)){
      const archive=resource.kind==='claude-projection-archive',identity=this.sourceIdentity(snapshot.taskId,resource.contentHash,archive);
      if(resource.pathScope!=='C'||resource.state!=='ready'||resource.integrity!=='valid'||resource.resourceId!==identity.resourceId||resource.relativePath!==identity.relativePath)throw new ApplicationError('OWNERSHIP_CONFLICT','Claude来源归属或就绪身份不同');
      const manifest=verifyOwnedBundle(this.store.directory(resource),resource.contentHash,this.store.storeId);this.claudeScope(manifest,snapshot,archive);
      const expected=archive?[]:[...new Set((manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))].sort(),actual=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(resource.resourceId) as {dependency_id:string}[]).map(r=>r.dependency_id);
      if(canonicalJson(actual)!==canonicalJson(expected))throw new ApplicationError('RESOURCE_STATE_CHANGED','Claude来源的完整依赖已改变');
      if(archive){const original=this.store.get(`session-projection:${snapshot.taskId}:${resource.contentHash}`),ref=this.store.sqlite.prepare("SELECT 1 FROM capability_session_refs WHERE task_id=? AND ref_id=? AND ref_kind='session-projection' AND ref_hash=?").get(snapshot.taskId,original.resourceId,resource.contentHash);if(!ref||original.kind!=='session-projection'||original.pathScope!=='C'||original.relativePath!==`sessions/${snapshot.taskId}/claude/plugin`)throw new ApplicationError('SNAPSHOT_IMMUTABLE','归档缺少原完整插件引用');}
      return;
    }
    if (resource.kind !== 'session-projection' || resource.state !== 'ready' || resource.integrity !== 'valid' || resource.relativePath !== `sessions/${snapshot.taskId}/claude/plugin`) throw new ApplicationError('OWNERSHIP_CONFLICT','投影不属于此原会话');
    const manifest = verifyOwnedBundle(join(this.store.root,resource.relativePath),resource.contentHash,this.store.storeId), selectionHash = digest(canonicalJson({ ...snapshot,native: { ...snapshot.native,sessionId: null } }));
    if (manifest.metadata.taskId !== snapshot.taskId || manifest.metadata.selectionHash !== selectionHash || manifest.metadata.kind !== 'claude-session-projection') throw new ApplicationError('SNAPSHOT_IMMUTABLE','投影绑定的选择不同，不能覆盖原路径');
  }
}
