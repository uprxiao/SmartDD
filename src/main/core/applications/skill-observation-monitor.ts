/** Host-owned diagnostic collection; never issues tool or user-input authority. */
export class SkillObservationMonitor {
 private readonly entries=new Map<string,{cancel:()=>void;refresh:()=>void}>();
 private closed=false;
 constructor(private readonly collect:(taskId:string,runId:string)=>Promise<void>,private readonly intervalMs=2000){}
 start(taskId:string,runId:string,signal:AbortSignal):void{
  if(this.closed||signal.aborted)return;
  const existing=this.entries.get(runId);if(existing){existing.refresh();return;}
  let timer:ReturnType<typeof setTimeout>|undefined,canceled=false,running=false,requested=false;
  const cancel=()=>{if(canceled)return;canceled=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',cancel);this.entries.delete(runId);};
  const tick=async()=>{
   if(canceled||this.closed)return;
   if(running){requested=true;return;}
   running=true;
   try{await this.collect(taskId,runId);}catch{/* Missing evidence cannot interrupt the Agent. */}
   running=false;
   if(!canceled&&!this.closed){const delay=requested?0:this.intervalMs;requested=false;timer=setTimeout(()=>{void tick();},delay);timer.unref();}
  };
  const refresh=()=>{if(canceled||this.closed)return;if(timer)clearTimeout(timer);void tick();};
  this.entries.set(runId,{cancel,refresh});signal.addEventListener('abort',cancel,{once:true});
  void tick();
 }
 close():void{this.closed=true;for(const entry of [...this.entries.values()])entry.cancel();}
}
