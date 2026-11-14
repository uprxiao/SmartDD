import { useEffect, useState } from 'react';
import { Download, FileInput, Server, Sparkles, Upload } from 'lucide-react';
import type { ProviderView, RunConfigView } from '@shared/ai-agents';
import type { AgentImportPreview } from '@shared/agent-transfer';
import { passphraseIssue, transferValue } from '@shared/project-transfer';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { AgentDialog, Pill } from './ui';

export function AgentExportDialog({providers,configs,onClose,onDone}:{providers:ProviderView[];configs:RunConfigView[];onClose:()=>void;onDone:()=>void}){
  const exportable=configs.filter(c=>c.source!=='login');
  const [selected,setSelected]=useState(exportable.filter(c=>c.source!=='legacy').map(c=>c.id)),[extra,setExtra]=useState<string[]>([]);
  const [includeKeys,setIncludeKeys]=useState(false),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const automatic=new Set(configs.filter(c=>selected.includes(c.id)).flatMap(c=>c.providerId?[c.providerId]:[]));
  useEffect(()=>()=>{void rpc.agentTransfer.dispose();},[]);
  const toggle=(ids:string[],id:string)=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];
  const save=async()=>{
    if(busy)return;
    if(!selected.length&&!extra.length){setError('请至少选择一项');return;}
    const issue=includeKeys?passphraseIssue(password,confirmation):null;if(issue){setError(issue);return;}
    setBusy(true);setError('');
    try{
      const result=transferValue(await rpc.agentTransfer.export({agentIds:selected,providerIds:extra,includeKeys,
        ...(includeKeys?{password,confirmation}:{})}));
      if(result){onDone();onClose();}
    }catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}
  };
  return <AgentDialog title="导出智能体配置" sub="生成 JSON 文件，别人导入后可直接使用" wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={busy} onClick={()=>void save()}><Download size={14}/>{busy?'正在导出…':'导出'}</button></>}>
    <h3 className="m13-sub">智能体</h3><div className="m13-checks-list">{exportable.map(c=><label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={()=>setSelected(ids=>toggle(ids,c.id))}/>{c.name}<small>{c.source==='legacy'?'高级配置':''}</small></label>)}</div>
    <h3 className="m13-sub">供应商</h3><div className="m13-checks-list">{providers.map(p=><label key={p.id}><input type="checkbox" checked={automatic.has(p.id)||extra.includes(p.id)} disabled={automatic.has(p.id)} onChange={()=>setExtra(ids=>toggle(ids,p.id))}/>{p.name}<small>{automatic.has(p.id)?'随所选智能体带上':''}</small></label>)}</div>
    <label className="m13-check"><input type="checkbox" checked={includeKeys} onChange={e=>setIncludeKeys(e.target.checked)}/>包含 Key（用口令加密，导入时需输入口令）</label>
    {includeKeys&&<div className="m13-tiers"><label className="m13-field"><span>口令（至少 8 个字符）</span><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="m13-field"><span>再次输入</span><input type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label></div>}
    <p className="m13-hint">不导出工具可执行路径与本机目录；订阅/API 智能体跟随本机 CLI 登录，不导出，对方登录后可以自行创建。{includeKeys?'':'默认不含 Key。'}</p>
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
}

export function AgentImportDialog({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){
  const [preview,setPreview]=useState<AgentImportPreview|null>(null),[file,setFile]=useState<{token:string;encrypted:boolean}|null>(null);
  const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>()=>{void rpc.agentTransfer.dispose();},[]);
  const choose=async()=>{
    if(busy)return;setBusy(true);setError('');
    try{const result=transferValue(await rpc.agentTransfer.chooseImport());if(result){setFile(result);setPreview(result.preview);setPassword('');}}
    catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}
  };
  const unlock=async()=>{
    if(!file||busy)return;setBusy(true);setError('');
    try{setPreview(transferValue(await rpc.agentTransfer.unlock(file.token,password)));setPassword('');}
    catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}
  };
  const commit=async()=>{
    if(!preview||busy)return;setBusy(true);setError('');
    try{transferValue(await rpc.agentTransfer.commit(preview.token));onDone();onClose();}
    catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}
  };
  return <AgentDialog title="导入智能体配置" sub="选择 WillYou 导出的配置文件，核对后再导入" wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!preview||busy} onClick={()=>void commit()}><Upload size={14}/>{busy?'正在处理…':'导入'}</button></>}>
    <button className="m10-button secondary" disabled={busy} onClick={()=>void choose()}><FileInput size={14}/>{file?'重新选择文件':'选择配置文件…'}</button>
    {file?.encrypted&&!preview&&<><label className="m13-field"><span>配置口令</span><input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="m10-button secondary" disabled={busy||!password} onClick={()=>void unlock()}>解锁并预览</button></>}
    {preview&&<><h3 className="m13-sub">将导入</h3>
      {preview.providers.map(p=><div className="m13-row" key={p.ref}><span className="m13-rowicon"><Server size={16}/></span><span>{p.finalName}<small>{Object.values(p.endpoints).join(' · ')}</small></span><Pill tone={p.needsKey?'warn':'ok'}>{p.needsKey?'需要填写 Key':'含 Key'}</Pill></div>)}
      {preview.agents.map(c=><div className="m13-row" key={c.ref}><span className="m13-rowicon"><Sparkles size={16}/></span><span>{c.finalName}<small>{c.finalName!==c.name?'已有同名配置，不覆盖':'新配置'}{!c.toolInstalled?' · 本机尚未检测到 Code Agent':''}</small></span></div>)}
      {preview.skipped.length>0&&<p className="m13-hint">文件里有 {preview.skipped.length} 个订阅/API 智能体，已跳过：它们跟随本机 CLI 登录，请登录后自行创建。</p>}
    </>}
    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
  </AgentDialog>;
}
