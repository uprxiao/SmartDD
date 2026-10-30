import React,{StrictMode,useState}from'react';
import{createRoot}from'react-dom/client';
import{FileWorkspace}from'../src/FileWorkspace.jsx';
import{initialWorkspace,workspaceScope,FILES}from'../src/file-workspace-model.mjs';
import'../src/styles.css';
import{pdfRuntimeSnapshot}from'../src/file-pdf-engine.mjs';
window.__pdfRenderingPrototype={snapshot:pdfRuntimeSnapshot};
function Fixture({theme,iteration}){
 const[id]=useState(()=>{const id='pdf-rendering-'+theme+'-'+iteration,path='/synthetic/'+id,roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots),state=JSON.parse(localStorage.getItem('willyou-m9-prototype-v1')||'{}');state[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:[['normal.pdf','normal'],['scripts.pdf','dev136-scripts'],['square.pdf','dev136-square'],['tall.pdf','dev136-tall']].map(([path,pdfSource])=>({path,kind:'pdf',pdfSource,text:'P: explicit per-file synthetic PDF fixture; no native file IO'}))}};localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify(state));return id;});
 return <FileWorkspace task={{id,cwd:'/synthetic/'+id,hostId:'local',status:'running'}} project={{id:'pdf-rendering-P',path:'/synthetic/'+id,name:'PDF rendering P',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/>;
}
function Harness(){const[theme,setTheme]=useState('light'),[iteration,setIteration]=useState(0);document.documentElement.dataset.theme=theme;return <><style>{'.pdf-rendering-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:40,display:'flex',gap:12,alignItems:'center'}}>P · 合成PDF来源 · 无本机文件/终端/模型连接<button data-testid="pdf-reset" onClick={()=>setIteration(x=>x+1)}>重置</button><button data-testid="pdf-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button></nav><section className="pdf-rendering-harness" style={{position:'fixed',top:40,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><Fixture key={theme+iteration} theme={theme} iteration={iteration}/></section></>;}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
