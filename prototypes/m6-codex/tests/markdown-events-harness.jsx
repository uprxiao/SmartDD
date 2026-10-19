import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileMarkdown } from '../src/FileMarkdown.jsx';
import '../src/styles.css';
function Harness() {
 const [mode,setMode]=useState('first'),[theme,setTheme]=useState('light'),[events,setEvents]=useState([]),[text,setText]=useState('# Prefix\n\nRendered **bold** and [Local](other.txt), [Web](https://example.invalid/m9).\n\nTail selection\n');
 document.documentElement.dataset.theme=theme;
 const record=(kind,value)=>setEvents(old=>[...old,{kind,value}]);
 return <main style={{height:'100vh',padding:24,boxSizing:'border-box'}}><p>Markdown事件生命周期 · P合成夹具；不读取真实文件，不导航或连接外部服务。</p><nav style={{display:'flex',gap:12}}>{['first','other','closed'].map(x=><button data-testid={'events-'+x} key={x} onClick={()=>setMode(x)}>{x}</button>)}<button data-testid="events-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>浅深色</button></nav><output data-testid="events-mode">{mode}</output><pre data-testid="events-log">{JSON.stringify(events)}</pre><section style={{height:'75vh'}}>{mode==='closed'?<p>已关闭</p>:<FileMarkdown key={mode} text={mode==='first'?text:'# Other\n\nOther file\n'} path={mode+'.md'} onEdit={setText} onSelect={(from,to)=>record('selection',{from,to})} onOpenFile={value=>record('local',value)} onImageAction={value=>record('entry',value)} />}</section></main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
