import {claimNativeFront,refreshNativeFront,releaseNativeFront} from '@main/app/window-host';
import type { BaseWindow, WebContentsView, WebContents, Rectangle } from 'electron';
import { BrowserError } from './errors';

export type NativeHostVisibility='visible'|'hidden'|'minimized'|'temporary';
export function nativeHostVisibility(window?:BaseWindow|null):NativeHostVisibility{
  if(!window||window.isDestroyed())return 'visible';
  if(window.isMinimized())return 'minimized';
  return window.isVisible()?'visible':'hidden';
}

type OwnedView={primary:BaseWindow;window:BaseWindow;contents:WebContents;holds:Set<symbol>;foreground:boolean;appliedBounds?:Rectangle;desiredBounds?:Rectangle};
type TemporaryHost={primary:BaseWindow;window:BaseWindow};
export type TemporaryPaintHostFactory=(primary:BaseWindow,viewport:Rectangle)=>BaseWindow|Promise<BaseWindow>;

/** Ordinary tabs use the AppShell host. On macOS a genuinely minimized root
 * cannot create a cold compositor surface; a temporary, non-interactive paint
 * host owns only those cold views until the original root can present them. */
export class BrowserParkWindow {
  private readonly owned=new Map<WebContentsView,OwnedView>();
  private readonly presentationListeners=new Map<BaseWindow,()=>void>();
  private temporary?:TemporaryHost;
  private temporaryCreating?:{primary:BaseWindow;promise:Promise<BaseWindow>};
  private temporaryReservations=0;
  constructor(private readonly host?:()=>BaseWindow|null,private readonly ensureHost?:()=>Promise<BaseWindow>,private readonly createTemporary?:TemporaryPaintHostFactory){}
  private applyBounds(view:WebContentsView,entry:OwnedView,rect:Rectangle):void{
    entry.desiredBounds={...rect};
    // Chromium on macOS can stop delivering new compositor surfaces if an
    // already-sized view is resized while its native parent is not presented.
    // Keep its last usable native viewport for background work; the hidden
    // shell layout is only a desired rectangle until native presentation.
    if(entry.appliedBounds&&(entry.window!==entry.primary||nativeHostVisibility(entry.window)!=='visible'))return;
    const actual=entry.window===entry.primary?rect:{...rect,x:0,y:0};
    const prior=entry.appliedBounds;
    if(prior&&prior.x===actual.x&&prior.y===actual.y&&prior.width===actual.width&&prior.height===actual.height)return;
    view.setBounds(actual);entry.appliedBounds={...actual};
  }
  private closeTemporaryIfEmpty():void{
    const active=this.temporary;if(!active||this.temporaryReservations||[...this.owned.values()].some(entry=>entry.window===active.window))return;
    this.temporary=undefined;
    if(!active.window.isDestroyed())active.window.close();
  }
  private async temporaryFor(primary:BaseWindow,rect:Rectangle):Promise<BaseWindow>{
    if(this.temporary&&!this.temporary.window.isDestroyed()){
      if(this.temporary.primary!==primary)throw new BrowserError('BROWSER_UNAVAILABLE','旧浏览器绘制宿主尚未收尾');
      return this.temporary.window;
    }
    if(this.temporaryCreating){if(this.temporaryCreating.primary!==primary)throw new BrowserError('BROWSER_UNAVAILABLE','旧浏览器绘制宿主尚未收尾');return this.temporaryCreating.promise;}
    const promise=(async()=>{
      const window=await this.createTemporary!(primary,rect);if(window===primary)return primary;
      this.temporary={primary,window};
      window.once('closed',()=>{
        if(this.temporary?.window!==window)return;
        this.temporary=undefined;
        // Native host loss retires its exact live contents; do not fabricate
        // a replacement document or leave an orphan attached to a dead host.
        for(const [view,entry] of [...this.owned])if(entry.window===window){this.remove(view);if(!entry.contents.isDestroyed())entry.contents.close({waitForBeforeUnload:false});}
      });
      return window;
    })();this.temporaryCreating={primary,promise};
    try{return await promise;}finally{if(this.temporaryCreating?.promise===promise)this.temporaryCreating=undefined;}
  }
  private migrateIfPresentable(view:WebContentsView,entry:OwnedView):void{
    if(entry.window===entry.primary||entry.holds.size||entry.contents.isDestroyed()||entry.primary.isDestroyed()||nativeHostVisibility(entry.primary)!=='visible')return;
    const old=entry.window;
    if(old.isDestroyed())return;
    if(old.contentView.children.includes(view))old.contentView.removeChildView(view);
    entry.window=entry.primary;entry.appliedBounds=undefined;
    entry.primary.contentView.addChildView(view,0);
    if(entry.desiredBounds)this.applyBounds(view,entry,entry.desiredBounds);
    view.setVisible(entry.foreground||entry.holds.size>0);
    refreshNativeFront(entry.primary,view);
    this.closeTemporaryIfEmpty();
  }
  private watchPresentation(window:BaseWindow):void{
    if(this.presentationListeners.has(window))return;
    const flush=()=>{
      if(nativeHostVisibility(window)!=='visible'||window.isDestroyed())return;
      for(const [view,entry] of this.owned)if(entry.primary===window&&!entry.contents.isDestroyed()){
        this.migrateIfPresentable(view,entry);
        if(entry.window===window&&entry.desiredBounds)this.applyBounds(view,entry,entry.desiredBounds);
      }
    };
    const onClosed=()=>{
      detach();
      for(const [view,entry] of [...this.owned])if(entry.primary===window&&entry.window!==window){this.remove(view);if(!entry.contents.isDestroyed())entry.contents.close({waitForBeforeUnload:false});}
    };
    const detach=()=>{window.removeListener('show',flush);window.removeListener('restore',flush);window.removeListener('focus',flush);window.removeListener('closed',onClosed);this.presentationListeners.delete(window);};
    window.on('show',flush);window.on('restore',flush);window.on('focus',flush);window.once('closed',onClosed);
    this.presentationListeners.set(window,detach);
  }
  async ensure():Promise<BaseWindow>{
    const window=this.ensureHost?await this.ensureHost():this.host?.();
    if(!window||window.isDestroyed())throw new BrowserError('BROWSER_UNAVAILABLE','浏览器主宿主尚未就绪');
    return window;
  }
  async park(view:WebContentsView,rect:Rectangle):Promise<void>{
    let entry=this.owned.get(view);
    const primary=entry?.primary??await this.ensure();
    // After a native destroyed event Electron clears the view's getter, while
    // the original WebContents still answers isDestroyed(). Retain that identity.
    const contents=entry?.contents??view.webContents;
    if(!contents||contents.isDestroyed()||primary.isDestroyed()||entry?.window.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭');
    if(!entry){
      const needsTemporary=!!this.createTemporary&&nativeHostVisibility(primary)==='minimized';
      if(needsTemporary)this.temporaryReservations++;
      try{
        const prepared=needsTemporary?await this.temporaryFor(primary,rect):primary;
        if(contents.isDestroyed()||primary.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭');
        const window=primary.isMinimized()?prepared:primary;
        if(window.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭');
        entry={primary,window,contents,holds:new Set(),foreground:false};this.owned.set(view,entry);this.watchPresentation(primary);
      }finally{
        if(needsTemporary)this.temporaryReservations--;
        this.closeTemporaryIfEmpty();
      }
    }
    releaseNativeFront(primary,view);entry.foreground=false;
    this.migrateIfPresentable(view,entry);
    entry.window.contentView.addChildView(view,0);
    this.applyBounds(view,entry,{x:0,y:0,width:Math.max(1,rect.width),height:Math.max(1,rect.height)});
    view.setVisible(entry.holds.size>0);
  }
  foreground(view:WebContentsView,rect:Rectangle):void{
    const entry=this.owned.get(view);
    if(!entry||entry.primary.isDestroyed()||entry.window.isDestroyed()||entry.contents.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭');
    this.applyBounds(view,entry,rect);
    this.migrateIfPresentable(view,entry);
    claimNativeFront(entry.primary,view,()=>{entry.foreground=false;if(entry.window.isDestroyed()||entry.contents.isDestroyed())return;entry.window.contentView.addChildView(view,0);view.setVisible(entry.holds.size>0);},()=>{entry.foreground=true;this.applyBounds(view,entry,rect);view.setVisible(true);},()=>entry.window===entry.primary);
  }
  acquire(view:WebContentsView):()=>void{
    const entry=this.owned.get(view);
    // A native login popup owns its own foreground surface.
    if(!entry)return()=>{};
    if(entry.window.isDestroyed()||entry.contents.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','网页已经关闭');
    const token=Symbol();entry.holds.add(token);view.setVisible(true);
    return()=>{if(this.owned.get(view)!==entry||!entry.holds.delete(token)||entry.contents.isDestroyed())return;view.setVisible(entry.foreground||entry.holds.size>0);this.migrateIfPresentable(view,entry);};
  }
  demoteAll():void{
    for(const [view,entry] of this.owned){if(entry.contents.isDestroyed()||entry.window.isDestroyed())continue;entry.foreground=false;entry.window.contentView.addChildView(view,0);view.setVisible(entry.holds.size>0);}
  }
  isForeground(view:WebContentsView):boolean{return this.owned.get(view)?.foreground===true;}
  hostVisibility(view:WebContentsView):NativeHostVisibility{const entry=this.owned.get(view);return entry&&entry.window!==entry.primary?'temporary':nativeHostVisibility(entry?.window);}
  remove(view:WebContentsView):void{
    const entry=this.owned.get(view);if(!entry)return;releaseNativeFront(entry.primary,view);this.owned.delete(view);
    if(!entry.window.isDestroyed()&&entry.window.contentView.children.includes(view))entry.window.contentView.removeChildView(view);
    if(![...this.owned.values()].some(candidate=>candidate.primary===entry.primary))this.presentationListeners.get(entry.primary)?.();
    this.closeTemporaryIfEmpty();
  }
  dispose():void{for(const view of this.owned.keys())this.remove(view);this.closeTemporaryIfEmpty();}
}
