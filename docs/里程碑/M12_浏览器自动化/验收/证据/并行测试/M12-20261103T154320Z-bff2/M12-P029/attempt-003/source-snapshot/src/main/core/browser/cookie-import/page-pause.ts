import type {Session} from 'electron';
import {ApplicationError} from '@shared/applications';
import type {BrowserProfile} from '@shared/browser-profiles';
import type {BrowserPage,BrowserPageRegistry} from '../page-registry';
import {awaitBrowserNavigation} from '../navigation-wait';

/** Keeps native WebContents/opener identity while replacing every document.
 * The coordinator installs the profile network gate before invoking hold(). */
export class BrowserImportPagePause {
  private readonly saved=new Map<string,Map<BrowserPage,string>>();
  constructor(private readonly options:{pages:BrowserPageRegistry;session:(profile:BrowserProfile)=>Session;address:(page:BrowserPage)=>string;changed:(taskId:string)=>void}){}
  async hold(profile:BrowserProfile):Promise<void>{
    const pages=this.options.pages,partition=this.options.session(profile);
    await awaitBrowserNavigation(pages.cancelProfileInitializations(profile.id),AbortSignal.timeout(10000));
    let saved=this.saved.get(profile.id);if(!saved){saved=new Map();this.saved.set(profile.id,saved);}
    const targets=pages.all().filter(page=>page.profileId===profile.id);
    for(const page of targets){
      if(!saved.has(page))saved.set(page,this.options.address(page));
      page.importPaused=true;page.references.invalidate();
      const error=new ApplicationError('BROWSER_UNAVAILABLE','正在导入或恢复登录态');
      page.abort.abort(error);page.queue.cancelQueued(error);page.contents.stop();this.options.changed(page.taskId);
    }
    await awaitBrowserNavigation(partition.closeAllConnections(),AbortSignal.timeout(10000));
    // End old script execution before unloading, including a page stuck in JS.
    // Failure is fail-closed: no snapshot/journal/native write may follow it.
    for(const page of targets){
      if(page.closed||page.contents.isDestroyed())continue;
      await awaitBrowserNavigation(page.proxy.send('Runtime.terminateExecution'),AbortSignal.timeout(5000));
      await page.helper.close();await awaitBrowserNavigation(page.queue.settled(),AbortSignal.timeout(10000));
      if(page.closed||page.contents.isDestroyed())continue;
      await awaitBrowserNavigation(page.contents.loadURL('about:blank'),AbortSignal.timeout(10000));
      if(page.contents.getURL()!=='about:blank')throw new ApplicationError('BROWSER_UNAVAILABLE','无法暂停使用该登录态的页面，尚未写入Cookie');
    }
    // Requests accepted before the gate (including workers) cannot finish and
    // deliver Set-Cookie after the target snapshot.
    await awaitBrowserNavigation(partition.closeAllConnections(),AbortSignal.timeout(10000));
  }
  async resume(profile:BrowserProfile):Promise<number>{
    const saved=this.saved.get(profile.id);if(!saved)return 0;
    const targets=[...saved].filter(([page])=>!page.closed&&!page.contents.isDestroyed());
    await Promise.all(targets.map(async([page,address])=>{
      // A login prompt or unavailable site must not hold the profile lock.
      // Navigation remains alive; normal workspace events report its outcome.
      try{await this.options.pages.resumeAfterImport(page,address,AbortSignal.timeout(25000));}catch{/* Site navigation is reported by the workspace. */}
      this.options.changed(page.taskId);
    }));
    this.saved.delete(profile.id);return targets.length;
  }
}
