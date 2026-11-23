import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, EyeOff, Info, Plus, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { agentProtocol, codeAgentKindSchema, type CodeAgentKind, type ProviderInput, type ProviderModel, type ProviderView } from '@shared/ai-agents';
import { modelForStorage, type ProviderCatalogModel } from '@shared/provider-model-metadata';
import { providerCatalog, type ProviderPreset } from '@shared/provider-catalog';
import { transferValue } from '@shared/project-transfer';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { AgentDialog, Pill } from './ui';
import { ProviderIcon, ToolIcon } from './icons';
import { agentLabels, providerFits } from './agent-editor';
import { ProviderModelPicker } from './provider-model-picker';

export function modelCheckDescription(model:ProviderModel,kind:CodeAgentKind):string{
  const check=model.checks?.[kind];
  if(!check)return '';
  const retried=check.status==='available'&&model.availability[kind]==='available'&&check.attempts===2&&check.failures.length>0;
  return retried?'首次失败后重试成功 · '+check.message:check.message;
}

type ModelCheck = { model: string; kind: CodeAgentKind };

export function configuredModelCheckKinds(provider: ProviderView): CodeAgentKind[] {
  return codeAgentKindSchema.options.filter(kind => provider.endpoints[agentProtocol[kind]]);
}

export function untestedModelChecks(provider: ProviderView, kinds: readonly CodeAgentKind[]): ModelCheck[] {
  return provider.models.flatMap(model => model.offline ? [] : kinds
    .filter(kind => (model.availability[kind] ?? 'untested') === 'untested')
    .map(kind => ({ model: model.id, kind })));
}

export const protocolLabels={responses:'OpenAI Responses',anthropic:'Anthropic',openai:'OpenAI 兼容',gemini:'Gemini 原生'};
type Protocol=keyof typeof protocolLabels;
const protocols=Object.keys(protocolLabels) as Protocol[];
export const contextLabel=(tokens:number|null)=>tokens===null?'—':tokens>=1048576?`${Math.round(tokens/1048576)}M`:tokens>=1000?`${Math.round(tokens/1000)}K`:String(tokens);
const blankModel=(id:string):ProviderModel=>({id,name:id,catalogSource:'manual',contextWindow:null,offline:false,availability:{claude:'untested',codex:'untested'}});
const pairing=(tools:CodeAgentKind[])=>tools.length?`可用于 ${tools.map(t=>agentLabels[t]).join('、')}`:'需确认兼容协议';

/** The three approved setup steps use main-process network work. No mock
 * outcomes, timer-based successes or renderer fetches enter the product. */
