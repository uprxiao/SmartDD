import {useState} from 'react';
import {MapPin} from 'lucide-react';
import type {BrowserPermissionPrompt} from '@shared/browser-site-state';
const labels:Record<string,string>={geolocation:'你的位置','media:video':'摄像头','media:audio':'麦克风',media:'摄像头或麦克风',notifications:'发送通知',fullscreen:'全屏显示','clipboard-read':'读取剪贴板','clipboard-sanitized-write':'写入剪贴板','display-capture':'共享屏幕',pointerLock:'锁定指针'};
export function BrowserPermissionBar({prompt,onResolve}:{prompt:BrowserPermissionPrompt;onResolve:(allow:boolean)=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const resolve=async(allow:boolean)=>{setBusy(true);setError('');try{await onResolve(allow);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="bw-prompt" role="alertdialog" aria-label="站点权限请求"><MapPin size={15}/><span><strong>{prompt.origin}</strong> 想要使用{prompt.permissions.map(name=>labels[name]??name).join('、')}。你的选择会记在当前登录态中，可在登录态管理里撤销；Agent 无法代你允许。{error&&<span role="alert" className="bw-danger-text">{error}</span>}</span><button type="button" className="bw-mini" disabled={busy} onClick={()=>void resolve(false)}>拒绝</button><button type="button" className="bw-mini bw-mini-primary" disabled={busy} onClick={()=>void resolve(true)}>允许</button></div>;
}
