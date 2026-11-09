import {useEffect,useRef,useState} from 'react';
import {KeyRound,X} from 'lucide-react';
import type {BrowserAuthPrompt} from '@shared/browser-auth';
export function BrowserAuthDialog({prompt,onRespond}:{prompt:BrowserAuthPrompt;onRespond:(credentials:{user:string;pass:string}|null)=>Promise<void>}){
  const [user,setUser]=useState(''),[pass,setPass]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{input.current?.focus();},[]);
  const respond=async(credentials:{user:string;pass:string}|null)=>{setBusy(true);setError('');try{await onRespond(credentials);setUser('');setPass('');}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="bw-scrim" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)void respond(null);}}><div role="dialog" aria-modal="true" aria-label="需要登录" data-browser-panel="authentication" className="bw-dialog" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(!busy)void respond(null);}}}>
    <div className="bw-dialog-head"><div><h2>需要登录</h2><p>{prompt.host} 要求输入用户名和密码（{prompt.proxy?'代理认证':'HTTP 基本认证'}）</p></div><button type="button" className="fw-icon" aria-label="关闭" disabled={busy} onClick={()=>void respond(null)}><X size={16}/></button></div>
    <div className="bw-dialog-body">{error&&<p className="bw-danger-text" role="alert">{error}</p>}<form id={'auth-'+prompt.id} className="bw-form" onSubmit={event=>{event.preventDefault();void respond({user,pass});}}>
      <label>用户名<input ref={input} aria-label="基本认证用户名" autoComplete="off" disabled={busy} value={user} onChange={event=>setUser(event.target.value)}/></label><label>密码<input aria-label="基本认证密码" type="password" autoComplete="off" disabled={busy} value={pass} onChange={event=>setPass(event.target.value)}/></label><p className="bw-hint"><KeyRound size={13}/>应用不保存站点密码。</p>
    </form></div><div className="bw-dialog-actions"><button type="button" disabled={busy} onClick={()=>void respond(null)}>取消</button><button type="submit" form={'auth-'+prompt.id} disabled={busy}>登录</button></div>
  </div></div>;
}
