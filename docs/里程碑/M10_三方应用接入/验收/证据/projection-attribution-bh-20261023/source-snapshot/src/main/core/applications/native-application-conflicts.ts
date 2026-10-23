import {dirname,resolve} from 'node:path';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import type {NativeLaunchContext} from './native-launch-context';
import {canonicalFuturePath} from './session-registry';

/** Read-only attribution before publishing. This narrows per-run native loading only; it
 * does not prove filesystem ownership. Publication and adapter preflight must
 * still verify the actual managed trees and all shared capability conflicts. */
export function nativeCapabilityConflicts(snapshot:CapabilitySessionSnapshotV2,native:NativeLaunchContext,physical?:{owned:ReadonlySet<string>;occupied:ReadonlySet<string>;unavailable?:ReadonlySet<string>}):{applications:Set<string>;standardSkills:Set<string>;unavailableApplications:Set<string>;unavailableStandardSkills:Set<string>;projectMcp:boolean}{
 const conflicts=new Set<string>(),standards=new Set<string>(),unavailableApplications=new Set<string>(),unavailableStandardSkills=new Set<string>();let projectMcp=false;
 const ownPaths=new Set([...snapshot.packages.flatMap(p=>p.skills.map(s=>s.projectionPath)),...snapshot.standardSkills.map(s=>s.projectionPath)]);
 const applicationMcp=snapshot.mcp.find(m=>m.kind==='applications')?.serverName;
 for(const item of native.inventory){
  if(item.kind==='skill'&&(physical?(physical.owned.has(item.path)||physical.unavailable?.has(item.path)):ownPaths.has(item.path)))continue;
  if(item.kind==='mcp'&&snapshot.mcp.some(m=>m.kind==='legacy-project-context'&&m.serverName===item.name))projectMcp=true;
  if(item.kind==='plugin'&&snapshot.runner==='claude-code'&&item.name==='smartdd-session'){for(const p of snapshot.packages)conflicts.add(p.appId);for(const s of snapshot.standardSkills)standards.add(s.projectionPath);continue;}
  if(item.kind==='skill')for(const s of snapshot.standardSkills){const name=dirname(s.projectionPath).split('/').at(-1);if(item.path===s.projectionPath||item.name===name||item.name==='smartdd-session:'+name)standards.add(s.projectionPath);}
  if(item.kind==='mcp'&&item.name===applicationMcp){for(const p of snapshot.packages)conflicts.add(p.appId);continue;}
  for(const p of snapshot.packages){
   if(item.kind==='skill'&&p.skills.some(s=>item.path===s.projectionPath||item.name===s.nativeName||item.name==='smartdd-session:'+s.nativeName)||item.kind==='native-tool'&&Object.keys(p.toolContractMajors).some(op=>snapshot.adapterBinding.nativeToolNames[op]===item.name))conflicts.add(p.appId);
  }
 }
 if(snapshot.runner==='codex')for(const item of native.userSkillConfig){
  if(typeof item.path!=='string'||item.enabled!==false)continue;
  const path=canonicalFuturePath(resolve(snapshot.native.cwd,item.path));
  for(const p of snapshot.packages)if(p.skills.some(s=>path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath))))conflicts.add(p.appId);
  for(const s of snapshot.standardSkills)if(path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath)))standards.add(s.projectionPath);
 }
 if(physical)for(const path of physical.occupied){for(const p of snapshot.packages)if(p.skills.some(s=>s.projectionPath===path))conflicts.add(p.appId);for(const s of snapshot.standardSkills)if(s.projectionPath===path)standards.add(path);}
 if(physical?.unavailable)for(const path of physical.unavailable){for(const p of snapshot.packages)if(p.skills.some(s=>s.projectionPath===path))unavailableApplications.add(p.appId);for(const s of snapshot.standardSkills)if(s.projectionPath===path)unavailableStandardSkills.add(path);}
 return{applications:conflicts,standardSkills:standards,unavailableApplications,unavailableStandardSkills,projectMcp};
}
/** Compatibility helper for callers that only need per-App attribution. */
export function nativeApplicationConflicts(snapshot:CapabilitySessionSnapshotV2,native:NativeLaunchContext):Set<string>{return nativeCapabilityConflicts(snapshot,native).applications;}
