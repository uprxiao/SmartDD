import {dirname,resolve} from 'node:path';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import type {NativeLaunchContext} from './native-launch-context';
import {canonicalFuturePath} from './session-registry';

/** Read-only attribution before publishing. This narrows App loading only; it
 * does not prove filesystem ownership. Publication and adapter preflight must
 * still verify the actual managed trees and all shared capability conflicts. */
export function nativeApplicationConflicts(snapshot:CapabilitySessionSnapshotV2,native:NativeLaunchContext):Set<string>{
 const conflicts=new Set<string>();
 const ownPaths=new Set([...snapshot.packages.flatMap(p=>p.skills.map(s=>s.projectionPath)),...snapshot.standardSkills.map(s=>s.projectionPath)]);
 const applicationMcp=snapshot.mcp.find(m=>m.kind==='applications')?.serverName;
 for(const item of native.inventory){
  if(item.kind==='skill'&&ownPaths.has(item.path))continue;
  if(item.kind==='mcp'&&item.name===applicationMcp){for(const p of snapshot.packages)conflicts.add(p.appId);continue;}
  for(const p of snapshot.packages){
   if(item.kind==='skill'&&p.skills.some(s=>item.name===s.nativeName||item.name==='smartdd-session:'+s.nativeName)||item.kind==='native-tool'&&Object.keys(p.toolContractMajors).some(op=>snapshot.adapterBinding.nativeToolNames[op]===item.name))conflicts.add(p.appId);
  }
 }
 if(snapshot.runner==='codex')for(const item of native.userSkillConfig){
  if(typeof item.path!=='string'||item.enabled!==false)continue;
  const path=canonicalFuturePath(resolve(snapshot.native.cwd,item.path));
  for(const p of snapshot.packages)if(p.skills.some(s=>path===canonicalFuturePath(s.projectionPath)||path===canonicalFuturePath(dirname(s.projectionPath))))conflicts.add(p.appId);
 }
 return conflicts;
}
