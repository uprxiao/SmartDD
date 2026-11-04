import { ApplicationError } from '@shared/applications';
import { applicationPreflightFailure } from '../applications/capability-preflight';
import { BrowserPageRegistry, type BrowserPage } from './page-registry';
import { BrowserArtifacts, browserDigest } from './artifacts';
import { BrowserOperations } from './operations';
import { BrowserError, staleReference } from './errors';
import type Database from 'better-sqlite3';
import { app, nativeImage, session, type BrowserWindow } from 'electron';
import { BrowserInputInterrupted, type BrowserHelperOptions } from './agent-browser';
import { join,resolve,isAbsolute } from 'node:path';
import { browserExecArguments } from './exec-policy';
import type { BrowserProgress } from './input-progress';
import {BrowserWorkspace} from './workspace';
import type {BrowserShortcut} from '@shared/browser-workspace';
import {normalizeBrowserNavigationUrl} from '@shared/browser-navigation';
import browserCommands from '@shared/browser-commands.generated.json';
import {executeBrowserPageCommand} from './page-commands';
import {BrowserConditionWait} from './wait';
import {BrowserRecorder} from './recorder';
import {BrowserProfiles} from './profiles';
import {executeBrowserCookie} from './cookies';
import type {BrowserProfile} from '@shared/browser-profiles';
import {BrowserSettings,browserUserAgent} from './settings';
import {browserIdentitySchema} from '@shared/browser-settings';
import {randomUUID} from 'node:crypto';
import {BrowserSiteStates} from './site-state';
import {BrowserNetworkPolicy} from './network-policy';
import type {BrowserCertificateState} from '@shared/browser-workspace';
import {BrowserPermissions} from './permissions';
import {BrowserDownloads} from './downloads';
let nativeUserAgent:string|undefined;

export interface BrowserScope {
  projectId:string;taskId:string;runId:string;requestId:string;operationId:string;signal:AbortSignal;assertActive():void;
}
const readCommands=new Set(browserCommands.filter(command=>command.semantics==='read').map(command=>command.command.slice(1).join(' ')));
const text=(value:unknown):string=>{
  if(!['string','number','boolean'].includes(typeof value))throw new ApplicationError('INVALID_INPUT','文本字段只接受字符串、数字或布尔值');
  return String(value);
};

