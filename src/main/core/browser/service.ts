import {verifyStandaloneScope,standaloneTaskId} from '../agent/task-application-scope';
import {BrowserPresentationRequests,type PresentationStatus} from './presentation';
import {BrowserJavascriptDialogs} from './javascript-dialogs';
import { ApplicationError } from '@shared/applications';
import { applicationPreflightFailure } from '../applications/capability-preflight';
import { BrowserPageRegistry, type BrowserPage } from './page-registry';
import { BrowserArtifacts, browserDigest } from './artifacts';
import { BrowserOperations } from './operations';
import { BrowserError, staleReference } from './errors';
import type Database from 'better-sqlite3';
import { app, nativeImage, session, type BaseWindow } from 'electron';
import { BrowserInputInterrupted, type BrowserHelperOptions } from './agent-browser';
import { join,resolve,isAbsolute,dirname } from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';
import { browserExecArguments } from './exec-policy';
import type { BrowserProgress } from './input-progress';
import {BrowserWorkspace} from './workspace';
import type {BrowserShortcut} from '@shared/browser-workspace';
import {BROWSER_BLANK_URL,normalizeBrowserNavigationUrl} from '@shared/browser-navigation';
import browserCommands from '@shared/browser-commands.generated.json';
import {executeBrowserPageCommand} from './page-commands';
import {BrowserConditionWait} from './wait';
import {browserObservationOptions,observeBrowserPage} from './observation';
import {BrowserTabOpen,browserTabOpenInput} from './tab-open';
import {BrowserScriptRunner,parseBrowserScript,scriptExecutionInput} from './script-runner';
import {browserLoginInput,type BrowserLoginState} from './login';
import {BrowserCheckpoints,browserActionCheckpoint,checkpointInput,type BrowserCheckpoint} from './checkpoints';
import {BrowserRecorder} from './recorder';
import {BrowserProfiles} from './profiles';
import {executeBrowserCookie} from './cookies';
import type {BrowserProfile,BrowserProfileCaller} from '@shared/browser-profiles';
import {BrowserSettings,browserUserAgent} from './settings';
import {browserIdentitySchema} from '@shared/browser-settings';
import {randomUUID} from 'node:crypto';
import {BrowserSiteStates} from './site-state';
import {BrowserNetworkPolicy} from './network-policy';
import type {BrowserCertificateState} from '@shared/browser-workspace';
import {BrowserPermissions} from './permissions';
import {BrowserDownloads} from './downloads';
import {BrowserAuthentication} from './authentication';
import {awaitBrowserNavigation} from './navigation-wait';
import {BrowserImportJournals} from './cookie-import/journal';
import {BrowserCookieSources} from './cookie-import/sources';
import {NativeBrowserCookieStore} from './cookie-import/native-store';
import {BrowserImportCoordinator} from './cookie-import/coordinator';
import {BrowserImportPagePause} from './cookie-import/page-pause';
import {safeStorageCipher} from '../../safe-storage-cipher';
import type {SecretCipher} from '../../secrets';
import {BrowserCookieImportAudit} from './cookie-import/audit';
import {BrowserProfileClones} from './profile-clones';
import {cloneBrowserSessionData} from './clone-session';
import {BrowserAccess,type BrowserAccessAudit} from './access';
import {BrowserAutomation} from './automation';
import type {BrowserAccessMode} from '@shared/browser-access';
import {BrowserAudit} from './audit';
let nativeUserAgent:string|undefined;

export interface BrowserScope {
  projectId:string;taskId:string;runId:string;requestId:string;operationId:string;signal:AbortSignal;runSignal?:AbortSignal;assertActive():void;
  assertRetained?():void;
  policyDigest?:string;
}
const readCommands=new Set(browserCommands.filter(command=>command.semantics==='read').map(command=>command.command.slice(1).join(' ')));
const text=(value:unknown):string=>{
  if(!['string','number','boolean'].includes(typeof value))throw new ApplicationError('INVALID_INPUT','文本字段只接受字符串、数字或布尔值');
  return String(value);
};

/** Host-owned pages only. Both authenticated module calls and future UI placement share this service. */
export class BrowserService {
  userChangedScriptPage(taskId:string,pageId:string){this.scripts.userChangedPage(taskId,pageId);}
  cancelScriptLogin(taskId:string,executionId:string){this.scripts.cancelLogin(taskId,executionId);}
  async resumeScriptAfterLogin(scope:BrowserScope,state:BrowserLoginState){
    scope.assertActive();
    this.validateLoginTab(scope.taskId,state);
    if(!state.scriptExecutionId)throw new ApplicationError('INVALID_INPUT','该登录接续缺少原测试编号');
    const input=this.scripts.loginInput(scope,state.scriptExecutionId);
    const cwd=this.options.taskDirectory?.(scope.taskId);
    if(!cwd)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原任务工作目录不可用');
    const page=this.pages.get(scope.taskId,state.pageId);
    const authorize=()=>{
      scope.assertRetained?.();this.validateLoginTab(scope.taskId,state);
      if(this.closed||this.automation.paused(scope.taskId))throw new ApplicationError('CANCELED','当前任务的浏览器已暂停');
      this.profiles.require(scope,page.profileId,'control');
    };
    return this.scripts.start(scope,input,cwd,page,authorize,()=>{},true,login=>this.createScriptLogin(scope,login));
  }
  private createScriptLogin(scope:BrowserScope,input:BrowserLoginState){
    scope.assertRetained?.();
    if(!this.requestLogin)throw new ApplicationError('CAPABILITY_UNAVAILABLE','登录接续尚不可用');
    this.validateLoginTab(scope.taskId,input);
    this.requestLogin({...scope,operationId:randomUUID()},input);
  }
  private scriptChanged?:(taskId:string,executionId:string)=>void;
  attachScriptUpdates(changed:(taskId:string,executionId:string)=>void){this.scriptChanged=changed;}
  private checkpointChanged?:(taskId:string,receipt:ReturnType<BrowserCheckpoints['result']>)=>void;
  attachCheckpointUpdates(changed:NonNullable<BrowserService['checkpointChanged']>){this.checkpointChanged=changed;}
  private noteCheckpoint(taskId:string,receipt:ReturnType<BrowserCheckpoints['result']>){
    try{this.checkpointChanged?.(taskId,receipt);}
    catch{console.warn('[browser] checkpoint notification unavailable');}
  }
  async verifyCheckpointFromUi(taskId:string,id:string){
    const projectId=this.options.taskProject(taskId);
    if(!projectId)throw new ApplicationError('SCOPE_DENIED','原任务已失效');
    const record=this.checkpoints.forTask(taskId,projectId,id);
    if(record.verified)return this.checkpoints.result(record);
    return this.verifyCheckpoint(taskId,record,AbortSignal.timeout(3000),original=>{
      this.profiles.binding(taskId,projectId,original.profileId);
    });
  }
  private async verifyCheckpoint(taskId:string,record:BrowserCheckpoint,signal:AbortSignal,authorizePage:(original:BrowserPage)=>void,runId?:string){
    const original=await awaitBrowserNavigation(this.workspace.target(taskId,record.pageId),signal);
    const generation=original.references.documentGeneration;
    const authorize=()=>{
      authorizePage(original);
      this.profiles.assertAvailable(original.profileId);
      if(this.options.taskProject(taskId)!==record.projectId||this.pages.get(taskId,record.pageId)!==original
        ||original.profileId!==record.profileId||URL.parse(original.contents.getURL())?.origin!==record.origin
        ||original.references.documentGeneration!==generation)
        throw new ApplicationError('INTENT_STALE','核对时原业务页已变化');
    };
    return original.queue.run(authorize,async()=>{
      const reading=AbortSignal.any([signal,original.abort.signal,AbortSignal.timeout(3000)]);
      await awaitBrowserNavigation(this.conditions.get(original)!.run({selector:record.selector,text:record.text,timeout:2500},reading,authorize),reading);
      authorize();
      const result=this.checkpoints.verify(record,original);
      this.noteCheckpoint(taskId,result);
      return result;
    },signal,runId);
  }
  scriptFromUi(taskId:string,id:string,action?:'pause'|'stop'){
    const projectId=this.options.taskProject(taskId);
    if(!projectId)throw new ApplicationError('SCOPE_DENIED','任务浏览器已失效');
    return this.scripts.get({taskId,projectId},id,action);
  }
  inspectScriptFromUi(taskId:string,id:string){
    const projectId=this.options.taskProject(taskId),cwd=this.options.taskDirectory?.(taskId);
    if(!projectId||!cwd)throw new ApplicationError('SCOPE_DENIED','原任务或工作目录已失效');
    return this.scripts.inspectCheckpoint({taskId,projectId},id,cwd,page=>{
      if(this.options.taskProject(taskId)!==projectId)throw new ApplicationError('SCOPE_DENIED','原任务已变化');
      this.profiles.binding(taskId,projectId,page.profileId);
      this.profiles.assertAvailable(page.profileId);
    });
  }
  async readScriptEvidence(taskId:string,id:string,kind:'report'|'screenshot'){
    const {report,evidence}=this.scriptFromUi(taskId,id);
    const item=kind==='report'?report:[...evidence].reverse().find(row=>row.path.endsWith('.png'));
    if(!item)throw new ApplicationError('RESOURCE_STATE_CHANGED','本次测试还没有相应证据');
    const directory=join(await realpath(this.artifacts.root),taskId);
    if(dirname(item.path)!==directory||await realpath(item.path)!==item.path)
      throw new ApplicationError('SCOPE_DENIED','测试证据不属于当前任务');
    const file=await stat(item.path);
    if(!file.isFile()||file.size>4*1024*1024||file.size!==item.bytes)
      throw new ApplicationError('RESOURCE_STATE_CHANGED','测试证据已变化或超出预览大小');
    const bytes=await readFile(item.path);
    if(browserDigest(bytes)!==item.sha256)throw new ApplicationError('RESOURCE_STATE_CHANGED','测试证据摘要已变化');
    return kind==='report'
      ?{kind,text:JSON.stringify(JSON.parse(bytes.toString('utf8')),null,2)}
      :{kind,image:`data:image/png;base64,${bytes.toString('base64')}`};
  }
  private loginPaused?:(taskId:string,pageId:string)=>boolean;
  attachLoginGuard(check:(taskId:string,pageId:string)=>boolean){this.loginPaused=check;}
  private assertPageNotAwaitingLogin(page:BrowserPage){
    const owner=page.openerPageId??page.id;
    if(this.loginPaused?.(page.taskId,owner))throw new BrowserError('BROWSER_PAUSED','原网页正在等待本人登录');
  }
  private requestLogin?:(scope:BrowserScope,input:BrowserLoginState)=>unknown;
  attachLoginRequest(accept:(scope:BrowserScope,input:BrowserLoginState)=>unknown){this.requestLogin=accept;}
  assertLoginTabIdentity(taskId:string,input:BrowserLoginState){
    if(this.options.taskProject(taskId)!==input.projectId||this.workspace.savedTab(taskId,input.pageId)?.profileId!==input.profileId)
      throw new ApplicationError('INTENT_STALE','原标签或登录身份已变化');
  }
  validateLoginTab(taskId:string,input:BrowserLoginState){
    this.assertLoginTabIdentity(taskId,input);
    this.profiles.binding(taskId,input.projectId,input.profileId);
    this.profiles.assertAvailable(input.profileId);
  }
  async checkLoginReady(taskId:string,input:BrowserLoginState){
    this.validateLoginTab(taskId,input);
    const signal=AbortSignal.timeout(2500);
    let page:BrowserPage;
    try{page=await awaitBrowserNavigation(this.workspace.target(taskId,input.pageId),signal);}
    catch(error){if(signal.aborted)return 'loading' as const;throw error;}
    if(page.contents.isLoadingMainFrame())return 'loading' as const;
    const generation=page.references.documentGeneration;
    const current=()=>{
      this.validateLoginTab(taskId,input);
      if(this.pages.get(taskId,input.pageId)!==page||URL.parse(page.contents.getURL())?.origin!==input.origin
        ||page.references.documentGeneration!==generation||this.authentication.snapshot(taskId,page.id))
        throw new BrowserError('BROWSER_TAB_CHANGED','原业务页面尚未就绪');
    };
    try{
      current();
      const ready=this.conditions.get(page);
      if(!ready)return 'loading' as const;
      await awaitBrowserNavigation(ready.run({selector:input.readySelector,load:'domcontentloaded',timeout:1600},signal,current),signal);
      current();
      return 'ready' as const;
    }catch(error){
      this.validateLoginTab(taskId,input);
      if(signal.aborted||page.contents.isLoadingMainFrame())return 'loading' as const;
      if(error instanceof BrowserError)return 'unconfirmed' as const;
      throw error;
    }
  }
  readonly presentation=new BrowserPresentationRequests();
  private presentOpen?:(scope:BrowserScope,pageId:string)=>void|Promise<PresentationStatus>;
  attachOpenPresentation(present:(scope:BrowserScope,pageId:string)=>void|Promise<PresentationStatus>){this.presentOpen=present;}
  private taskAccess?:{accept(scope:BrowserScope,targetTaskId:string,mode:BrowserAccessMode):unknown|undefined;revoke(id:string):boolean};
  attachTaskAccess(value:NonNullable<BrowserService['taskAccess']>){this.taskAccess=value;}
  accessTarget(taskId:string,reviewedPageIds:readonly string[]=[]){
    const projectId=this.options.taskProject(taskId);
    if(!projectId)return {projectId,pages:[]};
    const pages=new Map(this.pages.list(taskId).map(page=>[page.id,page.contents.getURL()]));
    if(reviewedPageIds.length){
      const reviewed=new Set(reviewedPageIds);
      // A saved tab may not have a native view yet after a restart. Only
      // previously reviewed tabs can participate in the later revalidation.
      for(const page of this.workspace.list(taskId)){
        if(page.kind==='tab'&&reviewed.has(page.pageId)&&!pages.has(page.pageId)&&page.url&&page.url!==BROWSER_BLANK_URL)pages.set(page.pageId,page.url);
      }
    }
    return {projectId,pages:[...pages].map(([id,url])=>({id,url})).sort((a,b)=>a.id.localeCompare(b.id))};
  }
  bindTaskAccess(binding:import('./access').BrowserAccessRun,targetTaskId:string,mode:BrowserAccessMode,id:string){const grant=this.access.bindApproved(binding,targetTaskId,mode,id);this.automation.track(binding);this.automation.target(binding.runId,targetTaskId);return grant;}

