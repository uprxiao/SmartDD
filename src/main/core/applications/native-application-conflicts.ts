import { builtinCapabilityDeliveryAdapters, type CapabilityDeliveryAdapterRegistry } from './capability-delivery-adapters';
import {dirname,resolve,isAbsolute} from 'node:path';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import type {NativePreparationSource} from '@shared/application-session-diagnostics';
import type {NativeLaunchContext} from './native-launch-context';
import {canonicalFuturePath} from './session-registry';
export interface NativeCapabilityConflicts {
 applications:Set<string>;standardSkills:Set<string>;unavailableApplications:Set<string>;unavailableStandardSkills:Set<string>;projectMcp:boolean;
 sources:Map<string,NativePreparationSource[]>;
}
const safePath=(path:string|null|undefined)=>path&&isAbsolute(path)&&path.length<=4096&&!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(path)?path:null;
/** Read-only attribution. Source locations are display evidence,never repair,
 * native loading or tool authority. Existing conflict sets remain the gates. */
export function nativeCapabilityConflicts(snapshot:CapabilitySessionSnapshot,native:NativeLaunchContext,physical?:{owned:ReadonlySet<string>;occupied:ReadonlySet<string>;unavailable?:ReadonlySet<string>},deliveryAdapters:CapabilityDeliveryAdapterRegistry=builtinCapabilityDeliveryAdapters):NativeCapabilityConflicts{
 const conflicts=new Set<string>(),standards=new Set<string>(),unavailableApplications=new Set<string>(),unavailableStandardSkills=new Set<string>(),sources=new Map<string,NativePreparationSource[]>();let projectMcp=false;
 const add=(key:string,source:NativePreparationSource)=>{const current=sources.get(key)??[];if(!current.some(s=>JSON.stringify(s)===JSON.stringify(source)))sources.set(key,[...current,source]);};
 const itemSource=(item:NativeLaunchContext['inventory'][number]):NativePreparationSource=>({kind:item.kind,name:item.name,path:safePath(item.path),configurationPath:null,location:item.path==='profile arguments'?'profile-arguments':safePath(item.path)?'file':'unrecorded'});
 const ownPaths=new Set([...snapshot.packages.flatMap(p=>p.skills.map(s=>s.projectionPath)),...snapshot.standardSkills.map(s=>s.projectionPath)]),applicationMcp=snapshot.mcp.find(m=>m.kind==='applications')?.serverName;
 for(const item of native.inventory){
  if(item.kind==='skill'&&(physical?(physical.owned.has(item.path)||physical.unavailable?.has(item.path)):ownPaths.has(item.path)))continue;
  if(item.kind==='mcp'&&snapshot.mcp.some(m=>m.kind==='legacy-project-context'&&m.serverName===item.name)){projectMcp=true;add('project-mcp:'+item.name,itemSource(item));}
  if(item.kind==='plugin'&&snapshot.runner==='claude-code'&&item.name==='smartdd-session'){for(const p of snapshot.packages){conflicts.add(p.appId);add('application:'+p.appId,itemSource(item));}for(const s of snapshot.standardSkills){standards.add(s.projectionPath);add('standard-skill:'+s.skillId,itemSource(item));}continue;}
  if(item.kind==='skill')for(const s of snapshot.standardSkills){const name=dirname(s.projectionPath).split('/').at(-1);if(item.path===s.projectionPath||item.name===name||item.name==='smartdd-session:'+name){standards.add(s.projectionPath);add('standard-skill:'+s.skillId,itemSource(item));}}
  if(item.kind==='mcp'&&item.name===applicationMcp){for(const p of snapshot.packages){conflicts.add(p.appId);add('application:'+p.appId,itemSource(item));}continue;}
  for(const p of snapshot.packages)if(item.kind==='skill'&&p.skills.some(s=>item.path===s.projectionPath||item.name===s.nativeName||item.name==='smartdd-session:'+s.nativeName)||item.kind==='native-tool'&&Object.keys(p.toolContractMajors).some(op=>snapshot.adapterBinding.nativeToolNames[op]===item.name)){conflicts.add(p.appId);add('application:'+p.appId,itemSource(item));}
 }
 if(deliveryAdapters.shared(snapshot.runner)&&native.userSkillConfig.some(item=>typeof item.path==='string'&&item.enabled===false)){
  const provenance=new Map<string,NonNullable<NativeLaunchContext['skillConfigSources']>[number]>();
  // Preserve first-match attribution while resolving each source only once.
  for(const source of native.skillConfigSources??[]){const key=canonicalFuturePath(resolve(snapshot.native.cwd,source.path));if(!provenance.has(key))provenance.set(key,source);}
  for(const item of native.userSkillConfig){
  if(typeof item.path!=='string'||item.enabled!==false)continue;
  const path=canonicalFuturePath(resolve(snapshot.native.cwd,item.path)),location=provenance.get(path),source=(name:string):NativePreparationSource=>({kind:'skill-config',name,path:safePath(resolve(snapshot.native.cwd,item.path as string)),configurationPath:safePath(location?.configurationPath),location:location?.location??'unrecorded'});
  for(const p of snapshot.packages)if(p.skills.some(s=>path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath)))){conflicts.add(p.appId);add('application:'+p.appId,source(p.appId));}
  for(const s of snapshot.standardSkills)if(path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath))){standards.add(s.projectionPath);add('standard-skill:'+s.skillId,source(s.skillId));}
 }
 }
 const projection=(name:string,path:string):NativePreparationSource=>({kind:'projection',name,path:safePath(path),configurationPath:null,location:'file'});
 if(physical)for(const path of physical.occupied){for(const p of snapshot.packages)if(p.skills.some(s=>s.projectionPath===path)){conflicts.add(p.appId);add('application:'+p.appId,projection(p.appId,path));}for(const s of snapshot.standardSkills)if(s.projectionPath===path){standards.add(path);add('standard-skill:'+s.skillId,projection(s.skillId,path));}}
 if(physical?.unavailable)for(const path of physical.unavailable){for(const p of snapshot.packages)if(p.skills.some(s=>s.projectionPath===path)){unavailableApplications.add(p.appId);add('application:'+p.appId,projection(p.appId,path));}for(const s of snapshot.standardSkills)if(s.projectionPath===path){unavailableStandardSkills.add(path);add('standard-skill:'+s.skillId,projection(s.skillId,path));}}
 return{applications:conflicts,standardSkills:standards,unavailableApplications,unavailableStandardSkills,projectMcp,sources};
}
export function nativeApplicationConflicts(snapshot:CapabilitySessionSnapshot,native:NativeLaunchContext):Set<string>{return nativeCapabilityConflicts(snapshot,native).applications;}
