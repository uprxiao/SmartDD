import { useEffect, useMemo, useState } from 'react';
import { selectFileViewer, viewerConfigurationSchema } from '../../../src/shared/file-viewer';
const KEY='willyou-m9-viewer-prototype-v1';
const example={adapters:[{id:'local-text',name:'本机文本资源',enabled:true,suffixes:['.foo','.bar.foo'],sources:['project-directory','task-cwd'],provider:{kind:'local-resource',writable:true}}],preferred:{}};
const load=()=>{try{return viewerConfigurationSchema.parse(JSON.parse(localStorage.getItem(KEY)))}catch{return {adapters:[],preferred:{}}}};
/** P17 interaction model only: no native paths, MCP connection or actual file writes. */
export default function FileMcpViewer({name,text,onDefault,onEdit,onSave,onScenario,initialSettings=false}){
 const [config,setConfig]=useState(load),[explicit,setExplicit]=useState(),[settings,setSettings]=useState(initialSettings),[json,setJson]=useState(''),[error,setError]=useState(''),[baseline,setBaseline]=useState(text||''),[status,setStatus]=useState('ready');
 const adapter=useMemo(()=>selectFileViewer(config,name||'', 'project-directory',explicit),[config,name,explicit]);
 useEffect(()=>{setBaseline(text||'');setStatus('ready')},[name]);
 const draft=text||'';
 useEffect(()=>{if(settings){setJson(JSON.stringify(config,null,2));setError('')}},[settings]);
 const dirty=draft!==baseline,choose=id=>{if(!dirty){setExplicit(id);setStatus('ready')}};
 return <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
  <div className="fw-save-strip"><span>扩展文件查看器 · 原型合成数据</span><button disabled={dirty} onClick={()=>choose(undefined)}>自动选择查看器</button><button disabled={dirty} onClick={onDefault}>内置文件查看器</button><button onClick={()=>setSettings(true)}>管理扩展文件查看器…</button></div>
  <div className="fw-save-strip">{config.adapters.filter(a=>a.enabled).map(a=><button disabled={dirty} key={a.id} onClick={()=>choose(a.id)} aria-pressed={explicit===a.id}>{a.name}</button>)}</div>
  {!adapter?<div className="fw-empty"><p>没有可用的扩展文件查看器。保留内置查看入口。</p><button onClick={onDefault}>返回内置查看器</button></div>:<>
   <div className="fw-save-strip"><span>{adapter.name} · {name} · {adapter.provider.kind==='local-resource'&&adapter.provider.writable?'本机条件保存':'只读资源'}</span></div>
   {status==='failed'?<div role="alert" className="fw-save-strip">扩展连接失败，文件和草稿保持不变。<button onClick={()=>{setStatus('ready');onScenario('ready')}}>重试扩展</button><button disabled={dirty} onClick={onDefault}>返回内置查看器</button></div>:<textarea aria-label="扩展资源内容（原型）" value={draft} readOnly={adapter.provider.kind!=='local-resource'||!adapter.provider.writable} onChange={e=>onEdit(e.target.value)} style={{flex:1,minHeight:180,padding:16,fontFamily:'monospace',background:'transparent',color:'inherit',border:0,resize:'none'}}/>}
   <div className="fw-save-strip"><button disabled={!dirty||status==='conflict'} onClick={()=>{if(onSave()){setBaseline(draft);setStatus('saved')}}}>保存（模拟 ifMatch）</button><button onClick={()=>{setStatus('conflict');onScenario('conflict')}}>模拟资源版本冲突</button><button onClick={()=>{setStatus('failed');onScenario('save-error')}}>模拟连接断开</button></div>
   {status==='conflict'&&<div role="alert" className="fw-save-strip">资源版本已改变，本地修改仍保留。<button onClick={()=>{if(onSave(true)){setBaseline(draft);setStatus('saved');onScenario('ready')}}}>读取最新版本并保留修改（模拟）</button></div>}{status==='saved'&&<div role="status" className="fw-save-strip">已保存合成资源；正式 App 使用真实条件写回回执。</div>}
  </>}
  {settings&&<div className="fw-modal-backdrop" onClick={()=>setSettings(false)}><section className="fw-close-dialog" role="dialog" aria-modal="true" aria-label="扩展文件查看器" onClick={e=>e.stopPropagation()} style={{width:560,maxWidth:'90vw'}}><h2>扩展文件查看器</h2><p>登记本机适配器及匹配后缀。stdio 的 runtimePaths 仅登记服务自身的只读运行文件。此原型只保存公开合成清单，不连接服务或读取本机文件。</p><textarea aria-label="文件查看器适配清单" value={json} onChange={e=>setJson(e.target.value)} spellCheck={false} style={{width:'100%',minHeight:260,fontFamily:'monospace'}}/><button onClick={()=>setJson(JSON.stringify(example,null,2))}>填入本机资源示例</button>{error&&<p role="alert">{error}</p>}<div><button onClick={()=>setSettings(false)}>取消</button><button onClick={()=>{try{const parsed=viewerConfigurationSchema.parse(JSON.parse(json));setConfig(parsed);localStorage.setItem(KEY,JSON.stringify(parsed));setSettings(false)}catch{setError('清单格式无效，请检查编号、来源和适配器能力。')}}}>保存登记</button></div></section></div>}
 </div>;
}
