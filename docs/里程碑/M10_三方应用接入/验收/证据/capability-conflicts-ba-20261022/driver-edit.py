from pathlib import Path
import json,shutil
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4'); e=Path('/private/tmp/m10-capability-conflicts-ba-20261022')
files=['src/main/core/applications/'+s for s in ['native-application-conflicts.ts','session-projector.ts','claude-delivery.ts','claude-delivery-state.ts','agent-adapter-registry.ts','task-capability-launcher.ts']]+['src/shared/agent-adapters.ts']
for p in files:
 q=e/'originals'/p;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(w/p,q)
def edit(p,old,new,n=1):
 p=w/p;s=p.read_text();assert s.count(old)==n,(p,old[:90],s.count(old));p.write_text(s.replace(old,new))
# Original schema1 continues to require every standard Skill. Only the new
# host-created format2 permits an explicit subset, tied to the same original S.
(w/'src/main/core/applications/claude-projection-selection.ts').write_text('''import {z} from 'zod';
import {basename,dirname} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import type {OwnedBundleManifest} from './owned-bundle';
import {canonicalJson,digest} from './manifest';
const source=z.object({resourceId:z.string().min(1).max(512),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),nativeName:z.string().min(1).max(64)}).strict();
const common={kind:z.literal('claude-session-projection'),taskId:z.string().min(1).max(128),selectionHash:z.string().regex(/^[a-f0-9]{64}$/),sources:z.array(source).max(4096)};
const metadata=z.discriminatedUnion('formatVersion',[
 z.object({...common,formatVersion:z.literal(1)}).strict(),
 z.object({...common,formatVersion:z.literal(2),standardSkillScope:z.array(z.string().min(1).max(4096)).max(4096)}).strict(),
]);
/** Loading scope only: never rewrites S, grants tools, or accepts foreign paths. */
export function selectedStandardSkills(snapshot:CapabilitySessionSnapshotV2,scope?:readonly string[]){
 const selected=snapshot.standardSkills.filter(s=>scope===undefined||scope.includes(s.projectionPath));
 if(scope&&(snapshot.legacyBinding||new Set(scope).size!==scope.length||selected.length!==scope.length||canonicalJson(selected.map(s=>s.projectionPath))!==canonicalJson(scope)))throw new ApplicationError('INVALID_INPUT','标准Skill加载范围必须是原固定选择的有序子集');
 return selected;
}
/** Verify complete App Skill groups and explicit standard subset against full S.
 * Also reject hidden/extraneous files because Claude discovers the physical tree. */
export function claudeProjectionSelection(manifest:OwnedBundleManifest,snapshot:CapabilitySessionSnapshotV2,requireFull=false):{appIds:string[];standardSkillScope:string[]}{
 const fail=()=>new ApplicationError('SNAPSHOT_IMMUTABLE','Claude投影必须对应原选择及明确的完整加载范围');
 if(snapshot.runner!=='claude-code'||snapshot.provenance!=='created'||snapshot.legacyBinding)throw fail();
 const parsed=metadata.safeParse(manifest.metadata),selectionHash=digest(canonicalJson({...snapshot,native:{...snapshot.native,sessionId:null}}));
 if(!parsed.success||parsed.data.taskId!==snapshot.taskId||parsed.data.selectionHash!==selectionHash)throw fail();
 const value=parsed.data,standards=selectedStandardSkills(snapshot,value.formatVersion===2?value.standardSkillScope:undefined),appSources=(p:CapabilitySessionSnapshotV2['packages'][number])=>p.skills.map(s=>({resourceId:'app:'+p.packageHash,sourceHash:s.contentHash,nativeName:s.nativeName}));
 const appIds=snapshot.packages.filter(p=>appSources(p).some(source=>value.sources.some(s=>canonicalJson(s)===canonicalJson(source)))).map(p=>p.appId);
 const expected=[...snapshot.packages.filter(p=>appIds.includes(p.appId)).flatMap(appSources),...standards.map(s=>({resourceId:`standard-skill:${s.skillId}:${s.hash}`,sourceHash:s.hash,nativeName:basename(dirname(s.projectionPath))}))];
 if(canonicalJson(value.sources)!==canonicalJson(expected)||requireFull&&(appIds.length!==snapshot.packages.length||standards.length!==snapshot.standardSkills.length))throw fail();
 const names=expected.map(s=>s.nativeName);
 if(new Set(names).size!==names.length||manifest.files.some(f=>f.path!=='.claude-plugin/plugin.json'&&!names.some(name=>f.path.startsWith(`skills/${name}/`)))||names.some(name=>!manifest.files.some(f=>f.path===`skills/${name}/SKILL.md`)))throw fail();
 return{appIds,standardSkillScope:standards.map(s=>s.projectionPath)};
}
''')
p='src/main/core/applications/native-application-conflicts.ts'
edit(p,"export function nativeApplicationConflicts(snapshot:CapabilitySessionSnapshotV2,native:NativeLaunchContext):Set<string>{\n const conflicts=new Set<string>();", "export function nativeCapabilityConflicts(snapshot:CapabilitySessionSnapshotV2,native:NativeLaunchContext):{applications:Set<string>;standardSkills:Set<string>;projectMcp:boolean}{\n const conflicts=new Set<string>(),standards=new Set<string>();let projectMcp=false;")
edit(p,"  if(item.kind==='skill'&&ownPaths.has(item.path))continue;", "  if(item.kind==='skill'&&ownPaths.has(item.path))continue;\n  if(item.kind==='mcp'&&snapshot.mcp.some(m=>m.kind==='legacy-project-context'&&m.serverName===item.name))projectMcp=true;\n  if(item.kind==='plugin'&&snapshot.runner==='claude-code'&&item.name==='smartdd-session'){for(const p of snapshot.packages)conflicts.add(p.appId);for(const s of snapshot.standardSkills)standards.add(s.projectionPath);continue;}\n  if(item.kind==='skill')for(const s of snapshot.standardSkills){const name=dirname(s.projectionPath).split('/').at(-1);if(item.name===name||item.name==='smartdd-session:'+name)standards.add(s.projectionPath);}")
edit(p,"  for(const p of snapshot.packages)if(p.skills.some(s=>path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath))))conflicts.add(p.appId);", "  for(const p of snapshot.packages)if(p.skills.some(s=>path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath))))conflicts.add(p.appId);\n  for(const s of snapshot.standardSkills)if(path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath)))standards.add(s.projectionPath);")
edit(p," return conflicts;\n}"," return{applications:conflicts,standardSkills:standards,projectMcp};\n}\n/** Compatibility helper for callers that only need per-App attribution. */\nexport function nativeApplicationConflicts(snapshot:CapabilitySessionSnapshotV2,native:NativeLaunchContext):Set<string>{return nativeCapabilityConflicts(snapshot,native).applications;}\n")
p='src/main/core/applications/session-projector.ts'
edit(p,"import {verifyClaudeDelivery}","import {claudeProjectionSelection,selectedStandardSkills} from './claude-projection-selection';\nimport {verifyClaudeDelivery}")
s=(w/p).read_text();start=s.index('const claudeMetadataSchema=');end=s.index('\nexport type ClaudeProjectionSource=',start);s=s[:start]+s[end:];start=s.index('    if(snapshot.runner',s.index('  private claudeScope('));end=s.index('\n  private sourceIdentity',start);s=s[:start]+"    return claudeProjectionSelection(manifest,snapshot,requireFull).appIds;\n  }"+s[end:];s=s.replace("import {z} from 'zod';\n",'');(w/p).write_text(s)
edit(p,"applicationScope?:readonly string[],independent=false)","applicationScope?:readonly string[],independent=false,standardSkillScope?:readonly string[])",3)
edit(p,"for (const standard of snapshot.standardSkills)","for (const standard of selectedStandardSkills(snapshot,standardSkillScope))")
edit(p,"this.sourceSkills(snapshot,applicationScope,independent)","this.sourceSkills(snapshot,applicationScope,independent,standardSkillScope)")
edit(p,"selectionHash,formatVersion:1,sources:","selectionHash,...(standardSkillScope?{formatVersion:2,standardSkillScope:[...standardSkillScope]}:{formatVersion:1}),sources:")
edit(p,"this.claudeBundle(current.snapshot,current.selectionHash,applicationScope,independent)","this.claudeBundle(current.snapshot,current.selectionHash,applicationScope,independent,standardSkillScope)")
p='src/main/core/applications/claude-delivery.ts'
edit(p,"async prepare(taskId:string,appIds:readonly string[]):Promise<ClaudeDeliveryToken>{return this.prepareSelection(taskId,appIds,false);}","async prepare(taskId:string,appIds:readonly string[],standardSkillScope?:readonly string[]):Promise<ClaudeDeliveryToken>{return this.prepareSelection(taskId,appIds,false,standardSkillScope);}")
edit(p,"async prepareIndependent(taskId:string):Promise<ClaudeDeliveryToken>{return this.prepareSelection(taskId,[],true);}","async prepareIndependent(taskId:string,standardSkillScope?:readonly string[]):Promise<ClaudeDeliveryToken>{return this.prepareSelection(taskId,[],true,standardSkillScope);}")
edit(p,"private async prepareSelection(taskId:string,appIds:readonly string[],independent:boolean)","private async prepareSelection(taskId:string,appIds:readonly string[],independent:boolean,standardSkillScope?:readonly string[])")
edit(p,"this.projector.claudeSource(taskId,appIds,independent)","this.projector.claudeSource(taskId,appIds,independent,standardSkillScope)")
p='src/main/core/applications/claude-delivery-state.ts'
edit(p,"import {randomUUID}","import {claudeProjectionSelection} from './claude-projection-selection';\nimport {randomUUID}")
s=(w/p).read_text();start=s.index(' const expected=[',s.index('export function verifyClaudeDelivery'));end=s.index('\n return slot;',start);s=s[:start]+" const selected=claudeProjectionSelection(manifest,snapshot);\n if(canonicalJson(selected.appIds)!==canonicalJson(v.appIds)||canonicalJson(verifyOwnedBundle(store.directory(source),v.hash,store.storeId))!==canonicalJson(manifest))throw fail();"+s[end:];s=s.replace(" const manifest=verifyOwnedBundle(store.directory(resource),v.hash,store.storeId),metadata=manifest.metadata;"," const manifest=verifyOwnedBundle(store.directory(resource),v.hash,store.storeId);");(w/p).write_text(s)
p='src/shared/agent-adapters.ts'
edit(p,"snapshot: capabilitySessionSnapshotSchema,independentCapabilities:","snapshot: capabilitySessionSnapshotSchema,standardSkillScope:z.array(absolute).max(4096).optional(),independentCapabilities:")
p='src/main/core/applications/agent-adapter-registry.ts'
edit(p,"import {assertClaudeRunDelivery}","import {claudeProjectionSelection,selectedStandardSkills} from './claude-projection-selection';\nimport {assertClaudeRunDelivery}")
edit(p,"    const allSkills =", "    const standards=selectedStandardSkills(snapshot,input.standardSkillScope);\n    if(input.standardSkillScope&&snapshot.runner==='claude-code'&&!input.claudeDelivery)throw new ApplicationError('INVALID_INPUT','标准Skill子集须经过本轮Claude原目录交付');\n    const allSkills =")
edit(p,"...snapshot.standardSkills.map(s => ({ path:","...standards.map(s => ({ path:")
edit(p,"      const projection = verifyOwnedBundle(input.pluginRoot,input.pluginHash,this.store.storeId);", "      const projection = verifyOwnedBundle(input.pluginRoot,input.pluginHash,this.store.storeId);\n      const selected=claudeProjectionSelection(projection,snapshot);if(canonicalJson(selected.appIds)!==canonicalJson(applications.map(p=>p.appId))||canonicalJson(selected.standardSkillScope)!==canonicalJson(standards.map(s=>s.projectionPath)))throw new ApplicationError('SNAPSHOT_IMMUTABLE','实际Claude目录与本轮加载范围不同');")
edit(p,"snapshot.runner === 'claude-code' && input.pluginRoot && item.name", "snapshot.runner === 'claude-code' && allSkills.length>0 && input.pluginRoot && item.name")
edit(p,"snapshot:input.applicationScope?{...input.snapshot,packages:input.snapshot.packages.filter(p=>input.applicationScope!.includes(p.appId))}:input.snapshot", "snapshot:{...input.snapshot,packages:input.snapshot.packages.filter(p=>input.applicationScope===undefined||input.applicationScope.includes(p.appId)),standardSkills:selectedStandardSkills(input.snapshot,input.standardSkillScope)}")
p='src/main/core/applications/task-capability-launcher.ts'
edit(p,"import {nativeApplicationConflicts}","import {nativeCapabilityConflicts}")
edit(p,"const plannedConflicts=native?nativeApplicationConflicts(planned,native):new Set<string>(),plannedReady", "const plannedFacets=native?nativeCapabilityConflicts(planned,native):undefined,plannedStandards=plannedFacets?.standardSkills.size?planned.standardSkills.filter(s=>!plannedFacets.standardSkills.has(s.projectionPath)).map(s=>s.projectionPath):undefined,plannedConflicts=plannedFacets?.applications??new Set<string>(),plannedReady")
edit(p,"this.projector.sourceSkills(planned,plannedScope,plannedScope?.length===0)","this.projector.sourceSkills(planned,plannedScope,plannedScope?.length===0,plannedStandards)")
edit(p,"const conflicts=native&&!snapshot.legacyBinding?nativeApplicationConflicts(snapshot,native):new Set<string>(),ready=", "const facets=native&&!snapshot.legacyBinding?nativeCapabilityConflicts(snapshot,native):undefined,standardSkillScope=facets?.standardSkills.size?snapshot.standardSkills.filter(s=>!facets.standardSkills.has(s.projectionPath)).map(s=>s.projectionPath):undefined,standardSkills=snapshot.standardSkills.filter(s=>standardSkillScope===undefined||standardSkillScope.includes(s.projectionPath)),conflicts=facets?.applications??new Set<string>(),ready=")
edit(p,"snapshot.runner==='claude-code'&&this.claudeDelivery.has(snapshot.taskId))?ready", "snapshot.runner==='claude-code'&&(this.claudeDelivery.has(snapshot.taskId)||standardSkillScope!==undefined))?ready")
edit(p,"this.projector.sourceSkills(snapshot,applicationScope,independent)","this.projector.sourceSkills(snapshot,applicationScope,independent,standardSkillScope)",2)
edit(p,"this.claudeDelivery.prepareIndependent(input.taskId):await this.claudeDelivery.prepare(input.taskId,applicationScope)","this.claudeDelivery.prepareIndependent(input.taskId,standardSkillScope):await this.claudeDelivery.prepare(input.taskId,applicationScope,standardSkillScope)")
edit(p,"const mcpName=snapshot.mcp.find(m=>m.kind==='legacy-project-context')?.serverName??null;", "const mcpName=facets?.projectMcp?null:snapshot.mcp.find(m=>m.kind==='legacy-project-context')?.serverName??null;")
edit(p,"skills:RuntimeSkill[]=unavailable?[]:snapshot.standardSkills.map(","skills:RuntimeSkill[]=unavailable?[]:standardSkills.map(")
edit(p,"Object.fromEntries(snapshot.standardSkills.map(s=>{const source=sources.find", "Object.fromEntries(standardSkills.map(s=>{const source=sources.find")
edit(p,"request={snapshot,...(independent?", "request={snapshot,...(standardSkillScope?{standardSkillScope}:{}),...(independent?")
edit(p,"m.kind==='applications'?!independent:this.capabilities.enabled(input.projectId,MCP_CAPABILITY)","m.kind==='applications'?!independent:!facets?.projectMcp&&this.capabilities.enabled(input.projectId,MCP_CAPABILITY)")
(e/'implementation-files.json').write_text(json.dumps(files+['src/main/core/applications/claude-projection-selection.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts'],indent=2)+'\n')
print('BA source overlay written; immutable adapters untouched')