  readonly pages:BrowserPageRegistry;
  readonly operations:BrowserOperations;
  readonly workspace:BrowserWorkspace;
  private readonly tabOpen:BrowserTabOpen;
  private readonly scripts:BrowserScriptRunner;
  private readonly checkpoints:BrowserCheckpoints;
  readonly profiles:BrowserProfiles;
  readonly settings:BrowserSettings;
  readonly siteStates:BrowserSiteStates;
  readonly networkPolicy:BrowserNetworkPolicy;
  readonly permissions:BrowserPermissions;
  readonly downloads:BrowserDownloads;
  readonly authentication:BrowserAuthentication;
  readonly javascriptDialogs:BrowserJavascriptDialogs;
  readonly cookieSources:BrowserCookieSources;
  readonly access:BrowserAccess;
  readonly automation:BrowserAutomation;
  private readonly audit:BrowserAudit;
  private readonly imports:BrowserImportCoordinator;
  private readonly importAudit:BrowserCookieImportAudit;
  private readonly clones:BrowserProfileClones;
  private readonly certificateFailures=new Map<string,BrowserCertificateState>();
  private readonly artifacts:BrowserArtifacts;
  private readonly readWaits=new Map<string,Set<AbortController>>();
  private readonly userProfileRun='browser-ui-'+randomUUID();
  private closed=false;
  private readonly conditions=new WeakMap<BrowserPage,BrowserConditionWait>();
  private readonly recordings=new WeakMap<BrowserPage,BrowserRecorder>();
  private reconciling?:Promise<void>;
  private reconcileAgain=false;
  private reconcileTimer?:ReturnType<typeof setTimeout>;
  constructor(private readonly options:{userData:string;workspaceHome?:string;sqlite:Database.Database;helper:Pick<BrowserHelperOptions,'executable'|'sha256'|'processes'>;taskProject:(taskId:string)=>string|null;taskOwnerExists?:(taskId:string)=>boolean;taskDirectory?:(taskId:string)=>string|null;promptPreloadPath?:string;window?:()=>BaseWindow|null;ensureWindow?:()=>Promise<BaseWindow>;scheduledRun?:(runId:string)=>boolean;changed?:(taskId:string)=>void;accessChanged?:()=>void;shortcut?:(taskId:string,action:BrowserShortcut)=>void;cookieImport?:{cipher:SecretCipher;sources:BrowserCookieSources}}){
    this.operations=new BrowserOperations(options.sqlite);this.operations.recover();this.checkpoints=new BrowserCheckpoints(options.sqlite,this.operations);this.audit=new BrowserAudit(this.operations);this.importAudit=new BrowserCookieImportAudit(this.operations,options.taskProject);
    this.access=new BrowserAccess({taskProject:options.taskProject,changed:options.accessChanged,audit:event=>this.auditAccess(event)});
    this.automation=new BrowserAutomation({changed:options.changed,ended:runId=>this.access.endRun(runId)});
    this.settings=new BrowserSettings(options.sqlite);nativeUserAgent??=app.userAgentFallback;app.userAgentFallback=browserUserAgent(nativeUserAgent,this.settings.snapshot().identity);
    this.profiles=new BrowserProfiles({...options,authorized:(caller,target,mode)=>!!caller.runId&&this.access.can(caller.runId,target,mode==='observe'?'read':'write')});
    this.siteStates=new BrowserSiteStates(options.sqlite,id=>this.profiles.all().some(profile=>profile.id===id));
    this.permissions=new BrowserPermissions({states:this.siteStates,available:id=>{this.profiles.assertAvailable(id);return this.profiles.all().some(profile=>profile.id===id);},changed:options.changed});
    this.downloads=new BrowserDownloads({directory:()=>app.getPath('downloads'),available:(id,taskId)=>{this.profiles.assertAvailable(id);return!!options.taskProject(taskId)&&this.profiles.all().some(profile=>profile.id===id);},changed:options.changed});
    this.authentication=new BrowserAuthentication({available:id=>{this.profiles.assertAvailable(id);return this.profiles.all().some(profile=>profile.id===id);},changed:options.changed});
    this.javascriptDialogs=new BrowserJavascriptDialogs({preloadPath:()=>options.promptPreloadPath??join(app.getAppPath(),'out/preload/browser-prompt.js'),available:id=>{this.profiles.assertAvailable(id);return !this.closed&&this.profiles.all().some(profile=>profile.id===id);},changed:options.changed});
    this.networkPolicy=new BrowserNetworkPolicy({trusted:(id,host)=>this.siteStates.trusted(id,host),failed:(contents,failure)=>{
      const page=this.pages.all().find(page=>page.contents===contents);if(!page||page.importPaused)return;
      this.certificateFailures.set(page.id,{...failure,challengeId:randomUUID()});this.workspace.certificateFailed(page,failure.url,failure.error);
    }});
    this.pages=new BrowserPageRegistry({...options,profiles:this.profiles,prepareSession:session=>this.javascriptDialogs.prepareSession(session),configure:page=>{
      this.networkPolicy.install(page.contents,page.profileId);
      let displayPage=page;const seen=new Set<string>();
      while(displayPage.kind==='popup'&&displayPage.openerPageId&&!seen.has(displayPage.id)){seen.add(displayPage.id);const parent=this.pages.all().find(value=>value.id===displayPage.openerPageId);if(!parent)break;displayPage=parent;}
      this.permissions.install({contents:page.contents,taskId:page.taskId,pageId:page.id,profileId:page.profileId,displayPageId:displayPage.id});
      this.downloads.install({contents:page.contents,taskId:page.taskId,pageId:page.id,profileId:page.profileId});
      this.authentication.install({contents:page.contents,taskId:page.taskId,pageId:page.id,profileId:page.profileId,displayPageId:displayPage.id});
      this.javascriptDialogs.install({contents:page.contents,proxy:page.proxy,taskId:page.taskId,pageId:page.id,profileId:page.profileId,displayPageId:displayPage.id});
      page.contents.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace)this.certificateFailures.delete(page.id);});
      page.contents.once('destroyed',()=>this.certificateFailures.delete(page.id));
    }});
    this.pages.observe(event=>{if(event.type==='created'){this.conditions.set(event.page,new BrowserConditionWait(event.page));this.recordings.set(event.page,new BrowserRecorder(event.page));}});
    this.workspace=new BrowserWorkspace({...options,pages:this.pages,activity:id=>this.automation.activity(id),paused:id=>this.automation.paused(id),available:id=>this.profiles.assertAvailable(id),profileState:id=>this.profiles.importState(id),searchEngine:()=>this.settings.snapshot().searchEngine,authentication:(taskId,pageId)=>({prompt:this.authentication.snapshot(taskId,pageId),cancelled:this.authentication.cancelledState(taskId,pageId)}),javascriptDialog:(taskId,pageId)=>this.javascriptDialogs.snapshot(taskId,pageId),downloads:taskId=>this.downloads.snapshot(taskId),permission:(taskId,pageId)=>this.permissions.snapshot(taskId,pageId),certificate:(id,url)=>{
      const failure=this.certificateFailures.get(id);if(failure?.url===url)return failure;
      const page=this.pages.all().find(page=>page.id===id),accepted=page?this.networkPolicy.certificate(page.contents,url):null;
      return accepted?{...accepted,challengeId:null}:null;
    }});
    this.tabOpen=new BrowserTabOpen(this.workspace,this.operations);
    this.artifacts=new BrowserArtifacts(join(options.userData,'browser/artifacts'));
    this.scripts=new BrowserScriptRunner({
      db:options.sqlite,root:resolve(options.userData,'browser'),home:()=>options.workspaceHome??app.getPath('home'),
      workerPath:()=>app.isPackaged?join(process.resourcesPath,'browser-runner/worker.mjs'):join(app.getAppPath(),'resources/browser-runner/worker.mjs'),
      pages:this.pages,artifacts:this.artifacts,downloads:this.downloads,
      changed:(taskId,id)=>this.scriptChanged?.(taskId,id),
    });
    this.cookieSources=options.cookieImport?.sources??new BrowserCookieSources({temporaryRoot:join(options.userData,'browser/import-source'),...(options.workspaceHome?{applicationSupport:join(options.workspaceHome,'Library/Application Support')}:{} )});
    const partition=(profile:BrowserProfile)=>session.fromPartition(profile.partition);
    const pause=new BrowserImportPagePause({pages:this.pages,session:partition,address:page=>page.hostNavigation??this.workspace.list(page.taskId).find(tab=>tab.pageId===page.id)?.url??page.contents.getURL(),changed:taskId=>options.changed?.(taskId)});
    this.imports=new BrowserImportCoordinator({profiles:this.profiles,journals:new BrowserImportJournals(options.userData,options.cookieImport?.cipher??safeStorageCipher),sources:this.cookieSources,
      open:profile=>NativeBrowserCookieStore.open(partition(profile),contents=>this.networkPolicy.install(contents,profile.id)),
      hold:profile=>pause.hold(profile),resume:profile=>pause.resume(profile),gate:id=>this.networkPolicy.suspend(id),
      clear:async profile=>{const target=partition(profile);await target.closeAllConnections();await target.clearData();await target.clearAuthCache();await target.cookies.flushStore();this.siteStates.forget(profile.id);},
      changed:id=>{for(const page of this.pages.all().filter(page=>page.profileId===id))options.changed?.(page.taskId);},
    });
    const partitionRoot=join(options.userData,'Partitions');
    this.clones=new BrowserProfileClones({userData:options.userData,partitionRoot,profiles:this.profiles,sites:this.siteStates,
      warning:()=>console.warn('[browser] unpublished clone cleanup pending'),
      materialize:async(source,target,stagingId,admit,signal)=>{
        const original=partition(source);
        if(!original.storagePath||await realpath(dirname(original.storagePath))!==await realpath(partitionRoot))throw new ApplicationError('BROWSER_UNAVAILABLE','原生登录态不在预期分区目录，未开始复制');
        return cloneBrowserSessionData({sourceProfile:source,targetProfile:target,sourceSession:original,targetSession:()=>partition(target),stagingId,admit,signal,
          open:owner=>NativeBrowserCookieStore.open(owner,contents=>this.networkPolicy.install(contents,owner===original?source.id:target.id)),
        });
      },
    });
  }
  pause(taskId:string,value:boolean):void{
    this.automation.pause(taskId,value);
    if(value){
      for(const page of this.pages.list(taskId))page.queue.cancelQueued(new BrowserError('BROWSER_PAUSED','用户已暂停浏览器，排队操作已取消'));
      for(const wait of this.readWaits.get(taskId)??[])wait.abort(new BrowserError('BROWSER_PAUSED','用户已暂停浏览器'));
    }
  }
  private auditAccess(event:BrowserAccessAudit):void{
    const request=event.request,key='access-'+request.id,summary={actor:'agent',projectId:request.projectId,requesterTaskId:request.requesterTaskId,targetTaskId:request.targetTaskId,requestedMode:request.requestedMode,mode:request.mode,grantId:request.id,requestId:request.requestId??null,decisionSource:event.source,result:event.result};
    if(event.result==='revoked')for(const page of this.pages.all()){
      const owner=this.profiles.known(page.profileId)?.owner;
      if(page.taskId===request.targetTaskId||owner?.kind==='task'&&owner.id===request.targetTaskId)page.queue.cancelQueued(new ApplicationError('SCOPE_DENIED','本次运行的跨任务授权已失效'),request.runId);
    }
    this.operations.begin(request.runId,key,request.requesterTaskId,null,'access decision');
    this.operations.update(request.runId,key,event.result==='requested'?'running':event.result==='denied'?'failed':'succeeded',event.result==='requested'?'unknown':event.result==='denied'?'not-started':'completed',{summary,code:event.result==='denied'?'SCOPE_DENIED':undefined});
  }
  private admit(scope:BrowserScope,args:Record<string,unknown>,read=false,request=false,runningWrite=false):string{
    scope.assertActive();
    if(this.closed)throw new BrowserError('BROWSER_UNAVAILABLE','浏览器服务已关闭');
    if(this.options.taskProject(scope.taskId)!==scope.projectId)throw new ApplicationError('SCOPE_DENIED','当前运行没有这个任务的浏览器授权');
    if(scope.signal.aborted)throw scope.signal.reason??new ApplicationError('CANCELED','浏览器操作已取消');
    if(scope.runSignal){const binding={runId:scope.runId,taskId:scope.taskId,projectId:scope.projectId,signal:scope.runSignal};this.access.track(binding);this.automation.track(binding);}
    const taskId=args.task===undefined?scope.taskId:text(args.task);
    if(this.options.taskProject(taskId)!==scope.projectId||request&&taskId===scope.taskId)throw new ApplicationError('SCOPE_DENIED','只能访问本项目允许的浏览器任务');
    if(request){if(!scope.runSignal)throw new ApplicationError('SCOPE_DENIED','跨任务授权需要宿主签发的完整运行生命周期');return taskId;}
    if(taskId!==scope.taskId)this.access.require(scope.runId,taskId,read?'read':'write');
    if(!runningWrite&&this.automation.paused(taskId))throw new BrowserError('BROWSER_PAUSED','用户已暂停浏览器');
    this.automation.target(scope.runId,taskId);return taskId;
  }
  async execute(scope:BrowserScope,command:string,args:Record<string,unknown>):Promise<unknown>{
    const timeout=args.timeout??25000,isWait=command==='wait'||command==='wait fn',budget=isWait&&typeof timeout==='number'&&Number.isInteger(timeout)&&timeout>=1&&timeout<=90000?timeout+5000:90000;
    const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new BrowserError('BROWSER_TIMEOUT',`浏览器命令等待 ${budget}ms 后超时`)),budget),signal=AbortSignal.any([scope.signal,...(scope.runSignal?[scope.runSignal]:[]),deadline.signal]);
    const state:{dispatched:()=>boolean;activities:Map<string,()=>void>;audit?:ReturnType<BrowserAudit['start']>;pending?:()=>boolean}={dispatched:()=>false,activities:new Map<string,()=>void>()},effective={...scope,signal};
    try{
      scope.assertActive();if(this.options.taskProject(scope.taskId)===scope.projectId)state.audit=this.audit.start(scope,command,args,readCommands.has(command));
      const execution=this.executeScoped(effective,command,args,state);
      // The observation owns its own cancelable deadline. Once the action
      // completes, cancellation returns that action with an unavailable observation.
      const result=await (args.observeAfter===undefined?awaitBrowserNavigation(execution,signal):execution);
      if(state.pending?.())state.audit?.pending(result);else state.audit?.success(result);return result;
    }
    catch(error){
      try{state.audit?.failure(error,state.dispatched());}catch{console.warn('[browser] command audit unavailable');}
      if(!signal.aborted){
        // Audit/identity checks happen before executeScoped. A storage failure
        // here must retain the same proven-not-started CLI contract as other
        // preflight failures, rather than becoming an ambiguous write.
        if(!readCommands.has(command)&&!state.dispatched())throw applicationPreflightFailure(error instanceof ApplicationError?error:new BrowserError('BROWSER_UNAVAILABLE','浏览器命令在开始前失败'),scope.operationId);
        throw error;
      }
      const reason=signal.reason??error,failure=reason instanceof ApplicationError?reason:new BrowserError('BROWSER_ERROR',reason instanceof Error?reason.message:String(reason));
      throw readCommands.has(command)||state.dispatched()?failure:applicationPreflightFailure(failure,scope.operationId);
    }finally{clearTimeout(timer);if(!state.pending?.())for(const finish of state.activities.values())finish();}
  }
  private async executeScoped(scope:BrowserScope,command:string,args:Record<string,unknown>,state:{dispatched:()=>boolean;activities:Map<string,()=>void>;audit?:ReturnType<BrowserAudit['start']>;pending?:()=>boolean}):Promise<unknown>{
    const read=readCommands.has(command);let taskId=scope.taskId,dispatched=false,receiptOwned=false,actionKnown=false,page:BrowserPage|undefined,progress:BrowserProgress|undefined,deferredClickFailed=false,deferredClickPending=false,deferredClickError:BrowserError|undefined;
    let waiting:{abort:AbortController;set:Set<AbortController>}|undefined;
    let checkpoint:ReturnType<typeof browserActionCheckpoint.parse>|undefined;
    const mark=(id:string)=>{if(!state.activities.size)state.audit?.page(id);if(!state.activities.has(id))state.activities.set(id,this.automation.begin(scope.runId,taskId,id));};
    const recordGrant=(targetTaskId=taskId)=>{const grant=this.access.snapshot().grants.find(grant=>grant.runId===scope.runId&&grant.targetTaskId===targetTaskId);if(grant)state.audit?.grant({grantId:grant.id,mode:grant.mode,source:'user'},targetTaskId);};
    const guardProfile=(id:string,mode:BrowserAccessMode='observe')=>{const profile=this.profiles.require(scope,id,mode);if(profile.owner.kind==='task'&&profile.owner.id!==scope.taskId)recordGrant(profile.owner.id);return profile;};
    const admit=()=>{const result=this.admit(scope,args,read,false,dispatched&&!read);if(taskId!==scope.taskId)recordGrant();return result;};
    const guardPage=()=>{if(page){guardProfile(page.profileId,read?'observe':'control');this.profiles.assertAvailable(page.profileId);}};
    state.dispatched=()=>dispatched;
    const begin=(pageId:string|null)=>{if(pageId)state.audit?.page(pageId);const receipt=this.operations.begin(scope.runId,scope.requestId,scope.taskId,pageId,command);if(!receipt.replay)receiptOwned=true;return receipt;};
    const send=()=>{
      dispatched=true;
      if(!read)this.operations.update(scope.runId,scope.requestId,'running','unknown',{progress});
    };
    const recordProgress=()=>{if(!read)this.operations.update(scope.runId,scope.requestId,'running','unknown',{progress});};
    const interruptedClick=(target:BrowserPage,value:unknown)=>target.references.hasOpenDialog||Boolean(value&&typeof value==='object'&&'dialogOpened'in value&&value.dialogOpened===true);
    state.pending=()=>deferredClickPending;
    const finishDeferredActivity=()=>{for(const finish of state.activities.values())finish();state.activities.clear();};
    const deferredClickFailure=(reason:'stale'|'unknown'='stale')=>{deferredClickPending=false;deferredClickFailed=true;deferredClickError=reason==='stale'?staleReference():new BrowserError('BROWSER_ERROR','原点击收尾结果未知；请重新加载网页后观察，勿重发原点击');this.operations.update(scope.runId,scope.requestId,'unknown','unknown',{code:deferredClickError.code});state.audit?.failure(deferredClickError,true);finishDeferredActivity();};
    const deferredClickCompleted=(value:unknown)=>()=>{deferredClickPending=false;this.operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:value});state.audit?.success(value);finishDeferredActivity();};
    const referenceDeferral=(target:BrowserPage,value:unknown,click:boolean)=>click&&interruptedClick(target,value)?{
      failed:deferredClickFailure,completed:deferredClickCompleted(value),signal:scope.runSignal??scope.signal,
      cancel:async()=>{await target.helper.close();await target.proxy.waitForInputCompletion();},
    }:undefined;
    try{
      if(!browserCommands.some(item=>item.command.slice(1).join(' ')===command))throw new ApplicationError('CAPABILITY_UNAVAILABLE','浏览器命令未登记');
      const observation=browserObservationOptions(args.observeAfter);
      if(observation&&!['goto','click','fill','select'].includes(command))
        throw new ApplicationError('INVALID_INPUT','此命令不支持动作后观察');
      if(args.checkpoint!==undefined&&command!=='login wait'){
        if(!['goto','click','fill','select','download'].includes(command)||args.task!==undefined)
          throw new ApplicationError('INVALID_INPUT','此命令或任务范围无法登记业务检查点');
        checkpoint=browserActionCheckpoint.parse(args.checkpoint);
      }
      taskId=this.admit(scope,args,read,command==='access request');
      if(taskId!==scope.taskId&&command!=='access request')recordGrant();
      if(command==='access request'){
        if(standaloneTaskId(scope.projectId)||this.options.scheduledRun?.(scope.runId))throw new ApplicationError('SCOPE_DENIED','定时任务不能发起新的跨任务浏览器授权');
        const mode=args.mode;if(mode!=='observe'&&mode!=='control')throw new ApplicationError('INVALID_INPUT','授权模式须为observe或control');
        const durable=this.taskAccess?.accept(scope,taskId,mode);if(durable)return {result:durable};
        const receipt=begin(null);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};send();
        try{const grant=await this.access.request({runId:scope.runId,taskId:scope.taskId,projectId:scope.projectId,signal:scope.runSignal!},taskId,mode,scope.signal,scope.requestId);this.automation.target(scope.runId,taskId);const result={grantId:grant.id,taskId,mode:grant.mode};this.operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:result});return{result};}
        catch(error){if(error instanceof ApplicationError&&error.code==='SCOPE_DENIED')dispatched=false;throw error;}
      }
      if(command==='wait'){
        const abort=new AbortController(),set=this.readWaits.get(taskId)??new Set<AbortController>();set.add(abort);this.readWaits.set(taskId,set);waiting={abort,set};scope={...scope,signal:AbortSignal.any([scope.signal,abort.signal])};
      }
      if(command==='tab profile clone'){
        const source=guardProfile(text(args.profile),'control');this.profiles.assertAvailable(source.id);
        const contextPage=args.page===undefined?null:this.workspace.list(taskId).find(tab=>tab.pageId===text(args.page))?.pageId;
        if(contextPage===undefined)throw new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有这个网页标签');
        const receipt=begin(contextPage);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const active=()=>{scope.assertActive();if(this.closed||scope.signal.aborted)throw scope.signal.reason??new BrowserError('BROWSER_UNAVAILABLE','浏览器服务已关闭');if(this.options.taskProject(scope.taskId)!==scope.projectId||this.options.taskProject(taskId)!==scope.projectId)throw new ApplicationError('SCOPE_DENIED','当前运行已不能访问原任务');this.profiles.require(scope,source.id,'control');};
        const profile=await this.clones.clone(scope,source.id,active,send,scope.signal);
        this.operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:{profileId:profile.id,sourceProfileId:source.id}});this.options.changed?.(scope.taskId);
        return{result:{profile,sourceProfileId:source.id}};
      }
      if(command==='operation get')return this.operations.receipt(scope.runId,text(args.request));
      if(command==='identity get'){const value=this.settings.snapshot();return{result:{mode:value.identity,pendingMode:value.pendingIdentity,restartRequired:value.pendingIdentity!==null}};}
      if(command==='identity set'){
        const mode=browserIdentitySchema.safeParse(args.mode);if(!mode.success)throw new ApplicationError('INVALID_INPUT','浏览器身份须为clean或native');
        const receipt=begin(null);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const result=this.settings.setIdentity(mode.data,args.reset===true,send);this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result};
      }
      if(command==='tab profile list'){const profiles=this.profiles.list(scope);for(const profile of profiles)if(profile.owner.kind==='task'&&profile.owner.id!==scope.taskId)recordGrant(profile.owner.id);return{result:{profiles}};}
      if(command==='tab profile create'){
        const profileScope=args.scope??'isolated';if(profileScope!=='isolated'&&profileScope!=='imported')throw new ApplicationError('INVALID_INPUT','scope须为isolated或imported');
        const receipt=begin(null);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const profile=this.profiles.create(scope,text(args.label),profileScope,send);this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result:{profile}};
      }
      if(command==='tab profile show'){
        const tab=this.workspace.list(taskId).find(tab=>tab.pageId===text(args.page));if(!tab)throw new BrowserError('BROWSER_TAB_NOT_FOUND','没有该网页标签');
        this.profiles.ensureProject(scope.projectId);const profile=guardProfile(tab.profileId);return{result:{browserPageId:tab.pageId,profileId:profile.id,profileLabel:profile.label}};
      }
      if(command==='tab profile set'||command==='tab profile use-default'){
        if(command==='tab profile set'&&(args.page===undefined)===(args.task===undefined))throw new ApplicationError('INVALID_INPUT','set须指定page或task其中一个');
        const profile=command==='tab profile use-default'?this.profiles.ensureProject(scope.projectId):guardProfile(text(args.profile),'control');
        this.profiles.assertAvailable(profile.id);
        const tabs=this.workspace.list(taskId),targets=args.page===undefined?tabs.filter(tab=>tab.kind==='tab'):tabs.filter(tab=>tab.pageId===text(args.page));
        if(args.page!==undefined&&!targets.length)throw new BrowserError('BROWSER_TAB_NOT_FOUND','没有该网页标签');
        if(targets.some(tab=>tab.kind==='popup'))throw new ApplicationError('INVALID_INPUT','子窗口沿用来源页面登录态，请切换来源网页标签');
        const receipt=begin(null);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        for(const tab of targets){mark(tab.pageId);this.profiles.assertAvailable(tab.profileId);await this.workspace.setProfile(taskId,tab.pageId,profile.id,()=>{admit();this.profiles.assertAvailable(profile.id);},send,scope.signal);}
        this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result:{profileId:profile.id,pages:targets.map(tab=>tab.pageId)}};
      }
      if(command==='tab profile delete'){
        const profile=this.profiles.deletable(scope,text(args.profile));guardProfile(profile.id,'control');
        const receipt=begin(null);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        await this.deleteProfileData(scope,profile,admit,send);
        this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result:{deleted:profile.id}};
      }
      if(command==='tab list')return{tabs:this.workspace.list(taskId)};
      if(command==='checkpoint status'||command==='checkpoint verify'){
        const {checkpointId}=checkpointInput.parse(args),record=this.checkpoints.get(scope,checkpointId);
        const saved=this.workspace.savedTab(taskId,record.pageId);
        if(saved?.profileId!==record.profileId)throw new ApplicationError('INTENT_STALE','检查点对应的原标签或登录态已变化');
        if(command==='checkpoint status'||record.verified)return{result:this.checkpoints.result(record)};
        return{result:await this.verifyCheckpoint(taskId,record,scope.signal,original=>{
          admit();guardProfile(original.profileId);
          this.checkpoints.get(scope,record.id);
        },scope.runId)};
      }
      if(command==='login wait'){
        if(!this.requestLogin)throw new ApplicationError('BROWSER_UNAVAILABLE','登录接续尚不可用');
        const input=browserLoginInput(args),saved=this.workspace.savedTab(taskId,input.pageId);
        if(!saved)throw new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有原网页标签');
        guardProfile(saved.profileId);
        const data={...input,profileId:saved.profileId,projectId:scope.projectId};
        this.validateLoginTab(taskId,data);
        const result=this.requestLogin(scope,data);
        dispatched=true;
        return{result};
      }
      if(['script status','script stop','script pause'].includes(command)){
        const {executionId}=scriptExecutionInput.parse(args);
        const receipt=read?undefined:begin(null);
        if(receipt?.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const action=command==='script stop'?'stop':command==='script pause'?'pause':undefined;
        const result=this.scripts.get(scope,executionId,action);
        if(!read){dispatched=true;this.operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:result});}
        return{result};
      }
      if(command==='script run'||command==='script resume'){
        const input=parseBrowserScript(args),cwd=this.options.taskDirectory?.(scope.taskId);
        if(!cwd)throw new BrowserError('BROWSER_UNAVAILABLE','任务工作目录尚未就绪');
        page=this.pages.get(taskId,input.pageId);
        const target=page;
        const authorize=()=>{
          scope.assertRetained?.();
          if(this.closed||this.options.taskProject(taskId)!==scope.projectId||this.automation.paused(taskId))
            throw new ApplicationError('SCOPE_DENIED','当前任务的浏览器权限已变化');
          this.profiles.require(scope,target.profileId,'control');
          this.profiles.assertAvailable(target.profileId);
          this.assertPageNotAwaitingLogin(target);
        };
        const result=await this.scripts.start(scope,input,cwd,target,authorize,()=>{dispatched=true;},command==='script resume',
          login=>this.createScriptLogin(scope,login));
        state.audit?.page(target.id);
        return{result};
      }
      if(command==='tab open'){
        const input=browserTabOpenInput(args);
        const specified=input.pageId?this.workspace.savedTab(taskId,input.pageId):undefined;
        if(input.pageId&&!specified&&!this.operations.get(scope.runId,scope.requestId))
          throw new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有指定的网页标签');
        const profileId=specified?.profileId??input.profileId??this.workspace.currentProfile(taskId);
        this.profiles.ensureProject(scope.projectId);
        const authorize=()=>{
          scope.assertRetained?.();
          if(this.closed||this.options.taskProject(taskId)!==scope.projectId||this.automation.paused(taskId))
            throw new ApplicationError('SCOPE_DENIED','当前任务的浏览器权限已变化');
          this.profiles.require(scope,profileId,'control');
          this.profiles.assertAvailable(profileId);
        };
        const result=this.tabOpen.start(scope,input,profileId,{authorize,dispatch:()=>{dispatched=true;},
          ready:(opened,conditions,signal,check)=>this.conditions.get(opened)!.run({...conditions,load:'domcontentloaded'},signal,check),
          present:pageId=>this.presentOpen?.(scope,pageId),
        });
        state.audit?.page(result.pageId);
        return result;
      }
      if(command==='tab show'||command==='tab current'){
        const tabs=this.workspace.list(taskId),tab=command==='tab show'?tabs.find(tab=>tab.pageId===text(args.page)):tabs.find(tab=>tab.active);
        if(!tab)throw new BrowserError(command==='tab show'?'BROWSER_TAB_NOT_FOUND':'BROWSER_NO_TAB','没有可读取的网页标签');return{result:tab};
      }
      if((command==='tab switch'||command==='tab close')&&args.index!==undefined){
        if(args.page!==undefined||!Number.isInteger(args.index)||Number(args.index)<0)throw new ApplicationError('INVALID_INPUT','index与page只能指定一个，index必须是非负整数');
        const target=this.workspace.list(taskId)[Number(args.index)];if(!target)throw new BrowserError('BROWSER_TAB_NOT_FOUND','标签索引不存在');args={...args,page:target.pageId};
      }
      if(command==='tab switch'&&args.page===undefined)throw new ApplicationError('INVALID_INPUT','切换标签需要index或page');
      const navigation=command==='goto'||command==='tab create'&&args.url!==undefined?normalizeBrowserNavigationUrl(text(args.url)):undefined;
      if(navigation===null)throw new ApplicationError('INVALID_INPUT','导航地址或协议无效');
      if(command==='type'&&Array.from(text(args.input)).length>16384)throw new ApplicationError('INVALID_INPUT','type 最多16384字符；长文本请改用 inserttext');
      if(command==='wait'&&(args.fn!==undefined||args.timeout!==undefined&&(!Number.isInteger(args.timeout)||Number(args.timeout)<1||Number(args.timeout)>90000)))throw new ApplicationError('INVALID_INPUT','wait 不接受脚本，timeout须为1到90000毫秒');
      let downloadPath:string|undefined;
      if(command==='download'){
        const path=text(args.path);if(!path||path.includes('\0'))throw new ApplicationError('INVALID_INPUT','下载路径不能为空或含空字符');
        const cwd=this.options.taskDirectory?.(scope.taskId);if(!isAbsolute(path)&&!cwd)throw new BrowserError('BROWSER_UNAVAILABLE','任务工作目录尚未就绪');
        downloadPath=isAbsolute(path)?resolve(path):resolve(cwd!,path);
      }
      const execArgs=command==='exec'?browserExecArguments(text(args.command)):undefined;
      if(command==='tab create'&&args.profile!==undefined)guardProfile(text(args.profile),'control');
      if(command!=='tab create'){const known=this.workspace.list(taskId).find(tab=>args.page===undefined?tab.active:tab.pageId===text(args.page));if(known)mark(known.pageId);page=await awaitBrowserNavigation(this.workspace.target(taskId,args.page===undefined?undefined:text(args.page)),scope.signal);guardPage();mark(page.id);}
      if(page&&!read&&command!=='tab close'){
        this.assertPageNotAwaitingLogin(page);
        await this.scripts.waitForPage(page,scope.signal);
      }
      const execCredentials=command==='exec'&&execArgs?.[0]==='set'&&execArgs[1]==='credentials';
      if((command==='set credentials'||execCredentials)&&this.authentication.snapshot(taskId,page!.id))throw new ApplicationError('RESOURCE_BUSY','页面正在等待用户处理基本认证，Agent不能代答当前提示');
      if(!read){
        // A retained checkpoint outlives the operation receipt. A retry must
        // neither recreate that receipt nor dispatch the original write.
        if(checkpoint&&!this.operations.get(scope.runId,scope.requestId))this.checkpoints.assertUnrecorded(scope,checkpoint.id);
        const receipt=begin(page?.id??null);
        if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
      }
      let result:unknown;
      if(command==='tab create'){
        const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new BrowserError('BROWSER_TIMEOUT','新建网页标签等待90000ms后超时')),90000),signal=AbortSignal.any([scope.signal,deadline.signal]);
        try{send();page=await awaitBrowserNavigation(this.pages.create(taskId,scope.projectId,undefined,args.profile===undefined?undefined:text(args.profile)),signal);guardPage();mark(page.id);
          if(navigation!==undefined)await this.pages.navigate(page,navigation,signal);result={pageId:page.id,url:page.contents.getURL()};
        }finally{clearTimeout(timer);}
      }else{
        const target=page!;
        result=await target.queue.run(()=>{
          admit();guardPage();
          if(!read&&command!=='tab close'){
            this.assertPageNotAwaitingLogin(target);
            this.scripts.assertPageAvailable(target);
          }
        },async()=>{
          const deadline=new AbortController(),budget=command==='wait'||command==='wait fn'?Number(args.timeout??25000)+5000:90000;
          const timer=setTimeout(()=>deadline.abort(new BrowserError('BROWSER_TIMEOUT',`浏览器命令等待 ${budget}ms 后超时`)),budget);
          const signal=AbortSignal.any([scope.signal,target.abort.signal,deadline.signal]);
          const perform=async()=>{
          if(signal.aborted)throw signal.reason;
          this.profiles.assertAvailable(target.profileId);
          if(checkpoint)this.checkpoints.dispatch(scope,target,checkpoint,command);
          if(command.startsWith('cookie '))return executeBrowserCookie(target,command,args,send);
          if(command==='set credentials'||execCredentials){
            if(execCredentials&&execArgs!.length!==4)throw new ApplicationError('INVALID_INPUT','exec set credentials需要用户名和密码');
            this.authentication.setCredentials(target.contents,execCredentials?execArgs![2]:text(args.user),execCredentials?execArgs![3]:text(args.pass),send);return{result:{configured:true}};
          }
          if(command==='tab switch'){this.workspace.commandTarget(taskId,target.id,args.focus===true);send();return{result:{pageId:target.id,url:target.contents.getURL()}};}
          if(command==='tab close'){
            send();if(target.kind==='popup')await this.pages.close(taskId,target.id,true);else await this.workspace.close(taskId,target.id,true);
            return{result:{closed:target.id}};
          }
          if(command==='capture start')return{result:await this.recordings.get(target)!.start(send)};
          if(command==='capture stop'){
            const har=this.recordings.get(target)!.stop();send();return{file:await this.artifacts.write(scope.taskId,'capture','har',Buffer.from(JSON.stringify(har)))};
          }
          if(command==='intercept enable'){
            const patterns=args.patterns===undefined?[]:text(args.patterns).split(',');send();return{result:await this.recordings.get(target)!.enable(patterns)};
          }
          if(command==='intercept disable'){send();return{result:this.recordings.get(target)!.disable()};}
          if(command==='intercept list')return{result:this.recordings.get(target)!.list()};
          // A dialog can already be open before the first Helper connection.
          // The host owns its real CDP state and can answer without performing
          // a renderer-dependent kernel connection while JavaScript is blocked.
          const execDialog=command==='exec'&&execArgs?.[0]==='dialog';
          if(command==='dialog accept'||command==='dialog dismiss'||execDialog){
            const action=execDialog?execArgs![1]:command==='dialog accept'?'accept':'dismiss';
            if(action!=='accept'&&action!=='dismiss'||execDialog&&(action==='dismiss'?execArgs!.length!==2:execArgs!.length<2||execArgs!.length>3))
              throw new ApplicationError('INVALID_INPUT','dialog只接受accept [text]或dismiss');
            const value=await this.javascriptDialogs.respondFromAgent(taskId,target.id,action==='accept',execDialog?execArgs![2]:args.text===undefined?undefined:text(args.text),send);
            const settled=target.references?.hasDeferredGuards?await target.references.settleDeferredGuards():undefined;
            const result=settled?.unknown?{...value,inputContinuation:'unknown'}:settled?.blocked?{...value,inputContinuation:'blocked'}:value;
            return execDialog?this.artifacts.result(scope.taskId,'exec',result):{result};
          }
          if(target.references?.hasDeferredGuards){
            if(['goto','back','forward','reload'].includes(command)){
              // Discard the kernel's owned deferred release before a new
              // document can appear. Reconnecting later never replays input.
              await target.helper.close();target.references.invalidate(true);
            }else await target.references.assertDeferredGuardsReady();
          }
          await target.helper.ensureSession();
          if(signal.aborted)throw signal.reason??new ApplicationError('CANCELED','浏览器操作已取消');
          if(command==='download'){
            const armed=await target.references.arm(text(args.selector));let pending:ReturnType<BrowserDownloads['expect']>|undefined,error:unknown;
            try{
              pending=this.downloads.expect(target.contents,downloadPath!,signal);
              const dispatchDownload=()=>{pending!.start();send();},actionOptions={signal,dispatched:dispatchDownload,notStarted:()=>{if(!pending?.claimed())dispatched=false;}};
              if(armed.hostClick)await armed.click(actionOptions);else await target.helper.command(['click',armed.selector],{signal,dispatched:dispatchDownload});
            }catch(e){error=e;}
            try{
              const guard=await armed.finish();if(guard.blocked.length||!guard.connected){if(!guard.accepted.length)dispatched=pending?.claimed()??false;throw staleReference();}
              if(error)throw error;if(!guard.accepted.includes('click'))throw new BrowserError('BROWSER_ERROR','未确认下载点击事件送达；结果未知，请核对页面，不要重发');
              const downloaded=await pending!.result;return{result:{path:downloaded.path,name:downloaded.name,bytes:downloaded.receivedBytes,downloadId:downloaded.id}};
            }catch(error){pending?.cancel(error);throw error;}
          }
          if(command==='goto'){
            const url=navigation!;
            send();await this.pages.navigate(target,url,signal);return{navigated:true};
          }
          if(command==='back'||command==='forward'||command==='reload'){
            const wc=target.contents;send();
            if(command==='reload')await this.pages.navigate(target,target.hostNavigation??wc.getURL(),signal);
            else{const possible=command==='back'?wc.navigationHistory.canGoBack():wc.navigationHistory.canGoForward();if(possible){await new Promise<void>((resolve,reject)=>{
              let settled=false;
              const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);wc.off('did-finish-load',done);wc.off('did-navigate-in-page',inPage);wc.off('did-fail-load',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve();};
              const done=()=>finish(),failed=(_event:Electron.Event,code:number,description:string,_url:string,main:boolean)=>{if(main&&code!==-3)finish(new BrowserError('BROWSER_ERROR',description));},aborted=()=>finish(signal.reason);
              const inPage=(_event:Electron.Event,_url:string,main:boolean)=>{if(main)finish();};
              const timer=setTimeout(()=>finish(new BrowserError('BROWSER_TIMEOUT','导航等待60000ms后超时')),60000);
              wc.once('did-finish-load',done);wc.on('did-navigate-in-page',inPage);wc.on('did-fail-load',failed);signal.addEventListener('abort',aborted,{once:true});
              if(command==='back')wc.navigationHistory.goBack();else wc.navigationHistory.goForward();
            });}}
            return{result:{url:wc.getURL(),title:wc.getTitle()}};
          }
          if(command==='snapshot')return this.artifacts.result(scope.taskId,'snapshot',{
            ...await target.references.snapshot(target.helper,signal,args.container===undefined?undefined:text(args.container)),
            browserPageId:target.id,generation:target.references.documentGeneration,url:target.contents.getURL(),title:target.contents.getTitle(),
          });
          if(command==='console'||command==='network')return this.artifacts.result(scope.taskId,command,await target.helper.command(command==='console'?['console']:['network','requests'],{signal}));
          if(command==='exec'){
            // Host refs always pass the same identity checks, even through the compatibility entry.
            const refIndex=execArgs!.findIndex(arg=>arg.startsWith('@'));
            if(refIndex>=0){
              const armed=await target.references.arm(execArgs![refIndex]),native=[...execArgs!];native[refIndex]=armed.selector;
              const actionOptions={signal,dispatched:send,notStarted:()=>{dispatched=false;}};
              let value:unknown,error:unknown;
              try{
                if(execArgs![0]==='fill'&&refIndex===1){state.audit?.passwordFill(await armed.read('type')==='password');value=await armed.fill(execArgs!.slice(2).join(' '),actionOptions);}
                else if(execArgs![0]==='click'&&refIndex===1&&armed.hostClick)value=await armed.click(actionOptions);
                else value=await target.helper.command(native,{signal,dispatched:send});
              }catch(e){error=e;}
              const guard=await armed.finish(false,referenceDeferral(target,value,execArgs![0]==='click'));
              if(guard.pending)deferredClickPending=!deferredClickFailed;
              if(!guard.pending&&(guard.blocked.length||!guard.connected)){if(!guard.accepted.length)dispatched=false;throw staleReference();}if(error)throw error;
              if(execArgs![0]==='click'&&!guard.pending&&!guard.accepted.includes('click'))throw new BrowserError('BROWSER_ERROR','未确认点击事件送达页面；结果未知，请先核对页面，勿重发');
              if(guard.pending&&!target.references.hasOpenDialog)await target.references.settleDeferredGuards();
              if(deferredClickFailed)throw deferredClickError??staleReference();
              return this.artifacts.result(scope.taskId,'exec',value);
            }
            return this.artifacts.result(scope.taskId,'exec',await target.helper.command(execArgs!,{signal,dispatched:send}));
          }
          if(command==='eval'){
            const expression=text(args.expression);let changed=false;
            const off=target.proxy.onEvent(event=>{
              const frame=event.params.frame;
              if(!event.sessionId&&(event.method==='Runtime.executionContextsCleared'||event.method==='Page.frameNavigated'&&typeof frame==='object'&&frame!==null&&!('parentId' in frame)))changed=true;
            });
            const cancel=()=>{void target.proxy.send('Runtime.terminateExecution').catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
            try{
              send();const evaluated=await target.proxy.send<{result:{type:string;value?:unknown;description?:string};exceptionDetails?:{text:string}}>('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
              if(changed)throw new BrowserError('BROWSER_TAB_CHANGED','执行脚本期间页面已替换');
              if(evaluated.exceptionDetails)throw new BrowserError('BROWSER_EVAL_ERROR',evaluated.exceptionDetails.text);
              if(signal.aborted)throw signal.reason??new ApplicationError('CANCELED','脚本已取消');
              const value=evaluated.result.type==='undefined'?'没有返回值':typeof evaluated.result.value==='object'?JSON.stringify(evaluated.result.value):String(evaluated.result.value);
              return this.artifacts.result(scope.taskId,'eval',{value,origin:target.contents.getURL()});
            }catch(error){
              if(target.closed||target.contents.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','执行脚本期间网页已关闭，结果未知');
              // Chromium can reject Runtime.evaluate before delivering frameNavigated.
              if(changed||error instanceof Error&&/inspected target navigated|execution context.*destroyed/i.test(error.message))throw new BrowserError('BROWSER_TAB_CHANGED','执行脚本期间页面已替换');
              throw error;
            }
            finally{off();signal.removeEventListener('abort',cancel);}
          }
          if(command==='click'||command==='fill'){
            const ref=text(args.element),armed=await target.references.arm(ref);let value:unknown,error:unknown;
            const actionOptions={signal,dispatched:send,notStarted:()=>{dispatched=false;}};
            try{
              if(command==='fill'){state.audit?.passwordFill(await armed.read('type')==='password');value=await armed.fill(text(args.value),actionOptions);}
              else if(armed.hostClick)value=await armed.click(actionOptions);
              else value=await target.helper.command(['click',armed.selector],{signal,dispatched:send});
            }catch(e){error=e;}
            const guard=await armed.finish(false,referenceDeferral(target,value,command==='click'));
            if(guard.pending)deferredClickPending=!deferredClickFailed;
            if(!guard.pending&&(guard.blocked.length||!guard.connected)){
              // An old ref replaced before any event is demonstrably not-started. Partial delivery remains unknown.
              if(!guard.accepted.length)dispatched=false;
              throw staleReference();
            }
            if(error)throw error;
            if(command==='click'&&!guard.pending&&!guard.accepted.includes('click'))
              throw new BrowserError('BROWSER_ERROR','未确认点击事件送达页面；结果未知，请先核对页面，勿重发');
            if(guard.pending&&!target.references.hasOpenDialog)await target.references.settleDeferredGuards();
            if(deferredClickFailed)throw deferredClickError??staleReference();
            return value;
          }
          if(command==='type'||command==='inserttext'){
            const input=text(command==='type'?args.input:args.text),points=Array.from(input);
            const revision=target.helper.sessionRevision;
            progress={confirmedChars:0};
            // Retain the original focused element for an honest post-failure observation, including selection replacement.
            const focus=await target.proxy.send<{result:{objectId?:string}}>('Runtime.evaluate',{expression:'document.activeElement',returnByValue:false});
            try{
              let capacity:number|null=null;
              if(focus.result.objectId){
                const limit=await target.proxy.send<{result:{value?:unknown}}>('Runtime.callFunctionOn',{
                  objectId:focus.result.objectId,functionDeclaration:'function(){if(!(this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement)||this.maxLength<0)return null;const selected=(this.selectionEnd??0)-(this.selectionStart??0);return Math.max(0,this.maxLength-this.value.length+selected)}',returnByValue:true,
                });
                if(typeof limit.result.value==='number'&&Number.isSafeInteger(limit.result.value)&&limit.result.value>=0)capacity=limit.result.value;
              }
              for(let offset=0;offset<points.length;offset+=command==='type'?2000:points.length){
                if(signal.aborted)throw signal.reason;
                await target.helper.assertInputSession(revision);
                const chunk=points.slice(offset,offset+(command==='type'?2000:points.length));progress.inFlight={offset,length:chunk.length};recordProgress();
                try{
                  await target.helper.command(['keyboard',command==='type'?'type':'inserttext',chunk.join('')],{signal,dispatched:send,sessionRevision:revision});
                }catch(error){if(error instanceof BrowserInputInterrupted)delete progress.inFlight;throw error;}
                progress.confirmedChars+=chunk.length;delete progress.inFlight;recordProgress();
              }
              // A known maxlength cannot confirm the requested insertion. Do not silently
              // call it completed or infer page contents from source acknowledgments.
              if(capacity!==null&&input.length>capacity)throw new BrowserError('BROWSER_ERROR','目标maxlength可能截断本次输入；结果未知，请核对页面，不要自动重发');
              return{typed:true,progress};
            }catch(error){
              if(focus.result.objectId)try{
                const observed=await target.proxy.send<{result:{value?:string|null}}>('Runtime.callFunctionOn',{objectId:focus.result.objectId,functionDeclaration:'function(){if(!this.isConnected)return null;if(this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement)return this.value;return this.isContentEditable?this.textContent:null}',returnByValue:true});
                if(typeof observed.result.value==='string')progress.observed={at:new Date().toISOString(),length:observed.result.value.length,sha256:browserDigest(observed.result.value)};
              }catch{/* Page/element no longer readable: preserve unknown. */}
              throw error;
            }finally{if(focus.result.objectId)await target.proxy.send('Runtime.releaseObject',{objectId:focus.result.objectId}).catch(()=>{});}
          }
          if(command==='wait'){
            const timeout=Number(args.timeout??25000),native=['wait'];
            if(args.selector!==undefined)native.push(text(args.selector));
            for(const key of ['text','url','load','state'] as const)if(args[key]!==undefined)native.push('--'+key,text(args[key]));
            native.push('--timeout',String(timeout));
            const count=['selector','text','url','load'].filter(key=>args[key]!==undefined).length;
            if(args.state!==undefined||count>1)return await this.conditions.get(target)!.run(args,signal);
            if(count===0){await target.helper.command(['wait',String(timeout)],{signal,timeout:timeout+5000});return{waited:true};}
            await target.helper.command(native,{signal,timeout:timeout+5000});return{waited:true};
          }
          if(command==='screenshot'||command==='full-screenshot'){
            const format=args.format==='jpeg'?'jpeg':'png';
            const clip=command==='full-screenshot'?(await target.proxy.send<{cssContentSize:{width:number;height:number}}>('Page.getLayoutMetrics')).cssContentSize:undefined;
            const image=await target.proxy.send<{data:string}>('Page.captureScreenshot',{format,captureBeyondViewport:command==='full-screenshot',...(clip?{clip:{x:0,y:0,width:Math.ceil(clip.width),height:Math.ceil(clip.height),scale:1}}:{})});
            const bytes=Buffer.from(image.data,'base64'),pixels=nativeImage.createFromBuffer(bytes).getSize();
            const file=await this.artifacts.write(scope.taskId,command,format,bytes);
            return{file,format,width:pixels.width,height:pixels.height};
          }
          if(command==='pdf'){
            const bytes=await target.contents.printToPDF({printBackground:true,preferCSSPageSize:true});
            return{file:await this.artifacts.write(scope.taskId,'pdf','pdf',bytes)};
          }
          const callerTask=this.options.sqlite.prepare('SELECT cwd FROM tasks WHERE id=?').get(scope.taskId) as {cwd:string}|undefined;
          if(!callerTask)throw new BrowserError('BROWSER_UNAVAILABLE','调用任务已不存在');
          const other=await executeBrowserPageCommand(target,command,args,{signal,cwd:callerTask.cwd,send,notStarted:()=>{dispatched=false;}});
          if(other.handled)return this.artifacts.result(scope.taskId,command.replaceAll(' ','-'),other.result);
          throw new ApplicationError('CAPABILITY_UNAVAILABLE','此浏览器命令尚未完成接入');
          };
          // Closing this page deliberately aborts its page signal. Await the
          // close acknowledgement with the caller/deadline signals instead;
          // cancellation and a missing native completion still remain bounded.
          const completionSignal=command==='tab close'?AbortSignal.any([scope.signal,deadline.signal]):signal;
          try{
            const release=command==='tab close'?()=>{}:this.pages.acquirePaint(target);
            const physical=perform();void physical.finally(release).catch(()=>{});
            const value=await awaitBrowserNavigation(physical,completionSignal);
            if(signal.aborted&&command!=='tab close')throw signal.reason;
            if(!observation)return value;
            if(deferredClickPending)return{action:{state:'unknown',result:value},observation:{state:'unavailable',pageId:target.id}};
            this.operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:value,progress});
            actionKnown=true;
            const observed=await observeBrowserPage({
              page:target,options:observation,signal,
              authorize:()=>{this.admit(scope,args,true);guardProfile(target.profileId);this.profiles.assertAvailable(target.profileId);},
              condition:this.conditions.get(target)!,artifacts:this.artifacts,artifactTaskId:scope.taskId,
            });
            return{action:{state:'completed',result:value},observation:observed};
          }
          finally{clearTimeout(timer);}
        },scope.signal,scope.runId);
      }
      if(!read)this.operations.update(scope.runId,scope.requestId,deferredClickFailed?'unknown':deferredClickPending?'running':'succeeded',deferredClickFailed||deferredClickPending?'unknown':'completed',{summary:result,progress});
      return result;
    }catch(error){
      let failure=error instanceof ApplicationError?error:new BrowserError('BROWSER_ERROR',error instanceof Error?error.message:String(error));
      if(page?.closed&&dispatched)failure=new BrowserError('BROWSER_TAB_CLOSED','执行中网页已关闭，操作结果未知');
      if(receiptOwned&&!actionKnown)this.operations.update(scope.runId,scope.requestId,dispatched?'unknown':'failed',dispatched?'unknown':'not-started',{progress,code:failure.code});
      throw dispatched||read?failure:applicationPreflightFailure(failure,scope.operationId);
    }finally{
      if(receiptOwned&&dispatched&&checkpoint&&this.checkpointChanged){
        try{
          const record=this.checkpoints.forTask(taskId,scope.projectId,checkpoint.id);
          this.noteCheckpoint(taskId,this.checkpoints.result(record));
        }catch{console.warn('[browser] checkpoint receipt unavailable');}
      }
      if(waiting){waiting.set.delete(waiting.abort);if(!waiting.set.size)this.readWaits.delete(taskId);}
    }
  }
  private async clearProfile(profile:BrowserProfile):Promise<void>{
    await this.imports.discardAfterDelete(profile);
    this.siteStates.forget(profile.id);this.profiles.forget(profile.id);
  }
  accessState(){
    const state=this.access.snapshot(),describe=<T extends {requesterTaskId:string;targetTaskId:string;projectId:string}>(item:T)=>({...item,
      requesterTitle:(this.options.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get(item.requesterTaskId) as {title:string}|undefined)?.title??item.requesterTaskId,
      targetTitle:(this.options.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get(item.targetTaskId) as {title:string}|undefined)?.title??item.targetTaskId,
      projectName:(this.options.sqlite.prepare('SELECT name FROM projects WHERE id=?').get(item.projectId) as {name:string}|undefined)?.name??item.projectId,
    });
    return{requests:state.requests.map(describe),grants:state.grants.map(describe)};
  }
  respondAccess(id:string,allow:boolean,mode?:BrowserAccessMode):void{this.access.respond(id,allow,mode);}
  revokeAccess(id:string):void{if(this.taskAccess?.revoke(id))return;this.access.revoke(id);}
  pauseFromUi(taskId:string,paused:boolean){this.workspace.snapshot(taskId);this.pause(taskId,paused);return this.workspace.snapshot(taskId);}
  /** UI-only; never part of the browser command module. Bind approval to the
   * exact outstanding failed navigation so a stale click cannot trust a new host. */
  async continueCertificate(taskId:string,pageId:string,challengeId:string):Promise<void>{
    this.workspace.snapshot(taskId);const page=this.pages.get(taskId,pageId),failure=this.certificateFailures.get(pageId);
    if(!failure||failure.challengeId!==challengeId)throw new ApplicationError('RESOURCE_STATE_CHANGED','证书提示已失效，请重试当前页面');
    this.profiles.binding(taskId,page.projectId,page.profileId);this.profiles.assertAvailable(page.profileId);
    this.siteStates.trust(page.profileId,failure.host);this.certificateFailures.delete(pageId);
    if(page.kind==='popup')await this.pages.navigate(page,failure.url);else await this.workspace.navigate(taskId,pageId,failure.url);
  }
  profileSiteStates(taskId:string){
    const {projectId}=this.workspace.snapshot(taskId);
    return this.profiles.list({taskId,projectId}).map(profile=>({profile,state:this.siteStates.snapshot(profile.id),importState:this.profiles.importState(profile.id)}));
  }
  private async deleteProfileData(caller:BrowserProfileCaller,profile:BrowserProfile,admit:()=>void,send:()=>void):Promise<void>{
    this.profiles.deletable(caller,profile.id);const release=this.profiles.lock(profile.id,'删除');
    try{
      await this.pages.cancelProfileInitializations(profile.id);
      await this.workspace.removeProfileBindings(profile.id,taskId=>this.profiles.ensureProject(this.options.taskProject(taskId)!).id,admit,send);
      for(const remaining of this.pages.all().filter(page=>page.profileId===profile.id)){
        if(remaining.kind!=='popup'&&this.options.taskProject(remaining.taskId))throw new ApplicationError('RESOURCE_BUSY','仍有网页使用此登录态');
        admit();send();await this.pages.close(remaining.taskId,remaining.id);
      }
      admit();send();await this.clearProfile(profile);
    }finally{release();}
  }
  /** Trusted user actions remain available when Agent automation is paused.
   * Recheck task ownership after every asynchronous boundary and retain an
   * independent receipt; a failed/unknown mutation is never automatically replayed. */
  private async userProfileChange<T>(taskId:string,action:string,profileId:string|null,work:(caller:BrowserProfileCaller,admit:()=>void,send:()=>void)=>Promise<T>){
    const {projectId}=this.workspace.snapshot(taskId),caller={taskId,projectId},requestId=randomUUID();let dispatched=false;
    const admit=()=>{if(this.closed)throw new BrowserError('BROWSER_UNAVAILABLE','浏览器服务已关闭');if(this.options.taskProject(taskId)!==projectId)throw new ApplicationError('SCOPE_DENIED','任务归属已变化');};
    admit();const summary={actor:'user',projectId,action,profileId};this.operations.begin(this.userProfileRun,requestId,taskId,null,'ui profile '+action);
    const send=()=>{dispatched=true;this.operations.update(this.userProfileRun,requestId,'running','unknown',{summary});};
    try{const result=await work(caller,admit,send);this.operations.update(this.userProfileRun,requestId,'succeeded','completed',{summary});this.options.changed?.(taskId);return{result,records:this.profileSiteStates(taskId)};}
    catch(error){this.operations.update(this.userProfileRun,requestId,dispatched?'unknown':'failed',dispatched?'unknown':'not-started',{summary,code:error instanceof ApplicationError?error.code:'BROWSER_ERROR'});throw error;}
  }
  createProfile(taskId:string,label:string){return this.userProfileChange(taskId,'create',null,async(caller,admit,send)=>{admit();return this.profiles.create(caller,label,'isolated',send);});}
  cloneProfile(taskId:string,profileId:string){return this.userProfileChange(taskId,'clone',profileId,(caller,admit,send)=>this.clones.clone(caller,profileId,admit,send));}
  useProfile(taskId:string,pageId:string,profileId:string){return this.userProfileChange(taskId,'set',profileId,async(caller,admit,send)=>{
    const profile=this.profiles.require(caller,profileId,'control');this.profiles.assertAvailable(profile.id);
    const tab=this.workspace.list(taskId).find(tab=>tab.pageId===pageId);if(!tab)throw new BrowserError('BROWSER_TAB_NOT_FOUND','本任务没有这个网页标签');
    if(tab.kind==='popup')throw new ApplicationError('INVALID_INPUT','子窗口沿用来源页面登录态，请切换来源网页标签');
    this.profiles.assertAvailable(tab.profileId);await this.workspace.setProfile(taskId,pageId,profile.id,()=>{admit();this.profiles.require(caller,profile.id,'control');this.profiles.assertAvailable(profile.id);},send);return profile;
  });}
  deleteProfile(taskId:string,profileId:string){return this.userProfileChange(taskId,'delete',profileId,async(caller,admit,send)=>{const profile=this.profiles.deletable(caller,profileId);await this.deleteProfileData(caller,profile,admit,send);return profile.id;});}
  private uiProfile(taskId:string,profileId:string):BrowserProfile{const {projectId}=this.workspace.snapshot(taskId);return this.profiles.require({taskId,projectId},profileId,'control');}
  async importCookieSources(taskId:string){this.workspace.snapshot(taskId);return this.cookieSources.discover();}
  async importCookies(taskId:string,profileId:string,sourceId:string){const profile=this.uiProfile(taskId,profileId);this.imports.assertImportable(profile.id);return this.importAudit.run(taskId,profile.id,'import',()=>this.imports.import(profile,sourceId));}
  async recoverCookies(taskId:string,profileId:string){const profile=this.uiProfile(taskId,profileId);await this.importAudit.run(taskId,profile.id,'recover',()=>this.imports.recover(profile));return this.profileSiteStates(taskId);}
  async clearCookies(taskId:string,profileId:string){const profile=this.uiProfile(taskId,profileId);await this.importAudit.run(taskId,profile.id,'clear',()=>this.imports.clear(profile));return this.profileSiteStates(taskId);}
  revokeCertificate(taskId:string,profileId:string,host:string):void{
    const {projectId}=this.workspace.snapshot(taskId);this.profiles.require({taskId,projectId},profileId,'control');this.profiles.assertAvailable(profileId);
    this.siteStates.revokeCertificate(profileId,host);
    // The network gate reads current decisions on every request. Do not clear
    // its accepted TLS memory or erase the profile's Cookie/localStorage.
    for(const page of this.pages.all().filter(page=>page.profileId===profileId))this.options.changed?.(page.taskId);
  }
  respondPermission(taskId:string,id:string,allow:boolean):void{this.workspace.snapshot(taskId);this.permissions.respond(taskId,id,allow);}
  async respondJavascriptDialog(taskId:string,id:string,accept:boolean,text?:string):Promise<void>{
    this.workspace.snapshot(taskId);
    const page=this.pages.list(taskId).find(value=>this.javascriptDialogs.snapshot(taskId,value.id)?.id===id);
    await this.javascriptDialogs.respond(taskId,id,accept,text);
    if(page?.references?.hasDeferredGuards)await page.references.settleDeferredGuards();
  }
  respondAuthentication(taskId:string,id:string,credentials:{user:string;pass:string}|null):void{this.workspace.snapshot(taskId);this.authentication.respond(taskId,id,credentials);}
  async retryAuthentication(taskId:string,pageId:string):Promise<void>{
    this.workspace.snapshot(taskId);const page=this.pages.get(taskId,pageId),cancelled=this.authentication.cancelledForPage(taskId,pageId);
    if(!cancelled)throw new ApplicationError('RESOURCE_STATE_CHANGED','认证页面已变化，请重试当前页面');this.profiles.assertAvailable(page.profileId);
    if(page.kind==='popup')await this.pages.navigate(page,cancelled.url);else await this.workspace.navigate(taskId,pageId,cancelled.url);
  }
  async downloadAction(taskId:string,id:string,action:'cancel'|'open'|'reveal'|'remove'):Promise<void>{this.workspace.snapshot(taskId);await this.downloads.action(taskId,id,action);}
  revokePermission(taskId:string,profileId:string,origin:string,permission:string):void{
    const {projectId}=this.workspace.snapshot(taskId);this.profiles.require({taskId,projectId},profileId,'control');this.profiles.assertAvailable(profileId);this.siteStates.revokePermission(profileId,origin,permission);
    for(const page of this.pages.all().filter(page=>page.profileId===profileId))this.options.changed?.(page.taskId);
  }
  async preferences(taskId:string){
    this.workspace.snapshot(taskId);return{...this.settings.snapshot(),downloadDirectory:app.getPath('downloads'),artifactBytes:await this.artifacts.usage()};
  }
  async clearArtifacts(taskId:string){this.workspace.snapshot(taskId);await this.artifacts.clear();return this.preferences(taskId);}
  /** Task completion keeps profiles. Only missing task/project owners retire a
   * partition; this also repairs cleanup interrupted by a previous App exit. */
  reconcile():Promise<void>{
    if(this.closed)return Promise.resolve();
    if(this.reconciling){this.reconcileAgain=true;return this.reconciling;}
    this.reconciling=(async()=>{
      do {
      this.reconcileAgain=false;
      await this.imports.initialize();
      await this.clones.initialize();
      await this.workspace.reconcile();let busy=false;
      for(const profile of this.profiles.all()){
        const exists=profile.owner.kind==='task'?(this.options.taskOwnerExists?.(profile.owner.id)??this.options.taskProject(profile.owner.id)!==null):!!this.options.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(profile.owner.id);
        if(exists)continue;
        let release:()=>void;
        try{release=this.profiles.lock(profile.id,'清理');}catch(error){if(error instanceof ApplicationError&&error.code==='RESOURCE_BUSY'){busy=true;continue;}throw error;}
        try{
          await this.pages.cancelProfileInitializations(profile.id);
          await this.workspace.removeProfileBindings(profile.id,taskId=>this.profiles.ensureProject(this.options.taskProject(taskId)!).id,()=>{if(this.closed)throw new BrowserError('BROWSER_UNAVAILABLE','浏览器服务已关闭');},()=>{});
          for(const page of this.pages.all().filter(page=>page.profileId===profile.id))await this.pages.close(page.taskId,page.id);
          await this.clearProfile(profile);
        }finally{release();}
      }
      const recent=this.options.sqlite.prepare('SELECT key FROM app_settings WHERE key LIKE ?').all('browserRecent.v1:%') as {key:string}[];
      for(const row of recent){
        const scope=row.key.slice('browserRecent.v1:'.length),standalone=standaloneTaskId(scope);
        // An archived task is inaccessible to new commands, but is still a
        // durable owner. Unrelated deletions must not erase its login/history.
        const exists=!!this.options.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(scope)||!!(standalone&&(this.options.taskOwnerExists?.(standalone)??verifyStandaloneScope(this.options.sqlite,scope)));
        if(!exists)this.options.sqlite.prepare('DELETE FROM app_settings WHERE key=?').run(row.key);
      }
      if(busy&&!this.closed&&!this.reconcileTimer){this.reconcileTimer=setTimeout(()=>{this.reconcileTimer=undefined;void this.reconcile().catch(()=>console.warn('[browser] orphan-profile cleanup pending'));},250);this.reconcileTimer.unref();}
      // A second owner can disappear after the first scan took its snapshot.
      // Drain another pass before reporting the shared cleanup complete.
      } while(this.reconcileAgain&&!this.closed);
    })().finally(()=>{
      this.reconciling=undefined;
      // A request queued during the promise's final settlement must also be
      // observed; attach its pass to the same completion promise.
      if(this.reconcileAgain&&!this.closed)return this.reconcile();
    });return this.reconciling;
  }
  async dispose():Promise<void>{this.closed=true;this.presentation.invalidate();this.access.dispose();this.automation.dispose();clearTimeout(this.reconcileTimer);await this.scripts.close();await this.reconciling;await this.workspace.dispose();this.downloads.dispose();this.javascriptDialogs.stop();try{await this.pages.dispose();}finally{try{this.javascriptDialogs.dispose();}finally{this.authentication.dispose();this.permissions.dispose();this.networkPolicy.dispose();}}}
}
