// Layout follows the M14 workspace prototype; existing M9 files/M12 browser keep their stores and viewers.
import {observer} from 'mobx-react-lite';
import {useEffect,useRef,useState} from 'react';
import {rpc} from '@renderer/lib/ipc';
import {createPortal} from 'react-dom';
import {Files,Globe,TerminalSquare,FileDiff,Plus,X,Maximize2,Minimize2,PanelBottom,PanelRight} from 'lucide-react';
import {navigation} from '@renderer/core/navigation';
import {useVisibleWorkspaceTab} from '@renderer/lib/hooks/useVisibleWorkspaceTab';
import { TurnDiffSurface } from './turn-diff-surface';
import type {FileScope} from '@shared/files';
import {FileWorkspacePanel} from '@renderer/features/files/workspace-panel';import {AgentBrowserSurface} from '@renderer/features/browser/workspace';
import {browserWorkspaceFor} from '@renderer/features/browser/store';
import {AgentTerminalDrawer} from './agent-terminal';import {panelsFor,homeWorkspace,type AgentPanel} from './workspace-panels-store';
import { MessageAttachmentPreview } from './message-attachment-preview';
import { FileTreeIcon } from '@renderer/features/files/file-icon';
const definitions={files:{label:'文件',key:'F',Icon:Files},browser:{label:'浏览器',key:'B',Icon:Globe},terminal:{label:'终端',key:'T',Icon:TerminalSquare},diff:{label:'差异',key:'D',Icon:FileDiff}};
type PanelChoice = keyof typeof definitions;
export const AgentWorkspacePanels=observer(function AgentWorkspacePanels({scope,projectId,readOnly=false,titlebarTarget}:{
 scope:FileScope; projectId:string|null; readOnly?:boolean; titlebarTarget?:HTMLElement|null;
}){
 const panels=panelsFor(scope),[menu,setMenu]=useState(false),taskId=scope.kind==='task'?scope.taskId:null;
 const menuOwner=useRef<string|null>(null),pendingOwner=useRef<string|null>(null);
 const browserHolds=useRef(new Map<string,{taskId:string;tabId:string}>());
 const [menuSnapshot,setMenuSnapshot]=useState<{tabId:string;image:string|null}|null>(null);
 const releaseOwner=async(owner:string)=>{
   const hold=browserHolds.current.get(owner);
   if(hold){browserHolds.current.delete(owner);await rpc.browser.overlay({taskId:hold.taskId,tabId:hold.tabId,open:false,owner,instance:owner}).catch(()=>{});}
   await rpc.nativeSurface.overlay({owner,open:false}).catch(()=>{});
 };
 const closeMenu=()=>{
   const pending=pendingOwner.current;pendingOwner.current=null;if(pending)void releaseOwner(pending);
   setMenu(false);
 };
 const toggleMenu=()=>{
   if(menuOwner.current||pendingOwner.current){closeMenu();return;}
   const owner=crypto.randomUUID();pendingOwner.current=owner;
   void(async()=>{
     try{
       const browserTab=taskId&&panels.active==='browser'?browserWorkspaceFor(taskId).snapshot().state?.activeId:null;
       let snapshot:{tabId:string;image:string|null}|null=null;
       if(taskId&&browserTab){
         browserHolds.current.set(owner,{taskId,tabId:browserTab});
         const image=await rpc.browser.overlay({taskId,tabId:browserTab,open:true,owner,instance:owner});
         snapshot={tabId:browserTab,image};
       }
       if(pendingOwner.current!==owner){await releaseOwner(owner);return;}
       await rpc.nativeSurface.overlay({owner,open:true});
       if(pendingOwner.current!==owner){await releaseOwner(owner);return;}
       pendingOwner.current=null;menuOwner.current=owner;setMenuSnapshot(snapshot);setMenu(true);
     }catch{
       await releaseOwner(owner);
       if(pendingOwner.current===owner)pendingOwner.current=null;
     }
   })();
 };
 // Keep the old native slot covered until the shell menu is actually removed;
 // layout/owner cleanup in the same commit can then supersede the old slot.
 useEffect(()=>{if(!menu&&menuOwner.current){const owner=menuOwner.current;menuOwner.current=null;void releaseOwner(owner).finally(()=>{if(!menuOwner.current&&!pendingOwner.current)setMenuSnapshot(null);});}},[menu]);
 useEffect(()=>()=>{for(const owner of [menuOwner.current,pendingOwner.current])if(owner)void releaseOwner(owner);menuOwner.current=null;pendingOwner.current=null;},[taskId]);
 useEffect(()=>{setMenu(false);setMenuSnapshot(null);},[taskId]);
 const [fileTabsTarget, setFileTabsTarget] = useState<HTMLDivElement | null>(null);
 const [webTabsTarget, setWebTabsTarget] = useState<HTMLDivElement | null>(null);
 const [browseRequest, setBrowseRequest] = useState(0);
 const [tabStrip, setTabStrip] = useState<HTMLDivElement | null>(null);
 useVisibleWorkspaceTab(tabStrip);
 useEffect(()=>{
   if(!taskId||readOnly)return;
   let current=true;const store=browserWorkspaceFor(taskId);
   void store.refresh().then(()=>{if(current&&store.snapshot().state?.tabs.length)panels.restoreBrowser();});
   return()=>{current=false;};
 },[taskId,panels,readOnly]);
 const attachment=taskId ? panels.attachment : null;
 const tabs: AgentPanel[]=readOnly ? (attachment ? ['diff', 'attachment'] : ['diff']) : panels.tabs;
 const active=readOnly && panels.active!=='attachment'?'diff':panels.active;
 const projectMissing=scope.kind==='project'&&!projectId;
 const hasHomeDir=!!homeWorkspace.cwd;
 const available=(id:AgentPanel)=>readOnly?id==='diff':id==='files'||id==='terminal'&&(!!taskId||hasHomeDir)||id==='diff'&&!!taskId||id==='browser'&&!!taskId;
 const add=(id:AgentPanel)=>{
   panels.open(id);
   if(id==='files'&&!projectMissing)setBrowseRequest(value=>value+1);
   if(id==='browser'&&taskId)void browserWorkspaceFor(taskId).create();
   closeMenu();
 };
 useEffect(()=>{
   const key=(e:KeyboardEvent)=>{
     if(readOnly||e.defaultPrevented||e.isComposing||e.metaKey||e.ctrlKey||e.altKey)return;
     if(e.key==='Escape'&&menu){closeMenu();return;}
     if ((!menu&&panels.tabs.length)||e.target instanceof Element&&e.target.closest('input,textarea,[contenteditable],dialog,[role=dialog]'))return;
     const entry=(Object.keys(definitions) as PanelChoice[]).find(id=>definitions[id].key.toLowerCase()===e.key.toLowerCase()&&available(id));
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
       if(id==='attachment')return attachment && <div key={id} className={'agent-surface-tab agent-attachment-tab'+(active===id?' on':'')}>
         <button type="button" role="tab" aria-selected={active===id} title={attachment.name} onClick={()=>panels.open(id)}>
           <FileTreeIcon path={attachment.name}/><span className="agent-tab-label">{attachment.name}</span>
         </button>
         <button type="button" aria-label="关闭附件预览" onClick={()=>panels.close(id)}><X size={10}/></button>
       </div>;
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
     <button type="button" aria-label="打开面板" title="打开面板" aria-expanded={menu} onClick={toggleMenu}><Plus size={15}/></button>
     {menu && <><button type="button" className="agent-context-scrim" aria-label="关闭面板菜单" onClick={closeMenu}/><div className="agent-panel-menu">{list()}</div></>}
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
     {tabs.includes('browser')&&taskId&&<AgentBrowserSurface taskId={taskId} menuSnapshot={menuSnapshot} workspaceHeader={{
       target:webTabsTarget,active:active==='browser',onActivate:()=>panels.open('browser'),onClose:()=>panels.close('browser'),onAutoClose:()=>panels.close('browser',true),
     }}/>}
     {tabs.includes('terminal')&&active==='terminal'&&terminal}
     {tabs.includes('diff')&&active==='diff'&&taskId&&<TurnDiffSurface key={taskId} taskId={taskId} readOnly={readOnly}/>}
     {active==='attachment'&&taskId&&attachment&&<MessageAttachmentPreview
       key={attachment.turnId+':'+attachment.index} taskId={taskId} attachment={attachment}/>}
   </div>
 </aside>;
});
