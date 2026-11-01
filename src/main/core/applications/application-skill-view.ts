import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {ApplicationError} from '@shared/applications';
export interface ApplicationSkillView {appId:string;skillId:string;nativeName:string;path:string;sourceHash:string}
/** Transient discovery/planner view only. Never save this as the session's fixed source snapshot. */
export function applicationSkillSnapshotView(snapshot:CapabilitySessionSnapshot,views:readonly ApplicationSkillView[]):CapabilitySessionSnapshot{
  if(new Set(views.map(v=>v.appId+':'+v.skillId)).size!==views.length)throw new ApplicationError('INVALID_INPUT','本次Skill交付重复');
  for(const view of views){const skill=snapshot.packages.find(p=>p.appId===view.appId)?.skills.find(s=>s.skillId===view.skillId);if(!skill||skill.contentHash!==view.sourceHash)throw new ApplicationError('SCOPE_DENIED','Skill交付不能替换原固定来源');}
  const map=<T extends CapabilitySessionSnapshot['packages'][number]>(p:T)=>({...p,skills:p.skills.map(s=>{const view=views.find(v=>v.appId===p.appId&&v.skillId===s.skillId);return view?{...s,nativeName:view.nativeName,projectionPath:view.path}:s;})});
  return snapshot.schema===3?{...snapshot,packages:snapshot.packages.map(map)}:{...snapshot,packages:snapshot.packages.map(map)};
}
