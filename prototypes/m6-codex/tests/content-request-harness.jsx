import React,{StrictMode,useState}from'react';
import{createRoot}from'react-dom/client';
import{FileWorkspace}from'../src/FileWorkspace.jsx';
import{initialWorkspace,workspaceScope,FILES}from'../src/file-workspace-model.mjs';
import{requestSource}from'./content-request-fixture.mjs';
import'../src/styles.css';
const files=Object.entries(requestSource).map(([path,text])=>({path,text,kind:'code'}));
function Fixture({theme}){const[id]=useState(()=>{const id='content-request-'+theme,path='/synthetic/'+id,roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots),data=JSON.parse(localStorage.getItem('willyou-m9-prototype-v1')||'{}');data[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:files}};localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify(data));return id;});return <FileWorkspace task={{id,cwd:'/synthetic/'+id,hostId:'local',status:'running'}} project={{id:'content-request-P',path:'/synthetic/'+id,name:'Content request P',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/>;}
function Harness(){const[theme,setTheme]=useState('light');document.documentElement.dataset.theme=theme;return <><style>{'.content-request-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:40,display:'flex',gap:12}}>P · 合成正文/掩码/优先目录，无真实磁盘、模型或终端连接<button data-testid="request-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button></nav><section className="content-request-harness" style={{position:'fixed',top:40,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><Fixture key={theme} theme={theme}/></section></>;}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
