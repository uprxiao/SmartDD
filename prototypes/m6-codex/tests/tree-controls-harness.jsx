import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspace } from '../src/FileWorkspace.jsx';
import { initialWorkspace, workspaceScope, FILES } from '../src/file-workspace-model.mjs';
import { keyboardFiles } from './keyboard-focus-fixture.mjs';
import '../src/styles.css';
function Fixture({ theme, visible, onClose }) {
  const [id] = useState(() => {
    const id='tree-controls-'+crypto.randomUUID(),path='/synthetic/'+id;
    const roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots),all=JSON.parse(localStorage.getItem('willyou-m9-prototype-v1')||'{}');
    all[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:keyboardFiles}};localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify(all));return id;
  });
  return visible&&<FileWorkspace task={{id,cwd:'/synthetic/'+id,hostId:'local',status:'running'}} project={{id:'tree-controls-P',path:'/synthetic/'+id,name:'Tree controls P',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={onClose}/>;
}
function Harness(){const[theme,setTheme]=useState('light'),[visible,setVisible]=useState(true);document.documentElement.dataset.theme=theme;return <><style>{'.tree-controls-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:40,display:'flex',gap:12,alignItems:'center'}}>P · 合成文件树 · 无本机文件/终端/模型连接<button data-testid="tree-controls-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button><button data-testid="tree-controls-workspace-toggle" onClick={()=>setVisible(x=>!x)}>工作区夹具开关</button></nav><section className="tree-controls-harness" style={{position:'fixed',top:40,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><Fixture theme={theme} visible={visible} onClose={()=>setVisible(false)}/></section></>;}
createRoot(document.getElementById('root')).render(<Harness/>);
