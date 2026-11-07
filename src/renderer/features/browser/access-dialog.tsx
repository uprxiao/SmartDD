import {useEffect,useState,useSyncExternalStore} from 'react';
import {ShieldAlert,X} from 'lucide-react';
import {browserAccessChangedEvent} from '@shared/events';
import type {BrowserAccessMode} from '@shared/browser-access';
import {events} from '@renderer/lib/ipc';
import {browserAccess,type BrowserAccessStore} from './access-store';
import './workspace.css';

/** Background requests never switch the selected task or focus the terminal.
 * When a browser is visible its own scoped surface hosts the same dialog. */
export function BrowserAccessHost(){
  const value=useSyncExternalStore(browserAccess.subscribe,browserAccess.snapshot);
  useEffect(()=>{void browserAccess.refresh();return events.on(browserAccessChangedEvent,()=>{void browserAccess.refresh();});},[]);
  if(value.surface||!value.state.requests.length&&!value.grantsOpen)return null;
  return <div className="bw-access-floating" aria-label="浏览器授权区域"><BrowserAccessPanel/></div>;
}
export function BrowserAccessSurface({ready}:{ready:boolean}){
  useEffect(()=>browserAccess.mountSurface(),[]);
  return ready?<BrowserAccessPanel/>:null;
}
export function BrowserAccessPanel({store=browserAccess}:{store?:BrowserAccessStore}){
  const value=useSyncExternalStore(store.subscribe,store.snapshot),request=value.state.requests[0];
  if(request)return <AccessRequest key={request.id} request={request} store={store} busy={value.busy} error={value.error} remaining={value.state.requests.length-1}/>;
  if(!value.grantsOpen)return null;
  return <div className="bw-scrim" onMouseDown={event=>{if(event.target===event.currentTarget&&!value.busy)store.closeGrants();}}><div role="dialog" aria-modal="false" aria-label="跨任务授权" data-browser-panel="grants" className="bw-dialog" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(!value.busy)store.closeGrants();}}}>
    <div className="bw-dialog-head"><div><h2>跨任务授权</h2><p>本次运行中你已允许的访问</p></div><button className="fw-icon" aria-label="关闭跨任务授权" disabled={value.busy} onClick={store.closeGrants}><X size={16}/></button></div>
    <div className="bw-dialog-body">{value.error&&<p role="alert" className="bw-danger-text">{value.error}</p>}{value.state.grants.length?<ul className="bw-list">{value.state.grants.map(grant=><li key={grant.id}><span><strong>{grant.requesterTitle} → {grant.targetTitle}</strong><small>{grant.projectName} · {grant.mode==='control'?'可以操作':'仅观察'} · 仅本次运行</small></span><button className="bw-mini" disabled={value.busy} onClick={()=>void store.revoke(grant.id)}>撤销</button></li>)}</ul>:<p className="bw-empty-note">本次运行没有授予任何跨任务访问。</p>}</div><div className="bw-dialog-actions"><button disabled={value.busy} onClick={store.closeGrants}>完成</button></div>
  </div></div>;
}
function AccessRequest({request,store,busy,error,remaining}:{request:ReturnType<BrowserAccessStore['snapshot']>['state']['requests'][number];store:BrowserAccessStore;busy:boolean;error:string;remaining:number}){
  const [mode,setMode]=useState<BrowserAccessMode>(request.mode),[now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const seconds=Math.max(0,Math.ceil((request.expiresAt-now)/1000)),decide=(allow:boolean)=>{if(!busy)void store.decide(request.id,allow,mode);};
  return <div className="bw-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)decide(false);}}><div role="dialog" aria-modal="false" aria-label="Agent 请求访问其他任务的网页" data-browser-panel="access-request" className="bw-dialog" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();decide(false);}}}>
    <div className="bw-dialog-head"><div><h2>Agent 请求访问其他任务的网页</h2><p>当前运行：{request.requesterTitle}</p></div><button type="button" className="fw-icon" aria-label="拒绝并关闭" disabled={busy} onClick={()=>decide(false)}><X size={16}/></button></div>
    <div className="bw-dialog-body">{error&&<p className="bw-danger-text" role="alert">{error}</p>}<div className="bw-kv"><span>目标任务</span><strong>{request.targetTitle}</strong><span>所属项目</span><strong>{request.projectName}（与当前任务相同）</strong></div>
      <fieldset className="bw-radios" disabled={busy}><legend>允许的范围</legend><label><input type="radio" name={'cross-mode-'+request.id} checked={mode==='observe'} onChange={()=>setMode('observe')}/>仅观察（快照、截图、读取）</label><label><input type="radio" name={'cross-mode-'+request.id} checked={mode==='control'} onChange={()=>setMode('control')}/>可以操作（点击、输入、导航）</label></fieldset>
      <p className="bw-hint"><ShieldAlert size={13}/>授权只在本次运行内有效，运行结束、终端退出或你撤销后立即失效；跨项目请求一律拒绝。</p><p className="bw-hint" role="status">{seconds} 秒内未处理将自动拒绝。{remaining>0?`另有 ${remaining} 项请求等待处理。`:''}</p>
    </div><div className="bw-dialog-actions"><button type="button" disabled={busy} onClick={()=>decide(false)}>拒绝</button><button type="button" disabled={busy||seconds===0} onClick={()=>decide(true)}>允许本次运行</button></div>
  </div></div>;
}
