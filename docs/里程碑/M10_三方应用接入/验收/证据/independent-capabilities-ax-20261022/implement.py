from pathlib import Path
import json,hashlib
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-independent-capabilities-ax-20261022')
changed=[]
def edit(rel,fn):
 p=w/rel;old=p.read_text();new=fn(old);assert new!=old,rel;(e/'before'/rel).parent.mkdir(parents=True,exist_ok=True);(e/'before'/rel).write_text(old);p.write_text(new);changed.append(rel)
def rep(s,a,b):assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
base='src/main/core/applications/'
def builtin(s):
 s=rep(s,'  trustedMetadata(hash: string): InstalledApplicationPackage {','  retainedMetadata(hash: string): InstalledApplicationPackage {')
 s=rep(s,'    const resource = this.store.get(installed.resourceId);','    return installed;\n  }\n  /** Executable metadata also requires a ready resource;retained identity grants nothing. */\n  trustedMetadata(hash:string):InstalledApplicationPackage {\n    const installed=this.retainedMetadata(hash);\n    const resource = this.store.get(installed.resourceId);');return s
edit(base+'builtin-package-registry.ts',builtin)
def scope(s):
 s=rep(s,'export const applicationRunScopeSchema=z.object({schema:z.literal(1),','const scopeFields=z.object({schema:z.literal(1),')
 marker='export type ApplicationRunScope='
 i=s.index(marker);s=s[:i]+"export const applicationRunScopeSchema=z.discriminatedUnion('schema',[scopeFields,scopeFields.extend({schema:z.literal(2),mode:z.literal('independent-capabilities'),applications:scopeFields.shape.applications.max(0).min(0)})]);\n"+s[i:];return s
edit(base+'application-run-scope.ts',scope)
def session(s):
 s=rep(s,'  private sourceReferences(snapshot: CapabilitySessionSnapshotV2): SessionResourceReference[] {','  private executionSelection(snapshot:CapabilitySessionSnapshotV2,appIds:readonly string[]):CapabilitySessionSnapshotV2 {return{...snapshot,packages:snapshot.packages.filter(p=>appIds.includes(p.appId)),mcp:snapshot.mcp.filter(m=>m.kind!==\'applications\'||appIds.length>0)};}\n  private sourceReferences(snapshot: CapabilitySessionSnapshotV2,initialScope?:readonly string[]): SessionResourceReference[] {\n    if(initialScope&&(snapshot.legacyBinding||new Set(initialScope).size!==initialScope.length||initialScope.some(id=>!snapshot.packages.some(p=>p.appId===id))))throw new ApplicationError(\'INVALID_INPUT\',\'初始资源范围不属于原选择\');\n    const required=this.expectedSources(initialScope?this.executionSelection(snapshot,initialScope):snapshot);')
 s=rep(s,"resource.contentHash !== expected.hash || resource.state !== 'ready' || resource.integrity !== 'valid'","resource.contentHash !== expected.hash || required.has(id)&&(resource.state !== 'ready' || resource.integrity !== 'valid')")
 s=rep(s,'async create(input: CapabilitySessionSnapshotV2,discoveryHome: string)','async create(input: CapabilitySessionSnapshotV2,discoveryHome: string,initialApplicationScope?:readonly string[])')
 s=rep(s,'const refs = this.sourceReferences(snapshot);','const refs = this.sourceReferences(snapshot,initialApplicationScope);')
 s=rep(s,'scopedReferencesCoordinated(taskId:string,appIds:readonly string[],projectionIds:readonly string[]=[])','scopedReferencesCoordinated(taskId:string,appIds:readonly string[],projectionIds:readonly string[]=[],independent=false)')
 s=rep(s,"snapshot.provenance!=='created'||!appIds.length||appIds.length>32","snapshot.provenance!=='created'||(!appIds.length&&!independent)||(independent&&appIds.length!==0)||appIds.length>32")
 s=rep(s,'this.expectedSources({...snapshot,packages:snapshot.packages.filter(p=>appIds.includes(p.appId))})','this.expectedSources(this.executionSelection(snapshot,appIds))')
 s=rep(s,'async verifyScopedResources(taskId:string,appIds:readonly string[],projectionIds:readonly string[])','async verifyScopedResources(taskId:string,appIds:readonly string[],projectionIds:readonly string[],independent=false)')
 s=rep(s,'const roots=this.scopedReferencesCoordinated(taskId,appIds,projectionIds);','const roots=this.scopedReferencesCoordinated(taskId,appIds,projectionIds,independent);');return s
