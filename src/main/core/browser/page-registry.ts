import { BaseWindow, WebContentsView, type BrowserWindow, type Rectangle, type WebContents, type BrowserWindowConstructorOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserCdpProxy } from './cdp-proxy';
import { BrowserHelper, type BrowserHelperOptions } from './agent-browser';
import { BrowserReferences } from './references';
import { BrowserPageQueue } from './queue';
import { BrowserParkWindow } from './park-window';
import { browserDigest } from './artifacts';
import { BrowserError } from './errors';
import {browserProjectProfile,type BrowserProfiles} from './profiles';
import {awaitBrowserNavigation} from './navigation-wait';
export {browserProjectProfile} from './profiles';

export interface BrowserPage {
  id:string;short:string;taskId:string;projectId:string;profileId:string;view:WebContentsView;contents:WebContents;
  proxy:BrowserCdpProxy;helper:BrowserHelper;references:BrowserReferences;queue:BrowserPageQueue;
  rect:Rectangle;closed:boolean;abort:AbortController;hostNavigation:string|null;importPaused?:boolean;
  kind:'tab'|'popup';openerPageId?:string;popupWindow?:BaseWindow;
}
type BrowserPopupOptions=BrowserWindowConstructorOptions&{webContents?:WebContents};
export type BrowserPageEvent={type:'created'|'closed';page:BrowserPage};
export class BrowserPageRegistry {
  private readonly pages=new Map<string,BrowserPage>();
  private readonly active=new Map<string,string>();
  private readonly park=new BrowserParkWindow();
  private mounted?:BrowserPage;
  private readonly observers=new Set<(event:BrowserPageEvent)=>void>();
  private readonly closing=new Map<string,Promise<void>>();
  private readonly navigationRequests=new WeakMap<BrowserPage,object>();
  private readonly initializing=new Map<WebContents,{profileId:string;settled:Promise<void>;finish:()=>void}>();
  constructor(private readonly options:{userData:string;helper:Pick<BrowserHelperOptions,'executable'|'sha256'|'processes'>;window?:()=>BrowserWindow|null;profiles?:BrowserProfiles;configure?:(page:BrowserPage)=>void}){}
  observe(listener:(event:BrowserPageEvent)=>void):()=>void{this.observers.add(listener);return()=>{this.observers.delete(listener);};}
  private publish(type:BrowserPageEvent['type'],page:BrowserPage){for(const listener of this.observers)listener({type,page});}
  list(taskId:string){return [...this.pages.values()].filter(page=>page.taskId===taskId&&!page.closed);}
  all(){return[...this.pages.values()].filter(page=>!page.closed);}
  private trackInitialization(contents:WebContents,profileId:string):()=>void{
    let finish!:()=>void;const settled=new Promise<void>(resolve=>{finish=resolve;});this.initializing.set(contents,{profileId,settled,finish});
    return()=>{this.initializing.delete(contents);finish();};
  }
  /** Called only with the profile lifecycle lock held. Closing unpublished
   * contents prevents a late popup/create from writing after a data clear. */
  async cancelProfileInitializations(profileId:string):Promise<void>{
    const pending=[...this.initializing].filter(([,entry])=>entry.profileId===profileId);
    for(const[contents]of pending)if(!contents.isDestroyed())contents.close();
    await Promise.all(pending.map(([,entry])=>entry.settled));
  }
  get(taskId:string,id?:string):BrowserPage {
    const page=this.pages.get(id??this.active.get(taskId)??'');
    if(!page||page.closed||page.contents.isDestroyed()||page.taskId!==taskId)throw new BrowserError(id?'BROWSER_TAB_NOT_FOUND':'BROWSER_NO_TAB','本任务没有这个网页标签');
    return page;
  }
  async create(taskId:string,projectId:string,savedId?:string,requestedProfile?:string):Promise<BrowserPage>{
    // A restored persistent page ID still needs a fresh reference scope. Counters
    // alone repeat after restart and can turn an old ref into a valid new ref.
    const id=savedId??randomUUID(),short='k'+randomUUID().replaceAll('-','');
    const defaultProfile=this.options.profiles?.ensureProject(projectId),profileId=requestedProfile??defaultProfile?.id??browserProjectProfile(projectId);
    if(requestedProfile&&requestedProfile!==browserProjectProfile(projectId)&&!this.options.profiles)throw new BrowserError('BROWSER_UNAVAILABLE','登录态注册表尚未就绪');
    const profile=this.options.profiles?.require({taskId,projectId},profileId),partition=profile?.partition??'persist:wy-browser-'+profileId;
    this.options.profiles?.assertAvailable(profileId);
    if(this.pages.has(id))throw new BrowserError('BROWSER_ERROR','网页身份已经存在');
    const view=new WebContentsView({webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const initialized=this.trackInitialization(view.webContents,profileId);
    const proxy=new BrowserCdpProxy(view.webContents),references=new BrowserReferences(proxy,short);
    const page:BrowserPage={id,short,taskId,projectId,profileId,view,contents:view.webContents,proxy,references,helper:undefined!,queue:new BrowserPageQueue(),rect:{x:0,y:0,width:1000,height:700},closed:false,abort:new AbortController(),hostNavigation:null,kind:'tab'};
    view.webContents.setWindowOpenHandler(()=>({action:'deny'})); // Popup UI/lifecycle is implemented in S2.
    const denyUnsafeNavigation=(event:Electron.Event,url:string)=>{
      try{const protocol=new URL(url).protocol;if(protocol==='javascript:')return;const localLink=protocol==='file:'&&view.webContents.getURL().startsWith('file:');if(!['http:','https:','about:'].includes(protocol)&&url!==page.hostNavigation&&!localLink)event.preventDefault();}catch{event.preventDefault();}
    };
    view.webContents.on('will-navigate',denyUnsafeNavigation);
    view.webContents.on('will-redirect',(event,url)=>{if(url.startsWith('file:'))event.preventDefault();else denyUnsafeNavigation(event,url);});
    try {
      this.options.configure?.(page);
      await this.park.park(view,page.rect);
      await view.webContents.loadURL('about:blank');
      await proxy.start();await references.initialize();
      page.helper=new BrowserHelper({...this.options.helper,home:join(this.options.userData,'browser/agent-browser-home',id),
        // Darwin Unix-domain sockets have a short pathname limit. The home remains under userData.
        sockets:join('/private/tmp','wy-ab-'+browserDigest(this.options.userData+id).slice(0,24)),session:'wy-'+short,endpoint:proxy.endpoint},()=>references.invalidate());
      this.options.profiles?.assertAvailable(profileId);
      this.pages.set(id,page);if(!this.active.has(taskId))this.active.set(taskId,id);
      this.publish('created',page);
      return page;
    }catch(error){await proxy.stop();this.park.remove(view);if(!view.webContents.isDestroyed())view.webContents.close();throw error;}finally{initialized();}
  }
  /** Electron binds the opener to the returned WebContents. The child uses its
   * own native window and the opener's exact session, never an App preload. */
  createPopup(opener:BrowserPage,options:BrowserPopupOptions,asTab=false):WebContents{
    this.options.profiles?.assertAvailable(opener.profileId);
    const id=randomUUID(),short='k'+randomUUID().replaceAll('-','');
    // Adopt Electron's supplied contents to preserve the native opener identity.
    const view=new WebContentsView({...(options.webContents===undefined?{}:{webContents:options.webContents}),webPreferences:{...options.webPreferences,session:opener.contents.session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
    const contents=view.webContents;
    const initialized=this.trackInitialization(contents,opener.profileId);
    const window=asTab?undefined:new BaseWindow({width:Math.max(320,Math.min(options.width??800,1400)),height:Math.max(240,Math.min(options.height??600,1000)),show:false,title:'WillYou · 网页登录'});
    const bounds=window?.getContentBounds()??{width:1000,height:700};window?.contentView.addChildView(view);view.setBounds({x:0,y:0,width:bounds.width,height:bounds.height});
    const proxy=new BrowserCdpProxy(contents),references=new BrowserReferences(proxy,short);
    const page:BrowserPage={id,short,taskId:opener.taskId,projectId:opener.projectId,profileId:opener.profileId,view,contents,proxy,references,helper:undefined!,queue:new BrowserPageQueue(),rect:{x:0,y:0,width:bounds.width,height:bounds.height},closed:false,abort:new AbortController(),hostNavigation:null,kind:asTab?'tab':'popup',openerPageId:opener.id,popupWindow:window};
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    const guard=(event:Electron.Event,url:string)=>{try{if(!['http:','https:','about:','javascript:'].includes(new URL(url).protocol))event.preventDefault();}catch{event.preventDefault();}};
    contents.on('will-navigate',guard);contents.on('will-redirect',guard);
    window?.on('resize',()=>{if(!contents.isDestroyed()){const r=window.getContentBounds();view.setBounds({x:0,y:0,width:r.width,height:r.height});}});
    window?.on('closed',()=>{if(this.pages.has(id))void this.close(page.taskId,id);else if(!contents.isDestroyed())contents.close();});
    contents.on('destroyed',()=>{if(this.pages.has(id))void this.close(page.taskId,id);});
    void(async()=>{
      try{
        this.options.configure?.(page);
        if(asTab)await this.park.park(view,page.rect);
        await proxy.start();await references.initialize();
        if(contents.isDestroyed()||opener.closed)throw new BrowserError('BROWSER_TAB_CLOSED','来源页面已关闭');
        this.options.profiles?.assertAvailable(opener.profileId);
        page.helper=new BrowserHelper({...this.options.helper,home:join(this.options.userData,'browser/agent-browser-home',id),sockets:join('/private/tmp','wy-ab-'+browserDigest(this.options.userData+id).slice(0,24)),session:'wy-'+short,endpoint:proxy.endpoint},()=>references.invalidate());
        this.pages.set(id,page);this.publish('created',page);if(this.mounted?.taskId===page.taskId)window?.showInactive();
      }catch{await proxy.stop();this.park.remove(view);if(window&&!window.isDestroyed())window.close();if(!contents.isDestroyed())contents.close();}finally{initialized();}
    })();
    return contents;
  }
  async navigate(page:BrowserPage,url:string,signal?:AbortSignal):Promise<void>{
    this.options.profiles?.assertAvailable(page.profileId);
    await this.navigateOwned(page,url,signal);
  }
  /** Import coordinator only: keep its lifecycle lock through the reload so
   * deletion/another import cannot race the final navigation batch. */
  async resumeAfterImport(page:BrowserPage,url:string,signal:AbortSignal):Promise<void>{
    if(!page.importPaused)throw new BrowserError('BROWSER_UNAVAILABLE','网页没有待恢复的导入占位状态');
    page.abort=new AbortController();page.importPaused=false;
    await this.navigateOwned(page,url,signal);
  }
  private async navigateOwned(page:BrowserPage,url:string,signal?:AbortSignal):Promise<void>{
    const navigationSignal=signal?AbortSignal.any([page.abort.signal,signal]):page.abort.signal;
    if(navigationSignal.aborted)throw navigationSignal.reason??new BrowserError('BROWSER_TAB_CLOSED','网页已关闭');
    let normalized:string;
    try{const parsed=new URL(url);if(!['http:','https:','file:','about:'].includes(parsed.protocol)||parsed.protocol==='about:'&&url!=='about:blank')throw Error();normalized=parsed.href;}catch{throw new BrowserError('BROWSER_ERROR','请输入有效的 http(s)、file 或 about:blank 地址');}
    const request={};this.navigationRequests.set(page,request);page.references.invalidate();page.hostNavigation=normalized;
    const navigation=(async()=>{try{await page.contents.loadURL(normalized);}finally{if(this.navigationRequests.get(page)===request){this.navigationRequests.delete(page);page.hostNavigation=null;}}})();
    await awaitBrowserNavigation(navigation,navigationSignal);
  }
  async placement(taskId:string,pageId:string,rect:Rectangle|null):Promise<void>{
    const page=this.get(taskId,pageId),window=this.options.window?.();
    if(page.kind==='popup')throw new BrowserError('BROWSER_ERROR','子窗口不能挂到工作区');
    if(this.mounted&&this.mounted!==page&&window&&!window.isDestroyed()){
      window.contentView.removeChildView(this.mounted.view);await this.park.park(this.mounted.view,this.mounted.rect);this.mounted=undefined;
    }
    if(rect&&window&&!window.isDestroyed()){
      if(!Object.values(rect).every(Number.isFinite)||rect.width<1||rect.height<1)throw new BrowserError('BROWSER_ERROR','网页显示区域无效');
      this.park.remove(page.view);window.contentView.addChildView(page.view);page.rect=rect;page.view.setBounds(rect);this.mounted=page;this.active.set(taskId,pageId);
    }else{
      if(this.mounted===page&&window&&!window.isDestroyed()){window.contentView.removeChildView(page.view);this.mounted=undefined;}
      await this.park.park(page.view,page.rect);
    }
    for(const child of this.pages.values())if(child.popupWindow&&!child.popupWindow.isDestroyed()){
      if(this.mounted?.taskId===child.taskId)child.popupWindow.showInactive();else child.popupWindow.hide();
    }
  }
  activate(taskId:string,pageId:string):void{this.get(taskId,pageId);this.active.set(taskId,pageId);}
  isMounted(page:BrowserPage):boolean{return this.mounted===page;}
  close(taskId:string,pageId:string,fromPageQueue=false):Promise<void>{
    const page=this.pages.get(pageId);
    if(!page||page.taskId!==taskId)return Promise.reject(new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有这个网页标签'));
    const pending=this.closing.get(pageId);if(pending)return pending;
    const closing=this.closePage(page,fromPageQueue).finally(()=>{this.closing.delete(pageId);});this.closing.set(pageId,closing);return closing;
  }
  private async closePage(page:BrowserPage,fromPageQueue=false):Promise<void>{
    const {taskId,id:pageId}=page;page.closed=true;page.queue.close();page.abort.abort(new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭'));
    for(const child of this.list(taskId).filter(p=>p.kind==='popup'&&p.openerPageId===pageId))await this.close(taskId,child.id);
    await page.helper.close();
    // The CLI close is the current serialized item; it cannot wait for itself.
    // UI/dispose closes still wait for any active page work to finish.
    if(!fromPageQueue)await page.queue.settled();await page.proxy.stop();
    const window=this.options.window?.();if(this.mounted===page&&window&&!window.isDestroyed()){window.contentView.removeChildView(page.view);this.mounted=undefined;}
    this.park.remove(page.view);if(!page.contents.isDestroyed())page.contents.close();if(page.popupWindow&&!page.popupWindow.isDestroyed())page.popupWindow.close();this.pages.delete(pageId);this.publish('closed',page);
    if(this.active.get(taskId)===pageId){const next=this.list(taskId)[0];if(next)this.active.set(taskId,next.id);else this.active.delete(taskId);}
  }
  async dispose():Promise<void>{for(const page of [...this.pages.values()])if(this.pages.has(page.id))await this.close(page.taskId,page.id);this.park.dispose();}
}
