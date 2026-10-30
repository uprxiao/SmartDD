import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileNotebookPreview} from '../src/FileNotebookPreview.jsx';
import {notebookDetailFixtures} from '../../../scripts/files/notebook-detail-fixtures.mjs';
import '../src/styles.css';
import '../src/file-workspace.css';
const generated=notebookDetailFixtures();
function Harness(){
 const [name,setName]=useState(Object.keys(generated.fixtures)[0]);
 const expected=name==='copy-code.ipynb'?generated.longCode:name==='copy-raw.ipynb'?generated.longRaw:'';
 return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><header style={{padding:8}}><strong>隔离原型验收 · 合成数据</strong><select aria-label="Notebook 验收文件" value={name} onChange={e=>setName(e.target.value)}>{Object.keys(generated.fixtures).map(n=><option key={n}>{n}</option>)}</select></header><main style={{display:'flex',flex:1,minHeight:0}}><FileNotebookPreview key={name} initialValue={generated.fixtures[name]} title={name}/></main><textarea readOnly hidden aria-label="预期复制文本" value={expected}/></div>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
