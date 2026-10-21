from pathlib import Path
import json
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-claude-sources-av-20261022')
paths=['src/main/core/applications/session-projector.ts','src/main/core/applications/session-registry.ts','src/main/core/applications/task-capability-launcher.ts','src/main/core/applications/__tests__/agent-fixture.ts']
(e/'baseline.json').write_text(json.dumps({'baseCommit':'5783feb13bf8fb5658add822e9c0e109bf20e8e7','files':paths,'privateSource':str(w)},indent=2)+'\n')
p=w/paths[0];s=p.read_text().replace("import { parseDocument } from 'yaml';","import { parseDocument } from 'yaml';\nimport {z} from 'zod';")
s=s.replace("import { ownedBundle, writeOwnedBundle, verifyOwnedBundle } from './owned-bundle';","import { ownedBundle, writeOwnedBundle, verifyOwnedBundle,type OwnedBundle,type OwnedBundleManifest } from './owned-bundle';")
needle='/** Full source trees are copied; relative scripts/references/assets remain alongside SKILL.md. */'
assert s.count(needle)==1
s=s.replace(needle,"""const claudeMetadataSchema=z.object({kind:z.literal('claude-session-projection'),taskId:z.string().min(1).max(128),selectionHash:z.string().regex(/^[a-f0-9]{64}$/),formatVersion:z.literal(1),sources:z.array(z.object({resourceId:z.string().min(1).max(512),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),nativeName:z.string().min(1).max(64)}).strict()).max(4096)}).strict();
export type ClaudeProjectionSource={resource:ResourceRecord;bundle:OwnedBundle;applicationScope:readonly string[]};
"""+needle)
a=s.index('  async claude(taskId: string):');b=s.index('  verify(resource: ResourceRecord',a)
s=s[:a]+'''  private claudeBundle(snapshot:CapabilitySessionSnapshotV2,selectionHash:string,applicationScope?:readonly string[]):OwnedBundle{
    if(snapshot.runner!=='claude-code'||snapshot.provenance!=='created'||snapshot.legacyBinding)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此投影入口只处理有新会话依据的Claude能力；旧历史不猜测重建');
    const root=join(this.store.root,'sessions',snapshot.taskId,'claude/plugin'),skills=this.sourceSkills(snapshot,applicationScope),files:Record<string,Buffer>={},executables=new Set<string>();
    files['.claude-plugin/plugin.json']=Buffer.from(JSON.stringify({name:'smartdd-session',version:'1.0.0',description:'WillYou session capabilities'},null,2)+'\\n');
    for(const skill of skills){
      if(skill.path!==join(root,'skills',skill.nativeName,'SKILL.md'))throw new ApplicationError('SNAPSHOT_IMMUTABLE','Skill投影路径不等于原快照');
      for(const[path,bytes]of Object.entries(skill.files)){const target=`skills/${skill.nativeName}/${path}`;files[target]=bytes;if(skill.executables.has(path))executables.add(target);}
    }
    return ownedBundle({kind:'claude-session-projection',taskId:snapshot.taskId,selectionHash,formatVersion:1,sources:skills.map(s=>({resourceId:s.sourceResourceId,sourceHash:s.sourceHash,nativeName:s.nativeName}))},files,executables);
  }
  /** Verify a complete view against the full original S;never infer a new selection. */
  private claudeScope(manifest:OwnedBundleManifest,snapshot:CapabilitySessionSnapshotV2,requireFull=false):string[]{
    if(snapshot.runner!=='claude-code'||snapshot.provenance!=='created'||snapshot.legacyBinding)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','原Claude来源类型不支持此投影');
    const parsed=claudeMetadataSchema.safeParse(manifest.metadata),selected=digest(canonicalJson({...snapshot,native:{...snapshot.native,sessionId:null}}));
    if(!parsed.success||parsed.data.taskId!==snapshot.taskId||parsed.data.selectionHash!==selected)throw new ApplicationError('SNAPSHOT_IMMUTABLE','投影来源不属于完整原选择');
    const metadata=parsed.data,appSources=(p:CapabilitySessionSnapshotV2['packages'][number])=>p.skills.map(s=>({resourceId:'app:'+p.packageHash,sourceHash:s.contentHash,nativeName:s.nativeName}));
    const scope=snapshot.packages.filter(p=>appSources(p).some(source=>metadata.sources.some(s=>canonicalJson(s)===canonicalJson(source)))).map(p=>p.appId);
    const expected=[...snapshot.packages.filter(p=>scope.includes(p.appId)).flatMap(appSources),...snapshot.standardSkills.map(s=>({resourceId:`standard-skill:${s.skillId}:${s.hash}`,sourceHash:s.hash,nativeName:standardNativeSkillName(s.skillId,s.hash)}))];
    if(canonicalJson(metadata.sources)!==canonicalJson(expected)||(requireFull&&scope.length!==snapshot.packages.length))throw new ApplicationError('SNAPSHOT_IMMUTABLE','投影必须包含本轮应用的完整原Skill及全部原标准Skill');
    const names=expected.map(s=>s.nativeName);if(new Set(names).size!==names.length||manifest.files.some(f=>f.path!=='.claude-plugin/plugin.json'&&!names.some(name=>f.path.startsWith(`skills/${name}/`)))||names.some(name=>!manifest.files.some(f=>f.path===`skills/${name}/SKILL.md`)))throw new ApplicationError('SNAPSHOT_IMMUTABLE','投影来源目录或原名称不完整');
    return scope;
  }
  private sourceIdentity(taskId:string,hash:string,archive=false){const kind=archive?'claude-projection-archive':'claude-projection-source';return{kind,resourceId:`${kind}:${taskId}:${hash}`,relativePath:`projection-sources/claude/${taskId}/${archive?'archives':'views'}/${hash}`};}
  /** Immutable depot only;this does not publish or activate the native plugin root. */
  async claudeSource(taskId:string,applicationScope?:readonly string[]):Promise<ClaudeProjectionSource>{
    const current=await this.sessions.get(taskId),bundle=this.claudeBundle(current.snapshot,current.selectionHash,applicationScope),scope=this.claudeScope(bundle.manifest,current.snapshot),identity=this.sourceIdentity(taskId,bundle.hash);
    const dependencies=[...new Set((bundle.manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))];
    const resource=await this.store.publish({...identity,contentHash:bundle.hash,dependencies,materialize:stage=>writeOwnedBundle(stage,bundle,this.store.storeId),verify:directory=>{this.claudeScope(verifyOwnedBundle(directory,bundle.hash,this.store.storeId),current.snapshot);}});
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId);return{resource,bundle,applicationScope:Object.freeze(scope)};
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
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId);return{resource,bundle,applicationScope:Object.freeze(scope)};
  }
  async claude(taskId: string): Promise<{ resource: ResourceRecord;root: string }> {
    const current=await this.sessions.get(taskId),bundle=this.claudeBundle(current.snapshot,current.selectionHash),relativePath=`sessions/${taskId}/claude/plugin`,root=join(this.store.root,relativePath);
    const resource=await this.store.publish({resourceId:`session-projection:${taskId}:${bundle.hash}`,kind:'session-projection',contentHash:bundle.hash,relativePath,dependencies:[...new Set((bundle.manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))],materialize:stage=>writeOwnedBundle(stage,bundle,this.store.storeId),verify:directory=>{verifyOwnedBundle(directory,bundle.hash,this.store.storeId);}});
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId);return{resource,root};
  }
''' +s[b:]
needle='  verify(resource: ResourceRecord,snapshot: CapabilitySessionSnapshotV2): void {\n'
assert s.count(needle)==1
s=s.replace(needle,needle+'''    if(['claude-projection-source','claude-projection-archive'].includes(resource.kind)){
      const archive=resource.kind==='claude-projection-archive',identity=this.sourceIdentity(snapshot.taskId,resource.contentHash,archive);
      if(resource.pathScope!=='C'||resource.state!=='ready'||resource.integrity!=='valid'||resource.resourceId!==identity.resourceId||resource.relativePath!==identity.relativePath)throw new ApplicationError('OWNERSHIP_CONFLICT','Claude来源归属或就绪身份不同');
      const manifest=verifyOwnedBundle(this.store.directory(resource),resource.contentHash,this.store.storeId);this.claudeScope(manifest,snapshot,archive);
      const expected=archive?[]:[...new Set((manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))].sort(),actual=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(resource.resourceId) as {dependency_id:string}[]).map(r=>r.dependency_id);
      if(canonicalJson(actual)!==canonicalJson(expected))throw new ApplicationError('RESOURCE_STATE_CHANGED','Claude来源的完整依赖已改变');
      if(archive){const original=this.store.get(`session-projection:${snapshot.taskId}:${resource.contentHash}`),ref=this.store.sqlite.prepare("SELECT 1 FROM capability_session_refs WHERE task_id=? AND ref_id=? AND ref_kind='session-projection' AND ref_hash=?").get(snapshot.taskId,original.resourceId,resource.contentHash);if(!ref||original.kind!=='session-projection'||original.pathScope!=='C'||original.relativePath!==`sessions/${snapshot.taskId}/claude/plugin`)throw new ApplicationError('SNAPSHOT_IMMUTABLE','归档缺少原完整插件引用');}
      return;
    }
''')
p.write_text(s)
p=w/paths[1];s=p.read_text();s=s.replace("['session-projection','agent-projection','legacy-runtime'].includes(r.refKind)","['session-projection','agent-projection','legacy-runtime','claude-projection-source','claude-projection-archive'].includes(r.refKind)")
s=s.replace("['session-projection','agent-projection'].includes(ref.refKind)","['session-projection','agent-projection','claude-projection-source'].includes(ref.refKind)")
s=s.replace("['session-projection','agent-projection'].includes(resource.kind)","['session-projection','agent-projection','claude-projection-source','claude-projection-archive'].includes(resource.kind)")
p.write_text(s)
p=w/paths[2];s=p.read_text();s=s.replace("if(resource.kind==='session-projection')this.projector.verify(resource,snapshot)","if(['session-projection','claude-projection-source','claude-projection-archive'].includes(resource.kind))this.projector.verify(resource,snapshot)")
assert s.count("['session-projection','claude-projection-source','claude-projection-archive']")==2;p.write_text(s)
p=w/paths[3];s=p.read_text().replace("else if (resource.kind === 'session-projection') projector.verify(resource,snapshot)","else if (['session-projection','claude-projection-source','claude-projection-archive'].includes(resource.kind)) projector.verify(resource,snapshot)");p.write_text(s)
