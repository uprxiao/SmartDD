// Layout follows the M14 workspace prototype; existing M9 files/M12 browser keep their stores and viewers.
import {observer} from 'mobx-react-lite';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Files,Globe,TerminalSquare,FileDiff,Plus,X,Maximize2,Minimize2,PanelBottom,PanelRight} from 'lucide-react';
import {navigation} from '@renderer/core/navigation';
import {useVisibleWorkspaceTab} from '@renderer/lib/hooks/useVisibleWorkspaceTab';
import { TurnDiffSurface } from './turn-diff-surface';
import type {FileScope} from '@shared/files';
import {FileWorkspacePanel} from '@renderer/features/files/workspace-panel';import {AgentBrowserSurface} from '@renderer/features/browser/workspace';
import {browserWorkspaceFor} from '@renderer/features/browser/store';
import {AgentTerminalDrawer} from './agent-terminal';import {panelsFor,homeWorkspace,type AgentPanel} from './workspace-panels-store';
const definitions={files:{label:'文件',key:'F',Icon:Files},browser:{label:'浏览器',key:'B',Icon:Globe},terminal:{label:'终端',key:'T',Icon:TerminalSquare},diff:{label:'差异',key:'D',Icon:FileDiff}};
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
     {tabs.includes('diff')&&active==='diff'&&taskId&&<TurnDiffSurface key={taskId} taskId={taskId} readOnly={readOnly}/>}
   </div>
 </aside>;
});
