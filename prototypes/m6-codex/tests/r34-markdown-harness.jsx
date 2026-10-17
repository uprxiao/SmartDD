import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileMarkdown } from '../src/FileMarkdown.jsx';
import '../src/styles.css';
import '../src/file-workspace.css';
window.r34Markdown = { edits: [], selections: [], events: [], instance: 0 };
function Harness() {
  const [config, setConfig] = useState({ text: '', visible: true, readOnly: false, instance: 0 });
  const api = window.r34Markdown;
  api.show = value => { api.edits=[]; api.selections=[]; api.events=[]; api.instance++; setConfig({ text:'', visible:true, readOnly:false, ...value, instance:api.instance }); };
  api.update = value => setConfig(current=>({...current,...value}));
  api.state = config;
  return <main className="file-workspace" style={{width:960,margin:'24px auto',height:'auto',minHeight:800,display:'block',overflow:'visible'}}>
    <header style={{padding:12,display:'flex',gap:12,borderBottom:'1px solid var(--border)'}}><strong>R3.4 Markdown 合成验证</strong><button onClick={()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'}>切换测试主题</button><button onClick={()=>setConfig(current=>({...current,readOnly:!current.readOnly}))}>切换测试只读</button><button onClick={()=>setConfig(current=>({...current,visible:!current.visible}))}>挂载／卸载文档</button></header>
    {config.visible&&<FileMarkdown key={config.instance} text={config.text} path="docs/合成测试.md" readOnly={config.readOnly} findQuery={config.findQuery||''}
      onEdit={text=>{api.edits.push(text);setConfig(current=>({...current,text}));}}
      onSelect={(from,to)=>api.selections.push({from,to})}
      onOpenFile={value=>api.events.push({kind:'open',value})} onImageReference={value=>api.events.push({kind:'image',value})} onImageAction={value=>api.events.push({kind:'action',value})}
      onComposition={value=>api.events.push({kind:'composition',value})}/>} 
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);
