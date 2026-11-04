import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JavascriptDialog} from '/private/tmp/willyou-m12-p070-dialog-software-008/source/prototypes/m6-codex/src/BrowserPanels.jsx';
const longMessage=('这是合成的长网页消息，用于检查换行、滚动、长单词以及窄浏览器区域；不连接真实网页。\n').repeat(55)+'https://example.test/'+('unbroken-token-').repeat(120);
function Fixture(){
 const [theme,setTheme]=useState('light'),[narrow,setNarrow]=useState(false),[sequence,setSequence]=useState(1),[dialog,setDialog]=useState({id:'fixture-1',kind:'prompt',message:longMessage,defaultValue:'组件合成默认值',origin:'https://example.test'}),[mode,setMode]=useState('success'),[result,setResult]=useState(null),release=useRef(null);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 const open=()=>{const id='fixture-'+(sequence+1);setSequence(sequence+1);setResult(null);setDialog({id,kind:'prompt',message:longMessage,defaultValue:'组件合成默认值',origin:'https://example.test'});};
 const respond=async(accept,value)=>{if(mode==='hold'&&accept)await new Promise(resolve=>{release.current=resolve;});if(mode==='error'&&accept)throw Error('组件合成：响应失败，输入必须保留。');setResult({accept,value:value===undefined?null:value});setDialog(null);};
 return <div style={{width:'100vw',height:'100vh',overflow:'hidden',background:'var(--bg)',color:'var(--text)',fontFamily:'var(--sans)'}}>
  <header style={{height:56,display:'flex',alignItems:'center',gap:8,padding:'0 12px',fontSize:12}}><strong>[P组件] 冻结真实JavascriptDialog；非完整原型或App</strong><button type="button" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>组件切换主题</button><button type="button" onClick={()=>setNarrow(v=>!v)}>组件切换尺寸</button><button type="button" onClick={open}>组件重新打开</button><button type="button" onClick={()=>setMode('error')}>组件响应失败</button><button type="button" onClick={()=>setMode('hold')}>组件保持响应</button><button type="button" onClick={()=>{release.current?.();release.current=null;}}>组件完成响应</button></header>
  <section data-private-component-pane className="bw-root" style={{position:'relative',margin:'0 auto',width:narrow?320:720,maxWidth:'calc(100vw - 24px)',height:narrow?360:600,maxHeight:'calc(100vh - 72px)',border:'1px solid var(--border)',background:'var(--surface)'}}>
   <p style={{padding:12,fontSize:12}}>只在本私有夹具合成长message；来源为组件固定的 https://example.test。主dist入口另测。</p>
   {dialog&&<JavascriptDialog key={dialog.id} dialog={dialog} onRespond={respond}/>}
  </section><output data-component-result style={{display:'block',padding:12,fontSize:12}}>{result?JSON.stringify(result):'未响应'}</output><span data-component-mode>{mode}</span>
 </div>;
}
createRoot(document.getElementById('component-root')).render(<Fixture/>);
