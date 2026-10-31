from pathlib import Path
import json,shutil
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4'); e=Path('/private/tmp/m10-capability-conflicts-ba-20261022')
files=['src/main/core/applications/'+s for s in ['native-application-conflicts.ts','session-projector.ts','claude-delivery.ts','claude-delivery-state.ts','agent-adapter-registry.ts','task-capability-launcher.ts']]+['src/shared/agent-adapters.ts']
def edit(p,old,new,n=1):
 p=w/p;s=p.read_text();assert s.count(old)==n,(p,old[:90],s.count(old));p.write_text(s.replace(old,new))
p='src/main/core/applications/agent-adapter-registry.ts'
edit(p,"import {assertClaudeRunDelivery,","import {claudeProjectionSelection,selectedStandardSkills} from './claude-projection-selection';\nimport {assertClaudeRunDelivery,")
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
