import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import type {NativePreparationCapability,NativePreparationSource} from '@shared/application-session-diagnostics';
import type {NativeCapabilityConflicts} from './native-application-conflicts';
import {canonicalJson} from './manifest';
const hash=z.string().regex(/^[a-f0-9]{64}$/),name=z.string().min(1).max(128).refine(v=>!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(v)),path=z.string().min(1).max(4096).refine(v=>v.startsWith('/')&&!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(v));
export const nativeCapabilityPreparationSchema=z.array(z.object({kind:z.enum(['application','standard-skill','project-mcp']),id:name,name,selectedHash:hash,paths:z.array(path).max(4096),state:z.enum(['prepared','unavailable','disabled','unverified']),issueCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).nullable(),sources:z.array(z.object({kind:z.enum(['skill','mcp','plugin','native-tool','skill-config','projection','resource','policy']),name,path:path.nullable(),configurationPath:path.nullable(),location:z.enum(['file','profile-arguments','unrecorded'])}).strict()).max(128)}).strict().refine(v=>(v.state==='prepared')===(v.issueCode===null))).max(4096);
function selection(snapshot:CapabilitySessionSnapshotV2){return[...snapshot.packages.map(p=>({kind:'application' as const,id:p.appId,name:p.appId,selectedHash:p.packageHash,paths:p.skills.map(s=>s.projectionPath)})),...snapshot.standardSkills.map(s=>({kind:'standard-skill' as const,id:s.skillId,name:s.skillId,selectedHash:s.hash,paths:[s.projectionPath]})),...snapshot.mcp.filter(m=>m.kind==='legacy-project-context').map(m=>({kind:'project-mcp' as const,id:m.serverName,name:m.serverName,selectedHash:m.runtimeHash,paths:[]}))];}
export function assertNativeCapabilityPreparation(snapshot:CapabilitySessionSnapshotV2,items:readonly NativePreparationCapability[]):void{
 const expected=selection(snapshot);if(items.length!==expected.length||new Set(items.map(i=>i.kind+':'+i.id)).size!==items.length||items.some(i=>{const fixed=expected.find(s=>s.kind===i.kind&&s.id===i.id);return !fixed||fixed.name!==i.name||fixed.selectedHash!==i.selectedHash||canonicalJson(fixed.paths)!==canonicalJson(i.paths);})||Buffer.byteLength(canonicalJson(items))>1024*1024)throw new ApplicationError('SCOPE_DENIED','逐项准备记录不属于原固定能力选择');
}
/** The actual emitted subset is supplied by the launcher; this receipt grants
 * nothing and deliberately includes unavailable original selections. */
export function nativeCapabilityPreparation(snapshot:CapabilitySessionSnapshotV2,input:{applications:readonly string[];standardPaths:readonly string[];mcpNames:readonly string[];facets?:NativeCapabilityConflicts;issue?:string;projectMcpEnabled?:boolean}):NativePreparationCapability[]{
 const result:NativePreparationCapability[]=selection(snapshot).map(item=>{
  const key=item.kind+':'+item.id,sources=input.facets?.sources.get(key)??[],conflict=item.kind==='application'?input.facets?.applications.has(item.id):item.kind==='standard-skill'?input.facets?.standardSkills.has(item.paths[0]):input.facets?.projectMcp,damaged=item.kind==='application'?input.facets?.unavailableApplications.has(item.id):item.kind==='standard-skill'?input.facets?.unavailableStandardSkills.has(item.paths[0]):false,delivered=item.kind==='application'?input.applications.includes(item.id):item.kind==='standard-skill'?input.standardPaths.includes(item.paths[0]):input.mcpNames.includes(item.id);
  let state:NativePreparationCapability['state']='prepared',issueCode:string|null=null;
  if(input.issue){state='unavailable';issueCode=input.issue;}else if(conflict){state='unavailable';issueCode='AGENT_CAPABILITY_NAME_CONFLICT';}else if(damaged||!delivered){state=item.kind==='project-mcp'&&input.projectMcpEnabled===false?'disabled':'unavailable';issueCode='CAPABILITY_UNAVAILABLE';}
  const fallback:NativePreparationSource={kind:state==='disabled'?'policy':'resource',name:item.id,path:null,configurationPath:null,location:'unrecorded'};
  return{...item,state,issueCode,sources:state==='prepared'?[]:sources.length?sources:[fallback]};
 });
 const parsed=nativeCapabilityPreparationSchema.parse(result);assertNativeCapabilityPreparation(snapshot,parsed);return parsed;
}
