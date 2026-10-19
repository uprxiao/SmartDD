import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileNotebookPreview} from '../src/FileNotebookPreview.jsx';
import {notebookHeaderFixtures} from '../../../scripts/files/notebook-header-fixtures.mjs';
import '../src/styles.css';
import '../src/file-workspace.css';
const fixtures=notebookHeaderFixtures();
function Harness(){
  const [name,setName]=useState(Object.keys(fixtures)[0]);
  const download=()=>{const url=URL.createObjectURL(new Blob([fixtures[name]],{type:'application/x-ipynb+json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><header style={{padding:8}}><strong>隔离原型验收 · 合成数据</strong><select aria-label="Notebook 顶栏验收文件" value={name} onChange={e=>setName(e.target.value)}>{Object.keys(fixtures).map(n=><option key={n}>{n}</option>)}</select></header><main style={{display:'flex',flex:1,minHeight:0}}><FileNotebookPreview key={name} initialValue={fixtures[name]} title={name} onDownload={download}/></main></div>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
