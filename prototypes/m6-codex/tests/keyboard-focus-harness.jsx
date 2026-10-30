import React,{StrictMode,useState}from'react';
import{createRoot}from'react-dom/client';
import{FileWorkspace}from'../src/FileWorkspace.jsx';
import{initialWorkspace,workspaceScope,FILES}from'../src/file-workspace-model.mjs';
import{keyboardFiles}from'./keyboard-focus-fixture.mjs';
import'../src/styles.css';
function Fixture({theme,iteration}){
 const[id]=useState(()=>{
  const id='keyboard-'+theme+'-'+iteration,path='/synthetic/'+id,roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots);
  const existing=JSON.parse(localStorage.getItem('willyou-m9-prototype-v1')||'{}');existing[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:keyboardFiles}};localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify(existing));return id;
 });
 return <FileWorkspace task={{id,cwd:'/synthetic/'+id,hostId:'local',status:'running'}} project={{id:'keyboard-P',path:'/synthetic/'+id,name:'Keyboard P',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/>;
}
function Harness(){const[theme,setTheme]=useState('light'),[iteration,setIteration]=useState(0);document.documentElement.dataset.theme=theme;return <><style>{'.keyboard-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:40,display:'flex',gap:12,alignItems:'center'}}>P · 合成文件 · 无本机文件/终端/模型连接<button data-testid="keyboard-reset" onClick={()=>setIteration(x=>x+1)}>重置</button><button data-testid="keyboard-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button></nav><section className="keyboard-harness" style={{position:'fixed',top:40,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><Fixture key={theme+iteration} theme={theme} iteration={iteration}/></section></>;}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
