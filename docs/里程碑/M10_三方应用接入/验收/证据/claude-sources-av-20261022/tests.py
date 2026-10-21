from pathlib import Path
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4')
p=w/'src/main/core/applications/__tests__/claude-projection-sources.test.ts';assert not p.exists()
p.write_text('''import {chmodSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {applicationNativeSkillName,type CapabilitySessionSnapshotV2} from '@shared/application-session';
import {applicationSkillContentHash} from '../session-registry';
import {agentFixture} from './agent-fixture';
let f:Awaited<ReturnType<typeof agentFixture>>,snapshot:CapabilitySessionSnapshotV2;
beforeEach(async()=>{
 f=await agentFixture();const source={manifest:structuredClone(f.source.manifest),files:{...f.source.files}},m=source.manifest;
 m.appId='mail';m.displayName='Controlled second app';m.permissions=m.permissions.map(p=>p.replace('zentao.','mail.'));m.tools=m.tools.map(t=>({...t,name:t.name.replace('zentao','mail'),permission:t.permission.replace('zentao.','mail.')}));
 const installed=await f.packages.install(source);await f.packages.activate(installed.packageHash,0);snapshot=f.plan();const server=snapshot.mcp.find(m=>m.kind==='applications')!.serverName;
 snapshot.packages.push({appId:'mail',version:installed.version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:m.hostApi,dataApi:m.dataApi,runtimeHash:m.runtime.hash,toolContractMajors:Object.fromEntries(m.tools.map(t=>[t.name,t.contractMajor])),skills:m.skills.map(s=>{const name=applicationNativeSkillName('mail',s.id,installed.packageHash);return{skillId:s.id,nativeName:name,contentHash:applicationSkillContentHash(m,s.path),sourceRelativePath:s.path,projectionPath:join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills',name,'SKILL.md')};}),bindings:[],allowedOperations:m.permissions});Object.assign(snapshot.adapterBinding.nativeToolNames,Object.fromEntries(m.tools.map(t=>[t.name,'mcp__'+server+'__'+t.name])));await f.sessions.create(snapshot,f.home);
});
afterEach(()=>f.cleanup());
const dependencies=(id:string)=>(f.sqlite.prepare('SELECT dependency_id AS id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(id) as {id:string}[]).map(r=>r.id);
describe('immutable Claude source views and full original archive;no native activation',()=>{
 it('retains exactly the old full bundle identity and actual canonical Skill paths after the build refactor',async()=>{
  const canonical=await f.projector.claude(snapshot.taskId),before=f.snapshotTree(canonical.root),source=await f.projector.claudeSource(snapshot.taskId);
  expect(source.bundle.hash).toBe(canonical.resource.contentHash);expect(source.resource.relativePath).not.toBe(canonical.resource.relativePath);expect(f.snapshotTree(f.store.directory(source.resource))).toEqual(before);expect(f.snapshotTree(canonical.root)).toEqual(before);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);expect(source.applicationScope).toEqual(['zentao','mail']);await f.sessions.verifyResources(snapshot.taskId);
 });
 it('prepares a complete healthy view with original standards while preserving the full native root and all original refs',async()=>{
  const canonical=await f.projector.claude(snapshot.taskId),before=f.snapshotTree(canonical.root),refs=await f.sessions.references(snapshot.taskId);rmSync(join(f.store.root,f.application.relativePath),{recursive:true});
  const source=await f.projector.claudeSource(snapshot.taskId,['mail']),name=snapshot.packages[1].skills[0].nativeName;
  expect(source.applicationScope).toEqual(['mail']);expect(Object.keys(source.bundle.files).some(p=>p.startsWith('skills/'+snapshot.packages[0].skills[0].nativeName+'/'))).toBe(false);expect(source.bundle.files[`skills/${name}/assets/data.bin`]).toEqual(Buffer.from([0,255,192,128,10]));expect(source.bundle.manifest.files.find(x=>x.path===`skills/${name}/scripts/run.sh`)!.executable).toBe(true);
  expect(dependencies(source.resource.resourceId)).toEqual(['app:'+snapshot.packages[1].packageHash,...snapshot.standardSkills.map(s=>`standard-skill:${s.skillId}:${s.hash}`)].sort());for(const s of snapshot.standardSkills)expect(source.bundle.files['skills/'+s.projectionPath.split('/').at(-2)+'/SKILL.md']).toBeTruthy();expect(f.snapshotTree(canonical.root)).toEqual(before);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);for(const ref of refs)expect(await f.sessions.references(snapshot.taskId)).toContainEqual(ref);expect(()=>f.projector.verify(source.resource,snapshot)).not.toThrow();
 });
 it('archives verified original full bytes without requiring unavailable original package bodies or falsely changing their state',async()=>{
  const canonical=await f.projector.claude(snapshot.taskId),before=f.snapshotTree(canonical.root);rmSync(join(f.store.root,f.application.relativePath),{recursive:true});f.sqlite.prepare("UPDATE capability_resources SET state='recovery-required',integrity='invalid' WHERE resource_id=?").run(f.application.resourceId);
  const source=await f.projector.archiveClaude(snapshot.taskId,canonical.resource.resourceId);expect(source.bundle.hash).toBe(canonical.resource.contentHash);expect(f.snapshotTree(f.store.directory(source.resource))).toEqual(before);expect(dependencies(source.resource.resourceId)).toEqual([]);expect(f.store.get(f.application.resourceId)).toMatchObject({state:'recovery-required',integrity:'invalid'});expect(f.store.get(canonical.resource.resourceId)).toEqual(canonical.resource);expect(()=>f.projector.verify(source.resource,snapshot)).not.toThrow();
  await expect(f.projector.claudeSource(snapshot.taskId)).rejects.toThrow();expect(()=>f.sessions.scopedReferencesCoordinated(snapshot.taskId,['mail'],[source.resource.resourceId])).toThrow('本轮投影');
 });
 it('does not manufacture an archive from a missing original root or drop its original reference',async()=>{
  const canonical=await f.projector.claude(snapshot.taskId),refs=await f.sessions.references(snapshot.taskId);rmSync(canonical.root,{recursive:true});await expect(f.projector.archiveClaude(snapshot.taskId,canonical.resource.resourceId)).rejects.toThrow();expect(await f.sessions.references(snapshot.taskId)).toEqual(refs);expect(f.sqlite.prepare("SELECT 1 FROM capability_resources WHERE kind='claude-projection-archive'").get()).toBeUndefined();
 });
 it.each(['link','mode','extra'] as const)('preserves a changed/user-owned original root and refuses its %s archive',async kind=>{
  const canonical=await f.projector.claude(snapshot.taskId),path=join(canonical.root,'skills',snapshot.packages[0].skills[0].nativeName,'scripts/run.sh'),foreign=join(f.root,'foreign');writeFileSync(foreign,'user bytes');
  if(kind==='link'){rmSync(path);symlinkSync(foreign,path);}if(kind==='mode')chmodSync(path,0o600);if(kind==='extra')writeFileSync(join(canonical.root,'user.txt'),'user bytes');
  await expect(f.projector.archiveClaude(snapshot.taskId,canonical.resource.resourceId)).rejects.toThrow();expect(readFileSync(foreign,'utf8')).toBe('user bytes');if(kind==='extra')expect(readFileSync(join(canonical.root,'user.txt'),'utf8')).toBe('user bytes');expect(f.sqlite.prepare("SELECT 1 FROM capability_resources WHERE kind='claude-projection-archive'").get()).toBeUndefined();
 });
 it('rejects another task projection even with the same selected package identities',async()=>{
  const other=f.plan();await f.sessions.create(other,f.home);const projection=await f.projector.claude(other.taskId);await expect(f.projector.archiveClaude(snapshot.taskId,projection.resource.resourceId)).rejects.toThrow('原会话已登记');
 });
 it('retains exact depot identities after the first native ID bind and only permits registered view roots for the healthy scope',async()=>{
  const source=await f.projector.claudeSource(snapshot.taskId,['mail']),original=await f.sessions.get(snapshot.taskId);const roots=f.sessions.scopedReferencesCoordinated(snapshot.taskId,['mail'],[source.resource.resourceId]);expect(roots.map(r=>r.refId)).toContain(source.resource.resourceId);expect(roots.map(r=>r.refId)).not.toContain(f.application.resourceId);
  const bound=await f.sessions.bindNativeSession(snapshot.taskId,original.pointer.snapshotHash,{...snapshot.native,runner:'claude-code',sessionId:'fixed-native-id'}),again=await f.projector.claudeSource(snapshot.taskId,['mail']);expect(again.resource.resourceId).toBe(source.resource.resourceId);expect(again.bundle.hash).toBe(source.bundle.hash);expect(()=>f.projector.verify(source.resource,bound.snapshot)).not.toThrow();
 });
 it('detects altered view dependencies or canonical aliases rather than trusting metadata alone',async()=>{
  const source=await f.projector.claudeSource(snapshot.taskId,['mail']);f.sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(source.resource.resourceId);expect(()=>f.projector.verify(source.resource,snapshot)).toThrow('完整依赖');expect(()=>f.projector.verify({...source.resource,relativePath:`sessions/${snapshot.taskId}/claude/plugin`},snapshot)).toThrow('归属');
 });
 it('does not allow a partial view to masquerade as a full original archive',async()=>{
  const source=await f.projector.claudeSource(snapshot.taskId,['mail']);await expect(f.projector.archiveClaude(snapshot.taskId,source.resource.resourceId)).rejects.toThrow('完整插件');
 });
});
''')
