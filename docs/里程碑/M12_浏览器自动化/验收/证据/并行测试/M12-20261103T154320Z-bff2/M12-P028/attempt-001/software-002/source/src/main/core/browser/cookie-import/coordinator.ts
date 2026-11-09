import {ApplicationError} from '@shared/applications';
import type {BrowserProfile} from '@shared/browser-profiles';
import type {BrowserProfiles} from '../profiles';
import type {BrowserImportJournals} from './journal';
import {BrowserCookieTransactions} from './transactions';
import type {BrowserCookieMutationStore} from './native-store';
import {planBrowserCookieImport} from './plan';
import type {BrowserCookieSources} from './sources';

type Store=BrowserCookieMutationStore&{close():Promise<void>};
interface Options {
  profiles:BrowserProfiles;journals:BrowserImportJournals;sources:BrowserCookieSources;
  open(profile:BrowserProfile):Promise<Store>;
  hold(profile:BrowserProfile):Promise<void>;resume(profile:BrowserProfile):Promise<number>;
  gate(profileId:string):()=>void;clear(profile:BrowserProfile):Promise<void>;
  changed(profileId:string):void;
}
/** UI-only lifecycle owner. Pending files block page creation synchronously;
 * startup recovery is attempted once, before reconciliation can load a page. */
export class BrowserImportCoordinator {
  private readonly transactions:BrowserCookieTransactions;
  private readonly gates=new Map<string,()=>void>();
  private startup?:Promise<void>;
  private readonly pending:Set<string>;
  constructor(private readonly options:Options){
    this.transactions=new BrowserCookieTransactions(options.journals);
    this.pending=new Set([...options.journals.pending(),...options.journals.clearing()]);
    for(const id of this.pending)this.state(id,'needs-attention');
  }
  private state(id:string,value:'ready'|'importing'|'needs-attention'){
    this.options.profiles.setImportState(id,value);
    if(value!=='ready'&&!this.gates.has(id))this.gates.set(id,this.options.gate(id));
    if(value==='ready'){this.gates.get(id)?.();this.gates.delete(id);}
    this.options.changed(id);
  }
  initialize():Promise<void>{
    return this.startup??=(async()=>{
      for(const id of this.pending){const profile=this.options.profiles.known(id);if(!profile)continue;
        try{await this.recover(profile);}catch{/* Keep blocked; only explicit UI retry can try again. */}
      }
    })();
  }
  private async work<T>(profile:BrowserProfile,action:(store:Store)=>Promise<T>,release=this.options.profiles.lock(profile.id,'导入或恢复')):Promise<{result:T;reloadedPages:number}>{
    let store:Store|undefined,held=false,completed=false;
    this.state(profile.id,'importing');
    try{
      // Gate already installed. Unload all published pages and cancel pending
      // creations before the first snapshot, journal write or Cookie mutation.
      await this.options.hold(profile);held=true;store=await this.options.open(profile);
      const result=await action(store);await store.close();store=undefined;
      completed=true;release();this.state(profile.id,'ready');
      return{result,reloadedPages:await this.options.resume(profile)};
    }catch(error){
      let closeFailed=false;try{await store?.close();store=undefined;}catch{closeFailed=true;}
      const pending=this.options.journals.pending().includes(profile.id)||this.options.journals.clearing().includes(profile.id);
      if(pending||!held||completed||closeFailed)this.state(profile.id,'needs-attention');
      else{release();this.state(profile.id,'ready');await this.options.resume(profile);}
      throw error;
    }finally{try{await store?.close();}finally{release();}}
  }
  async import(profile:BrowserProfile,sourceId:string){
    this.options.profiles.assertAvailable(profile.id);
    const release=this.options.profiles.lock(profile.id,'准备导入');let started=false;
    this.options.profiles.setImportState(profile.id,'importing');this.options.changed(profile.id);
    // Read/validate every source row before pausing target pages. This can
    // prompt Keychain, but cannot touch target data or start a partial import.
    try{
    const prepared=await this.options.sources.prepare(sourceId);started=true;
    const {result,reloadedPages}=await this.work(profile,async store=>{
      const plan=planBrowserCookieImport(prepared,await store.snapshot());
      await this.transactions.apply(profile.id,plan,store);
      this.options.profiles.setSource(profile.id,{family:prepared.source.family,profile:prepared.source.profileName,importedAt:Date.now()});
      return plan;
    },release);
    const {changes:_,...summary}=result;return{...summary,reloadedPages};
    }finally{release();if(!started){this.options.profiles.setImportState(profile.id,'ready');this.options.changed(profile.id);}}
  }
  async recover(profile:BrowserProfile):Promise<void>{
    await this.work(profile,async store=>{
      if(this.options.journals.clearing().includes(profile.id)){await this.options.clear(profile);this.options.profiles.setSource(profile.id,null);this.options.journals.finishClear(profile.id);}
      else await this.transactions.recover(profile.id,store);
    });
    this.pending.delete(profile.id);
  }
  async clear(profile:BrowserProfile):Promise<void>{
    await this.work(profile,async()=>{
      this.options.journals.requestClear(profile.id);
      await this.options.clear(profile);this.options.profiles.setSource(profile.id,null);this.options.journals.finishClear(profile.id);
    });
    this.pending.delete(profile.id);
  }
  /** Deletion has already unloaded/closed all pages and owns its own lock. */
  async discardAfterDelete(profile:BrowserProfile):Promise<void>{
    this.options.journals.requestClear(profile.id);await this.options.clear(profile);this.options.journals.finishClear(profile.id);
    this.pending.delete(profile.id);this.state(profile.id,'ready');
  }
  assertImportable(profileId:string):void{
    if(this.options.profiles.importState(profileId)!=='ready')throw new ApplicationError('BROWSER_UNAVAILABLE','请先处理该登录态的恢复记录');
  }
}
