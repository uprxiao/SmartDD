import {ApplicationError} from '@shared/applications';
import type {BrowserAccessRun} from './access';

interface Run {binding:BrowserAccessRun;targets:Set<string>;stop:()=>void}
interface Activity {taskId:string;running:Set<{runId:string;finish:()=>void}>;endedAt:number;timer?:ReturnType<typeof setTimeout>}
/** Transient main-process state. Page identities/URLs remain in the workspace;
 * neither activity nor pause may be restored into a new run after restart. */
export class BrowserAutomation {
  private readonly runs=new Map<string,Run>();
  private readonly activities=new Map<string,Activity>();
  private readonly pauses=new Map<string,Set<string>>();
  private closed=false;
  constructor(private readonly options:{changed?:(taskId:string)=>void;ended?:(runId:string)=>void}){}
  private changed(taskId:string){try{this.options.changed?.(taskId);}catch{console.warn('[browser] automation UI notification unavailable');}}
  track(binding:BrowserAccessRun):void{
    if(this.closed||binding.signal.aborted)throw new ApplicationError('SCOPE_DENIED','浏览器运行已结束');
    const previous=this.runs.get(binding.runId);
    if(previous){if(previous.binding.taskId!==binding.taskId||previous.binding.projectId!==binding.projectId||previous.binding.signal!==binding.signal)throw new ApplicationError('SCOPE_DENIED','运行身份与原登记不符');return;}
    // Empty bindings exist only for an idle UI action or direct test host. A
    // subsequent actual run must not inherit that expired pause.
    if(this.pauses.get(binding.taskId)?.size===0){this.pauses.delete(binding.taskId);this.changed(binding.taskId);}
    const stop=()=>this.endRun(binding.runId);this.runs.set(binding.runId,{binding:{...binding},targets:new Set([binding.taskId]),stop});binding.signal.addEventListener('abort',stop,{once:true});
  }
  target(runId:string,taskId:string):void{this.runs.get(runId)?.targets.add(taskId);}
  paused(taskId:string):boolean{return this.pauses.has(taskId);}
  pause(taskId:string,value:boolean):void{
    if(!value)this.pauses.delete(taskId);
    else{
      const owners=[...this.runs.entries()].filter(([,run])=>run.binding.taskId===taskId),drivers=owners.length?owners:[...this.runs.entries()].filter(([,run])=>run.targets.has(taskId));
      this.pauses.set(taskId,new Set(drivers.map(([id])=>id)));
    }
    this.changed(taskId);
  }
  activity(pageId:string){const value=this.activities.get(pageId);return{active:!!value&&(value.running.size>0||Date.now()-value.endedAt<20000),running:!!value?.running.size};}
  begin(runId:string,taskId:string,pageId:string):()=>void{
    if(this.closed)return()=>{};this.target(runId,taskId);
    let value=this.activities.get(pageId);if(value&&value.taskId!==taskId)throw new ApplicationError('RESOURCE_STATE_CHANGED','页面活动归属不符');
    if(!value){value={taskId,running:new Set(),endedAt:0};this.activities.set(pageId,value);}clearTimeout(value.timer);
    const item=value;let finished=false;
    const token:{runId:string;finish:()=>void}={runId,finish:()=>{
      if(finished)return;finished=true;item.running.delete(token);
      if(this.activities.get(pageId)!==item)return;
      if(!item.running.size){item.endedAt=Date.now();item.timer=setTimeout(()=>{if(this.activities.get(pageId)===item&&!item.running.size){this.activities.delete(pageId);this.changed(taskId);}},20000);item.timer.unref?.();}
      this.changed(taskId);
    }};
    item.running.add(token);this.changed(taskId);return token.finish;
  }
  forget(pageId:string):void{const value=this.activities.get(pageId);if(!value)return;clearTimeout(value.timer);this.activities.delete(pageId);for(const token of [...value.running])token.finish();this.changed(value.taskId);}
  endRun(runId:string):void{
    const run=this.runs.get(runId);if(!run)return;run.binding.signal.removeEventListener('abort',run.stop);this.runs.delete(runId);
    for(const [taskId,ids]of this.pauses)if(ids.delete(runId)&&!ids.size){this.pauses.delete(taskId);this.changed(taskId);}
    for(const value of this.activities.values())for(const token of [...value.running])if(token.runId===runId)token.finish();
    this.options.ended?.(runId);
  }
  dispose():void{if(this.closed)return;this.closed=true;for(const id of [...this.runs.keys()])this.endRun(id);for(const id of [...this.activities.keys()])this.forget(id);this.pauses.clear();}
}
