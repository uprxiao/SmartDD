import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {BrowserProfile,BrowserProfileCaller} from '@shared/browser-profiles';
import type {BrowserProfiles} from './profiles';
import type {BrowserSiteStates} from './site-state';
import {BrowserCloneJournals,type BrowserCloneIntent} from './clone-journal';
import {browserProfileSnapshotStage} from './profile-snapshot';

interface CloneOptions {
  userData:string;partitionRoot:string;profiles:BrowserProfiles;sites:BrowserSiteStates;
  materialize(source:BrowserProfile,target:BrowserProfile,stagingId:string,admit:()=>void,signal?:AbortSignal):Promise<unknown>;
  warning?:()=>void;
}
/** An incomplete destination is never registered. After a process interruption
 * startup removes only unregistered, identity-bound target/staging directories;
 * a published target is complete and must survive journal cleanup failure. */
export class BrowserProfileClones {
  readonly journals:BrowserCloneJournals;
  private initializing?:Promise<void>;
  constructor(private readonly options:CloneOptions){this.journals=new BrowserCloneJournals(options.userData);}
  private async removeDirectory(path:string){
    try{const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw new ApplicationError('BROWSER_UNAVAILABLE','克隆临时目录类型无效');await rm(path,{recursive:true,force:true});}
    catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  }
  private async cleanup(intent:BrowserCloneIntent,removeIntent=true){
    const known=this.options.profiles.known(intent.targetId);
    if(known&&(known.owner.kind!=='task'||known.owner.id!==intent.taskId||known.scope!=='isolated'))throw new ApplicationError('RESOURCE_STATE_CHANGED','克隆恢复记录与已保存归属不符');
    if(!known)await this.removeDirectory(join(this.options.partitionRoot,'wy-browser-'+intent.targetId));
    await this.removeDirectory(browserProfileSnapshotStage(this.options.partitionRoot,intent.stagingId));
    const fd=await open(this.options.partitionRoot,'r');try{await fd.sync();}finally{await fd.close();}
    if(removeIntent)this.journals.remove(intent.targetId,intent.stagingId);
  }
  initialize():Promise<void>{
    return this.initializing??=(async()=>{
      await mkdir(this.options.partitionRoot,{recursive:true,mode:0o700});const stat=await lstat(this.options.partitionRoot);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ApplicationError('BROWSER_UNAVAILABLE','原生分区目录不可用');
      for(const id of this.journals.pending())try{const intent=this.journals.read(id);if(intent)await this.cleanup(intent);}catch{this.options.warning?.();}
    })();
  }
  async clone(caller:BrowserProfileCaller,sourceId:string,admit:()=>void,dispatched:()=>void,signal?:AbortSignal):Promise<BrowserProfile>{
    await this.initialize();admit();const source=this.options.profiles.require(caller,sourceId),candidate=this.options.profiles.prepareClone(caller,sourceId),policy=this.options.sites.snapshot(sourceId),release=this.options.profiles.lockForCopy(sourceId);
    const intent:BrowserCloneIntent={schemaVersion:1,targetId:candidate.profile.id,stagingId:randomUUID(),sourceId,taskId:caller.taskId,projectId:caller.projectId,createdAt:Date.now()};let written=false,publicationAttempted=false;
    const active=()=>{signal?.throwIfAborted();admit();this.options.profiles.require(caller,sourceId);};
    try{
      active();dispatched();this.journals.write(intent);written=true;
      await this.options.materialize(source,candidate.profile,intent.stagingId,active,signal);active();
      if(JSON.stringify(this.options.sites.snapshot(sourceId))!==JSON.stringify(policy))throw new ApplicationError('RESOURCE_STATE_CHANGED','原登录态站点授权在复制期间变化，未公布克隆');
      publicationAttempted=true;
      const profile=candidate.publish(()=>{},()=>this.options.sites.inherit(candidate.profile.id,policy),()=>this.options.sites.invalidate(candidate.profile.id));
      await this.cleanup(intent);return profile;
    }catch(error){
      // Native target contexts can retain open database handles. Keep the
      // intent until startup if cleanup cannot complete; never touch source.
      if(written&&!publicationAttempted)try{await this.cleanup(intent,false);}catch{this.options.warning?.();}
      throw error;
    }finally{release();}
  }
}
