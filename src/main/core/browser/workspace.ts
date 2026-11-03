import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {shell} from 'electron';
import {BROWSER_BLANK_URL,describeBrowserLoadFailure,isBrowserSearchUrl,normalizeBrowserNavigationUrl,type BrowserSearchEngine} from '@shared/browser-navigation';
import {browserWorkspaceSchema,type BrowserWorkspaceState,type BrowserTabState,type SavedBrowserWorkspace,type BrowserShortcut} from '@shared/browser-workspace';
import {BrowserPageRegistry,browserProjectProfile,type BrowserPage} from './page-registry';
import {BrowserError} from './errors';
import {browserFavicon} from './favicon';

type Runtime=Pick<BrowserTabState,'loading'|'canGoBack'|'canGoForward'|'failure'>;
const idle=():Runtime=>({loading:false,canGoBack:false,canGoForward:false,failure:null});
/** UI tab state has its own database keys. Live views remain owned by the registry. */
export class BrowserWorkspace {
  private readonly tasks=new Map<string,SavedBrowserWorkspace>();
  private readonly runtime=new Map<string,Runtime>();
  private readonly opening=new Map<string,Promise<BrowserPage>>();
  private readonly closingTabs=new Set<string>();
  private readonly recovering=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly notices=new Map<string,string>();
  private readonly external=new Map<string,{id:string;url:string}>();
  private readonly unobserve:()=>void;
  private shuttingDown=false;
  private placementVersion=0;
  private readonly finds=new Map<string,{requestId:number;active:number;total:number}>();
  private reconciling?:Promise<void>;
  constructor(private readonly options:{sqlite:Database.Database;pages:BrowserPageRegistry;taskProject:(id:string)=>string|null;changed?:(taskId:string)=>void;shortcut?:(taskId:string,action:BrowserShortcut)=>void}){
    this.unobserve=options.pages.observe(event=>{
      if(event.type==='created')this.attached(event.page);
      else if(!this.shuttingDown&&event.page.kind==='tab'&&!this.closingTabs.has(event.page.id)){
        const state=this.tasks.get(event.page.taskId);if(state){state.tabs=state.tabs.filter(t=>t.id!==event.page.id);if(state.activeId===event.page.id)state.activeId=state.tabs.at(-1)?.id??null;this.save(event.page.taskId);}
      }
    });
  }
  private project(taskId:string):string{const id=this.options.taskProject(taskId);if(!id)throw new BrowserError('BROWSER_UNAVAILABLE','只有所属项目仍存在的任务可以使用网页');return id;}
  private key(taskId:string){return'browserWorkspace.v1:'+taskId;}
  private load(taskId:string):SavedBrowserWorkspace{
    this.project(taskId);let state=this.tasks.get(taskId);if(state)return state;
    const row=this.options.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(this.key(taskId)) as {value:string}|undefined;
    try{state=row?browserWorkspaceSchema.parse(JSON.parse(row.value)):{version:1,tabs:[],activeId:null,closed:[]};}
    catch{throw new BrowserError('BROWSER_ERROR','已保存的网页标签无法读取，原记录仍保留');}
    this.tasks.set(taskId,state);return state;
  }
  private save(taskId:string):void{
    if(this.shuttingDown)return;
    const state=this.tasks.get(taskId);if(!state)return;
    const value=JSON.stringify(browserWorkspaceSchema.parse(state));
    this.options.sqlite.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(this.key(taskId),value,Date.now());
    this.options.changed?.(taskId);
  }
  private changed(taskId:string):void{this.options.changed?.(taskId);}
  snapshot(taskId:string):BrowserWorkspaceState{
    const state=this.load(taskId),projectId=this.project(taskId);
    const row=this.options.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserRecent.v1:'+projectId) as {value:string}|undefined;
    let recent:BrowserWorkspaceState['recent']=[];
    if(row)try{const values:unknown=JSON.parse(row.value);if(Array.isArray(values))recent=values.filter((r):r is BrowserWorkspaceState['recent'][number]=>!!r&&typeof r==='object'&&typeof r.url==='string'&&typeof r.title==='string'&&typeof r.host==='string'&&typeof r.visitedAt==='number').slice(0,8);}catch{/* A bad recent list must not destroy valid tabs. */}
    const found=state.activeId?this.finds.get(state.activeId):undefined;
    return{taskId,projectId,tabs:state.tabs.map(tab=>({...tab,...(this.runtime.get(tab.id)??idle())})),activeId:state.activeId,recent,notice:this.notices.get(taskId)??null,external:this.external.get(taskId)??null,find:{active:found?.active??0,total:found?.total??0}};
  }
  create(taskId:string):BrowserWorkspaceState{
    const state=this.load(taskId),id=randomUUID();state.tabs.push({id,url:BROWSER_BLANK_URL,title:'新标签页',favicon:null,profileId:browserProjectProfile(this.project(taskId))});state.activeId=id;this.save(taskId);return this.snapshot(taskId);
  }
  select(taskId:string,id:string|null):BrowserWorkspaceState{
    const state=this.load(taskId);if(id&&!state.tabs.some(t=>t.id===id))throw new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有这个网页标签');
    state.activeId=id;if(id&&this.options.pages.list(taskId).some(p=>p.id===id))this.options.pages.activate(taskId,id);this.save(taskId);return this.snapshot(taskId);
  }
  private ensure(taskId:string,id:string):Promise<BrowserPage>{
    const live=this.options.pages.list(taskId).find(p=>p.id===id);if(live)return Promise.resolve(live);
    const existing=this.opening.get(id);if(existing)return existing;
    const state=this.load(taskId),tab=state.tabs.find(t=>t.id===id);if(!tab)return Promise.reject(new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有这个网页标签'));
    const promise=(async()=>{const page=await this.options.pages.create(taskId,this.project(taskId),id);if(tab.url!==BROWSER_BLANK_URL)await this.loadUrl(page,tab.url);return page;})().finally(()=>this.opening.delete(id));
    this.opening.set(id,promise);return promise;
  }
  /** Explicit Agent use of a startup tab initializes its engine lazily too. */
  async target(taskId:string,id?:string):Promise<BrowserPage>{
    const state=this.load(taskId),target=id??state.activeId;
    if(target)return this.ensure(taskId,target);
    const live=this.options.pages.list(taskId);if(live.length)return this.options.pages.get(taskId);
    const first=state.tabs[0];if(first)return this.ensure(taskId,first.id);
    throw new BrowserError('BROWSER_NO_TAB','本任务没有网页标签');
  }
  list(taskId:string){
    const state=this.load(taskId);return[...state.tabs.map(t=>({pageId:t.id,browserPageId:t.id,title:t.title,url:t.url,profileId:t.profileId,kind:'tab' as const})),...this.options.pages.list(taskId).filter(p=>p.kind==='popup').map(p=>({pageId:p.id,browserPageId:p.id,title:p.view.webContents.getTitle(),url:p.view.webContents.getURL(),profileId:p.profileId,kind:'popup' as const,openerPageId:p.openerPageId}))];
  }
  async navigate(taskId:string,id:string,address:string,engine:BrowserSearchEngine='bing'):Promise<BrowserWorkspaceState>{
    const url=normalizeBrowserNavigationUrl(address,engine);if(url===null){this.notices.set(taskId,'请输入有效的 http(s) 或 localhost 地址');this.changed(taskId);return this.snapshot(taskId);}
    this.notices.delete(taskId);const state=this.load(taskId),tab=state.tabs.find(t=>t.id===id);if(!tab)throw new BrowserError('BROWSER_TAB_NOT_FOUND','网页标签已关闭');
    if(url===BROWSER_BLANK_URL){const live=this.options.pages.list(taskId).find(p=>p.id===id);if(live){this.closingTabs.add(id);try{await this.options.pages.close(taskId,id);}finally{this.closingTabs.delete(id);}}tab.url=url;tab.title='新标签页';tab.favicon=null;this.runtime.delete(id);this.save(taskId);}
    else{const page=await this.ensure(taskId,id);await this.loadUrl(page,url);}
    return this.snapshot(taskId);
  }
  private async loadUrl(page:BrowserPage,url:string):Promise<void>{
    this.cancelRecovery(page.id);const run=this.runtime.get(page.id)??idle();run.failure=null;this.runtime.set(page.id,run);
    try{await this.options.pages.navigate(page,url);}catch(error){if(page.closed)return;const message=error instanceof Error?error.message:String(error);if(!run.failure&&!message.includes('ERR_ABORTED')){run.failure=describeBrowserLoadFailure(-2,'ERR_FAILED',url);this.changed(page.taskId);}}
  }
  async action(taskId:string,id:string,action:'reload'|'hard-reload'|'stop'|'back'|'forward'|'focus'):Promise<void>{
    const page=await this.target(taskId,id),wc=page.view.webContents;
    if(action==='focus'){wc.focus();return;}if(action==='stop'){wc.stop();this.cancelRecovery(id);return;}
    const failure=this.runtime.get(id)?.failure;
    if(failure&&(action==='reload'||action==='hard-reload')){await this.loadUrl(page,failure.url);return;}
    if(action==='reload')wc.reload();else if(action==='hard-reload')wc.reloadIgnoringCache();
    else if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();else if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();
  }
  async placement(taskId:string,id:string,rect:Electron.Rectangle|null):Promise<void>{
    const version=++this.placementVersion;
    // Unmount remains possible after project deletion, before UI unmount finishes.
    if(rect===null){const live=this.options.pages.list(taskId).find(p=>p.id===id);if(live)await this.options.pages.placement(taskId,id,null);return;}
    const tab=this.load(taskId).tabs.find(t=>t.id===id);if(!tab||tab.url===BROWSER_BLANK_URL||this.runtime.get(id)?.failure)return;
    const page=await this.ensure(taskId,id);if(version!==this.placementVersion)return;await this.options.pages.placement(taskId,page.id,rect);
  }
  async find(taskId:string,id:string,text:string,forward:boolean,next:boolean){
    this.load(taskId);const page=this.options.pages.list(taskId).find(p=>p.id===id);if(!page){this.finds.delete(id);this.changed(taskId);return;}const wc=page.view.webContents;
    if(!text){wc.stopFindInPage('clearSelection');this.finds.delete(id);this.changed(taskId);return;}
    const requestId=wc.findInPage(text,{forward,findNext:next});this.finds.set(id,{requestId,active:0,total:0});
  }
  async close(taskId:string,id:string):Promise<BrowserWorkspaceState>{
    const state=this.load(taskId),tab=state.tabs.find(t=>t.id===id);if(!tab)return this.snapshot(taskId);
    this.cancelRecovery(id);const pending=this.opening.get(id);if(pending&&!this.options.pages.list(taskId).some(p=>p.id===id))await pending;
    this.closingTabs.add(id);try{if(this.options.pages.list(taskId).some(p=>p.id===id))await this.options.pages.close(taskId,id);}finally{this.closingTabs.delete(id);}
    state.closed=[...state.closed,tab].slice(-10);state.tabs=state.tabs.filter(t=>t.id!==id);if(state.activeId===id)state.activeId=state.tabs.at(-1)?.id??null;this.runtime.delete(id);this.save(taskId);return this.snapshot(taskId);
  }
  reopen(taskId:string):BrowserWorkspaceState{const state=this.load(taskId),old=state.closed.pop();if(old){const tab={...old,id:randomUUID()};state.tabs.push(tab);state.activeId=tab.id;this.save(taskId);}return this.snapshot(taskId);}
  async confirmExternal(taskId:string,id:string,allow:boolean):Promise<void>{const request=this.external.get(taskId);if(!request||request.id!==id)throw new BrowserError('BROWSER_ERROR','外部应用请求已失效');this.project(taskId);this.external.delete(taskId);this.changed(taskId);if(allow)await shell.openExternal(request.url);}
  private cancelRecovery(id:string){const timer=this.recovering.get(id);if(timer)clearTimeout(timer);this.recovering.delete(id);}
  private scheduleRecovery(page:BrowserPage){
    this.cancelRecovery(page.id);const failure=this.runtime.get(page.id)?.failure;if(!failure||!failure.recovery||this.shuttingDown)return;
    const timer=setTimeout(()=>{this.recovering.delete(page.id);if(!page.closed&&!this.shuttingDown)void this.loadUrl(page,failure.url);},failure.recovery==='poll'?2000:5000);timer.unref();this.recovering.set(page.id,timer);
  }
  private attached(page:BrowserPage){
    const state=this.load(page.taskId),wc=page.view.webContents;
    if(page.kind==='tab'&&!state.tabs.some(t=>t.id===page.id)){state.tabs.push({id:page.id,url:wc.getURL()||BROWSER_BLANK_URL,title:wc.getTitle()||'新标签页',favicon:null,profileId:page.profileId});if(page.openerPageId)state.activeId=page.id;this.save(page.taskId);}
    const runtime=idle();this.runtime.set(page.id,runtime);
    const update=()=>{if(page.closed||wc.isDestroyed()||this.shuttingDown)return;runtime.loading=wc.isLoading();runtime.canGoBack=wc.navigationHistory.canGoBack();runtime.canGoForward=wc.navigationHistory.canGoForward();this.changed(page.taskId);};
    wc.on('did-start-loading',update);wc.on('did-stop-loading',update);
    wc.on('found-in-page',(_event,result)=>{const query=this.finds.get(page.id);if(query?.requestId===result.requestId){query.active=result.activeMatchOrdinal;query.total=result.matches;this.changed(page.taskId);}});
    const committed=()=>{
      if(page.closed||wc.isDestroyed())return;runtime.failure=null;this.cancelRecovery(page.id);
      const tab=state.tabs.find(t=>t.id===page.id);if(tab){tab.url=wc.getURL();tab.title=wc.getTitle()||tab.url;this.save(page.taskId);this.remember(page.taskId,tab.url,tab.title);}update();
    };
    wc.on('did-navigate',committed);wc.on('did-navigate-in-page',(_event,_url,main)=>{if(main)committed();});
    wc.on('page-title-updated',(_event,title)=>{const tab=state.tabs.find(t=>t.id===page.id);if(tab){tab.title=title;this.save(page.taskId);}});
    let faviconGeneration=0;
    wc.on('page-favicon-updated',(_event,urls)=>{const generation=++faviconGeneration,url=urls.find(url=>/^https?:/.test(url));const tab=state.tabs.find(t=>t.id===page.id);if(!tab)return;if(!url){tab.favicon=null;this.save(page.taskId);return;}void browserFavicon(wc.session,url,page.abort.signal).then(icon=>{if(!page.closed&&!this.shuttingDown&&generation===faviconGeneration&&state.tabs.includes(tab)){tab.favicon=icon;this.save(page.taskId);}});});
    wc.on('did-fail-load',(_event,code,description,url,main)=>{if(!main||code===-3||page.closed)return;runtime.loading=false;runtime.failure=describeBrowserLoadFailure(code,description,url);this.changed(page.taskId);this.scheduleRecovery(page);});
    let gesture=0,burstAt=0,burst=0;
    wc.on('before-mouse-event',(_event,input)=>{if(input.type==='mouseDown')gesture=Date.now();});
    wc.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown')return;gesture=Date.now();if(!(input.meta||input.control)||input.alt)return;
      const key=input.key.toLowerCase(),action:BrowserShortcut|undefined=key==='b'&&input.shift?'new':key==='r'?(input.shift?'hard-reload':'reload'):key==='w'?'close':key==='t'?(input.shift?'reopen':'new'):key==='f'?'find':key==='l'?'address':key==='['?'back':key===']'?'forward':undefined;
      if(action){event.preventDefault();this.options.shortcut?.(page.taskId,action);}
    });
    const external=(event:Electron.Event,url:string)=>{try{const protocol=new URL(url).protocol;if(!['http:','https:','file:','about:','javascript:','data:'].includes(protocol)){event.preventDefault();this.external.set(page.taskId,{id:randomUUID(),url});this.changed(page.taskId);}}catch{event.preventDefault();}};
    wc.on('will-navigate',external);wc.on('will-redirect',external);
    wc.setWindowOpenHandler(details=>{
      const url=normalizeBrowserNavigationUrl(details.url);if(!url){try{external({preventDefault(){}} as Electron.Event,details.url);}catch{}return{action:'deny'};}
      const now=Date.now(),userGesture=now-gesture<=500;gesture=0;if(now-burstAt>1000){burstAt=now;burst=0;}if(!userGesture&&++burst>5){this.notices.set(page.taskId,'页面打开了过多新标签，已阻止后续弹窗');this.changed(page.taskId);return{action:'deny'};}
      if(url.startsWith('file:')&&!wc.getURL().startsWith('file:'))return{action:'deny'};
      if(details.frameName&&details.frameName!=='_blank')return{action:'allow',createWindow:options=>this.options.pages.createPopup(page,options)};
      return{action:'allow',outlivesOpener:true,createWindow:options=>this.options.pages.createPopup(page,options,true)};
    });
    update();
  }
  private remember(taskId:string,url:string,title:string){
    if(isBrowserSearchUrl(url))return;let host:string;try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))return;host=parsed.host;}catch{return;}
    const state=this.snapshot(taskId),recent=[{url,title,host,visitedAt:Date.now()},...state.recent.filter(r=>r.host!==host)].slice(0,8);
    this.options.sqlite.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run('browserRecent.v1:'+state.projectId,JSON.stringify(recent),Date.now());
    for(const id of this.tasks.keys())if(this.options.taskProject(id)===state.projectId)this.changed(id);
  }
  reconcile():Promise<void>{
    if(this.reconciling)return this.reconciling;
    this.reconciling=(async()=>{for(const taskId of this.tasks.keys())if(!this.options.taskProject(taskId)){
      for(const page of this.options.pages.list(taskId))if(this.options.pages.list(taskId).some(p=>p.id===page.id)){this.cancelRecovery(page.id);await this.options.pages.close(taskId,page.id);this.runtime.delete(page.id);}
      this.tasks.delete(taskId);this.external.delete(taskId);this.notices.delete(taskId);this.options.sqlite.prepare('DELETE FROM app_settings WHERE key=?').run(this.key(taskId));this.changed(taskId);
    }})().finally(()=>{this.reconciling=undefined;});return this.reconciling;
  }
  async dispose(){this.shuttingDown=true;this.unobserve();for(const id of this.recovering.keys())this.cancelRecovery(id);await this.reconciling;}
}
