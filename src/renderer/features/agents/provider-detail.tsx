import { useState } from 'react';
import { Info, Plus, Star } from 'lucide-react';
import type { CodeAgentKind, ProviderInput, ProviderView, RunConfigView } from '@shared/ai-agents';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { AgentDialog, Pill } from './ui';
import { ProviderIcon, ToolIcon } from './icons';
import { agentLabels, providerFits } from './agent-editor';
import { contextLabel, protocolLabels, modelCheckDescription } from './provider-catalog';

export function ProviderDetail({provider:p,configs,onClose,onRefresh,onNewAgent}:{provider:ProviderView;configs:RunConfigView[];onClose:()=>void;onRefresh:()=>Promise<void>;onNewAgent:(p:ProviderView,kind:CodeAgentKind)=>void}){
  const [tab,setTab]=useState<'overview'|'agents'>('overview'),[key,setKey]=useState<string|null>(p.hasKey?null:'');
  const [deleting,setDeleting]=useState(false),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
  const [editingAddress,setEditingAddress]=useState(false),[addresses,setAddresses]=useState({...p.endpoints});
  const refs=configs.filter(c=>c.providerId===p.id),supported=(['claude','codex'] as const).filter(k=>providerFits(p,k));
  const possible=(['claude','codex'] as const).filter(k=>p.endpoints[k==='claude'?'anthropic':'responses']);
  const manualModels=p.models.length>0&&p.models.every(m=>m.catalogSource==='manual');
  const input=(changes:Partial<ProviderInput>={}):ProviderInput=>({name:p.name,preset:p.preset,endpoints:p.endpoints,authType:p.authType,models:p.models,recommended:p.recommended,...changes});
  const perform=async(label:string,fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(label);setError('');try{await fn();await onRefresh();}catch(e){setError(rpcErrorMessage(e));}finally{setBusy(null);}};
  const check=(model:string,kind:CodeAgentKind)=>perform(model+':'+kind,()=>rpc.agents.checkProviderModel(p.id,kind,model));
  const untested=p.models.flatMap(m=>m.offline?[]:possible.filter(k=>m.availability[k]==='untested').map(kind=>({model:m.id,kind})));
  const saveKey=()=>perform('key',async()=>{await rpc.agents.saveProvider(input({key:key?.trim()||null}),p.id);setKey(null);});
  if(deleting)return <AgentDialog title={`删除 ${p.name}？`} sub="供应商与它的 Key 会一并删除" onClose={()=>setDeleting(false)} footer={<><button className="m10-button secondary" disabled={Boolean(busy)} onClick={()=>setDeleting(false)}>取消</button><button className="m10-button primary m13-danger-btn" disabled={Boolean(busy)} onClick={()=>void perform('delete',async()=>{await rpc.agents.deleteProvider(p.id);onClose();})}>删除</button></>}>
    {refs.length?<><p className="m13-desc">使用它的 {refs.length} 个智能体会一起删除：</p><ul className="m13-gen-list">{refs.map(c=><li key={c.id}><ToolIcon tool={c.kind} size={16}/><b>{c.name}</b>{c.isDefault&&<Pill tone="ok"><Star size={11}/>默认</Pill>}</li>)}</ul>{refs.some(c=>c.isDefault)&&<p className="m13-hint">默认智能体删除后，默认改为首页显示中的下一个。</p>}<p className="m13-hint">使用过这些智能体的历史任务恢复时会提示重新选择，不会悄悄换成别的账号。</p></>:<p className="m13-desc">还没有智能体使用它。</p>}
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
  return <AgentDialog title={p.name} sub={p.preset?'目录':'自定义'} wide onClose={onClose} footer={<><button className="m10-button secondary m13-danger-text m13-foot-left" disabled={Boolean(busy)} onClick={()=>setDeleting(true)}>删除</button><button className="m10-button primary" onClick={onClose}>完成</button></>}>
    <div className="m13-right-head"><ProviderIcon catalog={p.preset} name={p.name} size={44}/><div><b>{p.name}</b><small>{supported.length?`可用于 ${supported.map(k=>agentLabels[k]).join('、')}`:'在下方测试模型以确认所需协议'}</small></div></div>
    <div className="m10-tabs m13-ptabs" role="tablist">{(['overview','agents'] as const).map(id=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{id==='overview'?'概览':'智能体'}{id==='agents'&&<span className="m13-count">{refs.length}</span>}</button>)}</div>
    {tab==='overview'&&<>
      {!p.hasKey&&<div className="m13-alert warn"><Info size={16}/><div><strong>需要填写 Key</strong><p>填写后才能启动任务和测试模型。</p></div></div>}
      <dl className="m13-info compact"><dt>适用工具</dt><dd className="m13-fit-line">{(['claude','codex'] as const).map(k=><span className={'m13-toolchip'+(supported.includes(k)?'':' off')} key={k} title={supported.includes(k)?'':'所需协议缺失或尚未通过模型验证'}><ToolIcon tool={k} size={14}/>{agentLabels[k]}{supported.includes(k)?'✓':'—'}</span>)}</dd>
        <dt>服务地址</dt><dd>{editingAddress?<><div className="m13-form-grid">{Object.keys(protocolLabels).map(k=><label key={k} className="m13-field"><span>{protocolLabels[k as keyof typeof protocolLabels]}</span><input aria-label={protocolLabels[k as keyof typeof protocolLabels]+' 地址'} value={addresses[k as keyof typeof addresses]??''} onChange={e=>setAddresses(old=>({...old,[k]:e.target.value}))}/></label>)}</div><button className="m10-button secondary m13-row-btn" disabled={Boolean(busy)} onClick={()=>void perform('address',async()=>{await rpc.agents.saveProvider(input({endpoints:Object.fromEntries(Object.entries(addresses).filter(([,v])=>v?.trim()))}),p.id);setEditingAddress(false);})}>保存地址</button><button className="m13-link" onClick={()=>setEditingAddress(false)}>取消</button></>:<>{Object.entries(p.endpoints).map(([k,v])=><div className="m13-endpoint" key={k}><Pill tone={k==='openai'?'muted':'info'}>{protocolLabels[k as keyof typeof protocolLabels]}</Pill><code>{v}</code></div>)}<button className="m13-link" disabled={Boolean(busy)} onClick={()=>{setAddresses({...p.endpoints});setEditingAddress(true);}}>编辑地址</button></>}</dd>
        <dt>Key</dt><dd>{key===null?<><code>{p.preset==='magpie'?'本机公开令牌或已保存的网关 Key':p.hasKey?(p.keyHint?'•••• '+p.keyHint:'•••••••• 已加密保存'):'未填写'}</code><button className="m13-link" disabled={Boolean(busy)} onClick={()=>setKey('')}>{p.hasKey?'更换':'填写'}</button></>:<span className="m13-inline-edit"><input type="password" autoComplete="new-password" aria-label="新的 Key" value={key} onChange={e=>setKey(e.target.value)} placeholder="加密保存，只在启动时注入"/><button className="m10-button secondary m13-row-btn" disabled={Boolean(busy)||!key.trim()} onClick={()=>void saveKey()}>保存</button>{p.hasKey&&<button className="m13-link" onClick={()=>setKey(null)}>取消</button>}</span>}</dd>
        <dt>模型目录</dt><dd>{manualModels?'手填模型 · 启动前检查服务可达性':`${p.refreshedAt?`${new Date(p.refreshedAt).toLocaleString()} 刷新`:'尚未刷新'} · 每次启动任务前自动比对`}<button className="m13-link" disabled={Boolean(busy)||!p.hasKey} onClick={()=>void perform('refresh',()=>rpc.agents.refreshProviderModels(p.id))}>{busy==='refresh'?'刷新中…':'刷新模型'}</button></dd>
      </dl>
      <h3 className="m13-sub m13-sub-row">模型在各工具中的可用性{untested.length>0&&<button className="m13-link" disabled={Boolean(busy)||!p.hasKey} onClick={()=>void perform('batch',async()=>{for(const pair of untested)await rpc.agents.checkProviderModel(p.id,pair.kind,pair.model);})}>测试全部未测试（{untested.length}）</button>}</h3>
      <div className="m13-table matrix" role="table" aria-label="模型可用性"><div role="row" className="m13-th"><span>模型</span><span>上下文</span>{(['claude','codex'] as const).map(k=><span key={k} className="m13-th-tool"><ToolIcon tool={k} size={14}/>{agentLabels[k]}</span>)}</div>{p.models.map(m=><div role="row" key={m.id} data-model={m.id}><span className="m13-cell-name">{m.name}{Object.values(p.recommended).includes(m.id)&&<Pill tone="info">推荐</Pill>}{m.offline&&<Pill tone="warn">已下线</Pill>}</span><span>{contextLabel(m.contextWindow)}</span>{(['claude','codex'] as const).map(k=>{
        if(!possible.includes(k))return <span className="m13-cell-na" key={k} title="供应商没有这个工具所需的协议">—</span>;
        const status=m.availability[k],testing=busy===m.id+':'+k;
        return <span className="m13-cell" key={k} data-tool={k} data-avail={status} title={modelCheckDescription(m,k)}><Pill tone={status==='available'?'ok':status==='unavailable'?'warn':'muted'}>{testing?'测试中…':status==='available'?'可用':status==='unavailable'?'不可用':'未测试'}</Pill>{refs.some(c=>c.kind===k&&c.defaultModel===m.id)&&<Star size={12} className="m13-star" aria-label="默认模型"/>}{status!=='available'&&!testing&&<button className="m13-link" disabled={Boolean(busy)||!p.hasKey||m.offline} onClick={()=>void check(m.id,k)}>{status==='unavailable'?'重测':'测试'}</button>}</span>;
      })}</div>)}</div><p className="m13-hint">★ 是对应智能体的默认模型；“—”表示供应商没有这个工具需要的接口。测试会发起最小的流式＋工具调用，可能产生少量费用，结果按工具分别保留。能列出的模型不一定能调用。</p>
    </>}
    {tab==='agents'&&<>{refs.length?<ul className="m13-gen-list">{refs.map(c=><li key={c.id}><ToolIcon tool={c.kind} size={16}/><b>{c.name}</b><small>{p.models.find(m=>m.id===c.defaultModel)?.name??c.defaultModel}{c.homeVisible?'':' · 不在首页显示'}</small>{c.isDefault&&<Pill tone="ok"><Star size={11}/>默认</Pill>}</li>)}</ul>:<p className="m13-hint">还没有智能体使用这个供应商。</p>}{supported.filter(k=>!refs.some(c=>c.kind===k)).map(k=><button key={k} className="m10-button secondary m13-regen" disabled={!p.hasKey} onClick={()=>onNewAgent(p,k)}><Plus size={14}/>用它创建 {agentLabels[k]} 智能体</button>)}{supported.length>0&&supported.every(k=>refs.some(c=>c.kind===k))&&<p className="m13-hint">适用的 Code Agent 都已经有智能体了，想用更多模型请编辑对应的智能体。</p>}</>}
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
}
