import React from'react';
import{createRoot}from'react-dom/client';
import{FileWorkspace}from'../src/FileWorkspace.jsx';
import{initialWorkspace,workspaceScope,FILES,fileKey,applyExternalFileChange}from'../src/file-workspace-model.mjs';
import{readingFiles,changedReadingSource}from'./reading-restart-fixture.mjs';
import'../src/styles.css';
const theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light',id='reading-'+theme,path='/synthetic/'+id,roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots),key='willyou-m9-prototype-v1';let data=JSON.parse(localStorage.getItem(key)||'{}');if(!data[scope]){data[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:readingFiles}};localStorage.setItem(key,JSON.stringify(data));}
document.documentElement.dataset.theme=theme;
function Harness(){return <><style>{'.reading-restart-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:40,display:'flex',gap:12}}>P · 完整共享文件区，合成文件，无真实磁盘/终端/模型<button data-testid="reading-change-source" onClick={()=>{const previous=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify(applyExternalFileChange(previous,scope,roots,fileKey('main','A.md'),changedReadingSource)));location.reload();}}>等长替换 A 源文并刷新（合成）</button></nav><section className="reading-restart-harness" style={{position:'fixed',top:40,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><FileWorkspace task={{id,cwd:path,hostId:'local',status:'running'}} project={{id:'reading-P',path,name:'Reading P',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/></section></>}
createRoot(document.getElementById('root')).render(<Harness/>);
