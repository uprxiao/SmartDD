import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import type {BrowserAccessMode,BrowserAccessRequest,BrowserAccessGrant,BrowserAccessState} from '@shared/browser-access';

/** Minted by the authenticated host, never accepted from CLI/renderer arguments.
 * signal is the run lifetime, not the current command's shorter cancellation. */
export interface BrowserAccessRun {runId:string;taskId:string;projectId:string;signal:AbortSignal}
export interface BrowserAccessAudit {
  request:Omit<BrowserAccessRequest,'expiresAt'>;result:'requested'|'allowed'|'denied'|'revoked';
  source:'agent'|'user'|'timeout'|'run-end'|'command-cancel'|'scope-changed'|'shutdown';at:number;
}
interface Pending {request:BrowserAccessRequest;finish:(allow:boolean,source:BrowserAccessAudit['source'])=>void}
interface Tracked {binding:BrowserAccessRun;stop:()=>void;grants:Map<string,BrowserAccessGrant>}

/** In-memory run grants. Reading this state never creates or renews authority. */
export class BrowserAccess {
  private readonly runs=new Map<string,Tracked>();
  private readonly pending=new Map<string,Pending>();
  private closed=false;
  constructor(private readonly options:{taskProject:(id:string)=>string|null;changed?:()=>void;audit?:(event:BrowserAccessAudit)=>void}){}
  private valid(binding:BrowserAccessRun):boolean{return!this.closed&&!binding.signal.aborted&&this.options.taskProject(binding.taskId)===binding.projectId;}
  private event(request:BrowserAccessAudit['request'],result:BrowserAccessAudit['result'],source:BrowserAccessAudit['source']):boolean{
    try{this.options.audit?.({request:{...request},result,source,at:Date.now()});return true;}catch{console.warn('[browser] access audit unavailable');return false;}
  }
  private changed(){try{this.options.changed?.();}catch{console.warn('[browser] access UI notification unavailable');}}
  track(binding:BrowserAccessRun):void{
    if(!this.valid(binding))throw new ApplicationError('SCOPE_DENIED','浏览器运行身份已失效');
    const previous=this.runs.get(binding.runId);
    if(previous){if(previous.binding.taskId!==binding.taskId||previous.binding.projectId!==binding.projectId||previous.binding.signal!==binding.signal)throw new ApplicationError('SCOPE_DENIED','运行身份与宿主登记不符');return;}
    const stop=()=>this.endRun(binding.runId);this.runs.set(binding.runId,{binding:{...binding},stop,grants:new Map()});binding.signal.addEventListener('abort',stop,{once:true});
  }
  private run(runId:string):Tracked{
    const run=this.runs.get(runId);if(!run||!this.valid(run.binding))throw new ApplicationError('SCOPE_DENIED','浏览器运行授权已失效');return run;
  }
  can(runId:string,targetTaskId:string,semantics:'read'|'write'):boolean{
    let run:Tracked;try{run=this.run(runId);}catch{return false;}
    if(this.options.taskProject(targetTaskId)!==run.binding.projectId)return false;
    if(targetTaskId===run.binding.taskId)return true;
    const grant=run.grants.get(targetTaskId);return!!grant&&(semantics==='read'||grant.mode==='control');
  }
  require(runId:string,targetTaskId:string,semantics:'read'|'write'):void{if(!this.can(runId,targetTaskId,semantics))throw new ApplicationError('SCOPE_DENIED','本次运行没有该任务的浏览器授权');}
  request(binding:BrowserAccessRun,targetTaskId:string,mode:BrowserAccessMode,signal:AbortSignal):Promise<BrowserAccessGrant>{
    this.track(binding);this.run(binding.runId);
    if(!['observe','control'].includes(mode))throw new ApplicationError('INVALID_INPUT','授权模式须为observe或control');
    if(targetTaskId===binding.taskId||this.options.taskProject(targetTaskId)!==binding.projectId)throw new ApplicationError('SCOPE_DENIED','只能申请同项目其他任务的浏览器授权');
    if(signal.aborted)throw new ApplicationError('SCOPE_DENIED','授权申请已取消');
    const request:BrowserAccessRequest={id:randomUUID(),runId:binding.runId,projectId:binding.projectId,requesterTaskId:binding.taskId,targetTaskId,mode,createdAt:Date.now(),expiresAt:Date.now()+60000};
    if(!this.event(request,'requested','agent'))throw new ApplicationError('BROWSER_UNAVAILABLE','授权记录不可用，未发起申请');
    this.run(binding.runId);if(signal.aborted)throw new ApplicationError('SCOPE_DENIED','授权申请已取消');
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(allow:boolean,source:BrowserAccessAudit['source'])=>{
        if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);this.pending.delete(request.id);
        const valid=this.valid(binding)&&this.options.taskProject(targetTaskId)===binding.projectId&&this.runs.get(binding.runId)?.binding.signal===binding.signal;
        let granted:BrowserAccessGrant|undefined;
        if(allow&&valid&&this.event(request,'allowed',source)){
          const run=this.runs.get(binding.runId),current=()=>!!run&&this.runs.get(binding.runId)===run&&this.valid(binding)&&this.options.taskProject(targetTaskId)===binding.projectId;
          if(current()){
            const previous=run!.grants.get(targetTaskId);if(previous)this.event(previous,'revoked',source);
            if(current()){const {expiresAt,...identity}=request;granted={...identity,grantedAt:Date.now()};run!.grants.set(targetTaskId,granted);}
          }
        }
        if(granted)resolve({...granted});
        else{this.event(request,'denied',allow?'scope-changed':source);reject(new ApplicationError('SCOPE_DENIED','浏览器跨任务授权被拒绝或已失效'));}
        this.changed();
      };
      const cancel=()=>finish(false,'command-cancel'),timer=setTimeout(()=>finish(false,'timeout'),60000);timer.unref?.();
      this.pending.set(request.id,{request,finish});signal.addEventListener('abort',cancel,{once:true});this.changed();
      // A cancellation delivered while observers were notified must not leave
      // a late user click capable of installing an abandoned grant.
      if(signal.aborted)cancel();
    });
  }
  /** Called only by a trusted main-window controller. */
  respond(id:string,allow:boolean):void{
    const pending=this.pending.get(id);if(!pending)throw new ApplicationError('RESOURCE_STATE_CHANGED','授权申请已结束，请核对当前请求');
    pending.finish(allow,'user');
  }
  revoke(id:string):void{
    for(const run of this.runs.values())for(const [target,grant]of run.grants)if(grant.id===id){run.grants.delete(target);this.event(grant,'revoked','user');this.changed();return;}
    throw new ApplicationError('RESOURCE_STATE_CHANGED','原授权已失效');
  }
  snapshot():BrowserAccessState{
    // Reconcile deleted/moved tasks on every trusted read as well as use.
    for(const pending of [...this.pending.values()]){
      const run=this.runs.get(pending.request.runId);
      if(!run||!this.valid(run.binding)||this.options.taskProject(pending.request.targetTaskId)!==pending.request.projectId)pending.finish(false,'scope-changed');
    }
    const grants:BrowserAccessGrant[]=[];
    for(const run of this.runs.values())for(const [target,grant]of run.grants){if(!this.valid(run.binding)||this.options.taskProject(target)!==run.binding.projectId){run.grants.delete(target);this.event(grant,'revoked','scope-changed');}else grants.push({...grant});}
    return{requests:[...this.pending.values()].map(value=>({...value.request})),grants};
  }
  endRun(runId:string):void{
    const run=this.runs.get(runId);if(!run)return;run.binding.signal.removeEventListener('abort',run.stop);this.runs.delete(runId);
    for(const pending of [...this.pending.values()])if(pending.request.runId===runId)pending.finish(false,'run-end');
    for(const grant of run.grants.values())this.event(grant,'revoked','run-end');this.changed();
  }
  dispose():void{
    if(this.closed)return;this.closed=true;for(const pending of [...this.pending.values()])pending.finish(false,'shutdown');for(const id of [...this.runs.keys()])this.endRun(id);
  }
}
