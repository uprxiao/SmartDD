from pathlib import Path
import json,hashlib
p=Path('/private/tmp/m10-legacy-guard-bd-20261022');w=p/'candidate';bc=Path('/private/tmp/m10-native-omissions-bc-20261022');base='src/main/core/applications/';files=['native-discovery-exclusions.ts','native-static-roots.ts','discovery-catalog.ts','agent-adapter-registry.ts','task-capability-launcher.ts'];original={n:(w/(base+n)).read_text()for n in files};updates=dict(original)
def replace(name,old,new,count=1):
 s=updates[name];assert s.count(old)==count,(name,old[:90],s.count(old),count);updates[name]=s.replace(old,new)
replace('native-discovery-exclusions.ts',"import {assertDiscoveryPath} from './legacy-discovery';","import {assertDiscoveryPath,legacyDiscoveryEntry,verifyLegacyDiscoveryEntry} from './legacy-discovery';")
anchor="interface CatalogBinding {"
addition='''/** A retention candidate is not an ownership claim. Legacy identity must still
 * match the complete registered entry before any physical failure can be omitted. */
export function nativeGuardEntryUnavailable(entry:Entry,home:string,legacy=false):boolean{
 if(entry.format){
  if(!legacy)throw new ApplicationError('SCOPE_DENIED','旧格式目录不能使用现代加载排除');
  const match=/^smartdd-([a-z][a-z0-9-]{0,63})-([a-f0-9]{16})$/.exec(entry.nativeName);
  if(!match||canonicalJson(legacyDiscoveryEntry(entry.storeId,home,match[1],entry.sourceHash))!==canonicalJson(entry))throw recovery();
 }
 try{if(entry.format)verifyLegacyDiscoveryEntry(entry,home);else verifyModernDiscoveryProjection(entry,home);return false;}
 catch(error){
  if(error instanceof ApplicationError&&['HASH_MISMATCH','OWNERSHIP_CONFLICT',...(entry.format?['RESOURCE_RECOVERY_REQUIRED']:[])].includes(error.code))return true;
  if(entry.format&&['ENOENT','ENOTDIR','EACCES','EPERM','ELOOP'].includes((error as NodeJS.ErrnoException).code??''))return true;
  throw error;
 }
}

'''
replace('native-discovery-exclusions.ts',anchor,addition+anchor)
replace('native-discovery-exclusions.ts',"function unverifiedPaths(catalog:CatalogBinding['catalog'],home:string,paths:readonly string[],selectedPaths:readonly string[]):Set<string>{","function unverifiedPaths(catalog:CatalogBinding['catalog'],home:string,paths:readonly string[],selectedPaths:readonly string[],legacy=false):Set<string>{")
old="for(const path of excluded){const entry=catalog.entries.find(e=>e.path===path);if(!entry||entry.format||selectedPaths.includes(path))throw new ApplicationError('SCOPE_DENIED','不能排除旧格式、未知路径或本轮启用的受管Skill');let unavailable=false;try{verifyModernDiscoveryProjection(entry,home);}catch(error){if(error instanceof ApplicationError&&['HASH_MISMATCH','OWNERSHIP_CONFLICT'].includes(error.code))unavailable=true;else throw error;}if(!unavailable)throw new ApplicationError('RESOURCE_STATE_CHANGED','原目录已恢复受管归属，须重新准备而非扩大本轮加载');}"
new="for(const path of excluded){const entry=catalog.entries.find(e=>e.path===path);if(!entry||entry.format&&!legacy||selectedPaths.includes(path))throw new ApplicationError('SCOPE_DENIED','不能排除旧格式、未知路径或本轮启用的受管Skill');if(!nativeGuardEntryUnavailable(entry,home,legacy))throw new ApplicationError('RESOURCE_STATE_CHANGED','原目录已恢复受管归属，须重新准备而非扩大本轮加载');}"
replace('native-discovery-exclusions.ts',old,new)
replace('native-discovery-exclusions.ts',"const guardSelectionSchema=z.object({schema:z.literal('native-guard-discovery-omissions-v1')","const modernGuardSelectionSchema=z.object({schema:z.literal('native-guard-discovery-omissions-v1')")
replace('native-discovery-exclusions.ts',"export type NativeGuardDiscoverySelection=", "const guardSelectionSchema=z.discriminatedUnion('schema',[modernGuardSelectionSchema,modernGuardSelectionSchema.extend({schema:z.literal('native-guard-retention-omissions-v1')}).strict()]);\nexport type NativeGuardDiscoverySelection=")
replace('native-discovery-exclusions.ts',"unverifiedPaths(selection.catalog,selection.home,selection.paths,[]);record.assertOwnedGuard();return record;", "if(selection.schema==='native-guard-retention-omissions-v1'&&!selection.paths.some(path=>selection.catalog.entries.find(e=>e.path===path)?.format==='legacy-tree-v1'))throw recovery();\n unverifiedPaths(selection.catalog,selection.home,selection.paths,[],selection.schema==='native-guard-retention-omissions-v1');record.assertOwnedGuard();return record;")
replace('native-discovery-exclusions.ts',"if(r.kind!=='agent-projection'||r.pathScope", "if(r.kind!==(entry.format?'legacy-agent-projection':'agent-projection')||r.pathScope")
replace('native-discovery-exclusions.ts',"const {selection,context}=guardRecord(store,proof);if(context.runner!=='codex')throw recovery();return{schema:'native-discovery-exclusions-v1'", "const {selection,context}=guardRecord(store,proof);if(context.runner!=='codex')throw recovery();if(selection.paths.some(path=>selection.catalog.entries.find(e=>e.path===path)?.format))throw new ApplicationError('SCOPE_DENIED','旧格式排除只能用于本轮零授权守护规划');return{schema:'native-discovery-exclusions-v1'")
updates['native-discovery-exclusions.ts']+='''
/** Pure-false planning only. The opaque live guard is independent from the old
 * serialized modern-exclusion field, whose legacy rejection stays unchanged. */
export function nativeGuardPlanOmissions(store:ResourceStore,proof:NativeGuardDiscoveryProof,input:AgentLoadRequest):Set<string>{
 const {selection,context}=guardRecord(store,proof),snapshot=input.snapshot;
 if(context.runner!=='codex'||input.runId!==context.runId||snapshot.runner!==context.runner||snapshot.taskId!==context.taskId||snapshot.projectId!==context.projectId||snapshot.packages.length||snapshot.standardSkills.length||snapshot.mcp.length||Object.keys(snapshot.adapterBinding.nativeToolNames).length||snapshot.legacyBinding||input.mcp.length||input.pluginRoot!==null||input.pluginHash!==null||input.catalogExclusions||input.applicationScope||input.standardSkillScope||input.claudeDelivery||input.currentExecutable!==process.execPath||!input.catalog)throw recovery();
 const omitted=nativeGuardCatalogOmissions(store,proof,input.native.home,input.catalog);
 const row=store.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(context.taskId) as {snapshot_json:string};
 const source=JSON.parse(row.snapshot_json),native=context.kind==='fixed'?source.native:source;
 if(input.native.runner!==context.runner||input.native.cwd!==native.cwd||input.native.stateRoot!==native.stateRoot||input.native.sessionId!==native.sessionId)throw recovery();
 const adapter=store.get('agent-adapter:'+context.runner+':'+snapshot.adapterBinding.hash);
 const held=store.sqlite.prepare("SELECT 1 FROM capability_lease_resources r JOIN capability_resource_leases l ON l.lease_id=r.lease_id WHERE l.owner_kind='run' AND l.owner_id=? AND r.resource_id=? AND r.content_hash=? AND r.generation=?").get(context.runId,adapter.resourceId,adapter.contentHash,adapter.generation);if(!held)throw recovery();
 return omitted;
}
'''
replace('native-static-roots.ts',"if(omitted.has(r.resourceId)){if(r.kind!=='agent-projection')throw invalid();continue;}","if(omitted.has(r.resourceId))continue;")
replace('discovery-catalog.ts',"import {verifyModernDiscoveryProjection,nativeGuardCatalogOmissions", "import {verifyModernDiscoveryProjection,nativeGuardEntryUnavailable,nativeGuardCatalogOmissions")
replace('discovery-catalog.ts',"const raw=this.catalog(),paths:string[]=[];for(const entry of raw.entries){if(entry.format)continue;try{verifyModernDiscoveryProjection(entry,this.home);}catch(error){if(error instanceof ApplicationError&&['OWNERSHIP_CONFLICT','HASH_MISMATCH'].includes(error.code))paths.push(entry.path);else throw error;}}\n        return paths.length?{schema:'native-guard-discovery-omissions-v1' as const,home:this.home,catalog:structuredClone({generation:raw.generation,entries:raw.entries}),paths}:undefined;", "const raw=this.catalog(),paths:string[]=[];let legacy=false;for(const entry of raw.entries)if(nativeGuardEntryUnavailable(entry,this.home,true)){paths.push(entry.path);if(entry.format)legacy=true;}\n        return paths.length?{schema:legacy?'native-guard-retention-omissions-v1' as const:'native-guard-discovery-omissions-v1' as const,home:this.home,catalog:structuredClone({generation:raw.generation,entries:raw.entries}),paths}:undefined;")
replace('discovery-catalog.ts',"if(omitted.has(entry.path)){if(entry.format)throw new ApplicationError('SCOPE_DENIED','旧目录不参与普通守护的新格式排除');continue;}","if(omitted.has(entry.path))continue;")
replace('agent-adapter-registry.ts',"import {validateNativeDiscoveryExclusions}","import {validateNativeDiscoveryExclusions,nativeGuardPlanOmissions,type NativeGuardDiscoveryProof}")
replace('agent-adapter-registry.ts',"private preflight(installed: InstalledAgentAdapter,input: AgentLoadRequest): void", "private preflight(installed: InstalledAgentAdapter,input: AgentLoadRequest,guardOmissions?:ReadonlySet<string>): void")
replace('agent-adapter-registry.ts',"const excludedH=validateNativeDiscoveryExclusions(this.store,input,allSkills.map(s=>s.path));", "const excludedH=guardOmissions??validateNativeDiscoveryExclusions(this.store,input,allSkills.map(s=>s.path));")
replace('agent-adapter-registry.ts',"  plan(hash: string,value: AgentLoadRequest): AgentLoadPlan {", "  plan(hash:string,value:AgentLoadRequest):AgentLoadPlan{return this.planChecked(hash,value);}\n  planNativeGuard(hash:string,value:AgentLoadRequest,proof:NativeGuardDiscoveryProof):AgentLoadPlan{return this.planChecked(hash,value,proof);}\n  private planChecked(hash:string,value:AgentLoadRequest,proof?:NativeGuardDiscoveryProof):AgentLoadPlan {")
replace('agent-adapter-registry.ts',"this.preflight(installed,input);", "const omitted=proof?nativeGuardPlanOmissions(this.store,proof,input):undefined;this.preflight(installed,input,omitted);")
replace('agent-adapter-registry.ts',"...(input.catalog&&input.catalogExclusions?{catalog:{...input.catalog,entries:input.catalog.entries.filter(e=>!input.catalogExclusions!.paths.includes(e.path))}}:{})", "...(input.catalog&&(omitted||input.catalogExclusions)?{catalog:{...input.catalog,entries:input.catalog.entries.filter(e=>!omitted?.has(e.path)&&!input.catalogExclusions?.paths.includes(e.path))}}:{})")
replace('task-capability-launcher.ts',"import {nativeGuardAdapterExclusions,type NativeGuardDiscoveryProof}","import {nativeGuardCatalogOmissions,type NativeGuardDiscoveryProof}")
replace('task-capability-launcher.ts',"const omissions=discoveryProof?nativeGuardAdapterExclusions(this.support.store,discoveryProof):undefined,flags=", "const omissions=discoveryProof?nativeGuardCatalogOmissions(this.support.store,discoveryProof,catalog.home,collection):undefined,flags=",2)
replace('task-capability-launcher.ts',"!omissions?.paths.includes(e.path)","!omissions?.has(e.path)",2)
replace('task-capability-launcher.ts',"args=this.support.adapters.plan(isolation.hash,{snapshot:hidden,...(omissions?{catalogExclusions:omissions}:{}),runId:","const request={snapshot:hidden,runId:")
replace('task-capability-launcher.ts',"args=this.support.adapters.plan(adapter.hash,{snapshot,...(omissions?{catalogExclusions:omissions}:{}),runId:","const request={snapshot,runId:")
# Finish each already scoped pure-false request separately.
name='task-capability-launcher.ts';lines=updates[name].splitlines();found=0
for i,line in enumerate(lines):
 if 'const request={snapshot:hidden,runId:' in line:
  assert line.endswith('}).args;');lines[i]=line[:-len('}).args;')]+'};args=(discoveryProof?this.support.adapters.planNativeGuard(isolation.hash,request,discoveryProof):this.support.adapters.plan(isolation.hash,request)).args;';found+=1
 elif 'const request={snapshot,runId:' in line:
  assert line.endswith('}).args;');lines[i]=line[:-len('}).args;')]+'};args=(discoveryProof?this.support.adapters.planNativeGuard(adapter.hash,request,discoveryProof):this.support.adapters.plan(adapter.hash,request)).args;';found+=1
assert found==2;updates[name]='\n'.join(lines)+'\n'
# Verify every source anchor and old byte sequence before making any mutation.
for n in files:assert (w/(base+n)).read_text()==original[n]
raw=p/'originals';raw.mkdir(exist_ok=True);manifest=[]
for n in files:
 b=original[n].encode();target=raw/(base+n);target.parent.mkdir(parents=True,exist_ok=True);assert not target.exists();target.write_bytes(b);new=updates[n].encode();manifest.append({'path':base+n,'parentSha256':hashlib.sha256(b).hexdigest(),'candidateSha256':hashlib.sha256(new).hexdigest()})
for n in files:(w/(base+n)).write_text(updates[n])
(p/'implementation-files.json').write_text(json.dumps({'parent':'1d1fd835a630722571fbeac680bfda82ba5b9b63','productionFiles':manifest,'testFile':base+'__tests__/task-capability-launcher.test.ts','productionCount':5,'existingRed2Cases':8,'noImmutableAdapterOrPublicSchemaChange':True},indent=2)+'\n');print('5 production files updated only in BD isolated copy;originals preserved')
