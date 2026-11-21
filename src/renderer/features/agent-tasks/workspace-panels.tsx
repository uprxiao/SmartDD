// Layout follows P0.19 M14RightPanel; existing M9 files/M12 browser keep their stores and viewers.
import {rpcErrorMessage} from '@shared/ipc/rpc';
import {observer} from 'mobx-react-lite';
import {useEffect,useRef,useState} from 'react';
import {Files,Globe,TerminalSquare,FileDiff,Plus,X,Maximize2,Minimize2,PanelBottom,PanelRight} from 'lucide-react';
import {EditorView} from '@codemirror/view';import {Compartment,EditorState} from '@codemirror/state';
import {syncFileConflictDiff} from '@renderer/features/files/conflict-diff';
import type {FileScope} from '@shared/files';import {agentTaskEvent} from '@shared/events';import {rpc,events} from '@renderer/lib/ipc';
import {FileWorkspacePanel} from '@renderer/features/files/workspace-panel';import {AgentBrowserSurface} from '@renderer/features/browser/workspace';
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
  if(turn?.status!=='complete')return;
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
 },[taskId,turn?.turnId,turn?.status]);

 useEffect(()=>{
  let alive=true;
  setFiles(null);setContent(null);setPath('');setError('');
  if(turn?.status==='complete')void rpc.agentTasks.changeFiles(taskId,turn.turnId,0).then(result=>{
   if(alive){setFiles(result);setPath(result.files[0]?.path??'');}
  }).catch(e=>{if(alive)setError(rpcErrorMessage(e));});
  return()=>{alive=false;};
 },[taskId,turn?.turnId,turn?.status]);
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
  </div>:<div className="agent-diff-main">
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

export const AgentWorkspacePanels=observer(function AgentWorkspacePanels({scope,projectId,onClose,readOnly=false}:{scope:FileScope;projectId:string|null;onClose():void;readOnly?:boolean}){
 const panels=panelsFor(scope),[menu,setMenu]=useState(false),taskId=scope.kind==='task'?scope.taskId:null;const tabs=readOnly?['diff' as const]:panels.tabs;const active=readOnly?'diff':panels.active;const available=(id:AgentPanel)=>readOnly?id==='diff':id==='files'||id==='terminal'&&(!!taskId||!!homeWorkspace.cwd)||id==='diff'&&!!taskId||id==='browser'&&!!taskId&&!!projectId;
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(readOnly||e.defaultPrevented||e.isComposing||e.metaKey||e.ctrlKey||e.altKey||e.target instanceof Element&&e.target.closest('input,textarea,[contenteditable],dialog,[role=dialog]'))return;if(e.key==='Escape'&&menu){setMenu(false);return;}if(!menu&&panels.tabs.length)return;const entry=Object.entries(definitions).find(([,v])=>v.key.toLowerCase()===e.key.toLowerCase());if(entry&&available(entry[0] as AgentPanel)){e.preventDefault();panels.open(entry[0] as AgentPanel);setMenu(false);}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[menu,panels,panels.tabs.length,taskId,projectId,homeWorkspace.cwd,readOnly]);
 const list=()=>Object.entries(definitions).map(([key,{label,Icon,key:shortcut}])=><button key={key} type="button" disabled={!available(key as AgentPanel)} title={!available(key as AgentPanel)?'创建并关联项目任务后可用':label} onClick={()=>{panels.open(key as AgentPanel);setMenu(false);}}><Icon size={15}/>{label}{panels.tabs.includes(key as AgentPanel)&&' ✓'}{!available(key as AgentPanel)&&<small>创建任务后可用</small>}<kbd>{shortcut}</kbd></button>);
 const terminal=taskId?<AgentTerminalDrawer taskId={taskId} onClose={()=>panels.close('terminal')}/>:homeWorkspace.projectId&&homeWorkspace.dirId?<AgentTerminalDrawer home={{projectId:homeWorkspace.projectId,dirId:homeWorkspace.dirId}} onClose={()=>panels.close('terminal')}/>:<p>先选择可用的项目工作目录</p>;
 return <aside className={'agent-right-panel'+(panels.maximized?' maximized':'')} aria-label="统一工作面板" data-testid="agent-workspace-panel" data-maximized={panels.maximized}><header><div className="agent-panel-tabs" role="tablist" aria-label="工作面板">{tabs.map(id=>{const {label,Icon}=definitions[id];return <div key={id} className={active===id?'on':''}><button type="button" role="tab" aria-selected={active===id} onClick={()=>panels.open(id)}><Icon size={14}/>{label}</button>{!readOnly&&<button type="button" aria-label={'关闭'+label+'面板'} onClick={()=>panels.close(id)}><X size={10}/></button>}</div>;})}</div>{!readOnly&&<div className="agent-panel-add"><button type="button" title="打开面板" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}><Plus size={15}/></button>{menu&&<><button type="button" className="agent-context-scrim" aria-label="关闭面板菜单" onClick={()=>setMenu(false)}/><div className="agent-panel-menu">{list()}</div></>}</div>}<span className="push"/><button type="button" title={panels.maximized?'还原面板':'最大化面板'} onClick={()=>{panels.maximized=!panels.maximized;}}>{panels.maximized?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>{!readOnly&&!!taskId&&<button type="button" title="底部终端抽屉（⌃`）" disabled={!taskId&&!homeWorkspace.cwd} aria-pressed={panels.drawer} onClick={()=>panels.terminalDrawer()}><PanelBottom size={15}/></button>}{taskId && <button type="button" title="收起右侧面板" onClick={()=>{panels.maximized=false;onClose();}}><PanelRight size={15}/></button>}</header><div className="agent-panel-body">{!tabs.length?<div className="agent-panel-empty"><b>打开面板</b>{list()}</div>:active==='files'&&scope.kind==='project'&&!projectId?<div className='agent-panel-empty'>先选择项目工作目录</div>:active==='files'?<FileWorkspacePanel scope={scope} onClose={onClose}/>:active==='browser'&&taskId?<AgentBrowserSurface taskId={taskId}/>:active==='terminal'?terminal:active==='diff'&&taskId?<DiffSurface taskId={taskId} readOnly={readOnly}/>:<p>此面板在任务创建后可用</p>}</div></aside>;
});