edit(base+'session-registry.ts',session)
def runs(s):
 marker='  private async reserveManaged('
 i=s.index(marker);s=s[:i]+"  /** Explicit host-only zero application authority;ordinary empty scopes remain invalid. */\n  async reserveIndependent(input:z.infer<typeof reserveSchema>,projectionIds:readonly string[]=[],reservation?:{runId:string;ptyId:string},delivery?:ClaudeDeliveryToken):Promise<OwnedCapabilityRun>{return this.reserveManaged(input,reservation,{appIds:[],projectionIds:[...projectionIds],independent:true},delivery);}\n"+s[i:]
 s=rep(s,'narrowing?:{appIds:readonly string[];projectionIds:readonly string[]}','narrowing?:{appIds:readonly string[];projectionIds:readonly string[];independent?:true}')
 s=rep(s,'this.sessions.scopedReferencesCoordinated(value.taskId,narrowing.appIds,narrowing.projectionIds),payload={schema:1 as const,','this.sessions.scopedReferencesCoordinated(value.taskId,narrowing.appIds,narrowing.projectionIds,narrowing.independent===true),payload={...(narrowing.independent?{schema:2 as const,mode:\'independent-capabilities\' as const}:{schema:1 as const}),')
 s=s.replace('owned.scopeProjectionIds??[]):this.sessions.verifyResources','owned.scopeProjectionIds??[],owned.scope.schema===2):this.sessions.verifyResources')
 s=s.replace('owned.scopeProjectionIds??[]);else await this.sessions.verifyResources','owned.scopeProjectionIds??[],owned.scope.schema===2);else await this.sessions.verifyResources');return s
edit(base+'run-registry.ts',runs)
def projector(s):
 s=rep(s,'sourceSkills(snapshot: CapabilitySessionSnapshotV2,applicationScope?:readonly string[])','sourceSkills(snapshot: CapabilitySessionSnapshotV2,applicationScope?:readonly string[],independent=false)')
 s=rep(s,'(!applicationScope.length||new Set(applicationScope).size','((!applicationScope.length&&!independent)||(independent&&applicationScope.length!==0)||new Set(applicationScope).size')
 s=rep(s,'private claudeBundle(snapshot:CapabilitySessionSnapshotV2,selectionHash:string,applicationScope?:readonly string[])','private claudeBundle(snapshot:CapabilitySessionSnapshotV2,selectionHash:string,applicationScope?:readonly string[],independent=false)')
 s=rep(s,'skills=this.sourceSkills(snapshot,applicationScope),','skills=this.sourceSkills(snapshot,applicationScope,independent),')
 s=rep(s,'async claudeSource(taskId:string,applicationScope?:readonly string[])','async claudeSource(taskId:string,applicationScope?:readonly string[],independent=false)')
 s=rep(s,'this.claudeBundle(current.snapshot,current.selectionHash,applicationScope)','this.claudeBundle(current.snapshot,current.selectionHash,applicationScope,independent)');return s
edit(base+'session-projector.ts',projector)
edit('src/shared/claude-delivery.ts',lambda s:rep(rep(s,'z.object({taskId:','z.object({schema:z.literal(2),taskId:'),'.min(1).max(32)','.min(0).max(32)'))
def deliveryState(s):
 s=rep(s,")).min(1).max(32).refine(a=>", ")).min(0).max(32).refine(a=>")
 s=rep(s,'claudeSlotSchema=z.object({schema:z.literal(1),','claudeSlotSchema=z.object({schema:z.union([z.literal(1),z.literal(2)]),')
 line="consumers:z.array(consumer).max(128)}).strict();"
 s=rep(s,line,"consumers:z.array(consumer).max(128)}).strict().superRefine((slot,ctx)=>{if(slot.schema===1&&(slot.current?.appIds.length===0||slot.pending?.appIds.length===0))ctx.addIssue({code:'custom',message:'旧交付记录不能声明空应用范围'});});")
 s=rep(s,'return{taskId:token.taskId,leaseId:aliasLeaseId,','return{schema:2,taskId:token.taskId,leaseId:aliasLeaseId,')
 s=rep(s,' if(!slot||!v||!c||slot.pending||',' if(proof.schema!==2||!slot||!v||!c||slot.pending||');return s
edit(base+'claude-delivery-state.ts',deliveryState)
def delivery(s):
 s=rep(s,'return{taskId:slot.taskId,preparationId:id,','return{schema:2,taskId:slot.taskId,preparationId:id,')
 line=' async prepare(taskId:string,appIds:readonly string[]):Promise<ClaudeDeliveryToken>{'
 s=rep(s,line," async prepare(taskId:string,appIds:readonly string[]):Promise<ClaudeDeliveryToken>{return this.prepareSelection(taskId,appIds,false);}\n async prepareIndependent(taskId:string):Promise<ClaudeDeliveryToken>{return this.prepareSelection(taskId,[],true);}\n private async prepareSelection(taskId:string,appIds:readonly string[],independent:boolean):Promise<ClaudeDeliveryToken>{")
 s=rep(s,'source=await this.projector.claudeSource(taskId,appIds);if(!source.applicationScope.length)throw recovery();','source=await this.projector.claudeSource(taskId,appIds,independent);if(!source.applicationScope.length&&!independent)throw recovery();')
 s=rep(s,'this.recoverPreparation(slot);this.idle(slot);','this.recoverPreparation(slot);this.idle(slot);if(independent)slot.schema=2;')
 return s
