from pathlib import Path
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4')
p=w/'src/main/core/applications/session-projector.ts';s=p.read_text();s=s.replace("export type ClaudeProjectionSource={resource:ResourceRecord;bundle:OwnedBundle;applicationScope:readonly string[]};","export type ClaudeProjectionSource={role:'view'|'archive';resource:ResourceRecord;bundle:OwnedBundle;applicationScope:readonly string[]};")
s=s.replace("return{resource,bundle,applicationScope:Object.freeze(scope)};", "return{role:'view',resource,bundle,applicationScope:Object.freeze(scope)};",1)
pos=s.index('  async archiveClaude(');a=s[:pos];b=s[pos:];b=b.replace("return{resource,bundle,applicationScope:Object.freeze(scope)};","return{role:'archive',resource,bundle,applicationScope:Object.freeze(scope)};",1);s=a+b
needle='  async claude(taskId: string): Promise<{ resource: ResourceRecord;root: string }> {'
assert s.count(needle)==1
s=s.replace(needle,'''  /** Read verified static depot bytes.This is not a canonical-root lease or a
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
'''+needle);p.write_text(s)
p=w/'src/main/core/applications/session-registry.ts';s=p.read_text();s=s.replace("['session-projection','agent-projection','claude-projection-source'].includes(ref.refKind)","['session-projection','agent-projection'].includes(ref.refKind)");p.write_text(s)
p=w/'src/main/core/applications/__tests__/claude-projection-sources.test.ts';s=p.read_text();old="it('retains exact depot identities after the first native ID bind and only permits registered view roots for the healthy scope',async()=>{"
s=s.replace(old,"it('retains exact depot identities after first native ID binding without accepting static sources as native projection roots',async()=>{")
old="const roots=f.sessions.scopedReferencesCoordinated(snapshot.taskId,['mail'],[source.resource.resourceId]);expect(roots.map(r=>r.refId)).toContain(source.resource.resourceId);expect(roots.map(r=>r.refId)).not.toContain(f.application.resourceId);"
new="expect(()=>f.sessions.scopedReferencesCoordinated(snapshot.taskId,['mail'],[source.resource.resourceId])).toThrow('本轮投影');"
assert s.count(old)==1;s=s.replace(old,new)
needle=" it('does not allow a partial view to masquerade as a full original archive',async()=>{"
assert s.count(needle)==1
s=s.replace(needle,""" it('reads the same immutable static view after source loss without creating a native run,lease or discovery receipt',async()=>{
  const source=await f.projector.claudeSource(snapshot.taskId,['mail']),app=f.packages.get(snapshot.packages[1].packageHash);rmSync(join(f.store.root,app.relativePath),{recursive:true});const beforeRuns=f.sqlite.prepare('SELECT * FROM capability_runs').all(),beforeLeases=f.sqlite.prepare('SELECT * FROM capability_resource_leases').all(),copy=await f.projector.readClaudeArtifact(snapshot.taskId,source.resource.resourceId);
  expect(copy.role).toBe('view');expect(copy.bundle.hash).toBe(source.bundle.hash);expect(copy.bundle.files).toEqual(source.bundle.files);expect(copy.applicationScope).toEqual(['mail']);expect(f.sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual(beforeRuns);expect(f.sqlite.prepare('SELECT * FROM capability_resource_leases').all()).toEqual(beforeLeases);expect(await f.sessions.get(snapshot.taskId)).toMatchObject({snapshot});
 });
 it('reads the original archive only as an archive and refuses missing original full reference or modified archive bytes',async()=>{
  const canonical=await f.projector.claude(snapshot.taskId),archive=await f.projector.archiveClaude(snapshot.taskId,canonical.resource.resourceId);expect((await f.projector.readClaudeArtifact(snapshot.taskId,archive.resource.resourceId)).role).toBe('archive');
  const path=join(f.store.directory(archive.resource),'.claude-plugin/plugin.json'),original=readFileSync(path);writeFileSync(path,'{}');await expect(f.projector.readClaudeArtifact(snapshot.taskId,archive.resource.resourceId)).rejects.toThrow();writeFileSync(path,original);
  f.sqlite.prepare('DELETE FROM capability_session_refs WHERE task_id=? AND ref_id=?').run(snapshot.taskId,canonical.resource.resourceId);await expect(f.projector.readClaudeArtifact(snapshot.taskId,archive.resource.resourceId)).rejects.toThrow('原完整插件引用');
 });
"""+needle);p.write_text(s)
