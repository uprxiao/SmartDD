import { useState } from 'react';
import { Check, Info, Plus, Star, TriangleAlert } from 'lucide-react';
import type { CodeAgentKind, CodeAgentTool, ProviderView, RunConfigInput, RunConfigView } from '@shared/ai-agents';
import { verifiedPresetProtocol } from '@shared/ai-provider-presets';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { ProviderIcon, ToolIcon } from './icons';
import { AgentDialog, AgentSwitch, Pill } from './ui';

export const agentLabels:Record<string,string>={claude:'Claude Code',codex:'Codex'};
const loginLabels={none:'订阅',api:'API',subscription:'订阅',local:'本机登录'};
const placeholders=[['opencode','OpenCode'],['zcode','Z Code'],['pi','Pi'],['dsh','DSH']];
export const providerFits=(p:ProviderView,kind:CodeAgentKind)=>Boolean((kind==='claude'?p.endpoints.anthropic:p.endpoints.responses)&&
  (verifiedPresetProtocol(p.preset,p.endpoints,kind)||p.models.some(m=>!m.offline&&m.availability[kind]==='available')));
const modelStatus={available:'可用',unavailable:'不可用',untested:'未测试'};

export function AgentEditor({initial,preset,configs,providers,tools,onClose,onSaved,onEditExisting,onAddProvider,onToolPath,onRedetect,onRefresh,redetecting=false}:{
  preset?:{kind:CodeAgentKind;providerId:string};redetecting?:boolean;
  initial?:RunConfigView;configs:RunConfigView[];providers:ProviderView[];tools:CodeAgentTool[];onClose:()=>void;onSaved:()=>void;
  onEditExisting:(c:RunConfigView)=>void;onAddProvider:(kind:CodeAgentKind)=>void;onToolPath:(t:CodeAgentTool)=>void;onRedetect:()=>void;onRefresh:()=>Promise<void>;
}){
  const [toolId,setToolId]=useState(initial?.toolId??(preset?(tools.find(t=>t.kind===preset.kind&&t.installed)?.id??tools.find(t=>t.kind===preset.kind)?.id??`tool-${preset.kind}`):(tools.find(t=>t.installed)?.id??tools[0]?.id??'tool-claude')));
  const tool=tools.find(t=>t.id===toolId),kind=((tool?.kind??initial?.kind??preset?.kind)==='codex'?'codex':'claude') as CodeAgentKind;
  const existing=(toolId:string,providerId:string|null)=>configs.find(c=>c.id!==initial?.id&&c.source!=='legacy'&&c.toolId===toolId&&c.providerId===providerId);
  const defaultSource=(t:CodeAgentTool|undefined)=>t?.login!=='none'&&t?.installed&&!existing(t.id,null)?'login':providers.find(p=>t&&providerFits(p,t.kind as CodeAgentKind)&&!existing(t.id,p.id))?.id??null;
  const [source,setSource]=useState<string|null>(initial?(initial.source==='login'?'login':initial.providerId):preset?.providerId??defaultSource(tool));
  const provider=providers.find(p=>p.id===source);
  const recommended=(p:ProviderView|undefined,k:CodeAgentKind)=>{
    const allowed=p?.models.filter(m=>!m.offline&&m.availability[k]!=='unavailable')??[];
    return allowed.find(m=>m.id===p?.recommended[k])?.id??allowed.find(m=>m.availability[k]==='available')?.id??allowed[0]?.id??null;
  };
  const [model,setModel]=useState<string|null>(initial?.defaultModel??recommended(provider,kind));
  const [picked,setPicked]=useState<string[]>(initial?.models??(model?[model]:[])),[name,setName]=useState(initial?.name??'');
  const [touched,setTouched]=useState(Boolean(initial)),[visible,setVisible]=useState(initial?.homeVisible??true),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[testing,setTesting]=useState<string|null>(null);
  const login=source==='login',options=provider?.models.filter(m=>!m.offline&&m.availability[kind]!=='unavailable')??[];
  const selected=picked.filter(id=>options.some(m=>m.id===id)),defaultModel=selected.includes(model??'')?model:selected[0]??null;
  const autoName=login?`${agentLabels[kind]} · ${loginLabels[tool?.login??'none']}`:`${agentLabels[kind]} · ${provider?.name??''}`;
  const finalName=(touched?name:autoName).trim(),duplicate=configs.some(c=>c.id!==initial?.id&&c.source!=='legacy'&&c.name===finalName);
  const duplicateAgent=source?existing(toolId,login?null:source):undefined;
  const ready=tool?.installed&&!duplicate&&!duplicateAgent&&finalName&&(login?tool.login!=='none':provider&&selected.length&&defaultModel);
  const pickSource=(id:string|null,k:CodeAgentKind=kind)=>{setSource(id);const p=providers.find(x=>x.id===id),m=recommended(p,k);setModel(m);setPicked(m?[m]:[]);};
  const pickTool=(t:CodeAgentTool)=>{setToolId(t.id);pickSource(defaultSource(t),t.kind as CodeAgentKind);};
  const toggleModel=(id:string)=>setPicked(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
  const save=async()=>{
    if(!ready||busy)return;setBusy(true);setError('');
    const input:RunConfigInput={name:finalName,toolId,source:login?'login':'provider',providerId:login?null:source,
      models:defaultModel?[defaultModel,...selected.filter(id=>id!==defaultModel)]:[],defaultModel,homeVisible:visible,
      isDefault:initial?.isDefault??false,nameCustomized:touched};
    try{await rpc.agents.save(input,initial?.id);await onRefresh();onSaved();onClose();}
    catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}
  };
  const test=async(id:string)=>{if(!provider||testing)return;setTesting(id);setError('');try{await rpc.agents.checkProviderModel(provider.id,kind,id);await onRefresh();}catch(e){setError(rpcErrorMessage(e));}finally{setTesting(null);}};
  const existingOption=(c:RunConfigView,title:string,icon:React.ReactNode)=><div className="m13-prov-opt disabled exists" key={c.id} data-existing={c.id}><span className="m13-radio-dot"/>{icon}<span><b>{title}</b><small>已有“{c.name}”，同一组合只能有一个；想用更多模型请编辑它</small></span><button className="m13-link" onClick={()=>onEditExisting(c)}>编辑它</button></div>;
  const loginExisting=existing(toolId,null);
  const eligibleSources=[...(tool?.installed&&tool.login!=='none'?['login']:[]),...providers.filter(p=>providerFits(p,kind)).map(p=>p.id)];
  const allUsed=!initial&&eligibleSources.length>0&&eligibleSources.every(id=>existing(toolId,id==='login'?null:id));

  return <AgentDialog title={initial?'编辑智能体':'新建智能体'} sub={initial?initial.name:'选 Code Agent，再选订阅或供应商，最后勾选模型；Key 已保存在供应商上'} wide onClose={onClose}
    footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!ready||busy} onClick={()=>void save()}>{busy?'正在保存…':initial?'保存':'创建'}</button></>}>
    <section className="m13-step" data-step="1"><h3 className="m13-step-h"><i>1</i>Code Agent{initial&&<small>编辑时不能更换</small>}</h3>
      <div className="m13-agent-cards" role="radiogroup" aria-label="Code Agent">{(['claude','codex'] as const).map(k=>{
        const t=tools.find(t=>t.id===initial?.toolId&&t.kind===k)??tools.find(t=>t.kind===k&&t.installed)??tools.find(t=>t.kind===k),can=t?.installed&&(!initial||initial.toolId===t.id);
        return <button key={k} role="radio" aria-checked={kind===k} disabled={!can} className={'m13-agent-card'+(kind===k?' selected':'')} onClick={()=>t&&pickTool(t)}><ToolIcon tool={k} size={24}/><span><b>{agentLabels[k]}</b><small>{!t?.installed?'未检测到 · 安装后重新检测':`${t.version??'版本未知'} · ${t.login==='none'?'未登录':`已登录（${loginLabels[t.login]}）`}`}</small></span>{kind===k&&<Check size={14} className="m13-card-check"/>}</button>;
      })}{placeholders.map(([id,label])=><button className="m13-agent-card" disabled key={id} title={`${label} 暂不支持，后续版本接入`}><ProviderIcon catalog={'agent-'+id} name={label} size={24}/><span><b>{label}</b><small>暂不支持</small></span></button>)}</div>
      <div className="m13-tool-status" aria-label="本机检测"><span className="m13-ts-label">本机检测</span>{tools.filter(t=>t.kind==='claude'||t.kind==='codex').map(t=><span key={t.id} className="m13-ts-item" data-tool={t.id}><b>{agentLabels[t.kind]}</b>{t.installed?<span className="m13-checks"><span><Check size={12}/>检测到程序</span><span><Check size={12}/>程序可启动</span>{t.version?.match(/\d+\.\d+\.\d+/)?.[0]===(t.kind==='codex'?'0.167.1':'2.1.322')?<span><Check size={12}/>版本已验证</span>:<span className="warn"><TriangleAlert size={12}/>未验证版本 {t.version}，可继续使用</span>}</span>:<span className="warn"><TriangleAlert size={12}/>未检测到</span>}<button className="m13-link" onClick={()=>onToolPath(t)}>自定义路径…</button></span>)}<button className="m13-link" disabled={redetecting} onClick={onRedetect}>{redetecting?'检测中…':'重新检测'}</button></div>
    </section>
    <section className="m13-step" data-step="2"><h3 className="m13-step-h"><i>2</i>订阅或供应商<small>只列支持 {agentLabels[kind]} 的</small></h3>
      <div className="m13-prov-list" role="radiogroup" aria-label="订阅或供应商">
        {loginExisting?existingOption(loginExisting,loginLabels[tool?.login??'none'],<ToolIcon tool={kind} size={22}/>):(tool&&tool.login!=='none')||initial?.source==='login'?<button role="radio" aria-checked={login} className={'m13-prov-opt'+(login?' selected':'')} onClick={()=>pickSource('login')}><span className="m13-radio-dot"/><ToolIcon tool={kind} size={22}/><span><b>{loginLabels[tool?.login??'local']}</b><small>{tool?.login==='api'&&tool.loginSourceEnv==='ANTHROPIC_API_KEY'?'来自环境变量 ANTHROPIC_API_KEY；使用 CLI 自己的默认模型':'使用 CLI 自己的登录与默认模型'}</small></span></button>:<div className="m13-prov-opt disabled"><span className="m13-radio-dot"/><ToolIcon tool={kind} size={22}/><span><b>订阅</b><small>{agentLabels[kind]} 未登录。在终端运行 <code>{kind}</code> 登录后即可选择</small></span></div>}
        {providers.filter(p=>providerFits(p,kind)).map(p=>{const ex=existing(toolId,p.id);return ex?existingOption(ex,p.name,<ProviderIcon catalog={p.preset} name={p.name} size={22}/>):<button key={p.id} role="radio" aria-checked={source===p.id} className={'m13-prov-opt'+(source===p.id?' selected':'')} onClick={()=>pickSource(p.id)} data-provider={p.id}><span className="m13-radio-dot"/><ProviderIcon catalog={p.preset} name={p.name} size={22}/><span><b>{p.name}{!p.hasKey&&<Pill tone="warn">需要填写 Key</Pill>}</b><small>{p.models.length} 个模型 · Key 与模型可用性保存在供应商上</small></span></button>;})}
        {providers.some(p=>!providerFits(p,kind))&&<details className="m13-incompat-list"><summary>不支持 {agentLabels[kind]} 的供应商（{providers.filter(p=>!providerFits(p,kind)).length}）</summary>{providers.filter(p=>!providerFits(p,kind)).map(p=><div key={p.id} className="m13-prov-opt disabled"><ProviderIcon catalog={p.preset} name={p.name} size={22}/><span><b>{p.name}</b><small>所需协议缺失或尚未验证，请在供应商详情测试模型</small></span></div>)}</details>}
        <button className="m13-link m13-add-conn" onClick={()=>onAddProvider(kind)}><Plus size={13}/>添加供应商</button>
      </div>
    </section>
    <section className="m13-step" data-step="3"><h3 className="m13-step-h"><i>3</i>模型与名称</h3>
      {login?<p className="m13-hint m13-plain">使用 {agentLabels[kind]} 自己的默认模型，可在会话里切换。WillYou 拿不到 CLI 的凭据，不能获取模型列表或测试可用性。</p>:provider?<div className="m13-field"><span>模型<small className="m13-field-note">可多选，会话里可以在勾选的模型之间切换；★ 为启动时的默认模型</small></span><div className="m13-model-checks" role="group" aria-label="模型">{options.map(m=>{
        const on=selected.includes(m.id),status=m.availability[kind];return <div key={m.id} className={'m13-model-check'+(on?' on':'')} data-model={m.id}><label><input type="checkbox" checked={on} onChange={()=>toggleModel(m.id)}/><span className="m13-mc-name">{m.name}</span></label>{provider.recommended[kind]===m.id&&<Pill tone="info">推荐</Pill>}<Pill tone={status==='available'?'ok':'muted'}>{testing===m.id?'测试中…':modelStatus[status]}</Pill>{status==='untested'&&testing!==m.id&&<button className="m13-link" onClick={()=>void test(m.id)}>测试</button>}<span className="m13-mc-default">{on&&(defaultModel===m.id?<span className="m13-mc-star"><Star size={12}/>默认</span>:<button className="m13-link" onClick={()=>setModel(m.id)}>设为默认</button>)}</span></div>;
      })}</div>{provider.models.length>options.length&&<small className="m13-hint">{provider.models.length-options.length} 个模型在 {agentLabels[kind]} 中不可用，已隐藏；可在供应商详情里重新测试。</small>}</div>:<p className="m13-hint">{allUsed?<>当前 Code Agent 的组合已经全部有智能体了，请编辑已有的智能体，或<button className="m13-link" onClick={()=>onAddProvider(kind)}>添加新供应商</button>。</>:<>先选择订阅或供应商。</>}</p>}
      <label className="m13-field"><span>名称</span><input value={touched?name:autoName} maxLength={60} onChange={e=>{setTouched(true);setName(e.target.value);}}/></label>
      {duplicate&&<p className="m13-hint">已有同名智能体，请修改名称。</p>}
      <div className="m13-field"><span>首页显示</span><span className="m13-switch-row m13-plain"><AgentSwitch on={visible} label="在首页显示" disabled={initial?.isDefault} onChange={()=>setVisible(v=>!v)}/><span>{initial?.isDefault?'默认智能体必须在首页显示':visible?'在首页的智能体下拉中显示':'不在首页显示'}</span></span></div>
      {!login&&kind==='claude'&&provider&&<div className="m13-alert info"><Info size={16}/><div><p>Claude Code 的各档位与子智能体统一使用默认模型 {defaultModel}；第三方供应商运行不应用项目权限与钩子。</p></div></div>}
      {!login&&kind==='codex'&&provider&&<div className="m13-alert info"><Info size={16}/><div><strong>第三方 Provider 下 Codex 原生插件不可用</strong><p>插件自带的 Skill／MCP 可在“技能”页发现并纳管；新建或重启会话后生效。</p></div></div>}
    </section>
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
}
