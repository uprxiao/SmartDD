import React from 'react';
import {createRoot} from 'react-dom/client';
import {FileWorkspace} from '../src/FileWorkspace.jsx';
import {initialWorkspace,workspaceScope,FILES} from '../src/file-workspace-model.mjs';
import '../src/styles.css';
const theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light',id='error-recovery-'+theme,path='/synthetic/'+id;
const roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots),key='willyou-m9-prototype-v1';
const data=JSON.parse(localStorage.getItem(key)||'{}');
if(!data[scope]){data[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:[{path:'errors.txt',kind:'code',text:'K11 synthetic original 中文🙂'},{path:'budget.tex',kind:'tex',text:'\\documentclass{article}\\begin{document}Synthetic budget\\end{document}'}]}};localStorage.setItem(key,JSON.stringify(data));}
document.documentElement.dataset.theme=theme;
createRoot(document.getElementById('root')).render(<><header>P · 共享文件区七类错误及恢复；合成数据，不访问磁盘／外部应用／终端</header><section className="error-recovery-harness" style={{position:'fixed',top:30,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><style>{'.error-recovery-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;flex:1!important}'}</style><FileWorkspace task={{id,cwd:path,hostId:'local',status:'running'}} project={{id:'error-recovery-P',path,name:'K11 P',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/></section></>);
