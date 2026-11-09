import {useTreePathTooltip} from '@renderer/features/files/tree-path-tooltip';
import {useBrowserTabTooltip,type BrowserTabTooltip} from './tab-tooltip';
import {BrowserJavascriptDialogView} from './javascript-dialog';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,ArrowRight,RotateCw,X,Search,Files,Globe,MoreHorizontal,ChevronUp,ChevronDown,Info,ShieldAlert,AlertTriangle,WifiOff,UserRound,Download,KeyRound,Pause,Play,Bot,ExternalLink} from 'lucide-react';
import {browserChangedEvent,browserShortcutEvent} from '@shared/events';
import type {BrowserWorkspaceState,BrowserShortcut} from '@shared/browser-workspace';
import type {BrowserProfile} from '@shared/browser-profiles';
import {BROWSER_BLANK_URL,normalizeBrowserNavigationUrl} from '@shared/browser-navigation';
import {events,rpc} from '@renderer/lib/ipc';
import {FileWorkspacePanel} from '@renderer/features/files/workspace-panel';
import {browserWorkspaceFor,openNewBrowserTab,type BrowserWorkspaceStore} from './store';
import './workspace.css';
import {navigation} from '@renderer/core/navigation';
import {tasksStore} from '@renderer/core/tasks-store';
import {BrowserSettingsDialog,type BrowserPreferences} from './settings-dialog';
import {BrowserProfileSiteStates,type ProfileSiteStates} from './profile-site-states';
import {BrowserPermissionBar} from './permission-bar';
import {BrowserDownloadPanel} from './download-panel';
import {BrowserAuthDialog} from './auth-dialog';
import {BrowserAccessSurface} from './access-dialog';
import {browserAccess} from './access-store';

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
    let showGeneration=0;
    const off=events.on(browserShortcutEvent,event=>{
      if(event.action!=='show')return;
      const generation=++showGeneration;
      const reveal=()=>{
        const task=tasksStore.byId.get(event.taskId);
        if(generation!==showGeneration||!task?.projectId||tasksStore.closing.has(event.taskId))return;
        // Reveal the requested browser without resuming an idle Agent.
        navigation.openTask(event.taskId);
        if(!navigation.filePanelOpen)navigation.toggleFilePanel();
      };
      if(tasksStore.byId.has(event.taskId))reveal();
      else void tasksStore.refresh().then(reveal).catch(()=>console.warn('[browser] focused task lookup unavailable'));
    });
    document.addEventListener('keydown',key);return()=>{showGeneration++;document.removeEventListener('keydown',key);off();};
  },[]);
}
export function TaskBrowserWorkspace({taskId,onClose}:{taskId:string;onClose:()=>void}){
  const store=browserWorkspaceFor(taskId),{state,error}=useSyncExternalStore(store.subscribe,store.snapshot);
  useEffect(()=>{void store.refresh();return events.on(browserChangedEvent,event=>{if(event.taskId===taskId)void store.refresh();});},[store,taskId]);
  const titleTip=useTreePathTooltip(JSON.stringify([taskId,state?.activeId,state?.tabs.map(tab=>[tab.id,tab.title,tab.url])]));
  const titleTooltip:BrowserTabTooltip|null=titleTip.target?{target:titleTip.target,element:titleTip.element,dismiss:titleTip.dismiss}:null;
  const web={tabTooltip:titleTip.bind,inactiveTooltip:titleTooltip&&<div className="bw-tab-tooltip">{titleTooltip.element}</div>,tabs:state?.tabs??[],paused:state?.paused??false,activeId:state?.activeId??null,onSelect:(id:string)=>void store.select(id),onFiles:()=>void store.select(null),onClose:(id:string)=>void store.close(id),onNew:()=>openNewBrowserTab(taskId),view:state?.activeId?<BrowserView state={state} store={store} error={error} titleTooltip={titleTooltip}/>:null};
  return <FileWorkspacePanel scope={{kind:'task',taskId}} onClose={onClose} web={web}/>;
}
function BrowserView({state,store,error,titleTooltip}:{state:BrowserWorkspaceState;store:BrowserWorkspaceStore;error:string;titleTooltip:BrowserTabTooltip|null}){
  const access=useSyncExternalStore(browserAccess.subscribe,browserAccess.snapshot),accessOpen=!!access.state.requests.length||access.grantsOpen,[accessReady,setAccessReady]=useState(false);
  const tab=state.tabs.find(t=>t.id===state.activeId)!,[address,setAddress]=useState(tab.url===BROWSER_BLANK_URL?'':tab.url),[find,setFind]=useState(false),[menu,setMenu]=useState(false);
  const input=useRef<HTMLInputElement>(null),searchInput=useRef<HTMLInputElement>(null),viewport=useRef<HTMLDivElement>(null),[query,setQuery]=useState('');
  const [preferences,setPreferences]=useState<BrowserPreferences|null>(null),[pageImage,setPageImage]=useState<string|null>(null),[initialImport,setInitialImport]=useState(false),[profileRecords,setProfileRecords]=useState<ProfileSiteStates|null>(null),[downloadsOpen,setDownloadsOpen]=useState(false),[authOpenId,setAuthOpenId]=useState<string|null>(null),[javascriptOpenId,setJavascriptOpenId]=useState<string|null>(null),seenDownload=useRef(state.downloads?.[0]?.id),settingsGeneration=useRef(0);
  const taskId=state.taskId,tabId=tab.id;
  const [addressIssue,setAddressIssue]=useState<{taskId:string;tabId:string;committedUrl:string;input:string;shown:boolean}|null>(null);
  const invalidAddress=addressIssue?.taskId===taskId&&addressIssue.tabId===tabId&&addressIssue.committedUrl===tab.url&&addressIssue.shown&&tab.importState!=='importing'&&tab.importState!=='needs-attention'?addressIssue:null;
  const invalidMessage='请输入有效的 http(s) 或 localhost 地址';
  const [,tickActivity]=useState(0),holdUntil=tab.agentHoldUntil;
  useEffect(()=>{
    if(state.paused||!tab.agentActive||tab.agentRunning||holdUntil==null)return;
    // The host owns the deadline. Switching tabs or remounting only resumes
    // displaying its remaining time; it must never start another 20 seconds.
    const timer=setInterval(()=>tickActivity(value=>value+1),250);
    return()=>clearInterval(timer);
  },[taskId,tabId,state.paused,tab.agentActive,tab.agentRunning,holdUntil]);
  const holdSeconds=holdUntil==null?null:Math.ceil(Math.max(0,holdUntil-Date.now())/1000);
  const [badgeProfile,setBadgeProfile]=useState<BrowserProfile|null>(null),[badgeLoading,setBadgeLoading]=useState(true);
  useEffect(()=>{
    let active=true;setBadgeProfile(null);setBadgeLoading(true);
    void rpc.browser.profileSiteStates({taskId}).then(records=>{if(active){setBadgeProfile(records.find(item=>item.profile.id===tab.profileId)?.profile??null);setBadgeLoading(false);}}).catch(()=>{if(active){setBadgeProfile(null);setBadgeLoading(false);}});
    return()=>{active=false;};
  },[taskId,tab.profileId]);
  const activeBadge=badgeProfile?.id===tab.profileId?badgeProfile:null;
  const badgeLabel=activeBadge?(activeBadge.scope==='project'?'项目登录态':'独立登录态'):'登录态';
  const badgeTitle=activeBadge?'当前页面的登录态：'+activeBadge.label:badgeLoading?'正在读取当前页面的登录态':'无法读取当前登录态，点击管理';
  useEffect(()=>{setAddress((state.auth?.pageId===tabId?state.auth.url:state.authCancelled?.pageId===tabId?state.authCancelled.url:undefined)??(tab.certificate?.challengeId?tab.failure?.url:undefined)??(tab.url===BROWSER_BLANK_URL?'':tab.url));},[tabId,tab.url,tab.failure,tab.certificate?.challengeId,state.auth?.url,state.authCancelled?.url]);
  const run=(work:()=>Promise<unknown>)=>void store.run(work);
  const action=(value:'reload'|'hard-reload'|'stop'|'back'|'forward')=>{
    if(value!=='stop')setAddressIssue(issue=>issue?.taskId===taskId&&issue.tabId===tabId?{...issue,shown:false}:issue);
    run(()=>rpc.browser.action({taskId,tabId,action:value}));
  };
  const submitAddress=()=>{
    // The host still validates and uses its configured search engine. Any engine
    // has the same validity result; this check only keeps invalid drafts editable.
    const invalid=normalizeBrowserNavigationUrl(address,'bing')===null;
    setAddressIssue(invalid?{taskId,tabId,committedUrl:tab.url,input:address.trim(),shown:true}:issue=>issue?{...issue,shown:false}:issue);
    run(()=>rpc.browser.navigate({taskId,tabId,address}));
    if(invalid){input.current?.focus();input.current?.select();}else input.current?.blur();
  };
  const shortcut=(value:BrowserShortcut)=>{
    if(value==='show')return;else if(value==='new')openNewBrowserTab(taskId);else if(value==='reopen')void store.reopen();else if(value==='close')void store.close(tabId);
    else if(value==='address'){void rpc.browser.focusChrome().then(()=>{input.current?.focus();input.current?.select();});}else if(value==='find')setFind(true);else action(value);
  };
  useEffect(()=>events.on(browserShortcutEvent,event=>{if(event.taskId===taskId)shortcut(event.action);}),[taskId,tabId]);
  const blank=tab.url===BROWSER_BLANK_URL&&!tab.failure&&!state.auth&&!state.authCancelled&&!state.javascriptDialog;
  const surfaceOpen=accessOpen||!!state.auth||!!state.authCancelled||!!state.javascriptDialog||preferences!==null||profileRecords!==null||menu||downloadsOpen;
  const pageBlocked=surfaceOpen||!!invalidAddress||tab.importState==='importing'||tab.importState==='needs-attention'||blank||!!tab.failure;
  const titleOverlay=useBrowserTabTooltip({taskId,tabId,tooltip:titleTooltip,pageBlocked,surfaceOpen});
  const blocked=pageBlocked||titleOverlay.parked;
  useEffect(()=>{
    if(!accessOpen){setAccessReady(false);return;}
    let active=true;setAccessReady(false);
    run(async()=>{let image:string|null=null;try{image=await rpc.browser.overlay({taskId,tabId,open:true});}catch{await rpc.browser.placement({taskId,tabId,rect:null});}if(active){setPageImage(image);setAccessReady(true);}});
    return()=>{active=false;setAccessReady(false);setPageImage(null);void rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});};
  },[accessOpen,taskId,tabId]);
  const closeMenu=(after?:()=>void)=>{settingsGeneration.current++;run(async()=>{await rpc.browser.overlay({taskId,tabId,open:false});setMenu(false);setPageImage(null);after?.();});};
  const toggleMenu=()=>{if(menu){closeMenu();return;}run(async()=>{const generation=++settingsGeneration.current,image=await rpc.browser.overlay({taskId,tabId,open:true});if(generation!==settingsGeneration.current){await rpc.browser.overlay({taskId,tabId,open:false});return;}setPageImage(image);setDownloadsOpen(false);setMenu(true);});};
  const closeSettings=()=>{settingsGeneration.current++;run(async()=>{try{await rpc.browser.overlay({taskId,tabId,open:false});}finally{setPreferences(null);setProfileRecords(null);setDownloadsOpen(false);setPageImage(null);}});};
  useEffect(()=>{
    if(!downloadsOpen)return;
    // Removing the focused menu item leaves focus on body. Keep Escape working
    // without taking keyboard focus away when a download opens automatically.
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||event.target instanceof Element&&event.target.closest('[role="dialog"]'))return;
      event.preventDefault();closeSettings();
    };
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[downloadsOpen,taskId,tabId]);
  const showSettings=()=>run(async()=>{
    const generation=++settingsGeneration.current;
    try{const value=await rpc.browser.preferences({taskId});if(generation!==settingsGeneration.current)return;setMenu(false);setPreferences(value);}
    catch(error){await rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});throw error;}
  });
  const showProfiles=(importNow=false,capture=false)=>run(async()=>{const generation=++settingsGeneration.current;try{const image=capture?await rpc.browser.overlay({taskId,tabId,open:true}):null;if(generation!==settingsGeneration.current)return;const records=await rpc.browser.profileSiteStates({taskId});if(generation!==settingsGeneration.current)return;if(capture)setPageImage(image);setBadgeProfile(records.find(item=>item.profile.id===tab.profileId)?.profile??null);setBadgeLoading(false);setMenu(false);setInitialImport(importNow);setProfileRecords(records);}catch(error){if(generation!==settingsGeneration.current)return;await rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});throw error;}});
  const showDownloads=()=>run(async()=>{const generation=++settingsGeneration.current,image=await rpc.browser.overlay({taskId,tabId,open:true});if(generation!==settingsGeneration.current){await rpc.browser.overlay({taskId,tabId,open:false});return;}setMenu(false);setPageImage(image);setDownloadsOpen(true);});
  useEffect(()=>{const latest=state.downloads?.[0]?.id;if(latest&&latest!==seenDownload.current&&!preferences&&!profileRecords&&!menu&&!state.auth){seenDownload.current=latest;showDownloads();}if(downloadsOpen&&!state.downloads?.length)closeSettings();},[state.downloads?.[0]?.id,preferences,profileRecords,menu,downloadsOpen,state.auth?.id]);
  useEffect(()=>{setMenu(false);setPreferences(null);setProfileRecords(null);setDownloadsOpen(false);setAuthOpenId(null);setJavascriptOpenId(null);setPageImage(null);return()=>{settingsGeneration.current++;void rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});};},[taskId,tabId]);
  useEffect(()=>{
    const id=state.auth?.id;if(!id||state.javascriptDialog||preferences||profileRecords||menu||downloadsOpen)return;
    let active=true;const generation=++settingsGeneration.current;
    run(async()=>{const image=await rpc.browser.overlay({taskId,tabId,open:true});if(!active||generation!==settingsGeneration.current){if(generation===settingsGeneration.current)await rpc.browser.overlay({taskId,tabId,open:false});return;}setPageImage(image);setAuthOpenId(id);});
    return()=>{active=false;if(generation===settingsGeneration.current){settingsGeneration.current++;setAuthOpenId(null);setPageImage(null);void rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});}};
  },[state.auth?.id,state.javascriptDialog?.id,taskId,tabId,preferences,profileRecords,menu,downloadsOpen]);
  useEffect(()=>{
    const id=state.javascriptDialog?.id;if(!id||accessOpen||preferences||profileRecords||menu||downloadsOpen)return;
    let active=true;const generation=++settingsGeneration.current;
    run(async()=>{await rpc.browser.overlay({taskId,tabId,open:true,capture:false});if(!active||generation!==settingsGeneration.current){if(generation===settingsGeneration.current)await rpc.browser.overlay({taskId,tabId,open:false});return;}setPageImage(null);setJavascriptOpenId(id);});
    return()=>{active=false;if(generation===settingsGeneration.current){settingsGeneration.current++;setJavascriptOpenId(null);setPageImage(null);void rpc.browser.overlay({taskId,tabId,open:false}).catch(()=>{});}};
  },[state.javascriptDialog?.id,accessOpen,taskId,tabId,preferences,profileRecords,menu,downloadsOpen]);
  useEffect(()=>{setFind(false);setQuery('');if(blank)void rpc.browser.focusChrome().then(()=>input.current?.focus());},[tabId]);
  useEffect(()=>{let active=true;if(find)void rpc.browser.focusChrome().then(()=>{if(active)searchInput.current?.focus();});return()=>{active=false;if(find)void rpc.browser.find({taskId,tabId,text:'',forward:true,next:false}).catch(()=>{});};},[find,tabId]);
  const search=(text:string,next=false,forward=true)=>run(()=>rpc.browser.find({taskId,tabId,text,forward,next}));
  const closeFind=()=>{setFind(false);run(async()=>{await rpc.browser.find({taskId,tabId,text:'',forward:true,next:false});await rpc.browser.action({taskId,tabId,action:'focus'});});};
  useEffect(()=>{
    const node=viewport.current;if(!node||blocked)return;
    let active=true,frame=0;const place=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!active)return;const r=node.getBoundingClientRect(),edge=2;if(r.width>2*edge&&r.height>2*edge)void rpc.browser.placement({taskId,tabId,rect:{x:Math.round(r.x)+edge,y:Math.round(r.y)+edge,width:Math.round(r.width)-2*edge,height:Math.round(r.height)-2*edge}}).catch(()=>{});});};
    const observer=new ResizeObserver(place);observer.observe(node);window.addEventListener('resize',place);place();
    return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',place);void rpc.browser.placement({taskId,tabId,rect:null}).catch(()=>{});};
  },[taskId,tabId,blocked,find,titleOverlay.revision]);
  return <div className="bw-workspace" data-browser-task={taskId} onKeyDown={event=>{
    if(downloadsOpen&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeSettings();return;}
    if(menu&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();return;}
    if(event.target instanceof Element&&event.target.closest('[role=dialog]'))return;
    if(event.defaultPrevented||event.nativeEvent.isComposing||!(event.metaKey||event.ctrlKey)||event.altKey)return;
    const key=event.key.toLowerCase(),command:BrowserShortcut|undefined=key==='l'?'address':key==='f'?'find':key==='r'?(event.shiftKey?'hard-reload':'reload'):key==='w'?'close':key==='t'?(event.shiftKey?'reopen':'new'):key==='['?'back':key===']'?'forward':undefined;
    if(command){event.preventDefault();event.stopPropagation();shortcut(command);}
  }}>
    <div className="fw-toolbar bw-toolbar"><div className="bw-nav"><button className="fw-icon" aria-label="后退" disabled={!tab.canGoBack} onClick={()=>action('back')}><ArrowLeft size={17} strokeWidth={1.65}/></button><button className="fw-icon" aria-label="前进" disabled={!tab.canGoForward} onClick={()=>action('forward')}><ArrowRight size={17} strokeWidth={1.65}/></button><button className="fw-icon" aria-label={tab.loading?'停止加载':invalidAddress?'重试':'刷新网页'} onClick={()=>action(tab.loading?'stop':'reload')}>{tab.loading?<X size={17} strokeWidth={1.65}/>:<RotateCw size={17} strokeWidth={1.65}/>}</button></div>
      <form className="fw-breadcrumb bw-address" onSubmit={event=>{event.preventDefault();submitAddress();}}><span className={tab.certificate&&!invalidAddress?'bw-security bw-certificate':'bw-security'} title={tab.certificate&&!invalidAddress?'证书不受信任':undefined}>{tab.certificate&&!invalidAddress?<ShieldAlert size={13} aria-label="证书不受信任"/>:<Globe size={13}/>}</span><input ref={input} aria-label="网页地址" value={address} placeholder="输入网址或搜索内容" spellCheck={false} onChange={event=>setAddress(event.target.value)} onFocus={event=>event.currentTarget.select()} onKeyDown={event=>{if(event.key==='Escape'){setAddress(blank?'':tab.url);event.currentTarget.blur();}}}/><button type="button" className="bw-profile" title={badgeTitle} aria-busy={badgeLoading} onClick={()=>showProfiles(false,true)}><UserRound size={12}/>{badgeLabel}</button></form>
      {state.paused?<button type="button" className="fw-pill bw-resume" onClick={()=>run(()=>rpc.browser.pause({taskId,paused:false}))}><Play size={13}/>恢复 Agent</button>:state.tabs.some(item=>item.agentActive)&&<button type="button" className="fw-pill bw-pause" onClick={()=>run(()=>rpc.browser.pause({taskId,paused:true}))}><Pause size={13}/>暂停 Agent</button>}
      <>{!!state.downloads?.length&&<button className={'fw-icon bw-download-trigger'+(downloadsOpen?' active':'')} aria-label="下载" aria-expanded={downloadsOpen} onClick={showDownloads}><Download size={17} strokeWidth={1.65}/>{state.downloads.some(item=>item.state==='progress')&&<i aria-label="下载进行中"/>}</button>}</><button className="fw-icon" aria-label="浏览器菜单" aria-expanded={menu} onClick={toggleMenu}><MoreHorizontal size={17} strokeWidth={1.65}/></button>
    </div>
    {titleOverlay.element}
    {menu&&<><button className="bw-dismiss" aria-label="关闭菜单" tabIndex={-1} onClick={()=>closeMenu()}/><div className="bw-menu" role="menu"><button role="menuitem" onClick={()=>closeMenu(()=>setFind(true))}><Search size={14}/>页内查找<kbd>⌘F</kbd></button><>{!!state.downloads?.length&&<button role="menuitem" onClick={showDownloads}><Download size={14}/>下载</button>}</><button role="menuitem" onClick={()=>showProfiles()}><UserRound size={14}/>登录态管理</button><button role="menuitem" disabled={tab.importState==='importing'||tab.importState==='needs-attention'} onClick={()=>showProfiles(true)}><UserRound size={14}/>导入 Chrome／Edge 登录态</button><button role="menuitem" onClick={()=>closeMenu(browserAccess.openGrants)}><ShieldAlert size={14}/>跨任务授权（{access.state.grants.length}）</button><button role="menuitem" onClick={showSettings}><Info size={14}/>浏览器设置</button><button role="menuitem" onClick={()=>closeMenu(()=>action('hard-reload'))}><RotateCw size={14}/>强制刷新</button><button role="menuitem" onClick={()=>closeMenu(()=>{void store.reopen();})}>重开关闭的标签</button></div></>}
    {downloadsOpen&&<><button className="bw-dismiss" aria-label="关闭下载浮层" tabIndex={-1} onClick={closeSettings}/><BrowserDownloadPanel items={state.downloads??[]} onClose={closeSettings} onAction={async(id,action)=>{await rpc.browser.downloadAction({taskId,id,action});await store.refresh();}}/></>}
    {(error||(state.notice&&!(addressIssue?.taskId===taskId&&state.notice===invalidMessage)))&&<div className="bw-banner" role="alert">{error||state.notice}</div>}
    {tab.importState==='needs-attention'&&<div className="bw-banner bw-attention-banner" role="alert"><ShieldAlert size={14}/><span>当前登录态需要处理：上次导入的恢复没有完成，页面暂时不可用，Agent 的浏览器命令返回 <code>BROWSER_UNAVAILABLE</code>。</span><button type="button" className="bw-mini" onClick={()=>showProfiles()}>去处理</button></div>}
    {state.paused?<div className="bw-banner bw-paused" role="status"><Pause size={14}/><span>已暂停 Agent 的浏览器操作。暂停期间 Agent 的浏览器命令会返回 <code>BROWSER_PAUSED</code>；你可以在页面里手动登录或处理弹窗，完成后点“恢复 Agent”。</span></div>:tab.agentActive&&<div className="bw-banner bw-agent" role="status"><Bot size={14}/><span>{tab.agentRunning?'Agent 正在操作此页面':holdSeconds==null?'Agent 最近操作过此页面':`Agent 最近操作过此页面 · ${holdSeconds} 秒后清除标记`}</span></div>}
    {state.external&&<div className="bw-prompt" role="alertdialog" aria-label="外部应用请求"><ExternalLink size={15}/><span>此页面想用外部应用打开 <code>{state.external.url}</code>。</span><button type="button" className="bw-mini" onClick={()=>run(()=>rpc.browser.external({taskId,id:state.external!.id,allow:false}))}>取消</button><button type="button" className="bw-mini bw-mini-primary" onClick={()=>run(()=>rpc.browser.external({taskId,id:state.external!.id,allow:true}))}>打开</button></div>}
    {state.permission&&<BrowserPermissionBar key={state.permission.id} prompt={state.permission} onResolve={async allow=>{await rpc.browser.respondPermission({taskId,id:state.permission!.id,allow});await store.refresh();}}/>}
    {find&&<div className="bw-find" role="search" aria-label="页内查找"><input ref={searchInput} aria-label="页内查找" placeholder="在页面中查找" value={query} onChange={event=>{setQuery(event.target.value);search(event.target.value);}} onKeyDown={event=>{if(event.key==='Escape')closeFind();else if(event.key==='Enter'){event.preventDefault();search(query,true,!event.shiftKey);}}}/><span className="bw-find-count" role="status" aria-live="polite">{query?(state.find.total?`第 ${state.find.active} / ${state.find.total} 个`:'无结果'):''}</span><button className="fw-icon" aria-label="上一个" disabled={!state.find.total} onClick={()=>search(query,true,false)}><ChevronUp size={15}/></button><button className="fw-icon" aria-label="下一个" disabled={!state.find.total} onClick={()=>search(query,true,true)}><ChevronDown size={15}/></button><button className="fw-icon" aria-label="关闭页内查找" onClick={closeFind}><X size={15}/></button></div>}
    {tab.loading&&!blocked&&<div className="bw-progress" role="status" aria-label="网页正在加载"/>}
    <div className={'bw-page'+(tab.agentActive&&!state.paused?' bw-agent-glow':'')} ref={viewport} data-testid="browser-viewport">
      {!invalidAddress&&tab.importState!=='importing'&&tab.importState!=='needs-attention'&&(pageImage||titleOverlay.image)&&<img className="bw-page-snapshot" src={(pageImage||titleOverlay.image)!} alt="网页预览"/>}
      {invalidAddress?<div className="bw-failure bw-invalid-address" role="alert"><AlertTriangle size={26}/><h2>{invalidMessage}</h2><p>你输入的是：<code>{invalidAddress.input}</code></p></div>:tab.importState==='importing'?<div className="bw-failure" role="status"><UserRound size={26}/><h2>正在导入登录态</h2><p>完成后将按原地址重新加载此页面。</p></div>:tab.importState==='needs-attention'?null:blank?<div className="bw-launcher" aria-label="新标签页"><section><h2>工具</h2><div className="bw-launcher-tools"><button type="button" className="bw-launcher-tool" onClick={()=>{void store.select(null);}}><Files size={17} strokeWidth={1.65}/><span>文件</span><kbd>⌘P</kbd></button></div></section><section><h2>推荐</h2>{state.recent.length?<div className="bw-launcher-sites">{state.recent.map(site=><button key={site.host} type="button" className="bw-launcher-site" title={site.title+' · '+site.host} onClick={()=>run(()=>rpc.browser.navigate({taskId,tabId,address:site.url}))}><span className="bw-launcher-icon"><Globe size={26} strokeWidth={1.4}/></span><span className="bw-launcher-name">{site.title}</span></button>)}</div>:<p className="bw-launcher-empty">本项目还没有访问记录。在上方地址栏输入网址或搜索内容，访问过的网站会出现在这里。</p>}</section></div>:state.authCancelled?<div className="bw-failure" role="alert"><KeyRound size={26}/><h2>401 · 需要认证</h2><p>你取消了 {state.authCancelled.host} 的登录。</p><button type="button" onClick={()=>run(()=>rpc.browser.retryAuthentication({taskId,tabId:state.authCancelled!.pageId}))}>重新登录</button></div>:tab.failure?<div className={'bw-failure'+(tab.certificate?.challengeId?' bw-cert':' bw-navigation-failure')} role="alert">{tab.certificate?.challengeId?<><ShieldAlert size={26}/><h2>此连接不受信任</h2><p><strong>{tab.certificate.host}</strong> 的证书不是由受信任的机构签发的（常见于内网测试环境的自签名证书）。继续访问时，你与该站点之间的通信可能被他人读取或篡改。</p><small className="bw-error-name">{tab.failure.errorName}</small><div className="bw-failure-actions"><button type="button" className="fw-pill" disabled={!tab.canGoBack} onClick={()=>action('back')}>返回</button><button type="button" className="bw-danger-link" onClick={()=>run(()=>rpc.browser.continueCertificate({taskId,tabId,challengeId:tab.certificate!.challengeId!}))}>我了解风险，继续访问</button></div><p className="bw-hint">只有你可以在这里放行；Agent 命令无法添加证书例外。例外按主机记在当前登录态中，可在登录态管理里撤销。</p></>:<>{tab.failure.kind==='offline'?<WifiOff size={26}/>:<AlertTriangle size={26}/>}<h2>{tab.failure.title}</h2>{tab.failure.kind==='not-running'?<p>请先启动这个地址的开发服务。</p>:tab.failure.kind==='refused'?<p>站点可能已停止，或者地址有误。</p>:tab.failure.kind==='dns'?<p>请检查地址拼写。</p>:null}{tab.failure.recovery&&<p className="bw-recovery"><span className="fw-loading"/>{tab.failure.recovery==='poll'?'服务启动后会自动重新加载':'网络恢复后会自动重新加载'}</p>}<small className="bw-error-name">{tab.failure.errorName}</small><div className="bw-failure-actions"><button type="button" className="fw-pill" onClick={()=>action('reload')}><RotateCw size={13}/>重试</button></div></>}</div>:null}
    </div>
    {state.javascriptDialog&&javascriptOpenId===state.javascriptDialog.id&&<BrowserJavascriptDialogView key={state.javascriptDialog.id} dialog={state.javascriptDialog} onRespond={async(accept,text)=>{await rpc.browser.respondJavascriptDialog({taskId,id:state.javascriptDialog!.id,accept,text});await store.refresh();}}/>}
    {state.auth&&authOpenId===state.auth.id&&<BrowserAuthDialog key={state.auth.id} prompt={state.auth} onRespond={async credentials=>{await rpc.browser.respondAuthentication({taskId,id:state.auth!.id,credentials});await store.refresh();}}/>}
    {profileRecords&&<BrowserProfileSiteStates taskId={taskId} tabId={tabId} taskTitle={tasksStore.current?.title} currentProfile={tab.profileId} initial={profileRecords} initialImport={initialImport} onClose={closeSettings}/>}
    {preferences&&<BrowserSettingsDialog taskId={taskId} initial={preferences} onClose={closeSettings}/>}
    <BrowserAccessSurface ready={accessReady}/>
  </div>;
}
