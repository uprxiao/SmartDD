import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Info, Plus } from 'lucide-react';
import type { RunConfigView } from '@shared/ai-agents';
import type { AiProfileInput, AiProfileView } from '@shared/ai-profiles';
import { isSecretEnvName, joinArgs, splitArgs } from '@shared/ai-profiles';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { AgentDialog, AgentSwitch } from './ui';

export function LegacyAgentEditor({config,onClose,onSaved}:{config:RunConfigView;onClose:()=>void;onSaved:()=>Promise<void>}){
  const query=useQuery({queryKey:['aiProfiles',config.id],queryFn:()=>rpc.aiProfiles.get(config.id)});
  if(!query.data)return <AgentDialog title="编辑智能体" sub={config.name+' · 旧配置'} onClose={onClose}><p className="m13-hint">{query.error?rpcErrorMessage(query.error):'正在读取旧配置…'}</p></AgentDialog>;
  return <LegacyForm profile={query.data} config={config} onClose={onClose} onSaved={onSaved}/>;
}
function LegacyForm({profile,config,onClose,onSaved}:{profile:AiProfileView;config:RunConfigView;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [name,setName]=useState(profile.name),[args,setArgs]=useState(joinArgs(profile.args)),[visible,setVisible]=useState(config.homeVisible);
  const [env,setEnv]=useState<AiProfileInput['env']>(profile.env.map(e=>({name:e.name,secret:e.secret,value:e.secret?undefined:e.value??''})));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const patch=(i:number,fields:Partial<AiProfileInput['env'][number]>)=>setEnv(old=>old.map((entry,index)=>index===i?{...entry,...fields}:entry));
  const save=async()=>{if(busy)return;setBusy(true);setError('');try{await rpc.agents.updateLegacy(config.id,{name,env,args:splitArgs(args),homeVisible:visible});await onSaved();onClose();}catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}};
  return <AgentDialog title="编辑智能体" sub={config.name+' · 旧配置'} wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={busy} onClick={()=>void save()}>{busy?'正在保存…':'保存'}</button></>}>
    <div className="m13-alert info"><Info size={16}/><div><p>{config.legacyReason??'保留原环境变量与参数'}。可以继续维护环境变量与启动参数。</p></div></div>
    <label className="m13-field"><span>名称</span><input value={name} maxLength={60} onChange={e=>setName(e.target.value)}/></label>
    <div className="m13-field"><span>首页显示</span><span className="m13-switch-row m13-plain"><AgentSwitch on={visible} label="在首页显示" disabled={config.isDefault||!config.available} onChange={()=>setVisible(v=>!v)}/><span>{config.isDefault?'默认智能体必须在首页显示':visible?'在首页的智能体下拉中显示':'不在首页显示'}</span></span></div>
    <div className="m13-field"><span>环境变量（秘密值只显示“已加密”，留空不修改）</span>{env.map((entry,i)=><div className="m13-env-row" key={i}><input aria-label="变量名" value={entry.name} onChange={e=>patch(i,{name:e.target.value,secret:entry.secret||isSecretEnvName(e.target.value)})}/><input aria-label="变量值" type={entry.secret?'password':'text'} autoComplete="off" value={entry.value??''} placeholder={entry.secret?'已加密，留空不修改':'值或 ${引用}'} onChange={e=>patch(i,{value:entry.secret&&e.target.value===''?undefined:e.target.value})}/><button type="button" className="m13-link" onClick={()=>setEnv(old=>old.filter((_,index)=>index!==i))}>删除</button></div>)}<button className="m13-link m13-add-conn" onClick={()=>setEnv(old=>[...old,{name:'',secret:false,value:''}])}><Plus size={13}/>添加变量</button></div>
    <label className="m13-field"><span>附加启动参数</span><input value={args} onChange={e=>setArgs(e.target.value)} placeholder="一般不需要填写"/></label>
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
}
