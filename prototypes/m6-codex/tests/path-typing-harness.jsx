import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileWorkspace} from '../src/FileWorkspace.jsx';
import {TerminalPreview,terminalPreviewSnapshot} from '../src/App.jsx';
import {FILES,initialWorkspace,workspaceScope} from '../src/file-workspace-model.mjs';
import '../src/styles.css';
const root='/synthetic/path-typing',names=['ordinary.txt','中文 空格🙂\'"();`$().txt'];
function Harness(){
 const [theme,setTheme]=useState('light'),voiceTarget=useRef(null),[id]=useState(()=>{
  const id='path-typing-'+crypto.randomUUID(),roots=[{id:'main',hostId:'local',path:root},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],all=JSON.parse(localStorage.getItem('willyou-m9-prototype-v1')||'{}');
  all[workspaceScope(id,roots)]={...initialWorkspace(),tabs:[],active:null,expanded:[],removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:names.map(path=>({path,kind:'code',text:'P synthetic source '+path}))}};localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify(all));return id;
 });
 useEffect(()=>{window.__pathTypingP=Object.freeze({id,root,snapshot:()=>terminalPreviewSnapshot(id)});return()=>{delete window.__pathTypingP;};},[id]);
 document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('ydark',theme==='dark');
 const task={id,cwd:root,hostId:'local',status:'running',title:'P synthetic keyboard only'},project={id:'P-path-typing',path:root,name:'P synthetic root',hostId:'local'};
 return <><style>{'.path-typing-harness{position:fixed;inset:48px 8px 8px;display:flex}.path-typing-harness>.file-workspace{position:relative!important;inset:auto!important;width:50%!important;max-width:none!important;height:100%!important;margin:0!important;flex:none!important}'}</style><nav>P · 原共享文件与终端 · 合成数据，无本机IO/PTY/模型 <button data-testid="typing-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button></nav><section className="path-typing-harness"><div style={{position:'relative',flex:1,minWidth:0}}><TerminalPreview task={task} project={project} dark={theme==='dark'} fontSize={13} voiceTarget={voiceTarget}/></div><FileWorkspace task={task} project={project} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/></section></>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
