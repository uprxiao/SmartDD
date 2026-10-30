import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileWorkspace} from '../src/FileWorkspace.jsx';
import {initialWorkspace,workspaceScope,FILES} from '../src/file-workspace-model.mjs';
import '../src/styles.css';
const files=[{path:'route.md',kind:'markdown',text:'# Heading\n\n中文🙂 NEEDLE_P_NAV suffix\n'},{path:'route.html',kind:'html',text:'<h1>Title</h1>\n<p>中文🙂 NEEDLE_P_HTML suffix</p>\n'}];
function Fixture({theme}){
 const[id]=useState(()=>{
  const id='viewer-navigation-'+theme,path='/synthetic/'+id,roots=[{id:'main',hostId:'local',path},{id:'extra',hostId:'local',path:'/workspace/shared-docs'}],state={...initialWorkspace(),tabs:[],active:null,expanded:[],rootStates:{main:{expanded:[],query:'',selected:[],focused:'',scrollTop:0}},removedPaths:{main:FILES.filter(x=>!files.some(f=>f.path===x.path)).map(x=>x.path)},syntheticFiles:{main:files}};
  localStorage.setItem('willyou-m9-prototype-v1',JSON.stringify({[workspaceScope(id,roots)]:state}));
  localStorage.setItem('willyou-m9-viewer-prototype-v1',JSON.stringify({adapters:[{id:'p-local',name:'P 合成只读资源',enabled:true,suffixes:['.md','.html'],sources:['project-directory'],provider:{kind:'local-resource',writable:false}}],preferred:{'.md':'p-local','.html':'p-local'}}));
  return id;
 });
 return <FileWorkspace task={{id,cwd:'/synthetic/'+id,hostId:'local',status:'completed'}} project={{id:'P-navigation',name:'P 合成查看器定位',path:'/synthetic/'+id,hostId:'local'}} dark={theme==='dark'} onTheme={()=>{}} onClose={()=>{}}/>;
}
function Harness(){const[theme,setTheme]=useState('light');document.documentElement.dataset.theme=theme;return <><style>{'.navigation-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{height:40}}>P · 合成数据，无真实服务/文件写入<button data-testid="navigation-theme" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>主题</button></nav><section className="navigation-harness" style={{position:'fixed',top:40,left:0,right:0,bottom:0,display:'flex'}}><Fixture key={theme} theme={theme}/></section></>;}
createRoot(document.getElementById('root')).render(<Harness/>);
