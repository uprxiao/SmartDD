/** Host-owned diagnostic collection; never issues tool or user-input authority. */
export class SkillObservationMonitor {
 private readonly entries=new Map<string,{cancel:()=>void}>();
 private closed=false;
 constructor(private readonly collect:(taskId:string,runId:string)=>Promise<void>,private readonly intervalMs=2000){}
 start(taskId:string,runId:string,signal:AbortSignal):void{
  if(this.closed||signal.aborted||this.entries.has(runId))return;
  let timer:ReturnType<typeof setTimeout>|undefined,canceled=false;
  const cancel=()=>{if(canceled)return;canceled=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',cancel);this.entries.delete(runId);};
  this.entries.set(runId,{cancel});signal.addEventListener('abort',cancel,{once:true});
  const tick=async()=>{
   if(canceled||this.closed)return;
   try{await this.collect(taskId,runId);}catch{/* Missing evidence cannot interrupt the Agent. */}
   if(!canceled&&!this.closed){timer=setTimeout(()=>{void tick();},this.intervalMs);timer.unref();}
  };
  void tick();
 }
 close():void{this.closed=true;for(const entry of [...this.entries.values()])entry.cancel();}
}
