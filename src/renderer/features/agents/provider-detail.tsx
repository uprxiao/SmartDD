import { useEffect, useState, type ReactNode } from 'react';
import { Info, Plus, Star } from 'lucide-react';
import { codeAgentKindSchema, type CodeAgentKind, type ProviderInput, type ProviderView, type RunConfigView } from '@shared/ai-agents';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import type { ProviderCatalogModel } from '@shared/provider-model-metadata';
import { AgentDialog, Pill } from './ui';
import { ProviderIcon, ToolIcon } from './icons';
import { agentLabels, providerFits } from './agent-editor';
import { contextLabel, protocolLabels, modelCheckDescription, configuredModelCheckKinds, untestedModelChecks } from './provider-catalog';
import { ProviderModelCandidates, type ModelCatalogFilters } from './provider-model-picker';

export function ProviderDetail({provider:p,configs,onClose,onRefresh,onNewAgent,renderAgentEditor}:{
  provider:ProviderView;configs:RunConfigView[];onClose:()=>void;onRefresh:()=>Promise<void>;
  onNewAgent:(p:ProviderView,kind:CodeAgentKind)=>void;
  renderAgentEditor?:(config:RunConfigView,onBack:()=>void)=>ReactNode;
}){
  const [tab,setTab]=useState<'overview'|'agents'>('overview'),[key,setKey]=useState<string|null>(p.hasKey?null:'');
  const [deleting,setDeleting]=useState(false),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
  const [editingAddress,setEditingAddress]=useState(false),[addresses,setAddresses]=useState({...p.endpoints});
  const [modelTab,setModelTab]=useState<'selected'|'unselected'>('selected');
  const [filters,setFilters]=useState<ModelCatalogFilters>({query:'',vendor:'',purpose:''});
  const [catalog,setCatalog]=useState<{revision:number;models:ProviderCatalogModel[]} | null>(null);
  const [draft,setDraft]=useState<{base:string[];picked:string[];revision:number} | null>(null);
  const [blockedModel,setBlockedModel]=useState<string|null>(null);
  const [editingAgent,setEditingAgent]=useState<string|null>(null);
  const refs=configs.filter(c=>c.providerId===p.id),supported=codeAgentKindSchema.options.filter(k=>providerFits(p,k));
  const references=(id:string)=>refs.filter(config=>config.models.includes(id)||config.defaultModel===id);
  const savedIds=p.models.map(model=>model.id);
  const savedSet=new Set(savedIds),baseSet=new Set(draft?.base);
  const picked=new Set(draft?.picked??savedIds);
  const added=draft?.picked.filter(id=>!baseSet.has(id)).length??0;
  const removed=draft?.base.filter(id=>!picked.has(id)).length??0;
  const changed=added>0||removed>0;
  const currentCatalog=catalog?.revision===p.identityRevision?catalog.models:null;
  const candidates=currentCatalog?.filter(model=>!model.offline&&!savedSet.has(model.id))??[];
  const referencedRemoval=blockedModel??draft?.base.find(id=>!picked.has(id)&&references(id).length);
  const blockedRefs=referencedRemoval?references(referencedRemoval):[];
  const agent=configs.find(config=>config.id===editingAgent);

  useEffect(()=>{
    let active=true;
    void rpc.agents.providerModelCatalog(p.id).then(models=>{
      if(active&&models) setCatalog(current=>current?.revision===p.identityRevision?current:{revision:p.identityRevision,models});
    }).catch(()=>{});
    return ()=>{active=false;};
  },[p.id,p.identityRevision]);

  const toggle=(id:string,checked:boolean)=>{
    setError('');
    if (!checked&&savedSet.has(id)&&references(id).length) {setBlockedModel(id);return;}
    setBlockedModel(null);
    setDraft(old=>{
      const base=old?.base??savedIds, previous=old?.picked??base;
      const picked=checked?[...new Set([...previous,id])]:previous.filter(modelId=>modelId!==id);
      if(picked.length===base.length&&picked.every(modelId=>base.includes(modelId)))return null;
      return {base,picked,revision:old?.revision??p.identityRevision};
    });
  };
  const possible=configuredModelCheckKinds(p);
  const columns=codeAgentKindSchema.options.filter(kind=>kind!=='antigravity'||p.endpoints.gemini);
  const manualModels=p.models.length>0&&p.models.every(m=>m.catalogSource==='manual');
  const input=(changes:Partial<ProviderInput>={}):ProviderInput=>({name:p.name,preset:p.preset,endpoints:p.endpoints,authType:p.authType,...changes});
  const perform=async(label:string,fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(label);setError('');try{await fn();await onRefresh();}catch(e){setError(rpcErrorMessage(e));}finally{setBusy(null);}};
  const check=(model:string,kind:CodeAgentKind)=>perform(model+':'+kind,()=>rpc.agents.checkProviderModel(p.id,kind,model));
  const untested=untestedModelChecks(p, possible);
  const saveKey=()=>perform('key',async()=>{await rpc.agents.saveProvider(input({key:key?.trim()||null}),p.id);setKey(null);});
  const refreshModels=()=>perform('refresh',async()=>{
    const {catalog:models,identityRevision}=await rpc.agents.refreshProviderModels(p.id);
    setCatalog({revision:identityRevision,models});
    if(!draft)return;
    const valid=new Set([...draft.base,...models.filter(model=>!model.offline).map(model=>model.id)]);
    const remaining=draft.picked.filter(id=>valid.has(id));
    if(remaining.length!==draft.picked.length){
      setDraft(remaining.length===draft.base.length&&remaining.every(id=>draft.base.includes(id))?null:{...draft,picked:remaining});
      setError('部分待接入模型已不在目录中，请重新选择。');
    }
  });
  const saveModels=()=>perform('models',async()=>{
    if(!draft)return;
    try{await rpc.agents.saveProviderModels(p.id,draft.base,draft.picked,draft.revision);}
    catch(e){await onRefresh();throw e;}
    setDraft(null);
    setBlockedModel(null);
  });
  if(agent&&renderAgentEditor)return renderAgentEditor(agent,()=>setEditingAgent(null));
  if(deleting)return <AgentDialog title={`删除 ${p.name}？`} sub="供应商与它的 Key 会一并删除" onClose={()=>setDeleting(false)} footer={<><button className="m10-button secondary" disabled={Boolean(busy)} onClick={()=>setDeleting(false)}>取消</button><button className="m10-button primary m13-danger-btn" disabled={Boolean(busy)} onClick={()=>void perform('delete',async()=>{await rpc.agents.deleteProvider(p.id);onClose();})}>删除</button></>}>
    {refs.length?<><p className="m13-desc">使用它的 {refs.length} 个智能体会一起删除：</p><ul className="m13-gen-list">{refs.map(c=><li key={c.id}><ToolIcon tool={c.kind} size={16}/><b>{c.name}</b>{c.isDefault&&<Pill tone="ok"><Star size={11}/>默认</Pill>}</li>)}</ul>{refs.some(c=>c.isDefault)&&<p className="m13-hint">默认智能体删除后，默认改为首页显示中的下一个。</p>}<p className="m13-hint">使用过这些智能体的历史任务恢复时会提示重新选择，不会悄悄换成别的账号。</p></>:<p className="m13-desc">还没有智能体使用它。</p>}
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
  return <AgentDialog title={p.name} sub={p.preset?'目录':'自定义'} wide onClose={onClose} footer={changed?<>
    <span className="m13-foot-left m13-model-edit-summary" role="status">{[added?`待接入 ${added} 个`:'',removed?`待移除 ${removed} 个`:''].filter(Boolean).join(' · ')}</span>
    <button className="m10-button secondary" disabled={Boolean(busy)} onClick={()=>{setDraft(null);setError('');setBlockedModel(null);}}>取消修改</button>
    <button className="m10-button primary" disabled={Boolean(busy)} onClick={()=>void saveModels()}>{busy==='models'?'正在保存…':'保存模型'}</button>
  </>:<><button className="m10-button secondary m13-danger-text m13-foot-left" disabled={Boolean(busy)} onClick={()=>setDeleting(true)}>删除</button><button className="m10-button primary" disabled={Boolean(busy)} onClick={onClose}>完成</button></>}>
    <div className="m13-right-head"><ProviderIcon catalog={p.preset} name={p.name} size={44}/><div><b>{p.name}</b><small>{supported.length?`可用于 ${supported.map(k=>agentLabels[k]).join('、')}`:'在下方测试模型以确认所需协议'}</small></div></div>
    <div className="m10-tabs m13-ptabs" role="tablist">{(['overview','agents'] as const).map(id=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{id==='overview'?'概览':'智能体'}{id==='agents'&&<span className="m13-count">{refs.length}</span>}</button>)}</div>
    {tab==='overview'&&<>
      {!p.hasKey&&<div className="m13-alert warn"><Info size={16}/><div><strong>需要填写 Key</strong><p>填写后才能启动任务和测试模型。</p></div></div>}
      <dl className="m13-info compact"><dt>适用工具</dt><dd className="m13-fit-line">{columns.map(k=><span className={'m13-toolchip'+(supported.includes(k)?'':' off')} key={k} title={supported.includes(k)?'':'所需协议缺失或尚未通过模型验证'}><ToolIcon tool={k} size={14}/>{agentLabels[k]}{supported.includes(k)?'✓':'—'}</span>)}</dd>
        <dt>服务地址</dt><dd>{editingAddress?<><div className="m13-form-grid">{Object.keys(protocolLabels).map(k=><label key={k} className="m13-field"><span>{protocolLabels[k as keyof typeof protocolLabels]}</span><input aria-label={protocolLabels[k as keyof typeof protocolLabels]+' 地址'} value={addresses[k as keyof typeof addresses]??''} onChange={e=>setAddresses(old=>({...old,[k]:e.target.value}))}/></label>)}</div><button className="m10-button secondary m13-row-btn" disabled={Boolean(busy)} onClick={()=>void perform('address',async()=>{await rpc.agents.saveProvider(input({endpoints:Object.fromEntries(Object.entries(addresses).filter(([,v])=>v?.trim()))}),p.id);setEditingAddress(false);})}>保存地址</button><button className="m13-link" onClick={()=>setEditingAddress(false)}>取消</button></>:<>{Object.entries(p.endpoints).map(([k,v])=><div className="m13-endpoint" key={k}><Pill tone={k==='openai'?'muted':'info'}>{protocolLabels[k as keyof typeof protocolLabels]}</Pill><code>{v}</code></div>)}<button className="m13-link" disabled={Boolean(busy)} onClick={()=>{setAddresses({...p.endpoints});setEditingAddress(true);}}>编辑地址</button></>}</dd>
        <dt>Key</dt><dd>{key===null?<><code>{p.preset==='magpie'?'本机公开令牌或已保存的网关 Key':p.hasKey?(p.keyHint?'•••• '+p.keyHint:'•••••••• 已加密保存'):'未填写'}</code><button className="m13-link" disabled={Boolean(busy)} onClick={()=>setKey('')}>{p.hasKey?'更换':'填写'}</button></>:<span className="m13-inline-edit"><input type="password" autoComplete="new-password" aria-label="新的 Key" value={key} onChange={e=>setKey(e.target.value)} placeholder="加密保存，只在启动时注入"/><button className="m10-button secondary m13-row-btn" disabled={Boolean(busy)||!key.trim()} onClick={()=>void saveKey()}>保存</button>{p.hasKey&&<button className="m13-link" onClick={()=>setKey(null)}>取消</button>}</span>}</dd>
        <dt>模型目录</dt><dd>{currentCatalog?`已获取 ${currentCatalog.length} 个模型`:manualModels?'手填模型 · 启动前检查服务可达性':p.refreshedAt?`${new Date(p.refreshedAt).toLocaleString()} 刷新`:'尚未刷新'}<button className="m13-link" disabled={Boolean(busy)||!p.hasKey} onClick={()=>void refreshModels()}>{busy==='refresh'?'刷新中…':'刷新模型'}</button></dd>
      </dl>
      <div className="m13-model-tabs" role="tablist" aria-label="模型接入范围">
        <button type="button" role="tab" aria-selected={modelTab==='selected'} onClick={()=>setModelTab('selected')}>已选 {p.models.length}</button>
        <button type="button" role="tab" aria-selected={modelTab==='unselected'} onClick={()=>setModelTab('unselected')}>未选{currentCatalog?` ${candidates.length}`:''}</button>
      </div>
      {modelTab==='unselected'?<ProviderModelCandidates models={candidates} picked={picked} filters={filters} onFilters={setFilters} onToggle={toggle} busy={Boolean(busy)} loaded={currentCatalog!==null}/>:<>
      {!!blockedRefs.length&&<div className="m13-alert warn m13-model-blocked" role="alert"><Info size={16}/><div>
        <strong>{p.models.find(model=>model.id===referencedRemoval)?.name} 正被智能体使用</strong>
        <p>请先在以下智能体中取消勾选该模型并保存。</p>
        {blockedRefs.map(config=><div key={config.id} className="m13-model-reference"><span>{config.name}</span>{renderAgentEditor&&
          <button className="m13-link" aria-label={`编辑智能体 ${config.name}`} onClick={()=>setEditingAgent(config.id)}>编辑智能体</button>}</div>)}
      </div></div>}
      <h3 className="m13-sub m13-sub-row">模型在各工具中的可用性{untested.length>0&&<button className="m13-link" disabled={Boolean(busy)||!p.hasKey} onClick={()=>void perform('batch',async()=>{for(const pair of untested)await rpc.agents.checkProviderModel(p.id,pair.kind,pair.model);})}>测试全部未测试（{untested.length}）</button>}</h3>
      <div className={'m13-table matrix'+(columns.length===3?' three-tools':'')} role="table" aria-label="模型可用性"><div role="row" className="m13-th"><span>模型</span><span>上下文</span>{columns.map(k=><span key={k} className="m13-th-tool"><ToolIcon tool={k} size={14}/>{agentLabels[k]}</span>)}</div>{p.models.map(m=><div role="row" key={m.id} data-model={m.id}><span className="m13-cell-name m13-model-name"><label title={m.id}><input type="checkbox" checked={picked.has(m.id)} disabled={Boolean(busy)} onChange={e=>toggle(m.id,e.target.checked)}/><span>{m.name}</span></label>{!picked.has(m.id)?<Pill tone="warn">待移除</Pill>:<>{Object.values(p.recommended).includes(m.id)&&<Pill tone="info">推荐</Pill>}{m.offline&&<Pill tone="warn">已下线</Pill>}</>}</span><span>{contextLabel(m.contextWindow)}</span>{columns.map(k=>{
        if(!possible.includes(k))return <span className="m13-cell-na" key={k} title="供应商没有这个工具所需的协议">—</span>;
        const status=m.availability[k],testing=busy===m.id+':'+k;
        return <span className="m13-cell" key={k} data-tool={k} data-avail={status} title={modelCheckDescription(m,k)}><Pill tone={status==='available'?'ok':status==='unavailable'?'warn':'muted'}>{testing?'测试中…':status==='available'?'可用':status==='unavailable'?'不可用':'未测试'}</Pill>{refs.some(c=>c.kind===k&&c.defaultModel===m.id)&&<Star size={12} className="m13-star" aria-label="默认模型"/>}{status!=='available'&&!testing&&<button className="m13-link" disabled={Boolean(busy)||!p.hasKey||m.offline} onClick={()=>void check(m.id,k)}>{status==='unavailable'?'重测':'测试'}</button>}</span>;
      })}</div>)}</div><p className="m13-hint">★ 是对应智能体的默认模型；“—”表示供应商没有这个工具需要的接口。测试会发起最小的流式＋工具调用，可能产生少量费用，结果按工具分别保留。能列出的模型不一定能调用。</p>
      </>}
    </>}
    {tab==='agents'&&<>{refs.length?<ul className="m13-gen-list">{refs.map(c=><li key={c.id}><ToolIcon tool={c.kind} size={16}/><b>{c.name}</b><small>{p.models.find(m=>m.id===c.defaultModel)?.name??c.defaultModel}{c.homeVisible?'':' · 不在首页显示'}</small>{c.isDefault&&<Pill tone="ok"><Star size={11}/>默认</Pill>}</li>)}</ul>:<p className="m13-hint">还没有智能体使用这个供应商。</p>}{supported.filter(k=>!refs.some(c=>c.kind===k)).map(k=><button key={k} className="m10-button secondary m13-regen" disabled={!p.hasKey} onClick={()=>onNewAgent(p,k)}><Plus size={14}/>用它创建 {agentLabels[k]} 智能体</button>)}{supported.length>0&&supported.every(k=>refs.some(c=>c.kind===k))&&<p className="m13-hint">适用的 Code Agent 都已经有智能体了，想用更多模型请编辑对应的智能体。</p>}</>}
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
}
