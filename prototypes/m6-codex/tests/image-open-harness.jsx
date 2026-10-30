import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspace } from '../src/FileWorkspace.jsx';
import { initialWorkspace, workspaceScope, FILES } from '../src/file-workspace-model.mjs';
import corpus from './markdown-images-fixtures.json';
import '../src/styles.css';
const picture=corpus.find(x=>x.name==='wide.png');
function Fixture({theme,mode}) {
  const [id]=useState(()=>{
    const id='v02-image-open-'+theme,path='/synthetic/'+id,roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],scope=workspaceScope(id,roots),store=JSON.parse(localStorage.getItem('willyou-m9-prototype-v1')||'{}');
    store[scope]={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.map(x=>x.path)},syntheticFiles:{main:[{path:'images.md',kind:'markdown',text:'# V02 original image\n\n![Original image](picture.png)\n'},{path:'picture.png',kind:'image',text:picture.dataUrl}]}};
    localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify(store));return id;
  });
  return <FileWorkspace imageMenuScope="document" imageContext resolveImageOpen={async path=>{if(mode==='empty')return null;if(mode==='error')throw Error('V02 synthetic asset resolver error');return path;}} task={{id,cwd:'/synthetic/'+id,hostId:'local',status:'running'}} project={{id:'v02-image-open-P',path:'/synthetic/'+id,name:'V02 synthetic image new tab',hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/>;
}
function Harness(){
  const [theme,setTheme]=useState('light'),[mode,setMode]=useState('normal');document.documentElement.dataset.theme=theme;
  return <><style>{'.v02-image-open-host>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:42,display:'flex',alignItems:'center',gap:12}}>P · 合成图片区域，无真实文件/任务/解析服务<button data-testid="image-open-theme" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>主题</button>{['normal','empty','error'].map(value=><button key={value} data-testid={'image-resolver-'+value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{value}（合成解析器）</button>)}</nav><section className="v02-image-open-host" style={{position:'fixed',top:42,left:0,bottom:0,width:'min(1200px,100vw)',display:'flex'}}><Fixture key={theme} theme={theme} mode={mode}/></section></>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
