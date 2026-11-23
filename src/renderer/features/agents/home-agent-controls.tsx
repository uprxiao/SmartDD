import { Menu } from '@base-ui/react/menu';
import { FULL_ACCESS_NOTE, FULL_ACCESS_WARNING } from './full-access-confirm';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { codeAgentKindSchema, type RunConfigView } from '@shared/ai-agents';
import { agentPermission, type AgentPermission } from '@shared/agent-permissions';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { PermIcon } from './icons';
import { AgentDialog } from './ui';
import './style.css';
import './home.css';

import { permissionLabels } from './permission-labels';
export { permissionLabels } from './permission-labels';
export function homeAgents(configs: readonly RunConfigView[]) {
  // Service order is authoritative, including its fixed first default. Missing Key
  // or an offline model remains selectable so preflight can offer the right repair.
  return configs.filter(c => c.source !== 'legacy' && codeAgentKindSchema.safeParse(c.kind).success && c.homeVisible && c.available && !c.loggedOut);
}
export function homeAgentId(configs: readonly RunConfigView[], lastId?: string|null) {
  return configs.find(c => c.isDefault)?.id ?? configs.find(c => c.id === lastId)?.id ?? configs[0]?.id ?? null;
}
export function HomePermissionPicker({kind,disabled=false}:{kind:string;disabled?:boolean}) {
  const pref=useAppSettingsKey('agentPermissions'),[confirm,setConfirm]=useState(false),[help,setHelp]=useState(false);
  const options:AgentPermission[]=kind==='codex'?['ask','auto','full']:['ask','full'];
  const effective=agentPermission(codeAgentKindSchema.safeParse(kind).data??'claude',pref.value?.selected??'ask').id;
  const p=permissionLabels[effective];
  const select=(id:AgentPermission)=>{if(id==='full'&&!pref.value?.fullConfirmed)setConfirm(true);else pref.update({selected:id});};
  return <><Menu.Root><Menu.Trigger disabled={disabled||pref.isLoading} className={'m13-perm-trigger'+(effective==='full'?' danger':'')} data-testid="home-permission" aria-label={'权限：'+p.name}><PermIcon icon={p.icon}/>{p.name}</Menu.Trigger>
    <Menu.Portal><div className="m13-shell"><Menu.Positioner side="top" align="start" sideOffset={8} className="m13-home-positioner"><Menu.Popup className="m13-perm-menu m13-home-perm-popup" aria-label="权限">
      <div className="m13-perm-head"><span>应如何批准 {kind==='antigravity'?'Antigravity':kind==='codex'?'Codex':'Claude Code'} 操作?</span><button type="button" onClick={()=>setHelp(true)}>了解更多</button></div>
      {options.map(id=><Menu.Item render={<button type="button"/>} key={id} role="menuitemradio" aria-checked={effective===id} className={id==='full'?'danger':undefined} onClick={()=>select(id)}><PermIcon icon={permissionLabels[id].icon}/><span className="m13-perm-text"><b>{permissionLabels[id].name}</b><small>{permissionLabels[id].desc}</small></span>{id===effective&&<Check size={16} strokeWidth={1.8} className="m13-perm-check"/>}</Menu.Item>)}
    </Menu.Popup></Menu.Positioner></div></Menu.Portal></Menu.Root>
    {confirm&&<AgentDialog title="使用完全访问权限？" onClose={()=>setConfirm(false)} footer={<><button className="m10-button" onClick={()=>setConfirm(false)}>取消</button><button className="m10-button primary" onClick={()=>{pref.update({selected:'full',fullConfirmed:true});setConfirm(false);}}>继续使用完全访问</button></>}><p className="m13-perm-warn">{FULL_ACCESS_WARNING}</p><div className="m13-note">{FULL_ACCESS_NOTE}</div></AgentDialog>}
    {help&&<AgentDialog title="智能体权限" onClose={()=>setHelp(false)} footer={<button className="m10-button primary" onClick={()=>setHelp(false)}>知道了</button>}><p className="m13-perm-warn">权限档位决定 CLI 内置工具的批准方式。恢复任务沿用创建时的档位；在终端里切换权限不会同步回首页。插件写操作仍由 WillYou 单独审批。</p></AgentDialog>}
  </>;
}
