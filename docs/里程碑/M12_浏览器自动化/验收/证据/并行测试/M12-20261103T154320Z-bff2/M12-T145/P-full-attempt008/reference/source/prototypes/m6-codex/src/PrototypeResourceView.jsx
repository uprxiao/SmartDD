import {useEffect,useRef,useState} from 'react';
import {CircleAlert} from 'lucide-react';

function ResourceEmpty({title,text,action,onAction}){
 return <div className="m10-empty error" role="alert"><CircleAlert size={28}/><h3>{title}</h3><p>{text}</p><button className="m10-button secondary" onClick={onAction}>{action}</button></div>;
}

export function PrototypeHtmlPreview({Empty}){
 const [open,setOpen]=useState(false);
 return <details className="m10-html-preview" onToggle={event=>setOpen(event.currentTarget.open)}><summary>HTML 正文 · 安全文本预览</summary><p className="m10-muted">仅显示文字，不加载远程内容。</p>{open&&<PrototypeResourceView Empty={Empty} text="合成 HTML 正文示例：项目进展与待办。此处仅演示安全文字查看，不读取真实邮件。"/>}</details>;
}

// Fixed synthetic text only. No persistence, network, resources or product calls.
export function PrototypeResourceView({text,Empty=ResourceEmpty}){
 const [chunked,setChunked]=useState(false),[parts,setParts]=useState(1),[reading,setReading]=useState(null),[error,setError]=useState('');
 const [hold,setHold]=useState(false),[nextError,setNextError]=useState(false),pending=useRef(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current=null;};},[]);
 const characters=Array.from(text),split=Math.max(1,Math.floor(characters.length/2)),partial=characters.slice(0,split).join('');
 const visible=chunked&&parts===1?partial:text,hasNext=chunked&&parts===1;
 function read(mode){
  if(reading)return;
  const fail=nextError;setNextError(false);setReading(mode);setError('');
  if(mode==='verify')setParts(0);
  const finish=()=>{
   if(!mounted.current)return;
   setReading(null);
   if(fail)setError('合成资源暂时不可读，请核对后重试。');
   else {setError('');setParts(mode==='append'?2:1);}
  };
  if(hold)pending.current=finish;else finish();
 }
 const retry=()=>read('verify');
 return <div className="m10-prototype-resource">
  {reading==='verify'?<p role="status">正在读取原内容…</p>:error&&parts===0?<Empty kind="error" role="alert" title="内容读取未完成" text={error} action="重试" onAction={retry}/>:<div className="m10-resource-view">
   {error&&!reading&&<Empty kind="error" role="alert" title="内容读取未完成" text={error} action="重试" onAction={retry}/>}<pre>{visible}</pre>
   {hasNext&&<><p className="m10-muted">内容尚未全部显示；已读取 {new TextEncoder().encode(visible).length} / {new TextEncoder().encode(text).length} 字节。</p><button className="m10-button secondary" disabled={!!reading} onClick={()=>read('append')}>继续读取内容</button></>}
  </div>}
  <details className="m10-runtime-demo" data-prototype-resource-demo><summary>内容读取演示 · 仅合成</summary>
   <p className="m10-muted">仅演示固定文字的读取状态，不读取真实内容或保存邮件正文。</p>
   <label><input type="checkbox" aria-label="启用分块内容演示" checked={chunked} disabled={!!reading} onChange={event=>{setChunked(event.target.checked);setParts(1);setError('');}}/>启用分块内容 · 合成</label>
   <label><input type="checkbox" aria-label="暂存内容读取" checked={hold} onChange={event=>setHold(event.target.checked)}/>暂存响应 · 合成</label>
   <label><input type="checkbox" aria-label="下次内容读取失败" checked={nextError} onChange={event=>setNextError(event.target.checked)}/>下次读取失败 · 合成</label>
   <button className="m10-button secondary" disabled={!!reading} onClick={retry}>重新核对内容 · 合成</button>
   <button className="m10-button secondary" disabled={!pending.current} onClick={()=>{const finish=pending.current;pending.current=null;finish?.();}}>交回内容读取 · 合成</button>
  </details>
 </div>;
}