edit(base+'claude-delivery.ts',delivery)
def shared(s):
 s=rep(s,'snapshot: capabilitySessionSnapshotSchema,claudeDelivery:','snapshot: capabilitySessionSnapshotSchema,independentCapabilities:z.literal(true).optional(),claudeDelivery:')
 s=rep(s,'.max(20)).min(1).max(32).optional()','.max(20)).min(0).max(32).optional()')
 marker="}).strict();\nexport type AgentLoadRequest"
 s=rep(s,marker,"}).strict().superRefine((v,ctx)=>{if(v.applicationScope?.length===0&&!v.independentCapabilities||v.independentCapabilities&&(!v.applicationScope||v.applicationScope.length!==0||v.mcp.some(m=>m.kind==='applications')))ctx.addIssue({code:'custom',message:'空应用范围须显式独立能力准备且不能注入应用桥'});});\nexport type AgentLoadRequest");return s
edit('src/shared/agent-adapters.ts',shared)
def adapter(s):
 # Conflicts concern only the MCPs actually injected by this host request.
 return rep(s,"item.kind === 'mcp' && snapshot.mcp.some(m => m.serverName === item.name)","item.kind === 'mcp' && input.mcp.some(m => m.serverName === item.name)")
edit(base+'agent-adapter-registry.ts',adapter)
def launcher(s):
 s=rep(s,'this.applications.builtin.trustedMetadata(packageHash)','this.applications.builtin.retainedMetadata(packageHash)')
 s=rep(s,'plannedReady.length>0&&plannedReady.length<planned.packages.length?plannedReady:undefined','plannedReady.length<planned.packages.length?plannedReady:undefined')
 s=rep(s,"if(planned.runner==='codex'&&!unavailable&&(plannedReady.length>0||planned.packages.length===0))","if(planned.runner==='codex'&&!unavailable)")
 s=rep(s,'this.projector.sourceSkills(planned,plannedScope)','this.projector.sourceSkills(planned,plannedScope,plannedScope?.length===0)')
 s=rep(s,'this.sessions.create(planned,input.home)','this.sessions.create(planned,input.home,plannedScope)')
 s=rep(s,'&&native&&ready.length>0&&(ready.length<snapshot.packages.length','&&native&&(ready.length<snapshot.packages.length')
 line="    const gateSnapshot=applicationScope?"
 s=rep(s,line,"    const independent=applicationScope?.length===0;\n"+line)
 s=s.replace('this.projector.sourceSkills(snapshot,applicationScope)','this.projector.sourceSkills(snapshot,applicationScope,independent)')
 s=rep(s,'deliveryToken=await this.claudeDelivery.prepare(input.taskId,applicationScope);','deliveryToken=independent?await this.claudeDelivery.prepareIndependent(input.taskId):await this.claudeDelivery.prepare(input.taskId,applicationScope);')
 s=rep(s,"ids=>applicationScope?this.runs.reserveScoped(","ids=>independent?this.runs.reserveIndependent({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},projectionIds,ids):applicationScope?this.runs.reserveScoped(")
 s=rep(s,'try{run=hold?.run??(deliveryToken?await this.runs.reserveScoped','try{run=hold?.run??(independent?await this.runs.reserveIndependent({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},projectionIds,undefined,deliveryToken):deliveryToken?await this.runs.reserveScoped')
 s=rep(s,'request={snapshot,...(applicationScope?{applicationScope}:{}),','request={snapshot,...(independent?{independentCapabilities:true as const}:{}),...(applicationScope?{applicationScope}:{}),')
 s=rep(s,"mcp:snapshot.mcp.map(m=>({kind:m.kind,","mcp:snapshot.mcp.filter(m=>m.kind==='applications'?!independent:this.capabilities.enabled(input.projectId,MCP_CAPABILITY)).map(m=>({kind:m.kind,")
 return s
edit(base+'task-capability-launcher.ts',launcher)
(e/'production-files.json').write_text(json.dumps(changed,indent=2)+'\n');print(json.dumps({'productionFiles':len(changed),'status':'draft;requires red retest/types/security regressions'}))
