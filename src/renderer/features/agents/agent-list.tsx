import { useState } from 'react';
import { Check, GripVertical, Plus, Star, Terminal } from 'lucide-react';
import type { CodeAgentTool, ProviderView, RunConfigView } from '@shared/ai-agents';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { Ellipsis } from 'lucide-react';
import { AgentIcon, ProviderIcon, ToolIcon } from './icons';
import { AgentSwitch, Pill } from './ui';
import { agentLabels, providerFits } from './agent-editor';

export interface AgentListActions {
  edit(c:RunConfigView):void; remove(c:RunConfigView):void; setDefault(c:RunConfigView):void;
  toggleVisible(c:RunConfigView):void; reorder(c:RunConfigView,index:number):void; create():void;
}
export function AgentList({configs,providers,tools,actions}:{configs:RunConfigView[];providers:ProviderView[];tools:CodeAgentTool[];actions:AgentListActions}){
  const [drag,setDrag]=useState<string|null>(null),[over,setOver]=useState<string|null>(null);
  if(!configs.length)return <div className="m13-empty"><Terminal size={20}/><h3>还没有智能体</h3><p>选一个 Code Agent，再选订阅或供应商。</p><button className="m10-button primary" onClick={actions.create}><Plus size={14}/>新建智能体</button></div>;
  return <div className="m13-agent-list m13-sortable">{configs.map((c,index)=>{
    const p=providers.find(p=>p.id===c.providerId),tool=tools.find(t=>t.id===c.toolId),m=p?.models.find(m=>m.id===c.defaultModel);
    const missing=!tool?.installed,legacy=c.source==='legacy',status=m?.availability[c.kind==='codex'?'codex':'claude'];
    const blocked=c.isDefault?'默认智能体必须在首页显示':c.loggedOut?'重新登录后才能在首页显示':missing?`${agentLabels[c.kind]??c.kind} 未安装`:'';
    return <div key={c.id} className={'m13-agent-row m13-agent-item'+(c.loggedOut||missing?' dim':'')+(drag===c.id?' dragging':'')+(over===c.id&&drag&&drag!==c.id?' drop-target':'')} data-agent={c.id}
      draggable={!c.isDefault} onDragStart={e=>{setDrag(c.id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',c.id);}}
      onDragOver={e=>{e.preventDefault();setOver(c.id);}} onDragLeave={()=>setOver(old=>old===c.id?null:old)}
      onDrop={e=>{e.preventDefault();const item=configs.find(c=>c.id===drag);if(item&&!item.isDefault)actions.reorder(item,index);setDrag(null);setOver(null);}}
      onDragEnd={()=>{setDrag(null);setOver(null);}}>
      <span className={'m13-grip'+(c.isDefault?' locked':'')} title={c.isDefault?'默认智能体固定排在第一位':'拖动调整顺序（即首页下拉中的顺序）'} aria-hidden="true"><GripVertical size={14}/></span>
      <AgentIcon tool={c.kind} provider={p?{catalog:p.preset,name:p.name}:null} legacy={legacy} size={28}/>
      <span className="m13-cap-main"><b>{c.name}{c.isDefault&&<Pill tone="ok"><Star size={11}/>默认</Pill>}{c.loggedOut&&<Pill tone="warn">已退出登录</Pill>}{p&&!p.hasKey&&<Pill tone="warn">供应商需要 Key</Pill>}{missing&&<Pill tone="warn">{agentLabels[c.kind]??c.kind} 未安装</Pill>}{m?.offline&&<Pill tone="warn">默认模型已下线，请改选</Pill>}{legacy&&<Pill>旧配置</Pill>}</b>
        <small>{legacy?`${agentLabels[c.kind]??c.kind} · 保留原环境变量与参数`:c.source==='login'?(c.loggedOut?'CLI 已退出登录，重新登录后自动恢复':'CLI 默认模型 · 使用本机 CLI 自己的登录'):p?<>{m?.name??c.defaultModel}{status&&status!=='available'&&<span className={'m13-avail-tag '+(status==='unavailable'?'bad':'untested')}> · {status==='unavailable'?'不可用':'未测试'}</span>}{c.models.length>1&&<span className="m13-more-models" title={c.models.filter(id=>id!==c.defaultModel).map(id=>p.models.find(m=>m.id===id)?.name??id).join('、')}> · 另 {c.models.length-1} 个模型可切换</span>}</>:'供应商已删除'}</small></span>
      <span className="m13-home-toggle" title={blocked}><span>首页</span><AgentSwitch on={c.homeVisible&&!c.loggedOut&&!missing} label={(c.homeVisible?'不在首页显示 ':'在首页显示 ')+c.name} disabled={Boolean(blocked)} title={blocked} onChange={()=>actions.toggleVisible(c)}/></span>
      <DropdownMenu><DropdownMenuTrigger className="m10-icon" aria-label={c.name+' 更多操作'}><Ellipsis size={16}/></DropdownMenuTrigger><DropdownMenuContent align="end">
        {!c.isDefault&&c.available&&c.homeVisible&&<DropdownMenuItem onClick={()=>actions.setDefault(c)}>设为默认</DropdownMenuItem>}
        <DropdownMenuItem onClick={()=>actions.edit(c)}>编辑</DropdownMenuItem>
        {!c.isDefault&&index>(configs[0]?.isDefault?1:0)&&<DropdownMenuItem onClick={()=>actions.reorder(c,index-1)}>上移</DropdownMenuItem>}
        {!c.isDefault&&index<configs.length-1&&<DropdownMenuItem onClick={()=>actions.reorder(c,index+1)}>下移</DropdownMenuItem>}
        <DropdownMenuSeparator/><DropdownMenuItem variant="destructive" onClick={()=>actions.remove(c)}>删除</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>;
  })}</div>;
}
export function ProviderList({providers,configs,onEdit,onCreate}:{providers:ProviderView[];configs:RunConfigView[];onEdit:(p:ProviderView)=>void;onCreate:()=>void}){
  return <div className="m13-agent-list">{providers.map(p=>{
    const count=configs.filter(c=>c.providerId===p.id).length;
    return <button key={p.id} className="m13-agent-row clickable" data-provider={p.id} onClick={()=>onEdit(p)}><span className="m13-agent-icon"><ProviderIcon catalog={p.preset} name={p.name} size={36}/></span><span className="m13-cap-main"><b>{p.name}<Pill>{p.preset?'目录':'自定义'}</Pill>{!p.hasKey&&<Pill tone="warn">需要填写 Key</Pill>}</b><small>{p.models.length} 个模型 · {count?`${count} 个智能体在用`:'还没有智能体使用'}</small></span><span className="m13-fit"><span className="m13-fit-label">适用</span>{(['claude','codex'] as const).map(k=>{const fit=providerFits(p,k);return <span key={k} className={'m13-toolchip'+(fit?'':' off')} title={fit?'':'所需协议缺失或尚未验证'}><ToolIcon tool={k} size={14}/>{agentLabels[k]}{fit?<Check size={12}/>:<span className="m13-dash">—</span>}</span>;})}</span></button>;
  })}<button className="m13-agent-row m13-add-row" onClick={onCreate}><span className="m13-cap-icon big"><Plus size={18}/></span><span className="m13-cap-main"><b>添加供应商</b><small>从目录选择，或填写自定义地址与 Key；Key 与模型可用性保存在供应商上</small></span></button></div>;
}
