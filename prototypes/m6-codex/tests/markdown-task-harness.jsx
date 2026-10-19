import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileMarkdown } from '../src/FileMarkdown.jsx';
import { taskSource, taskLinks } from './markdown-task-fixture.mjs';
import '../src/styles.css';
function Harness() {
 const [text,setText]=useState(taskSource),[readOnly,setReadOnly]=useState(false),[theme,setTheme]=useState('light'),[links,setLinks]=useState([]),[message,setMessage]=useState('');
 document.documentElement.dataset.theme=theme;
 const open=path=>{setLinks(old=>[...old,path]);setMessage(path===taskLinks[2]?'文件不存在：'+path:'已选择合成目标：'+path);};
 return <main style={{height:'100vh',padding:20,boxSizing:'border-box'}}><p>Y07 · P 合成夹具；不读取真实文件，不连接外部服务。</p><nav style={{display:'flex',gap:12}}><button data-testid="task-reset" onClick={()=>{setText(taskSource);setReadOnly(false);setLinks([]);setMessage('');}}>重置</button><button data-testid="task-readonly" onClick={()=>setReadOnly(x=>!x)}>只读</button><button data-testid="task-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button></nav><output data-testid="task-message">{message}</output><pre data-testid="task-state" style={{display:'none'}}>{JSON.stringify({text,readOnly,theme,links})}</pre><section style={{height:'80vh'}}><FileMarkdown text={text} path="source.md" readOnly={readOnly} onEdit={setText} onOpenFile={open} onImageAction={setMessage}/></section></main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