/** Host-owned pages only. Both authenticated module calls and future UI placement share this service. */
export class BrowserService {
  readonly pages:BrowserPageRegistry;
  readonly operations:BrowserOperations;
  readonly workspace:BrowserWorkspace;
  readonly profiles:BrowserProfiles;
  readonly settings:BrowserSettings;
  readonly siteStates:BrowserSiteStates;
  readonly networkPolicy:BrowserNetworkPolicy;
  readonly permissions:BrowserPermissions;
  readonly downloads:BrowserDownloads;
  private readonly certificateFailures=new Map<string,BrowserCertificateState>();
  private readonly artifacts:BrowserArtifacts;
  private readonly paused=new Set<string>();
  private readonly readWaits=new Map<string,Set<AbortController>>();
  private closed=false;
  private readonly conditions=new WeakMap<BrowserPage,BrowserConditionWait>();
  private readonly recordings=new WeakMap<BrowserPage,BrowserRecorder>();
  private reconciling?:Promise<void>;
  private reconcileTimer?:ReturnType<typeof setTimeout>;
  constructor(private readonly options:{userData:string;sqlite:Database.Database;helper:Pick<BrowserHelperOptions,'executable'|'sha256'|'processes'>;taskProject:(taskId:string)=>string|null;taskDirectory?:(taskId:string)=>string|null;window?:()=>BrowserWindow|null;changed?:(taskId:string)=>void;shortcut?:(taskId:string,action:BrowserShortcut)=>void}){
    this.settings=new BrowserSettings(options.sqlite);nativeUserAgent??=app.userAgentFallback;app.userAgentFallback=browserUserAgent(nativeUserAgent,this.settings.snapshot().identity);
    this.profiles=new BrowserProfiles(options);
    this.siteStates=new BrowserSiteStates(options.sqlite,id=>this.profiles.all().some(profile=>profile.id===id));
    this.permissions=new BrowserPermissions({states:this.siteStates,available:id=>{this.profiles.assertAvailable(id);return this.profiles.all().some(profile=>profile.id===id);},changed:options.changed});
    this.downloads=new BrowserDownloads({directory:()=>app.getPath('downloads'),available:(id,taskId)=>{this.profiles.assertAvailable(id);return!!options.taskProject(taskId)&&this.profiles.all().some(profile=>profile.id===id);},changed:options.changed});
    this.networkPolicy=new BrowserNetworkPolicy({trusted:(id,host)=>this.siteStates.trusted(id,host),failed:(contents,failure)=>{
      const page=this.pages.all().find(page=>page.contents===contents);if(!page)return;
      this.certificateFailures.set(page.id,{...failure,challengeId:randomUUID()});this.workspace.certificateFailed(page,failure.url,failure.error);
    }});
    this.pages=new BrowserPageRegistry({...options,profiles:this.profiles,configure:page=>{
      this.networkPolicy.install(page.contents,page.profileId);
      this.permissions.install({contents:page.contents,taskId:page.taskId,pageId:page.id,profileId:page.profileId});
      this.downloads.install({contents:page.contents,taskId:page.taskId,pageId:page.id,profileId:page.profileId});
      page.contents.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace)this.certificateFailures.delete(page.id);});
      page.contents.once('destroyed',()=>this.certificateFailures.delete(page.id));
    }});this.operations=new BrowserOperations(options.sqlite);this.operations.recover();
    this.pages.observe(event=>{if(event.type==='created'){this.conditions.set(event.page,new BrowserConditionWait(event.page));this.recordings.set(event.page,new BrowserRecorder(event.page));}});
    this.workspace=new BrowserWorkspace({...options,pages:this.pages,searchEngine:()=>this.settings.snapshot().searchEngine,downloads:taskId=>this.downloads.snapshot(taskId),permission:(taskId,pageId)=>this.permissions.snapshot(taskId,pageId),certificate:(id,url)=>{
      const failure=this.certificateFailures.get(id);if(failure?.url===url)return failure;
      const page=this.pages.all().find(page=>page.id===id),accepted=page?this.networkPolicy.certificate(page.contents,url):null;
      return accepted?{...accepted,challengeId:null}:null;
    }});
    this.artifacts=new BrowserArtifacts(join(options.userData,'browser/artifacts'));
  }
  pause(taskId:string,value:boolean):void{
    if(value){
      this.paused.add(taskId);
      for(const page of this.pages.list(taskId))page.queue.cancelQueued(new BrowserError('BROWSER_PAUSED','用户已暂停浏览器，排队操作已取消'));
      for(const wait of this.readWaits.get(taskId)??[])wait.abort(new BrowserError('BROWSER_PAUSED','用户已暂停浏览器'));
    }
    else this.paused.delete(taskId);
  }
  private admit(scope:BrowserScope,args:Record<string,unknown>):void{
    scope.assertActive();
    if(this.closed)throw new BrowserError('BROWSER_UNAVAILABLE','浏览器服务已关闭');
    if(this.options.taskProject(scope.taskId)!==scope.projectId||args.task!==undefined&&args.task!==scope.taskId)throw new ApplicationError('SCOPE_DENIED','当前运行没有这个任务的浏览器授权');
    if(this.paused.has(scope.taskId))throw new BrowserError('BROWSER_PAUSED','用户已暂停浏览器');
    if(scope.signal.aborted)throw scope.signal.reason??new ApplicationError('CANCELED','浏览器操作已取消');
  }
  async execute(scope:BrowserScope,command:string,args:Record<string,unknown>):Promise<unknown>{
    const read=readCommands.has(command);let dispatched=false,page:BrowserPage|undefined,progress:BrowserProgress|undefined;
    const send=()=>{dispatched=true;if(!read)this.operations.update(scope.runId,scope.requestId,'running','unknown',{progress});};
    const recordProgress=()=>{if(!read)this.operations.update(scope.runId,scope.requestId,'running','unknown',{progress});};
    try{
      this.admit(scope,args);
      if(!browserCommands.some(item=>item.command.slice(1).join(' ')===command))throw new ApplicationError('CAPABILITY_UNAVAILABLE','浏览器命令未登记');
      if(command==='tab profile clone'){this.profiles.require(scope,text(args.profile));throw new ApplicationError('CAPABILITY_UNAVAILABLE','登录态完整克隆尚在开发');}
      if(command==='access request'||command==='set credentials')throw new ApplicationError('CAPABILITY_UNAVAILABLE','此命令依赖尚在开发的认证或授权服务');
      if(command==='operation get')return this.operations.receipt(scope.runId,text(args.request));
      if(command==='identity get'){const value=this.settings.snapshot();return{result:{mode:value.identity,pendingMode:value.pendingIdentity,restartRequired:value.pendingIdentity!==null}};}
      if(command==='identity set'){
        const mode=browserIdentitySchema.safeParse(args.mode);if(!mode.success)throw new ApplicationError('INVALID_INPUT','浏览器身份须为clean或native');
        const receipt=this.operations.begin(scope.runId,scope.requestId,scope.taskId,null,command);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const result=this.settings.setIdentity(mode.data,args.reset===true,send);this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result};
      }
      if(command==='tab profile list')return{result:{profiles:this.profiles.list(scope)}};
      if(command==='tab profile create'){
        const profileScope=args.scope??'isolated';if(profileScope!=='isolated'&&profileScope!=='imported')throw new ApplicationError('INVALID_INPUT','scope须为isolated或imported');
        const receipt=this.operations.begin(scope.runId,scope.requestId,scope.taskId,null,command);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const profile=this.profiles.create(scope,text(args.label),profileScope,send);this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result:{profile}};
      }
      if(command==='tab profile show'){
        const tab=this.workspace.list(scope.taskId).find(tab=>tab.pageId===text(args.page));if(!tab)throw new BrowserError('BROWSER_TAB_NOT_FOUND','没有该网页标签');
        this.profiles.ensureProject(scope.projectId);const profile=this.profiles.require(scope,tab.profileId);return{result:{browserPageId:tab.pageId,profileId:profile.id,profileLabel:profile.label}};
      }
      if(command==='tab profile set'||command==='tab profile use-default'){
        if(command==='tab profile set'&&(args.page===undefined)===(args.task===undefined))throw new ApplicationError('INVALID_INPUT','set须指定page或task其中一个');
        const profile=command==='tab profile use-default'?this.profiles.ensureProject(scope.projectId):this.profiles.require(scope,text(args.profile),'control');
        this.profiles.assertAvailable(profile.id);
        const tabs=this.workspace.list(scope.taskId),targets=args.page===undefined?tabs.filter(tab=>tab.kind==='tab'):tabs.filter(tab=>tab.pageId===text(args.page));
        if(args.page!==undefined&&!targets.length)throw new BrowserError('BROWSER_TAB_NOT_FOUND','没有该网页标签');
        if(targets.some(tab=>tab.kind==='popup'))throw new ApplicationError('INVALID_INPUT','子窗口沿用来源页面登录态，请切换来源网页标签');
        const receipt=this.operations.begin(scope.runId,scope.requestId,scope.taskId,null,command);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        for(const tab of targets){this.profiles.assertAvailable(tab.profileId);await this.workspace.setProfile(scope.taskId,tab.pageId,profile.id,()=>{this.admit(scope,args);this.profiles.assertAvailable(profile.id);},send,scope.signal);}
        this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result:{profileId:profile.id,pages:targets.map(tab=>tab.pageId)}};
      }
      if(command==='tab profile delete'){
        const profile=this.profiles.deletable(scope,text(args.profile));
        const receipt=this.operations.begin(scope.runId,scope.requestId,scope.taskId,null,command);if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
        const release=this.profiles.lock(profile.id,'删除');
        try{
          await this.pages.cancelProfileInitializations(profile.id);
          await this.workspace.removeProfileBindings(profile.id,taskId=>this.profiles.ensureProject(this.options.taskProject(taskId)!).id,()=>this.admit(scope,args),send);
          // Child windows close with their opener. An orphan task may still have
          // a native view until reconciliation; close it before clearing data.
          for(const remaining of this.pages.all().filter(page=>page.profileId===profile.id)){
            if(remaining.kind!=='popup'&&this.options.taskProject(remaining.taskId))throw new ApplicationError('RESOURCE_BUSY','仍有网页使用此登录态');
            send();await this.pages.close(remaining.taskId,remaining.id);
          }
          this.admit(scope,args);send();await this.clearProfile(profile);
          this.operations.update(scope.runId,scope.requestId,'succeeded','completed');return{result:{deleted:profile.id}};
        }finally{release();}
      }
      if(command==='tab list')return{tabs:this.workspace.list(scope.taskId)};
      if(command==='tab show'||command==='tab current'){
        const tabs=this.workspace.list(scope.taskId),tab=command==='tab show'?tabs.find(tab=>tab.pageId===text(args.page)):tabs.find(tab=>tab.active);
        if(!tab)throw new BrowserError(command==='tab show'?'BROWSER_TAB_NOT_FOUND':'BROWSER_NO_TAB','没有可读取的网页标签');return{result:tab};
      }
      if((command==='tab switch'||command==='tab close')&&args.index!==undefined){
        if(args.page!==undefined||!Number.isInteger(args.index)||Number(args.index)<0)throw new ApplicationError('INVALID_INPUT','index与page只能指定一个，index必须是非负整数');
        const target=this.workspace.list(scope.taskId)[Number(args.index)];if(!target)throw new BrowserError('BROWSER_TAB_NOT_FOUND','标签索引不存在');args={...args,page:target.pageId};
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
      if(command==='tab create'&&args.profile!==undefined)this.profiles.require(scope,text(args.profile));
      if(command!=='tab create')page=await this.workspace.target(scope.taskId,args.page===undefined?undefined:text(args.page));
      if(!read){
        const receipt=this.operations.begin(scope.runId,scope.requestId,scope.taskId,page?.id??null,command);
        if(receipt.replay)return{operation:this.operations.receipt(scope.runId,scope.requestId),replayed:true};
      }
      let result:unknown;
      if(command==='tab create'){
        send();page=await this.pages.create(scope.taskId,scope.projectId,undefined,args.profile===undefined?undefined:text(args.profile));
        if(navigation!==undefined)await this.pages.navigate(page,navigation);
        result={pageId:page.id,url:page.contents.getURL()};
      }else{
        const target=page!;
        result=await target.queue.run(()=>this.admit(scope,args),async()=>{
          const deadline=new AbortController(),budget=command==='wait'||command==='wait fn'?Number(args.timeout??25000)+5000:90000;
          const timer=setTimeout(()=>deadline.abort(new BrowserError('BROWSER_TIMEOUT',`浏览器命令等待 ${budget}ms 后超时`)),budget);
          const signal=AbortSignal.any([scope.signal,target.abort.signal,deadline.signal]);
          const perform=async()=>{
          if(signal.aborted)throw signal.reason;
          this.profiles.assertAvailable(target.profileId);
          if(command.startsWith('cookie '))return executeBrowserCookie(target,command,args,send);
          if(command==='tab switch'){this.workspace.commandTarget(scope.taskId,target.id,args.focus===true);send();return{result:{pageId:target.id,url:target.contents.getURL()}};}
          if(command==='tab close'){
            send();if(target.kind==='popup')await this.pages.close(scope.taskId,target.id,true);else await this.workspace.close(scope.taskId,target.id,true);
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
            send();await this.pages.navigate(target,url);return{navigated:true};
          }
          if(command==='back'||command==='forward'||command==='reload'){
            const wc=target.contents;send();
            if(command==='reload')await this.pages.navigate(target,target.hostNavigation??wc.getURL());
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
            ...await target.references.snapshot(target.helper,signal),browserPageId:target.id,url:target.contents.getURL(),title:target.contents.getTitle(),
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
                if(execArgs![0]==='fill'&&refIndex===1)value=await armed.fill(execArgs!.slice(2).join(' '),actionOptions);
                else if(execArgs![0]==='click'&&refIndex===1&&armed.hostClick)value=await armed.click(actionOptions);
                else value=await target.helper.command(native,{signal,dispatched:send});
              }catch(e){error=e;}
              const guard=await armed.finish();if(guard.blocked.length||!guard.connected){if(!guard.accepted.length)dispatched=false;throw staleReference();}if(error)throw error;
              if(execArgs![0]==='click'&&!guard.accepted.includes('click'))throw new BrowserError('BROWSER_ERROR','未确认点击事件送达页面；结果未知，请先核对页面，勿重发');
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
              if(command==='fill')value=await armed.fill(text(args.value),actionOptions);
              else if(armed.hostClick)value=await armed.click(actionOptions);
              else value=await target.helper.command(['click',armed.selector],{signal,dispatched:send});
            }catch(e){error=e;}
            const guard=await armed.finish();
            if(guard.blocked.length||!guard.connected){
              // An old ref replaced before any event is demonstrably not-started. Partial delivery remains unknown.
              if(!guard.accepted.length)dispatched=false;
              throw staleReference();
            }
            if(error)throw error;
            if(command==='click'&&!guard.accepted.includes('click'))
              throw new BrowserError('BROWSER_ERROR','未确认点击事件送达页面；结果未知，请先核对页面，勿重发');
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
            const abort=new AbortController(),waits=this.readWaits.get(scope.taskId)??new Set<AbortController>();waits.add(abort);this.readWaits.set(scope.taskId,waits);
            const timeout=Number(args.timeout??25000),native=['wait'];
            if(args.selector!==undefined)native.push(text(args.selector));
            for(const key of ['text','url','load','state'] as const)if(args[key]!==undefined)native.push('--'+key,text(args[key]));
            native.push('--timeout',String(timeout));
            const waitSignal=AbortSignal.any([signal,abort.signal]),count=['selector','text','url','load'].filter(key=>args[key]!==undefined).length;
            try{
              if(args.state!==undefined||count>1)return await this.conditions.get(target)!.run(args,waitSignal);
              if(count===0){await target.helper.command(['wait',String(timeout)],{signal:waitSignal,timeout:timeout+5000});return{waited:true};}
              await target.helper.command(native,{signal:waitSignal,timeout:timeout+5000});return{waited:true};
            }
            finally{waits.delete(abort);if(!waits.size)this.readWaits.delete(scope.taskId);}
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
          try{const value=await perform();if(signal.aborted&&command!=='tab close')throw signal.reason;return value;}
          finally{clearTimeout(timer);}
        },scope.signal);
      }
      if(!read)this.operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:result,progress});
      return result;
    }catch(error){
      let failure=error instanceof ApplicationError?error:new BrowserError('BROWSER_ERROR',error instanceof Error?error.message:String(error));
      if(page?.closed&&dispatched)failure=new BrowserError('BROWSER_TAB_CLOSED','执行中网页已关闭，操作结果未知');
      if(!read&&this.operations.get(scope.runId,scope.requestId))this.operations.update(scope.runId,scope.requestId,dispatched?'unknown':'failed',dispatched?'unknown':'not-started',{progress,code:failure.code});
      throw dispatched||read?failure:applicationPreflightFailure(failure,scope.operationId);
    }
  }
  private async clearProfile(profile:BrowserProfile):Promise<void>{
    const partition=session.fromPartition(profile.partition);await partition.closeAllConnections();await partition.clearData();await partition.clearAuthCache();
    this.siteStates.forget(profile.id);this.profiles.forget(profile.id);
  }
  /** UI-only; never part of the browser command module. Bind approval to the
   * exact outstanding failed navigation so a stale click cannot trust a new host. */
  async continueCertificate(taskId:string,pageId:string,challengeId:string):Promise<void>{
    this.workspace.snapshot(taskId);const page=this.pages.get(taskId,pageId),failure=this.certificateFailures.get(pageId);
    if(!failure||failure.challengeId!==challengeId)throw new ApplicationError('RESOURCE_STATE_CHANGED','证书提示已失效，请重试当前页面');
    this.profiles.require({taskId,projectId:page.projectId},page.profileId,'control');this.profiles.assertAvailable(page.profileId);
    this.siteStates.trust(page.profileId,failure.host);this.certificateFailures.delete(pageId);
    if(page.kind==='popup')await this.pages.navigate(page,failure.url);else await this.workspace.navigate(taskId,pageId,failure.url);
  }
  profileSiteStates(taskId:string){
    const {projectId}=this.workspace.snapshot(taskId);
    return this.profiles.list({taskId,projectId}).map(profile=>({profile,state:this.siteStates.snapshot(profile.id)}));
  }
  revokeCertificate(taskId:string,profileId:string,host:string):void{
    const {projectId}=this.workspace.snapshot(taskId);this.profiles.require({taskId,projectId},profileId,'control');this.profiles.assertAvailable(profileId);
    this.siteStates.revokeCertificate(profileId,host);
    // The network gate reads current decisions on every request. Do not clear
    // its accepted TLS memory or erase the profile's Cookie/localStorage.
    for(const page of this.pages.all().filter(page=>page.profileId===profileId))this.options.changed?.(page.taskId);
  }
  respondPermission(taskId:string,id:string,allow:boolean):void{this.workspace.snapshot(taskId);this.permissions.respond(taskId,id,allow);}
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
    if(this.closed)return Promise.resolve();if(this.reconciling)return this.reconciling;
    this.reconciling=(async()=>{
      await this.workspace.reconcile();let busy=false;
      for(const profile of this.profiles.all()){
        const exists=profile.owner.kind==='task'?this.options.taskProject(profile.owner.id)!==null:!!this.options.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(profile.owner.id);
        if(exists)continue;
        let release:()=>void;
        try{release=this.profiles.lock(profile.id,'清理');}catch(error){if(error instanceof ApplicationError&&error.code==='RESOURCE_BUSY'){busy=true;continue;}throw error;}
        try{
          await this.pages.cancelProfileInitializations(profile.id);
          for(const page of this.pages.all().filter(page=>page.profileId===profile.id))await this.pages.close(page.taskId,page.id);
          await this.clearProfile(profile);
        }finally{release();}
      }
      const recent=this.options.sqlite.prepare('SELECT key FROM app_settings WHERE key LIKE ?').all('browserRecent.v1:%') as {key:string}[];
      for(const row of recent)if(!this.options.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(row.key.slice('browserRecent.v1:'.length)))this.options.sqlite.prepare('DELETE FROM app_settings WHERE key=?').run(row.key);
      if(busy&&!this.closed&&!this.reconcileTimer){this.reconcileTimer=setTimeout(()=>{this.reconcileTimer=undefined;void this.reconcile().catch(()=>console.warn('[browser] orphan-profile cleanup pending'));},250);this.reconcileTimer.unref();}
    })().finally(()=>{this.reconciling=undefined;});return this.reconciling;
  }
  async dispose():Promise<void>{this.closed=true;clearTimeout(this.reconcileTimer);await this.reconciling;await this.workspace.dispose();this.downloads.dispose();await this.pages.dispose();this.permissions.dispose();this.networkPolicy.dispose();}
}
