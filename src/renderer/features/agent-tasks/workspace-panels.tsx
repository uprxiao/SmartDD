// Layout follows the M14 workspace prototype; existing M9 files/M12 browser keep their stores and viewers.
import {rpcErrorMessage} from '@shared/ipc/rpc';
import {observer} from 'mobx-react-lite';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Files,Globe,TerminalSquare,FileDiff,Plus,X,Maximize2,Minimize2,PanelBottom,PanelRight} from 'lucide-react';
import {navigation} from '@renderer/core/navigation';
import {useVisibleWorkspaceTab} from '@renderer/lib/hooks/useVisibleWorkspaceTab';
import {EditorView} from '@codemirror/view';import {Compartment,EditorState} from '@codemirror/state';
import {syncFileConflictDiff} from '@renderer/features/files/conflict-diff';
import type {FileScope} from '@shared/files';import {agentTaskEvent} from '@shared/events';import {rpc,events} from '@renderer/lib/ipc';
import {FileWorkspacePanel} from '@renderer/features/files/workspace-panel';import {AgentBrowserSurface} from '@renderer/features/browser/workspace';
import {browserWorkspaceFor} from '@renderer/features/browser/store';
import {AgentTerminalDrawer} from './agent-terminal';import {panelsFor,homeWorkspace,type AgentPanel} from './workspace-panels-store';
const definitions={files:{label:'文件',key:'F',Icon:Files},browser:{label:'浏览器',key:'B',Icon:Globe},terminal:{label:'终端',key:'T',Icon:TerminalSquare},diff:{label:'差异',key:'D',Icon:FileDiff}};
function ReadonlyDiff({before,after}:{before:string;after:string}){const host=useRef<HTMLDivElement>(null);useEffect(()=>{if(!host.current)return;const slot=new Compartment(),view=new EditorView({parent:host.current,state:EditorState.create({doc:after,extensions:[EditorState.readOnly.of(true),EditorView.editable.of(false),slot.of([]),EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, monospace',fontSize:'12px'}})]})});syncFileConflictDiff(view,slot,before,after);return()=>view.destroy();},[before,after]);return <div className="agent-readonly-diff" ref={host} aria-label="只读差异"/>;}
type DiffPage = Awaited<ReturnType<typeof rpc.agentTasks.changePage>>;
type DiffSummary = DiffPage['items'][number];

const DiffSurface = observer(function DiffSurface({taskId,readOnly}:{taskId:string;readOnly:boolean}) {
 const panels = panelsFor({kind:'task',taskId});
 const selected = panels.diffTurn;
 const [page,setPage] = useState<DiffPage|null>(null);
 const [exact,setExact] = useState<DiffSummary|null>(null);
 const [selectionError,setSelectionError] = useState('');
 const [loadingOlder,setLoadingOlder] = useState(false);
 const [files,setFiles] = useState<Awaited<ReturnType<typeof rpc.agentTasks.changeFiles>>|null>(null);
 const [path,setPath] = useState('');
 const [content,setContent] = useState<Awaited<ReturnType<typeof rpc.agentTasks.changePatch>>|null>(null);
 const [error,setError] = useState('');
 useEffect(()=>{
  let alive=true;
  void rpc.agentTasks.changePage(taskId).then(r=>{if(alive)setPage(r);}).catch(e=>{if(alive)setSelectionError(rpcErrorMessage(e));});
  return()=>{alive=false;};
 },[taskId]);

 useEffect(()=>{
  let alive = true;
  setSelectionError('');
  const load = () => {
   if (selected) {
    void rpc.agentTasks.changeTurn(taskId,selected).then(r=>{
     if(alive){setExact(r);setSelectionError('');}
    }).catch(e=>{if(alive){setExact(null);setSelectionError(rpcErrorMessage(e));}});
   }
  };
  load();
  const off = events.on(agentTaskEvent,e=>{
   if(e.taskId!==taskId||e.type!=='diff.changed')return;
   load();
   void rpc.agentTasks.changePage(taskId).then(latest=>{
    if(!alive)return;
    setPage(old=>{
     if(!old)return latest;
     const seen=new Set(latest.items.map(r=>r.turnId));
     const older=old.items.filter(row=>!seen.has(row.turnId));
     return {items:[...latest.items,...older],next:older.length?old.next:latest.next};
    });
   }).catch(()=>{});
  });
  return()=>{alive=false;off();};
 },[taskId,selected]);

 const loadOlder = async () => {
  if(!page?.next||loadingOlder)return;
  setLoadingOlder(true);
  try{
   const more=await rpc.agentTasks.changePage(taskId,page.next);
   setPage(old=>{
    if(!old)return more;
    const seen=new Set(old.items.map(r=>r.turnId));
    return {items:[...old.items,...more.items.filter(row=>!seen.has(row.turnId))],next:more.next};
   });
  }catch(e){setSelectionError(rpcErrorMessage(e));}
  finally{setLoadingOlder(false);}
 };
 const fromList = page?.items.find(row=>row.turnId===selected);
 const turn = selected ? exact?.turnId===selected ? exact : fromList : page?.items[0];

 useEffect(()=>{
  let alive=true,token:string|undefined;
  if(turn?.status!=='complete'||!turn.filesTotal)return;
  const turnId=turn.turnId;
  const renew = () => {
   void rpc.agentTasks.holdDiff(taskId,turnId).then(receipt=>{
    if(!alive){void rpc.agentTasks.releaseDiff(taskId,receipt).catch(()=>{});return;}
    if(token)void rpc.agentTasks.releaseDiff(taskId,token).catch(()=>{});
    token=receipt;
   }).catch(e=>{if(alive)setError(rpcErrorMessage(e));});
  };
  renew();
  const timer=setInterval(renew,30_000);
  return()=>{alive=false;clearInterval(timer);if(token)void rpc.agentTasks.releaseDiff(taskId,token).catch(()=>{});};
 },[taskId,turn?.turnId,turn?.status,turn?.filesTotal]);

 useEffect(()=>{
  let alive=true;
  setFiles(null);setContent(null);setPath('');setError('');
  if(turn?.status==='complete'&&turn.filesTotal)void rpc.agentTasks.changeFiles(taskId,turn.turnId,0).then(result=>{
   if(alive){setFiles(result);setPath(result.files[0]?.path??'');}
  }).catch(e=>{if(alive)setError(rpcErrorMessage(e));});
  return()=>{alive=false;};
 },[taskId,turn?.turnId,turn?.status,turn?.filesTotal]);
 useEffect(()=>{
  let alive=true;
  setContent(null);
  if(turn?.status==='complete'&&path)void (async()=>{
   const result=await rpc.agentTasks.changePatch(taskId,turn.turnId,path);
   if(!result.bodyHash)return result;
   let offset=0,text='';
   for(let n=0;n<1000;n++){
    if(!alive)throw Error('差异视图已切换');
    const chunk=await rpc.agentTasks.changePatchBody(taskId,turn.turnId,path,result.bodyHash,offset);
    text+=chunk.chunk;
    if(chunk.done)return JSON.parse(text) as typeof result;
    if(chunk.next<=offset)throw Error('差异正文读取未推进');
    offset=chunk.next;
   }
   throw Error('差异正文超过本次读取预算');
  })().then(r=>{if(alive)setContent(r);}).catch(e=>{if(alive)setError(rpcErrorMessage(e));});
  return()=>{alive=false;};
 },[taskId,turn?.turnId,turn?.status,path]);

 if(!turn)return <div className="agent-panel-empty"><FileDiff/><p role={selectionError?'alert':'status'}>{selectionError||(selected||!page?'正在读取指定轮次':'还没有本轮改动')}</p></div>;
 const options = fromList||!selected ? page?.items??[turn] : [turn,...page?.items??[]];
 return <div className="agent-diff-surface">
  <header><b>本轮改动</b>
   <select aria-label="差异回合" value={turn.turnId} onChange={e=>{panels.diffTurn=e.target.value;}}>{options.map(r=>
    <option key={r.turnId} value={r.turnId}>改动记录 {r.recordNumber}{r.status==='complete'?'':` · ${r.reason??'正在捕获快照'}`}</option>)}
   </select>
   {!!page?.next&&<button type="button" disabled={loadingOlder} onClick={()=>void loadOlder()}>加载更早轮次</button>}
  </header>
  {selectionError&&<p role="alert">{selectionError}</p>}
  {turn.status!=='complete'?<div role="status">
   <p>{turn.reason??'正在捕获快照'}</p>
   {turn.preparing&&<p>后台准备中：{turn.progress?.files??0} 个文件 · {Math.round((turn.progress?.bytes??0)/1024)} KiB
    {!readOnly&&<button type="button" onClick={()=>void rpc.agentTasks.cancelDiff(taskId,turn.turnId).catch(e=>setSelectionError(rpcErrorMessage(e)))}>取消快照</button>}
   </p>}
  </div>:!turn.filesTotal?<p role="status">本轮没有文件改动</p>:<div className="agent-diff-main">
   <ul>{files?.files.map(file=><li key={file.path}><button type="button" className={path===file.path?'on':''} onClick={()=>{setError('');setPath(file.path);}} title={file.path}>{file.path}<small>{file.binary?'二进制':` +${file.added} −${file.removed}`}</small></button></li>)}
    {files?.hasMore&&<li><button type="button" onClick={()=>{
     const expected=turn.turnId;
     void rpc.agentTasks.changeFiles(taskId,expected,files.next).then(r=>{
      if((panels.diffTurn??expected)===expected)setFiles(v=>v?{...r,files:[...v.files,...r.files]}:r);
     }).catch(e=>setError(rpcErrorMessage(e)));
    }}>加载更多文件</button></li>}
   </ul>
   <div className="agent-diff-content"><b>{path}</b>{error?<p role="alert">{error}</p>:content?.patch===null?<p>{content.reason}</p>:content?.beforeText!==undefined&&content?.afterText!==undefined?<ReadonlyDiff before={content.beforeText} after={content.afterText}/>:<p>{files?.total===0?'本轮没有观察到文件变化':'正在读取只读差异…'}</p>}</div>
  </div>}
  <footer>区间内的用户及外部修改也可能出现在这里。回退请用 git／svn 命令。</footer>
 </div>;
});

export const AgentWorkspacePanels=observer(function AgentWorkspacePanels({scope,projectId,readOnly=false,titlebarTarget}:{
 scope:FileScope; projectId:string|null; readOnly?:boolean; titlebarTarget?:HTMLElement|null;
}){
 const panels=panelsFor(scope),[menu,setMenu]=useState(false),taskId=scope.kind==='task'?scope.taskId:null;
 const [fileTabsTarget, setFileTabsTarget] = useState<HTMLDivElement | null>(null);
 const [webTabsTarget, setWebTabsTarget] = useState<HTMLDivElement | null>(null);
 const [browseRequest, setBrowseRequest] = useState(0);
 const [tabStrip, setTabStrip] = useState<HTMLDivElement | null>(null);
 useVisibleWorkspaceTab(tabStrip);
 const tabs=readOnly?['diff' as const]:panels.tabs;
 const active=readOnly?'diff':panels.active;
 const projectMissing=scope.kind==='project'&&!projectId;
 const hasHomeDir=!!homeWorkspace.cwd;
 const available=(id:AgentPanel)=>readOnly?id==='diff':id==='files'||id==='terminal'&&(!!taskId||hasHomeDir)||id==='diff'&&!!taskId||id==='browser'&&!!taskId&&!!projectId;
 const add=(id:AgentPanel)=>{
   panels.open(id);
   if(id==='files'&&!projectMissing)setBrowseRequest(value=>value+1);
   if(id==='browser'&&taskId)void browserWorkspaceFor(taskId).create();
   setMenu(false);
 };
 useEffect(()=>{
   const key=(e:KeyboardEvent)=>{
     if(readOnly||e.defaultPrevented||e.isComposing||e.metaKey||e.ctrlKey||e.altKey)return;
     if(e.key==='Escape'&&menu){setMenu(false);return;}
     if ((!menu&&panels.tabs.length)||e.target instanceof Element&&e.target.closest('input,textarea,[contenteditable],dialog,[role=dialog]'))return;
     const entry=(Object.keys(definitions) as AgentPanel[]).find(id=>definitions[id].key.toLowerCase()===e.key.toLowerCase()&&available(id));
     if(entry){e.preventDefault();add(entry);}
   };
   document.addEventListener('keydown',key);
   return()=>document.removeEventListener('keydown',key);
 },[menu,panels,taskId,projectId,hasHomeDir,projectMissing,readOnly]);
 const list=()=>Object.entries(definitions).map(([key,{label,Icon,key:shortcut}])=><button key={key} type="button" disabled={!available(key as AgentPanel)} title={!available(key as AgentPanel)?'创建并关联项目任务后可用':key==='browser'?'新建网页标签':label} onClick={()=>add(key as AgentPanel)}><Icon size={15}/>{label}{key!=='browser'&&panels.tabs.includes(key as AgentPanel)&&' ✓'}{!available(key as AgentPanel)&&<small>创建任务后可用</small>}<kbd>{shortcut}</kbd></button>);
 const terminal=taskId?<AgentTerminalDrawer taskId={taskId} onClose={()=>panels.close('terminal')}/>:homeWorkspace.projectId&&homeWorkspace.dirId?<AgentTerminalDrawer home={{projectId:homeWorkspace.projectId,dirId:homeWorkspace.dirId}} onClose={()=>panels.close('terminal')}/>:<p>先选择可用的项目工作目录</p>;
 const header = <header className="agent-panel-header" data-testid="agent-workspace-panel-header">
   <div className="agent-panel-tabs" ref={setTabStrip} role="tablist" aria-label="工作面板">
     {tabs.map(id => {
       if(id==='files'&&!projectMissing)return <div key={id} className="agent-panel-tab-slot" ref={setFileTabsTarget}/>;
       if(id==='browser'&&taskId)return <div key={id} className="agent-panel-tab-slot" ref={setWebTabsTarget}/>;
       const { label, Icon } = definitions[id];
       return <div key={id} className={'agent-surface-tab'+(active === id ? ' on' : '')}>
         <button type="button" role="tab" aria-selected={active === id} onClick={() => panels.open(id)}><Icon size={14}/>{label}</button>
         {!readOnly && <button type="button" aria-label={`关闭${label}面板`} onClick={() => panels.close(id)}><X size={10}/></button>}
       </div>;
     })}
   </div>
   {!readOnly && <div className="agent-panel-add">
     <button type="button" aria-label="打开面板" title="打开面板" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Plus size={15}/></button>
     {menu && <><button type="button" className="agent-context-scrim" aria-label="关闭面板菜单" onClick={() => setMenu(false)}/><div className="agent-panel-menu">{list()}</div></>}
   </div>}
   <span className="push"/>
   <button type="button" title={panels.maximized ? '还原面板' : '最大化面板'} onClick={() => { panels.maximized = !panels.maximized; }}>
     {panels.maximized ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}
   </button>
   {titlebarTarget && !readOnly && <button type="button" data-testid="agent-titlebar-terminal-toggle" title="底部终端抽屉（⌃`）"
     disabled={!taskId && !homeWorkspace.cwd} aria-pressed={panels.drawer} onClick={() => panels.terminalDrawer()}><PanelBottom size={15}/></button>}
   {titlebarTarget && <button type="button" title="收起右侧面板" aria-pressed onClick={() => {
     panels.maximized = false;
     navigation.toggleFilePanel();
   }}><PanelRight size={15}/></button>}
 </header>;
 return <aside className={'agent-right-panel'+(panels.maximized?' maximized':'')} aria-label="统一工作面板" data-testid="agent-workspace-panel" data-maximized={panels.maximized}>
   {titlebarTarget ? createPortal(header, titlebarTarget) : header}
   <div className="agent-panel-body">
     {!tabs.length&&<div className="agent-panel-empty"><b>打开面板</b>{list()}</div>}
     {tabs.includes('files')&&(projectMissing?active==='files'&&<div className="agent-panel-empty fw-directory-only">先选择项目工作目录</div>:
       <div className="agent-file-surface" hidden={active!=='files'}><FileWorkspacePanel scope={scope} workspaceHeader={{
         target:fileTabsTarget,active:active==='files',browseRequest,
         onActivate:()=>panels.open('files'),onCloseDirectory:()=>{panels.close('files');setBrowseRequest(0);},
       }}/></div>)}
     {tabs.includes('browser')&&taskId&&<AgentBrowserSurface taskId={taskId} workspaceHeader={{
       target:webTabsTarget,active:active==='browser',onActivate:()=>panels.open('browser'),onClose:()=>panels.close('browser'),
     }}/>}
     {tabs.includes('terminal')&&active==='terminal'&&terminal}
     {tabs.includes('diff')&&active==='diff'&&taskId&&<DiffSurface taskId={taskId} readOnly={readOnly}/>}
   </div>
 </aside>;
});
