import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import {browserImportCookieSchema,type BrowserImportCookie,type BrowserImportJournal,BrowserImportJournals} from './journal';
import type {BrowserCookieMutationStore} from './native-store';
import type {BrowserCookieImportPlan} from './plan';
import {importDomainScope,inImportDomainScope} from './domain-policy';

export class BrowserCookieRecoveryRequired extends ApplicationError {
  constructor(readonly stage:'journal'|'write'|'restore'|'commit'|'cleanup'){
    super('BROWSER_UNAVAILABLE','登录态处理尚未完成，请先重试恢复或清空该登录态');
  }
}
/** Native mutation engine only. Its caller owns profile authorization, page
 * unloading/network gating and the startup-before-page-load ordering. */
export class BrowserCookieTransactions {
  private readonly active=new Set<string>();
  constructor(private readonly journals:Pick<BrowserImportJournals,'read'|'write'|'commit'|'remove'|'pending'>){}
  private async exclusive<T>(profileId:string,work:()=>Promise<T>):Promise<T>{
    if(this.active.has(profileId))throw new ApplicationError('RESOURCE_BUSY','该登录态正在导入或恢复');this.active.add(profileId);try{return await work();}finally{this.active.delete(profileId);}
  }
  private async clear(journal:BrowserImportJournal,store:BrowserCookieMutationStore):Promise<number>{
    let failed=0;for(const change of journal.changes){const cookie=change.after??change.before;if(!cookie)continue;try{await store.remove(cookie);}catch{failed++;}}return failed;
  }
  private async restore(journal:BrowserImportJournal,store:BrowserCookieMutationStore):Promise<void>{
    let failed=await this.clear(journal,store);
    for(const change of journal.changes)if(change.before)try{await store.set(change.before);}catch{failed++;}
    try{await store.flush();}catch{failed++;}
    if(failed)throw new BrowserCookieRecoveryRequired('restore');
    try{this.journals.remove(journal.profileId,journal.transactionId);}catch{throw new BrowserCookieRecoveryRequired('cleanup');}
  }
  private async assertBefore(plan:BrowserCookieImportPlan,store:BrowserCookieMutationStore):Promise<void>{
    const scope=importDomainScope(plan.domains),actual:BrowserImportCookie[]=[];
    for(const target of await store.snapshot()){
      const domain=target.kind==='readable'?target.cookie.domain:target.domain,hostOnly=target.kind==='readable'?target.cookie.hostOnly:!domain.startsWith('.');if(!inImportDomainScope(scope,domain,hostOnly))continue;
      if(target.kind!=='readable')throw new ApplicationError('RESOURCE_STATE_CHANGED','目标Cookie分区在准备期间变化，未开始写入');actual.push(target.cookie);
    }
    const canonical=(cookies:BrowserImportCookie[])=>cookies.map(cookie=>JSON.stringify(browserImportCookieSchema.parse(cookie))).sort(),expected=plan.changes.flatMap(change=>change.before?[change.before]:[]);
    if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(expected)))throw new ApplicationError('RESOURCE_STATE_CHANGED','目标登录态在准备期间变化，未开始写入');
  }
  apply(profileId:string,plan:BrowserCookieImportPlan,store:BrowserCookieMutationStore):Promise<{transactionId:string|null}>{
    return this.exclusive(profileId,async()=>{
      if(this.journals.read(profileId))throw new ApplicationError('RESOURCE_BUSY','该登录态还有待处理的恢复记录');if(!plan.changes.length)return{transactionId:null};await this.assertBefore(plan,store);
      const journal:BrowserImportJournal={schemaVersion:1,transactionId:randomUUID(),profileId,createdAt:Date.now(),phase:'prepared',changes:plan.changes};
      try{this.journals.write(journal);}catch(error){if(this.journals.pending().includes(profileId))throw new BrowserCookieRecoveryRequired('journal');throw error;}
      try{
        if(await this.clear(journal,store))throw new ApplicationError('BROWSER_ERROR','部分原Cookie未确认移除');
        for(const change of journal.changes)if(change.after)await store.set(change.after);
        await store.flush();
      }catch{await this.restore(journal,store);throw new ApplicationError('BROWSER_ERROR','导入未完成，原登录态已恢复');}
      try{this.journals.commit(profileId,journal.transactionId);}catch{throw new BrowserCookieRecoveryRequired('commit');}
      try{this.journals.remove(profileId,journal.transactionId);}catch{throw new BrowserCookieRecoveryRequired('cleanup');}
      return{transactionId:journal.transactionId};
    });
  }
  recover(profileId:string,store:BrowserCookieMutationStore):Promise<'none'|'restored'|'committed'>{
    return this.exclusive(profileId,async()=>{
      const journal=this.journals.read(profileId);if(!journal)return'none';
      if(journal.phase==='committed'){try{this.journals.remove(profileId,journal.transactionId);}catch{throw new BrowserCookieRecoveryRequired('cleanup');}return'committed';}
      await this.restore(journal,store);return'restored';
    });
  }
}
