import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {BrowserJavascriptDialog} from '@shared/browser-javascript-dialog';

export function BrowserJavascriptDialogView({dialog,onRespond}:{dialog:BrowserJavascriptDialog;onRespond:(accept:boolean,text?:string)=>Promise<void>}){
  const [value,setValue]=useState(dialog.defaultValue),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null),confirm=useRef<HTMLButtonElement>(null);
  const title=dialog.kind==='prompt'?'网页输入':dialog.kind==='confirm'?'网页确认':'网页提示';
  let source=dialog.url;try{const url=new URL(source);source=url.origin==='null'?url.href:url.origin;}catch{/* Display plain text without interpreting it. */}
  useEffect(()=>{if(dialog.kind==='prompt'){input.current?.focus();input.current?.select();}else confirm.current?.focus();},[dialog.id,dialog.kind]);
  const respond=async(accept:boolean)=>{if(busy)return;setBusy(true);setError('');try{await onRespond(accept,accept&&dialog.kind==='prompt'?value:undefined);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="bw-scrim"><div role="dialog" aria-modal="true" aria-label={title} data-browser-panel="javascript-dialog" className="bw-dialog" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();if(!busy)void respond(false);}}}>
    <div className="bw-dialog-head"><div><h2>{title}</h2><p>{source}</p></div><button type="button" className="fw-icon" aria-label="关闭网页对话框" disabled={busy} onClick={()=>void respond(false)}><X size={16}/></button></div>
    <form id={'javascript-dialog-'+dialog.id} className="bw-dialog-body bw-form" onSubmit={event=>{event.preventDefault();void respond(true);}}>
      <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflowY:'auto'}}>{dialog.message}</p>
      {dialog.kind==='prompt'&&<label>输入内容<input ref={input} aria-label="网页输入内容" autoComplete="off" disabled={busy} value={value} onChange={event=>setValue(event.target.value)}/></label>}
      {error&&<p role="alert" className="bw-danger-text">{error}</p>}
    </form>
    <div className="bw-dialog-actions">{dialog.kind!=='alert'&&<button type="button" disabled={busy} onClick={()=>void respond(false)}>取消</button>}<button ref={confirm} type="submit" form={'javascript-dialog-'+dialog.id} disabled={busy}>确定</button></div>
  </div></div>;
}
