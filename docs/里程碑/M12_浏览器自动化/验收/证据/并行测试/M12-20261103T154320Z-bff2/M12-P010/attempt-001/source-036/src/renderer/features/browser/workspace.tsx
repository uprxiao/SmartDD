import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,ArrowRight,RotateCw,X,Search,FolderOpen,Globe,MoreHorizontal} from 'lucide-react';
import {browserChangedEvent,browserShortcutEvent} from '@shared/events';
import type {BrowserWorkspaceState,BrowserShortcut} from '@shared/browser-workspace';
import {BROWSER_BLANK_URL} from '@shared/browser-navigation';
import {events,rpc} from '@renderer/lib/ipc';
import {FileWorkspacePanel} from '@renderer/features/files/workspace-panel';
import {browserWorkspaceFor,openNewBrowserTab,type BrowserWorkspaceStore} from './store';
import './workspace.css';
import {navigation} from '@renderer/core/navigation';
import {tasksStore} from '@renderer/core/tasks-store';
import {BrowserSettingsDialog,type BrowserPreferences} from './settings-dialog';

export function useBrowserShortcuts(){
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.isComposing||!(event.metaKey||event.ctrlKey)||!event.shiftKey||event.altKey||event.key.toLowerCase()!=='b')return;
      if(event.target instanceof Element&&event.target.closest('[data-browser-shortcut-owner]'))return;
      const taskId=document.querySelector<HTMLElement>('[data-browser-task]')?.dataset.browserTask;
      // The title-bar entry exists even when the right workspace is closed.
      const header=document.querySelector<HTMLButtonElement>('[data-testid=task-new-browser]');
      if(header){event.preventDefault();header.click();}else if(taskId){event.preventDefault();openNewBrowserTab(taskId);}
    };
    const off=events.on(browserShortcutEvent,event=>{if(event.action==='show'&&navigation.currentViewId==='task'&&tasksStore.current?.id===event.taskId&&!navigation.filePanelOpen)navigation.toggleFilePanel();});
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);off();};
  },[]);
}
export function TaskBrowserWorkspace({taskId,onClose}:{taskId:string;onClose:()=>void}){
  const store=browserWorkspaceFor(taskId),{state,error}=useSyncExternalStore(store.subscribe,store.snapshot);
  useEffect(()=>{void store.refresh();return events.on(browserChangedEvent,event=>{if(event.taskId===taskId)void store.refresh();});},[store,taskId]);
  const web={tabs:state?.tabs??[],activeId:state?.activeId??null,onSelect:(id:string)=>void store.select(id),onFiles:()=>void store.select(null),onClose:(id:string)=>void store.close(id),onNew:()=>openNewBrowserTab(taskId),view:state?.activeId?<BrowserView state={state} store={store} error={error}/>:null};
  return <FileWorkspacePanel scope={{kind:'task',taskId}} onClose={onClose} web={web}/>;
}
function BrowserView({state,store,error}:{state:BrowserWorkspaceState;store:BrowserWorkspaceStore;error:string}){
  const tab=state.tabs.find(t=>t.id===state.activeId)!,[address,setAddress]=useState(tab.url===BROWSER_BLANK_URL?'':tab.url),[find,setFind]=useState(false),[menu,setMenu]=useState(false);
  const input=useRef<HTMLInputElement>(null),searchInput=useRef<HTMLInputElement>(null),viewport=useRef<HTMLDivElement>(null),[query,setQuery]=useState('');
  const [preferences,setPreferences]=useState<BrowserPreferences|null>(null),[pageImage,setPageImage]=useState<string|null>(null),settingsGeneration=useRef(0);
  const taskId=state.taskId,tabId=tab.id;
  useEffect(()=>{setAddress(tab.url===BROWSER_BLANK_URL?'':tab.url);},[tabId,tab.url,tab.failure]);
  const run=(work:()=>Promise<unknown>)=>void store.run(work);
  const action=(value:'reload'|'hard-reload'|'stop'|'back'|'forward')=>run(()=>rpc.browser.action({taskId,tabId,action:value}));
  const shortcut=(value:BrowserShortcut)=>{
    if(value==='show')return;else if(value==='new')openNewBrowserTab(taskId);else if(value==='reopen')void store.reopen();else if(value==='close')void store.close(tabId);
    else if(value==='address'){void rpc.browser.focusChrome().then(()=>{input.current?.focus();input.current?.select();});}else if(value==='find')setFind(true);else action(value);
  };
  useEffect(()=>events.on(browserShortcutEvent,event=>{if(event.taskId===taskId)shortcut(event.action);}),[taskId,tabId]);
  const blank=tab.url===BROWSER_BLANK_URL,blocked=blank||!!tab.failure||preferences!==null;
  const closeSettings=()=>{settingsGeneration.current++;run(async()=>{try{await rpc.browser.overlay({taskId,tabId,open:false});}finally{setPreferences(null);setPageImage(null);}});};
  const showSettings=()=>run(async()=>{
    setMenu(false);const generation=++settingsGeneration.current;
    try{const image=await rpc.browser.overlay({taskId,tabId,open:true}),value=await rpc.browser.preferences({taskId});if(generation!==settingsGeneration.current){await rpc.browser.overlay({taskId,tabId,open:false});return;}setPageImage(image);setPreferences(value);}
    catch(error){await rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});throw error;}
  });
  useEffect(()=>{setPreferences(null);setPageImage(null);return()=>{settingsGeneration.current++;void rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});};},[taskId,tabId]);
  useEffect(()=>{setFind(false);setQuery('');if(blank)void rpc.browser.focusChrome().then(()=>input.current?.focus());},[tabId]);
  useEffect(()=>{let active=true;if(find)void rpc.browser.focusChrome().then(()=>{if(active)searchInput.current?.focus();});return()=>{active=false;if(find)void rpc.browser.find({taskId,tabId,text:'',forward:true,next:false}).catch(()=>{});};},[find,tabId]);
  const search=(text:string,next=false,forward=true)=>run(()=>rpc.browser.find({taskId,tabId,text,forward,next}));
  const closeFind=()=>{setFind(false);search('');};
  useEffect(()=>{
    const node=viewport.current;if(!node||blocked)return;
    let active=true,frame=0;const place=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!active)return;const r=node.getBoundingClientRect();if(r.width>0&&r.height>0)void rpc.browser.placement({taskId,tabId,rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}).catch(()=>{});});};
    const observer=new ResizeObserver(place);observer.observe(node);window.addEventListener('resize',place);place();
    return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',place);void rpc.browser.placement({taskId,tabId,rect:null}).catch(()=>{});};
  },[taskId,tabId,blocked,find]);
  return <div className="bw-workspace" data-browser-task={taskId} onKeyDown={event=>{
    if(event.defaultPrevented||event.nativeEvent.isComposing||!(event.metaKey||event.ctrlKey)||event.altKey)return;
    const key=event.key.toLowerCase(),command:BrowserShortcut|undefined=key==='l'?'address':key==='f'?'find':key==='r'?(event.shiftKey?'hard-reload':'reload'):key==='w'?'close':key==='t'?(event.shiftKey?'reopen':'new'):key==='['?'back':key===']'?'forward':undefined;
    if(command){event.preventDefault();event.stopPropagation();shortcut(command);}
  }}>
    <div className="fw-toolbar bw-toolbar"><div className="bw-nav"><button className="fw-icon" aria-label="后退" disabled={!tab.canGoBack} onClick={()=>action('back')}><ArrowLeft size={16}/></button><button className="fw-icon" aria-label="前进" disabled={!tab.canGoForward} onClick={()=>action('forward')}><ArrowRight size={16}/></button><button className="fw-icon" aria-label={tab.loading?'停止加载':'刷新网页'} onClick={()=>action(tab.loading?'stop':'reload')}>{tab.loading?<X size={16}/>:<RotateCw size={16}/>}</button></div>
      <form className="fw-breadcrumb bw-address" onSubmit={event=>{event.preventDefault();run(()=>rpc.browser.navigate({taskId,tabId,address}));input.current?.blur();}}><Globe size={14}/><input ref={input} aria-label="网页地址" value={address} placeholder="搜索或输入网址" onChange={event=>setAddress(event.target.value)} onFocus={event=>event.currentTarget.select()} onKeyDown={event=>{if(event.key==='Escape'){setAddress(blank?'':tab.url);event.currentTarget.blur();}}}/></form><button className="fw-icon" aria-label="浏览器菜单" onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={16}/></button>
    </div>
    {menu&&<div className="bw-menu-row"><button onClick={()=>{action('hard-reload');setMenu(false);}}>强制刷新</button><button onClick={()=>{setFind(true);setMenu(false);}}>页内查找</button><button onClick={()=>{void store.reopen();setMenu(false);}}>重开关闭的标签</button><button onClick={showSettings}>浏览器设置</button></div>}
    {(error||state.notice)&&<div className="bw-banner" role="alert">{error||state.notice}</div>}
    {state.external&&<div className="bw-banner" role="alert"><span>是否用外部应用打开 {state.external.url}？</span><button onClick={()=>run(()=>rpc.browser.external({taskId,id:state.external!.id,allow:true}))}>打开</button><button onClick={()=>run(()=>rpc.browser.external({taskId,id:state.external!.id,allow:false}))}>取消</button></div>}
    {find&&<div className="bw-find"><Search size={14}/><input ref={searchInput} aria-label="页内查找" placeholder="在页面中查找" value={query} onChange={event=>{setQuery(event.target.value);search(event.target.value);}} onKeyDown={event=>{if(event.key==='Escape')closeFind();else if(event.key==='Enter'){event.preventDefault();search(query,true,!event.shiftKey);}}}/><span aria-live="polite">第 {state.find.active} / {state.find.total} 个</span><button className="fw-icon" aria-label="关闭页内查找" onClick={closeFind}><X size={14}/></button></div>}
    {tab.loading&&!blocked&&<div className="bw-progress" role="status" aria-label="网页正在加载"/>}
    <div className="bw-page" ref={viewport} data-testid="browser-viewport">
      {pageImage&&<img className="bw-page-snapshot" src={pageImage} alt="弹框打开前的网页截图"/>}
      {blank?<div className="bw-start"><h2>新标签页</h2><section><h3>工具</h3><button onClick={()=>{void store.select(null);}}><FolderOpen size={17}/><span>文件</span><kbd>⌘P</kbd></button></section><section><h3>推荐</h3>{state.recent.length?state.recent.map(site=><button key={site.host} onClick={()=>run(()=>rpc.browser.navigate({taskId,tabId,address:site.url}))}><Globe size={16}/><span><strong>{site.title}</strong><small>{site.host}</small></span></button>):<p>还没有访问记录</p>}</section></div>:tab.failure?<div className="bw-failure" role="alert"><Globe size={30}/><h2>{tab.failure.title}</h2><code>{tab.failure.errorName}</code>{tab.failure.recovery&&<p>{tab.failure.recovery==='poll'?'服务启动后会自动重新加载':'网络恢复后会自动重新加载'}</p>}<button onClick={()=>action('reload')}>重试</button></div>:null}
    </div>
    {preferences&&<BrowserSettingsDialog taskId={taskId} initial={preferences} onClose={closeSettings}/>}
  </div>;
}
