import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserCdpProxy } from './cdp-proxy';
import { BrowserHelper, type BrowserHelperOptions } from './agent-browser';
import { BrowserReferences } from './references';
import { BrowserPageQueue } from './queue';
import { BrowserParkWindow } from './park-window';
import { browserDigest } from './artifacts';
import { BrowserError } from './errors';

export interface BrowserPage {
  id:string;short:string;taskId:string;projectId:string;profileId:string;view:WebContentsView;
  proxy:BrowserCdpProxy;helper:BrowserHelper;references:BrowserReferences;queue:BrowserPageQueue;
  rect:Rectangle;closed:boolean;abort:AbortController;hostNavigation:string|null;
}
export class BrowserPageRegistry {
  private readonly pages=new Map<string,BrowserPage>();
  private readonly active=new Map<string,string>();
  private readonly park=new BrowserParkWindow();
  private ordinal=0;
  private mounted?:BrowserPage;
  constructor(private readonly options:{userData:string;helper:Pick<BrowserHelperOptions,'executable'|'sha256'|'processes'>;window?:()=>BrowserWindow|null}){}
  list(taskId:string){return [...this.pages.values()].filter(page=>page.taskId===taskId&&!page.closed);}
  get(taskId:string,id?:string):BrowserPage {
    const page=this.pages.get(id??this.active.get(taskId)??'');
    if(!page||page.closed||page.view.webContents.isDestroyed()||page.taskId!==taskId)throw new BrowserError(id?'BROWSER_TAB_NOT_FOUND':'BROWSER_NO_TAB','本任务没有这个网页标签');
    return page;
  }
  async create(taskId:string,projectId:string):Promise<BrowserPage>{
    const id=randomUUID(),short='k'+(++this.ordinal).toString(36),profileId='project-'+browserDigest(projectId).slice(0,24);
    const view=new WebContentsView({webPreferences:{partition:'persist:wy-browser-'+profileId,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const proxy=new BrowserCdpProxy(view.webContents),references=new BrowserReferences(proxy,short);
    const page:BrowserPage={id,short,taskId,projectId,profileId,view,proxy,references,helper:undefined!,queue:new BrowserPageQueue(),rect:{x:0,y:0,width:1000,height:700},closed:false,abort:new AbortController(),hostNavigation:null};
    view.webContents.setWindowOpenHandler(()=>({action:'deny'})); // Popup UI/lifecycle is implemented in S2.
    const denyUnsafeNavigation=(event:Electron.Event,url:string)=>{
      try{const protocol=new URL(url).protocol;if(!['http:','https:','about:'].includes(protocol)&&url!==page.hostNavigation)event.preventDefault();}catch{event.preventDefault();}
    };
    view.webContents.on('will-navigate',denyUnsafeNavigation);
    view.webContents.on('will-redirect',denyUnsafeNavigation);
    try {
      await this.park.park(view,page.rect);
      await view.webContents.loadURL('about:blank');
      await proxy.start();await references.initialize();
      page.helper=new BrowserHelper({...this.options.helper,home:join(this.options.userData,'browser/agent-browser-home',id),
        // Darwin Unix-domain sockets have a short pathname limit. The home remains under userData.
        sockets:join('/private/tmp','wy-ab-'+browserDigest(this.options.userData+id).slice(0,24)),session:'wy-'+short,endpoint:proxy.endpoint},()=>references.invalidate());
      this.pages.set(id,page);if(!this.active.has(taskId))this.active.set(taskId,id);
      return page;
    }catch(error){await proxy.stop();this.park.remove(view);view.webContents.close();throw error;}
  }
  async navigate(page:BrowserPage,url:string):Promise<void>{
    let normalized:string;
    try{const parsed=new URL(url);if(!['http:','https:','file:','about:'].includes(parsed.protocol)||parsed.protocol==='about:'&&url!=='about:blank')throw Error();normalized=parsed.href;}catch{throw new BrowserError('BROWSER_ERROR','请输入有效的 http(s)、file 或 about:blank 地址');}
    page.references.invalidate();page.hostNavigation=normalized;
    try{await page.view.webContents.loadURL(normalized);}finally{page.hostNavigation=null;}
  }
  async placement(taskId:string,pageId:string,rect:Rectangle|null):Promise<void>{
    const page=this.get(taskId,pageId),window=this.options.window?.();
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
  }
  activate(taskId:string,pageId:string):void{this.get(taskId,pageId);this.active.set(taskId,pageId);}
  async close(taskId:string,pageId:string):Promise<void>{
    const page=this.get(taskId,pageId);page.closed=true;page.queue.close();page.abort.abort(new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭'));
    await page.helper.close();await page.queue.settled();await page.proxy.stop();
    const window=this.options.window?.();if(this.mounted===page&&window&&!window.isDestroyed()){window.contentView.removeChildView(page.view);this.mounted=undefined;}
    this.park.remove(page.view);page.view.webContents.close();this.pages.delete(pageId);
    if(this.active.get(taskId)===pageId){const next=this.list(taskId)[0];if(next)this.active.set(taskId,next.id);else this.active.delete(taskId);}
  }
  async dispose():Promise<void>{for(const page of [...this.pages.values()])await this.close(page.taskId,page.id);this.park.dispose();}
}