export function ProviderCatalogDialog({providers,forTool,onClose,onConnected,onNewAgent}:{providers:ProviderView[];forTool?:CodeAgentKind;
  onClose:()=>void;onConnected:()=>Promise<void>;onNewAgent:(provider:ProviderView,kind:CodeAgentKind)=>void}){
  const [step,setStep]=useState<'catalog'|'form'|'done'>('catalog'),[item,setItem]=useState<ProviderPreset|null>(null),[query,setQuery]=useState('');
  const [name,setName]=useState(''),[key,setKey]=useState(''),[showKey,setShowKey]=useState(false),[proto,setProto]=useState<Protocol>('responses'),[url,setUrl]=useState('');
  const [more,setMore]=useState<Partial<Record<Protocol,string>>>({}),[manual,setManual]=useState(''),[detected,setDetected]=useState<string|null>(null);
  const [result,setResult]=useState<{models:ProviderCatalogModel[];recommended:ProviderView['recommended'];note:string|null}|null>(null),[picked,setPicked]=useState<string[]>([]);
  const [done,setDone]=useState<ProviderView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState<'fetch'|'probe'|'connect'|null>(null);
  const [testing, setTesting] = useState<(ModelCheck & { progress?: string }) | null>(null);
  const closed = useRef(false);
  const [context,setContext]=useState(''),[efforts,setEfforts]=useState(''),[reasoning,setReasoning]=useState('');
  const custom=item===null,editable=custom||item.requiresAddress;
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      void rpc.providerSetup.cancel();
    };
  }, []);
  const closeDialog = () => {
    closed.current = true;
    onClose();
  };
  const choose=(p:ProviderPreset|null)=>{
    setItem(p);setName(p?.name??'');setKey(p?.id==='magpie'?'magpie':'');setProto(p?.id==='smg'?'anthropic':'responses');setUrl('');setMore({});
    setManual('');setDetected(null);setResult(null);setPicked([]);setError('');setContext('');setEfforts('');setReasoning('');setStep('form');
  };
  const endpoints=editable?Object.fromEntries([[proto,url],...Object.entries(more).filter(([k])=>k!==proto)].filter(([,v])=>typeof v==='string'&&v.trim()).map(([k,v])=>[k,(v as string).trim()])):item.endpoints;
  const input=(models:ProviderModel[]=[]):ProviderInput=>({name:name.trim(),preset:item?.id??null,endpoints,authType:item?.authType??'bearer',key:key.trim()||undefined,
    models,recommended:result?.recommended??{}});
  const validate=()=>{
    if(!name.trim())throw Error('请填写名称');if(!Object.keys(endpoints).length)throw Error('请填写服务地址');
    if(!key.trim()&&item?.id!=='magpie')throw Error(`请填写${item?.keyLabel??'API 密钥'}`);
  };
  const fetchModels=async()=>{
    if(busy)return;setError('');try{validate();}catch(e){setError(rpcErrorMessage(e));return;}
    setBusy('fetch');
    try{
      const r=transferValue(await rpc.providerSetup.models(input()));
      const ids=new Set(r.models.map(m=>m.id));
      setResult(r);setPicked(previous=>previous.filter(id=>ids.has(id)));
    }
    catch(e){setError(rpcErrorMessage(e));setResult(null);setPicked([]);}finally{setBusy(null);}
  };
  const probe=async()=>{
    if(busy)return;setError('');try{validate();}catch(e){setError(rpcErrorMessage(e));return;}setBusy('probe');
    try{
      const kinds=codeAgentKindSchema.options.filter(k=>endpoints[agentProtocol[k]]);
      const notes:string[]=[];
      for(const kind of kinds){const r=transferValue(await rpc.providerSetup.probe(input(),kind));notes.push(`${agentLabels[kind]}：${r.message}`);}
      setDetected(notes.length?notes.join('；'):'只有 OpenAI 兼容地址，两个工具都不能直接使用');
    }catch(e){setError(rpcErrorMessage(e));}finally{setBusy(null);}
  };
  const connect=async()=>{
    if(busy)return;setError('');
    try{
      validate();let models=result?.models.filter(m=>picked.includes(m.id)).map(modelForStorage)??[];
      if(!models.length&&manual.trim())models=[...new Set(manual.split(/[,，\s]+/).filter(Boolean))].map(blankModel);
      if(!models.length)throw Error('请至少勾选或手动填写一个模型');
      if(custom&&(context||efforts||reasoning)){
        const window=context?Number(context):null,levels=efforts.split(/[,，\s]+/).filter(Boolean);
        if(window!==null&&(!Number.isSafeInteger(window)||window<=0))throw Error('上下文窗口必须是正整数');
        if(reasoning&&!levels.includes(reasoning))throw Error('默认推理档位必须在支持档位中');
        models=models.map(m=>({...m,contextWindow:window??m.contextWindow,codex:{reasoningLevels:levels,defaultReasoning:reasoning||null,inputModalities:m.codex?.inputModalities??['text'],supportVerbosity:m.codex?.supportVerbosity??false}}));
      }
      setBusy('connect');const p=transferValue(await rpc.providerSetup.connect(input(models)));await onConnected();setKey('');setDone(p);setStep('done');
    }catch(e){setError(rpcErrorMessage(e));}finally{setBusy(null);}
  };
  const number=step==='catalog'?0:step==='form'?1:2;
  const title=step==='catalog'?'添加供应商':step==='done'?'已添加':custom?(name||'自定义供应商'):item.name;
  const configured = done ? configuredModelCheckKinds(done) : [];
  const supported = done ? configured.filter(kind => providerFits(done, kind)) : [];
  const untested = done ? untestedModelChecks(done, configured) : [];
  const testModels = async (checks: ModelCheck[], batch = false) => {
    if (!done?.hasKey || testing || closed.current) return;
    setError('');
    let updated = false;
    try {
      for (const [index, check] of checks.entries()) {
        if (closed.current) break;
        setTesting({ ...check, progress: batch ? `测试中 ${index + 1}/${checks.length}` : undefined });
        const provider = await rpc.agents.checkProviderModel(done.id, check.kind, check.model);
        updated = true;
        if (!closed.current) setDone(provider);
      }
    } catch (e) {
      if (!closed.current) setError(rpcErrorMessage(e));
    }
    try {
      if (updated) await onConnected();
    } catch (e) {
      if (!closed.current) setError(previous => previous || rpcErrorMessage(e));
    } finally {
      if (!closed.current) setTesting(null);
    }
  };
  const fieldChange=()=>{setResult(null);setPicked([]);setDetected(null);};
  return <AgentDialog title={title} sub={step==='catalog'?'选择目录中的供应商，或添加自定义供应商':step==='done'?'供应商已保存，可以用它创建智能体':editable?'填写服务地址与 Key，获取模型':'地址与协议已预填，填写 Key 并获取模型'} wide onClose={closeDialog}
    footer={step==='catalog'?<button className="m10-button secondary" onClick={onClose}>取消</button>:step==='done'?<>{done&&supported.length>0&&<button className="m10-button secondary" disabled={!!testing} onClick={()=>onNewAgent(done,forTool&&supported.includes(forTool)?forTool:supported[0])}><Plus size={14}/>创建智能体</button>}<button className="m10-button primary" onClick={closeDialog}>完成</button></>:<><button className="m10-button secondary m13-foot-left" disabled={Boolean(busy)} onClick={()=>{setError('');setStep('catalog');}}><ArrowLeft size={14}/>返回</button><button className="m10-button secondary" onClick={onClose}>取消</button>{!result&&!manual.trim()?<button className="m10-button primary" disabled={Boolean(busy)} onClick={()=>void fetchModels()}>{busy==='fetch'?'获取中…':'获取模型'}</button>:<button className="m10-button primary" disabled={Boolean(busy)||(!picked.length&&!manual.trim())} onClick={()=>void connect()}>{busy?'正在确认…':'接入'}</button>}</>}>
    <ol className="m13-steps" aria-label="步骤">{['选择','填写 Key 并获取模型','完成'].map((s,i)=><li key={s} className={(number>=i?'on':'')+(number===i?' cur':'')} aria-current={number===i?'step':undefined}><i>{number>i?<Check size={11}/>:i+1}</i>{s}</li>)}</ol>
    {step==='catalog'&&<><label className="m10-search m13-cat-search"><Search size={14}/><input aria-label="查找供应商" placeholder="查找供应商" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <section className="m13-cat-group"><h3>供应商<span>{forTool?`适用 ${agentLabels[forTool]} 的排在前面`:''}</span></h3><div className="m13-cat-grid">{providerCatalog.filter(p=>p.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>forTool?Number(b.tools.includes(forTool))-Number(a.tools.includes(forTool)):0).map(p=>{
        const has=providers.some(saved=>saved.preset===p.id);return <button key={p.id} className="m13-cat-item" disabled={has} onClick={()=>choose(p)}><ProviderIcon catalog={p.id} name={p.name} size={28}/><span><b>{p.name}{has&&<i className="m13-dot-ok" aria-label="已接入"/>}</b><small>{has?'已接入':`${p.description} · ${pairing(p.tools)}`}</small>{!p.documented&&<small className="m13-unverified">待提供地址与协议</small>}</span></button>;
      })}</div></section><section className="m13-cat-group"><h3>自定义供应商</h3><div className="m13-cat-grid"><button className="m13-cat-item" onClick={()=>choose(null)}><span className="m13-cap-icon big"><Plus size={16}/></span><span><b>自定义供应商</b><small>填写地址与 Key</small></span></button></div></section>
      <p className="m13-hint m13-cat-foot">订阅或 CLI 里登录的 API Key 不需要在这里添加：在终端登录后，新建智能体时可以直接选“订阅”或“API”。</p></>}
    {step==='form'&&<>
      {item&&!item.documented&&<div className="m13-alert warn"><Info size={16}/><div><strong>地址与协议待核实</strong><p>请填写你获得的真实服务地址，接入前会以最小调用验证。</p></div></div>}
      <fieldset disabled={Boolean(busy)} className="m13-form-grid" style={{border:0,padding:0,margin:0}}>
        {custom&&<><label className="m13-form-label" htmlFor="provider-setup-name">名称</label><input id="provider-setup-name" className="m13-input" value={name} onChange={e=>{setName(e.target.value);fieldChange();}} placeholder="例如 我的中转"/></>}
        <span className="m13-form-label">服务地址</span><div>{editable?<><div className="m13-proto-tabs" role="tablist">{protocols.map(k=><button type="button" key={k} role="tab" aria-selected={proto===k} onClick={()=>{setProto(k);fieldChange();}}>{protocolLabels[k]}</button>)}</div><input className="m13-input" aria-label="服务地址" value={url} onChange={e=>{setUrl(e.target.value);fieldChange();}} placeholder={proto==='anthropic'?'https://…/anthropic':'https://…/v1'}/>
          <div className="m13-inline-actions"><button type="button" className="m10-button secondary m13-row-btn" onClick={()=>void probe()}>检测协议</button>{detected&&<span className="m13-hint">{detected}（接入时以最小调用确认）</span>}</div>
          <details className="m13-adv"><summary>更多端点</summary>{protocols.filter(k=>k!==proto).map(k=><label key={k} className="m13-field"><span>{protocolLabels[k]}</span><input value={more[k]??''} onChange={e=>{setMore(old=>({...old,[k]:e.target.value}));fieldChange();}} placeholder="可选"/></label>)}</details>
          <small className="m13-hint">Codex 需要 OpenAI Responses，Claude Code 需要 Anthropic；只有 OpenAI 兼容时两个工具都不能直接使用。</small></>:<>{Object.entries(endpoints).map(([p,address])=><div className="m13-endpoint" key={p}><Pill tone={p==='openai'?'muted':'info'}>{protocolLabels[p as Protocol]}</Pill><code>{address}</code></div>)}<small className="m13-hint">{pairing(item!.tools)}</small></>}</div>
        <span className="m13-form-label">{item?.keyLabel??'API 密钥'}</span><div className="m13-key"><input aria-label={item?.keyLabel??'API 密钥'} type={showKey?'text':'password'} autoComplete="off" value={key} onChange={e=>{setKey(e.target.value);fieldChange();}} placeholder="粘贴 Key，加密保存，只在启动时注入"/><button type="button" className="m13-link" onClick={()=>setShowKey(v=>!v)}>{showKey?<EyeOff size={14}/>:<Eye size={14}/>} {showKey?'隐藏':'显示'}</button></div>
        {editable&&<><span className="m13-form-label">图标</span><div className="m13-inline-actions"><ProviderIcon catalog={item?.id??'custom-'+name} name={name||'?'} size={28}/><span className="m13-hint">{custom?'默认使用名称首字母':'使用供应商图标'}</span></div><label className="m13-form-label" htmlFor="provider-manual-models">模型</label><div><input id="provider-manual-models" className="m13-input" value={manual} onChange={e=>setManual(e.target.value)} placeholder="模型 ID，逗号分隔；留空则从服务获取"/><button type="button" className="m13-link" onClick={()=>void fetchModels()}>获取模型</button></div></>}
        {custom&&<><span className="m13-form-label">高级设置</span><details className="m13-adv"><summary>Codex 模型元数据</summary><label className="m13-field"><span>上下文窗口（tokens）</span><input inputMode="numeric" value={context} onChange={e=>setContext(e.target.value)} placeholder="使用目录或通用默认值"/></label><label className="m13-field"><span>支持的推理档位</span><input value={efforts} onChange={e=>setEfforts(e.target.value)} placeholder="例如 low, medium, high"/></label><label className="m13-field"><span>默认推理档位</span><input value={reasoning} onChange={e=>setReasoning(e.target.value)}/></label></details></>}
      </fieldset>
      {result&&(result.models.length
        ? <ProviderModelPicker models={result.models} picked={picked} onPick={setPicked} busy={Boolean(busy)}/>
        : <section className="m13-fetched"><h3 className="m13-sub">已获取 0 个模型</h3><div className="m13-alert info"><Info size={16}/><div><p>{result.note||'没有获取到模型列表'}{!result.note?.includes('手动填写模型 ID')&&'，请手动填写模型 ID。'}</p></div></div>{!editable&&<label className="m13-field"><span>模型 ID</span><input value={manual} onChange={e=>setManual(e.target.value)} placeholder="例如 acme-coder-large"/></label>}</section>)}
      <p className="m13-hint">协议探测与接入确认可能产生少量费用。接入时以最小的流式＋工具调用验证，并为每个适用的工具测试推荐模型。</p>
    </>}
    {busy&&<p className="m13-desc"><RefreshCw size={14} className="m13-spin"/> {busy==='fetch'?'正在获取模型列表…':busy==='probe'?'正在探测候选协议…':'正在确认接口并测试推荐模型…'}</p>}
    {error&&<div className="m13-alert danger" role="alert"><TriangleAlert size={16}/><div><p>{error}</p></div></div>}
    {step === 'done' && done && <div className="m13-done">
      <div className="m13-right-head"><ProviderIcon catalog={done.preset} name={done.name} size={44}/><div><b>{done.name} 已添加</b><small>{pairing(supported)} · {done.models.length} 个模型</small></div></div>
      <h3 className="m13-sub m13-sub-row">模型（{done.models.length}）
        {(untested.length > 0 || testing?.progress) && <button type="button" className="m13-link"
          disabled={!!testing || !done.hasKey} onClick={() => void testModels(untested, true)}>
          {testing?.progress ?? `测试全部未测试（${untested.length}）`}
        </button>}
      </h3>
      <div className={'m13-table matrix done-models'+(configured.length===3?' three-tools':'')} role="table" aria-label="模型">
        <div role="row" className="m13-th"><span>模型</span><span>上下文</span>{configured.map(kind => <span key={kind} className="m13-th-tool"><ToolIcon tool={kind} size={14}/>{agentLabels[kind]}</span>)}</div>
        {done.models.map(model => <div role="row" key={model.id} data-model={model.id}>
          <span className="m13-cell-name">{model.name}</span><span>{contextLabel(model.contextWindow)}</span>
          {configured.map(kind => {
            const status = model.availability[kind];
            const checking = testing?.model === model.id && testing.kind === kind;
            return <span className="m13-cell" key={kind} title={modelCheckDescription(model, kind)}>
              <Pill tone={status === 'available' ? 'ok' : status === 'unavailable' ? 'warn' : 'muted'}>{checking ? '测试中…' : status === 'available' ? '可用' : status === 'unavailable' ? '不可用' : '未测试'}</Pill>
              {!checking && status !== 'available' && !model.offline && <button type="button" className="m13-link" disabled={!!testing || !done.hasKey}
                aria-label={`${status === 'unavailable' ? '重测' : '测试'} ${model.name} · ${agentLabels[kind]}`} onClick={() => void testModels([{ model: model.id, kind }])}>
                {status === 'unavailable' ? '重测' : '测试'}
              </button>}
            </span>;
          })}
        </div>)}
      </div>
      {!supported.length && <div className="m13-alert warn"><Info size={16}/><div><p>当前 Code Agent 无法直接使用这个供应商。可先通过 Magpie 等网关接入，或在详情里核对并重测协议。</p></div></div>}
      <p className="m13-hint">接入时每种适用协议只测试一个推荐模型。「未测试」表示模型已加入目录，尚未验证该工具的实际调用。点击「测试」会发起一次最小调用，结果保存在供应商上。</p>
    </div>}
  </AgentDialog>;
}
