import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{FileConflictSource}from'../src/FileConflictSource.jsx';
import{inlineDiffFixtures,verifyInlineDiffFixture}from'../../../scripts/files/inline-diff-fixtures.mjs';
import'../src/styles.css';
import'../src/file-workspace.css';import'../src/file-code-theme.css';
for(const fixture of inlineDiffFixtures)verifyInlineDiffFixture(fixture);
function Harness(){const[scene,setScene]=useState(inlineDiffFixtures[0]),[text,setText]=useState(scene.local),[dark,setDark]=useState(false);return <main className="file-workspace" style={{position:'fixed',inset:0,width:'100%',height:'100%',margin:0,minWidth:0,flex:'none',borderRadius:0,display:'flex',flexDirection:'column',background:'var(--bg)',color:'var(--text)',fontFamily:'system-ui'}} data-theme={dark?'dark':'light'}>
 <header style={{flexShrink:0,padding:12,borderBottom:'1px solid var(--border)'}}><strong>原型 P · 合成差异边界数据 · 未连接真实文件</strong><button data-testid="diff-theme" onClick={()=>{setDark(!dark);document.documentElement.dataset.theme=!dark?'dark':'light';}}>切换主题</button><div style={{display:'flex',gap:8,marginTop:8}}>{inlineDiffFixtures.map(f=><button key={f.id} onClick={()=>{setScene(f);setText(f.local);}}>{f.id}</button>)}</div></header>
 <FileConflictSource key={scene.id} text={text} diskText={scene.disk} filename="fixture.txt" onEdit={setText}/>
 <output hidden data-testid="diff-fixture-log">{JSON.stringify({id:scene.id,text,disk:scene.disk,dark})}</output>
 </main>;}createRoot(document.getElementById('root')).render(<Harness/>);
