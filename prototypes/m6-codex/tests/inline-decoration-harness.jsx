import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileMarkdown } from '../src/FileMarkdown.jsx';
import { inlineFixture } from './inline-decoration-fixture.mjs';
import '../src/styles.css';
import '../src/file-workspace.css';
function Harness() {
  const [text,setText]=useState(inlineFixture),[version,setVersion]=useState(0),[theme,setTheme]=useState('light'),[selection,setSelection]=useState(null),[links,setLinks]=useState([]);
  document.documentElement.dataset.theme=theme;
  return <main style={{padding:20,height:'100vh'}}><p>节点装饰 · P合成夹具、真实共享CM；无文件权限或外部连接。</p><nav><button data-testid="inline-reset" onClick={()=>{setText(inlineFixture);setVersion(value=>value+1);}}>重置</button><button data-testid="inline-theme" onClick={()=>setTheme(value=>value==='light'?'dark':'light')}>浅深色</button><button data-testid="inline-blur">失焦</button></nav><output data-testid="inline-log" style={{display:'block',maxHeight:80,overflow:'auto',fontSize:10}}>{JSON.stringify({text,selection,links})}</output><section style={{height:650,overflow:'auto'}}><FileMarkdown key={version} text={text} path="inline.md" onEdit={setText} onSelect={(from,to)=>setSelection({from,to})} onOpenFile={path=>setLinks(old=>[...old,path])} onImageAction={message=>setLinks(old=>[...old,message])}/></section></main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
