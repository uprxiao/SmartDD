import React, {useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileWorkspaceTree} from '../src/FileWorkspaceTree.jsx';
import {createFixtureFileProvider} from '../src/file-interaction-model.mjs';
import '../src/styles.css';
const files=[{path:'A.txt',text:'A'},{path:'B.txt',text:'B'}];
function Harness(){
  const [theme,setTheme]=useState('light'),[expanded,setExpanded]=useState([]),[selected,setSelected]=useState([]),[focused,setFocused]=useState(''),[revision,setRevision]=useState(0),[events,setEvents]=useState([]);
  const api=useRef(null),scroll=useRef(null),control=useRef({hold:false,fail:false,pending:[]});
  const log=value=>setEvents(old=>[...old,value]);
  const provider=useMemo(()=>{
    const base=createFixtureFileProvider(revision?[...files,{path:'Z.txt',text:'Z'}]:files,{delay:0});
    return {...base,list:async(path,{signal}={})=>{
      const result=await base.list(path,{signal}),state=control.current;log('list:'+revision+':'+path);
      if(state.hold)await new Promise((resolve,reject)=>{
        const abort=()=>{log('aborted:'+revision+':'+path);reject(new DOMException('Cancelled','AbortError'));};
        signal?.addEventListener('abort',abort,{once:true});
        state.pending.push(()=>{signal?.removeEventListener('abort',abort);resolve();});
        log('held:'+revision+':'+path);
      });
      if(state.fail){state.fail=false;throw new Error('P synthetic directory failure');}return result;
    }};
  },[revision]);
  document.documentElement.dataset.theme=theme;
  function refresh(hold,fail=false){control.current.hold=hold;control.current.fail=fail;api.current.refresh();}
  function release(){control.current.hold=false;for(const done of control.current.pending.splice(0))done();log('released');}
  return <><p>P · 共享文件树局部夹具 · 合成列表/故障/门闩，无本机文件、终端或模型连接</p><nav>
    <button data-testid="theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题</button>
    <button data-testid="refresh-held" onClick={()=>refresh(true)}>挂起合成刷新</button>
    <button data-testid="refresh-error" onClick={()=>refresh(false,true)}>合成读取失败</button>
    <button data-testid="release" onClick={release}>释放合成响应</button>
    <button data-testid="provider-change" onClick={()=>{control.current.hold=true;setRevision(x=>x?0:1);}}>替换合成列表</button>
  </nav><section className="file-workspace" style={{position:'relative',inset:'auto',width:600,height:420,margin:0,display:'block'}}><aside className="fw-tree" style={{width:500,height:380}}><FileWorkspaceTree files={files} scope="refresh-P" rootPath="/synthetic/refresh" query="" expanded={expanded} selected={selected} focused={focused} activePath={null} scrollRef={scroll} apiRef={api} onExpandedChange={setExpanded} onSelectedChange={setSelected} onFocusedChange={setFocused} onOpen={(path,pin)=>log('open:'+path+':'+!!pin)} onMenu={()=>{}} onDrag={()=>{}} onDragEnd={()=>{}} renderIcon={()=>null} fixtureProvider={provider}/></aside></section>
    <button data-testid="outside">文件树后控件</button><output data-testid="events">{JSON.stringify(events)}</output></>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
