import React,{StrictMode,useState}from'react';
import{createRoot}from'react-dom/client';
import{FileMarkdown}from'../src/FileMarkdown.jsx';
import{diagramCases,diagramDocument}from'./markdown-diagram-fixture.mjs';
import'../src/styles.css';
function Harness(){
 const[mode,setMode]=useState(null),[theme,setTheme]=useState('light');document.documentElement.dataset.theme=theme;
 return <main style={{padding:20,height:'100vh',boxSizing:'border-box'}}><p>Y08 · 合成P场景，真实Mermaid引擎；不访问磁盘或外部链接。</p><nav style={{display:'flex',gap:8}}>{diagramCases.map(x=><button key={x.name} data-testid={'diagram-'+x.name} onClick={()=>setMode(x.name)}>{x.name}</button>)}<button data-testid="diagram-other" onClick={()=>setMode('other')}>切文件</button><button data-testid="diagram-close" onClick={()=>setMode(null)}>关闭</button><button data-testid="diagram-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button></nav><output data-testid="diagram-mode">{mode||'closed'}</output><section style={{height:'80vh'}}>{mode&&<FileMarkdown key={mode} path={mode+'.md'} text={mode==='other'?'# Other document\n\nOther source preserved\n':diagramDocument(diagramCases.find(x=>x.name===mode).source)} readOnly onEdit={()=>{}} onOpenFile={()=>{throw Error('Diagram must not navigate');}}/>}</section></main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
