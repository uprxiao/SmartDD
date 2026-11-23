import { ANTIGRAVITY_FULL_ACCESS_WARNING, FULL_ACCESS_NOTE, FULL_ACCESS_WARNING } from './full-access-confirm';
import { useState } from 'react';
import { codeAgentKindSchema, type RunConfigView } from '@shared/ai-agents';
import { agentPermission, type AgentPermission } from '@shared/agent-permissions';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { PermissionPicker } from './permission-picker';
import { AgentDialog } from './ui';
import './style.css';
import './home.css';

export function homeAgents(configs: readonly RunConfigView[]) {
  // Service order is authoritative, including its fixed first default. Missing Key
  // or an offline model remains selectable so preflight can offer the right repair.
  return configs.filter(c => c.source !== 'legacy' && codeAgentKindSchema.safeParse(c.kind).success && c.homeVisible && c.available && !c.loggedOut);
}
export function homeAgentId(configs: readonly RunConfigView[], lastId?: string|null) {
  return configs.find(c => c.isDefault)?.id ?? configs.find(c => c.id === lastId)?.id ?? configs[0]?.id ?? null;
}
export function HomePermissionPicker({kind,disabled=false}:{kind:string;disabled?:boolean}) {
  const pref=useAppSettingsKey('agentPermissions'),[confirm,setConfirm]=useState(false);
  const effective=agentPermission(codeAgentKindSchema.safeParse(kind).data??'claude',pref.value?.selected??'ask').id;
  const select=(id:AgentPermission)=>{if(id==='full'&&!pref.value?.fullConfirmed)setConfirm(true);else pref.update({selected:id});};
  return <><PermissionPicker selected={effective} allowAuto={kind==='codex'} disabled={disabled||pref.isLoading}
    testId="home-permission" onPick={select}/>
    {confirm&&<AgentDialog title="使用完全访问权限？" onClose={()=>setConfirm(false)} footer={<><button className="m10-button" onClick={()=>setConfirm(false)}>取消</button><button className="m10-button primary" onClick={()=>{pref.update({selected:'full',fullConfirmed:true});setConfirm(false);}}>继续使用完全访问</button></>}><p className="m13-perm-warn">{kind === 'antigravity' ? ANTIGRAVITY_FULL_ACCESS_WARNING : FULL_ACCESS_WARNING}</p><div className="m13-note">{FULL_ACCESS_NOTE}</div></AgentDialog>}
  </>;
}
