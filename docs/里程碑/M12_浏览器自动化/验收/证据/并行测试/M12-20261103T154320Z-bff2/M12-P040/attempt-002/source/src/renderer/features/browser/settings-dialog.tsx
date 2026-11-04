import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {rpc} from '@renderer/lib/ipc';
import {SEARCH_ENGINES,type BrowserSearchEngine} from '@shared/browser-navigation';
import type {BrowserSettingsState} from '@shared/browser-settings';
export interface BrowserPreferences extends BrowserSettingsState{downloadDirectory:string;artifactBytes:number}
export function BrowserSettingsDialog({taskId,initial,onClose}:{taskId:string;initial:BrowserPreferences;onClose:()=>void}){
  const [settings,setSettings]=useState(initial),[confirmClean,setConfirmClean]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{root.current?.querySelector<HTMLInputElement>('input')?.focus();},[]);
  const change=async(work:()=>Promise<BrowserPreferences>)=>{setBusy(true);setError('');try{setSettings(await work());}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="bw-scrim" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <div ref={root} role="dialog" aria-modal="true" aria-label="浏览器设置" data-browser-panel="settings" className="bw-dialog" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(!busy)onClose();}}}>
      <div className="bw-dialog-head"><h2>浏览器设置</h2><button type="button" className="fw-icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={16}/></button></div>
      <div className="bw-dialog-body">
        {error&&<p role="alert" className="bw-danger-text">{error}</p>}
        <fieldset className="bw-radios" disabled={busy}><legend>默认搜索引擎（地址栏输入非网址时使用）</legend>
          {Object.entries(SEARCH_ENGINES).map(([id,item])=><label key={id}><input type="radio" name="browser-engine" checked={settings.searchEngine===id} onChange={()=>void change(()=>rpc.browser.settings({taskId,searchEngine:id as BrowserSearchEngine}))}/>{item.label}</label>)}
        </fieldset>
        <fieldset className="bw-radios" disabled={busy}><legend>浏览器身份（整个应用生效，重启后生效）</legend>
          <label><input type="radio" name="browser-identity" checked={(settings.pendingIdentity??settings.identity)==='clean'} onChange={()=>void change(()=>rpc.browser.settings({taskId,identity:'clean'}))}/>清理后的身份（兼容导入的登录态）</label>
          <label><input type="radio" name="browser-identity" checked={(settings.pendingIdentity??settings.identity)==='native'} onChange={()=>void change(()=>rpc.browser.settings({taskId,identity:'native'}))}/>Electron 原生身份（部分站点需要；Google 登录不可用）</label>
          {settings.pendingIdentity&&<p className="bw-hint bw-restart" role="status">已更改，重启 WillYou 后生效。</p>}
        </fieldset>
        <div className="bw-kv"><span>下载位置</span><strong title={settings.downloadDirectory}>系统下载目录（{settings.downloadDirectory}），不弹保存对话框</strong></div>
        <div className="bw-kv"><span>浏览器文件</span><strong aria-label="浏览器文件占用">{settings.artifactBytes?(settings.artifactBytes/1048576).toFixed(1)+' MB（截图、PDF、HAR 与超限结果）':'0 MB'}</strong></div>
        <div className="bw-row-actions">{confirmClean?<><span className="bw-danger-text">将删除所有任务的浏览器截图、PDF、HAR 与超限结果文件；系统“下载”目录不受影响。</span><button type="button" className="bw-mini bw-mini-danger" disabled={busy} onClick={()=>void change(async()=>{const value=await rpc.browser.clearArtifacts({taskId,confirmed:true});setConfirmClean(false);return value;})}>确认清理</button><button type="button" className="bw-mini" disabled={busy} onClick={()=>setConfirmClean(false)}>取消</button></>:<button type="button" className="bw-mini" disabled={busy||!settings.artifactBytes} onClick={()=>setConfirmClean(true)}>清理全部浏览器文件</button>}</div>
      </div><div className="bw-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>完成</button></div>
    </div>
  </div>;
}
