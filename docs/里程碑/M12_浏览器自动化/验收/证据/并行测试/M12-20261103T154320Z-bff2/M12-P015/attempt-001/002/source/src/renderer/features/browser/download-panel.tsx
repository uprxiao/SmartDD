import {useEffect,useState} from 'react';
import {Download,FolderOpen,FileDown,Ban,X} from 'lucide-react';
import type {BrowserDownload} from '@shared/browser-downloads';
export type DownloadAction='cancel'|'open'|'reveal'|'remove';
/** B07 is an overlay. Its timer uses the last actual item change, so hovering
 * suspends dismissal without extending an old event's timestamp. */
export function BrowserDownloadPanel({items,onAction,onClose}:{items:BrowserDownload[];onAction:(id:string,action:DownloadAction)=>Promise<void>;onClose:()=>void}){
  const [hover,setHover]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),changedAt=Math.max(0,...items.map(item=>item.updatedAt));
  useEffect(()=>{if(hover)return;const timer=setTimeout(onClose,Math.max(0,changedAt+6000-Date.now()));return()=>clearTimeout(timer);},[hover,changedAt,onClose]);
  const action=async(id:string,kind:DownloadAction)=>{setBusy(id);setError('');try{await onAction(id,kind);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(null);}};
  return <div className="bw-downloads" role="region" aria-label="下载" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <div className="bw-downloads-head"><strong>下载</strong><span>系统下载目录</span><button type="button" className="fw-icon bw-mini-icon" aria-label="收起下载列表" onClick={onClose}><X size={14}/></button></div>
    {error&&<p role="alert" className="bw-danger-text">{error}</p>}
    {items.map(item=><div key={item.id} className={'bw-download bw-download-'+item.state}><FileDown size={15}/><div className="bw-download-text"><strong title={item.name}>{item.name}</strong><span>{item.state==='progress'?`正在下载 · ${item.totalBytes?Math.min(100,Math.round(item.receivedBytes/item.totalBytes*100))+'%':item.receivedBytes+' 字节'}`:item.state==='done'?'已保存到系统下载目录':item.state==='failed'?'下载失败：'+(item.error??'连接被中断'):'已取消'}</span>{item.state==='progress'&&<span className="bw-download-meter"><span style={{width:(item.totalBytes?Math.min(100,item.receivedBytes/item.totalBytes*100):0)+'%'}}/></span>}</div>
      {item.state==='progress'&&<button type="button" className="bw-mini" disabled={busy===item.id} onClick={()=>void action(item.id,'cancel')}><Ban size={13}/>取消</button>}
      {item.state==='done'&&<><button type="button" className="bw-mini" disabled={busy===item.id} onClick={()=>void action(item.id,'open')}><Download size={13}/>打开</button><button type="button" className="bw-mini" disabled={busy===item.id} onClick={()=>void action(item.id,'reveal')}><FolderOpen size={13}/>在文件夹中显示</button></>}
      {item.state!=='progress'&&<button type="button" className="fw-icon bw-mini-icon" disabled={busy===item.id} aria-label={'移除下载记录 '+item.name} onClick={()=>void action(item.id,'remove')}><X size={14}/></button>}
    </div>)}
  </div>;
}
