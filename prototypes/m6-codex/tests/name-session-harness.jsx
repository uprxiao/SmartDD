import React, {useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileWorkspaceTree} from '../src/FileWorkspaceTree.jsx';
import {createFixtureFileProvider} from '../src/file-interaction-model.mjs';
import '../src/styles.css';
import '../src/file-workspace.css';
document.documentElement.classList.toggle('ydark', new URLSearchParams(location.search).get('theme') === 'dark');
function Harness() {
 const [scope,setScope]=useState('A'),[query,setQuery]=useState(''),[sessions,setSessions]=useState([]),[selected,setSelected]=useState([]),[focused,setFocused]=useState(''),[expanded,setExpanded]=useState([]);
 const scrollRef=useRef(null),apiRef=useRef(null),counter=useRef(0);
 const files=useMemo(()=>Array.from({length:8},(_,i)=>({path:`needle-${scope}-${i}.txt`,kind:'code',text:'Synthetic only'})),[scope]);
 const provider=useMemo(()=>{
  const original=createFixtureFileProvider(files,{delay:0});
  return {...original,async names(q,{onUpdate}) {
   // Deliberately retain original callbacks across cancellation, to model late
   // delivery. Every snapshot is produced by the unchanged fixture provider.
   const snapshots=[],result=await original.names(q,{onUpdate:value=>snapshots.push(value)}),id=counter.current++;
   return new Promise(resolve=>setSessions(old=>[...old,{id,scope,q,frames:[...snapshots.map(value=>({kind:'updated',value,deliver:()=>onUpdate(value)})),{kind:'completed',value:result,deliver:()=>resolve(result)}]}]));
  }};
 },[files,scope]);
 function release(session,index){const frame=session.frames[index];frame.deliver();const before=JSON.stringify(frame.value);setSessions(old=>old.map(row=>row.id===session.id?{...row,frames:row.frames.map((x,i)=>i===index?{...x,delivered:true,before,after:JSON.stringify(x.value)}:x)}:row));}
 return <main className="file-workspace" style={{height:760,width:1100,margin:16,display:'flex',gap:24}}>
  <section style={{width:340,height:700,display:'flex',flexDirection:'column'}}><h1>C09 合成搜索会话</h1><p>原型组件；不读取磁盘。按钮只延迟／释放原始回调。</p>
   <label>筛选文件<input aria-label="筛选文件" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div>{['A','B'].map(value=><button key={value} data-scope={value} aria-pressed={scope===value} onClick={()=>{setScope(value);setQuery('');setSelected([]);setFocused('');setExpanded([]);}}>{value} 合成目录</button>)}</div>
   <FileWorkspaceTree files={files} fixtureProvider={provider} scope={scope} rootPath={'/synthetic/'+scope} query={query} searchScenario="ready" expanded={expanded} selected={selected} focused={focused} activePath="" scrollRef={scrollRef} apiRef={apiRef} onScrollPosition={()=>{}} onExpandedChange={setExpanded} onSelectedChange={setSelected} onFocusedChange={setFocused} onOpen={()=>{}} onMenu={()=>{}} onDrag={e=>e.preventDefault()} onDragEnd={()=>{}} changedOnly={false} hideGenerated={false} large={false} renderIcon={()=>null}/>
  </section>
  <section style={{width:650,overflow:'auto'}} aria-label="合成会话释放控制">{sessions.map(row=><div key={row.id} data-session={row.id} data-source={row.scope} data-query={row.q}>{row.scope} / {row.id}{row.frames.map((frame,i)=><button key={i} data-frame={i} data-delivered={String(!!frame.delivered)} onClick={()=>release(row,i)}>{frame.kind} {frame.value.length}</button>)}</div>)}
   <pre aria-label="只读会话记录">{JSON.stringify(sessions.map(({id,scope,q,frames})=>({id,scope,q,frames:frames.map(({kind,value,delivered,before,after})=>({kind,paths:value.map(x=>x.path),delivered,before,after}))})))}</pre>
  </section>
 </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
