import {useRef,useEffect,useState} from 'react';
import {UserRound,X} from 'lucide-react';
import {rpc} from '@renderer/lib/ipc';
export type ProfileSiteStates=Awaited<ReturnType<typeof rpc.browser.profileSiteStates>>;
/** B12 site decisions; profile CRUD/import controls are added by the remaining
 * S4 work. This component reads only host-supplied, profile-scoped records. */
export function BrowserProfileSiteStates({taskId,currentProfile,initial,onClose}:{taskId:string;currentProfile:string;initial:ProfileSiteStates;onClose:()=>void}){
  const [records,setRecords]=useState(initial),[selected,setSelected]=useState(currentProfile),[busy,setBusy]=useState(false),[error,setError]=useState(''),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{root.current?.querySelector<HTMLButtonElement>('[role=option][aria-selected=true]')?.focus();},[]);
  const value=records.find(value=>value.profile.id===selected)??records[0];
  const revoke=async(host:string)=>{if(!value)return;setBusy(true);setError('');try{setRecords(await rpc.browser.revokeCertificate({taskId,profileId:value.profile.id,host}));}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="bw-scrim" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><div ref={root} className="bw-dialog bw-dialog-wide" role="dialog" aria-modal="true" aria-label="登录态管理" data-browser-panel="profiles" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(!busy)onClose();}}}>
    <div className="bw-dialog-head"><h2>登录态管理</h2><button type="button" className="fw-icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={16}/></button></div>
    <div className="bw-dialog-body"><p className="bw-hint">每个 profile 独立保存 Cookie、本地存储与缓存。默认使用项目登录态；任务需要不同账号时新建独立登录态。</p>{error&&<p role="alert" className="bw-danger-text">{error}</p>}
      <div className="bw-profiles"><ul className="bw-profile-list" role="listbox" aria-label="登录态列表">{records.map(({profile})=><li key={profile.id}><button type="button" role="option" disabled={busy} aria-selected={profile.id===value?.profile.id} className={profile.id===value?.profile.id?'selected':''} onClick={()=>setSelected(profile.id)}><UserRound size={14}/><span><strong>{profile.label}</strong><small>{profile.scope==='project'?'项目默认':'任务独立'}{profile.id===currentProfile?' · 当前页面使用中':''}</small></span></button></li>)}</ul>
        {value&&<div className="bw-profile-detail"><h3>{value.profile.label}</h3><p className="bw-hint">{value.profile.source?`已从 ${value.profile.source.family==='chrome'?'Chrome':'Edge'} · ${value.profile.source.profile} 导入 Cookie`:'没有导入记录'}</p><h4>证书例外</h4>{value.state.certificates.length?<ul className="bw-list">{value.state.certificates.map(({host})=><li key={host}><span><strong>{host}</strong><small>你曾选择继续访问</small></span><button type="button" className="bw-mini" disabled={busy} onClick={()=>void revoke(host)}>撤销</button></li>)}</ul>:<p className="bw-empty-note">无</p>}<h4>站点权限</h4>{value.state.permissions.length?<ul className="bw-list">{value.state.permissions.map(item=><li key={item.origin+item.permission}><span><strong>{item.origin}</strong><small>{item.permission==='geolocation'?'位置':item.permission} · {item.decision==='allow'?'允许':'拒绝'}</small></span></li>)}</ul>:<p className="bw-empty-note">无</p>}</div>}
      </div></div><div className="bw-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>完成</button></div>
  </div></div>;
}
