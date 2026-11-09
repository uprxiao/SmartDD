type Attached = {method?:string;sessionId?:string;params?:{sessionId?:string;targetInfo?:{type?:string;targetId?:string}}};
type ProxyLike = {sessions:ReadonlyMap<string,{type?:string;targetId?:string}>;emit:(...args:any[])=>void};
type HelperLike = {command:(...args:any[])=>Promise<any>};
/** Test-only delay of real page-owned iframe attachment messages. Never changes
 * the proxy's frame sessions, guard initialization, AX, input, reply, or session.
 * Every deferred original call retains exact receiver and argument identities. */
export function holdOwnedIframeAttachments(proxy:ProxyLike,helper:HelperLike,record:(value:unknown)=>void){
 const originalEmit=proxy.emit,originalCommand=helper.command,pending:{receiver:any;args:any[];ordinal:number}[]=[];
 let active=true,finished=false,started=false,ordinal=0;
 const state={active:true,firstSnapshotStarted:false,reason:null as string|null,delayed:[]as any[],released:[]as any[],restored:false,errors:[]as string[]};
 function release(reason:string){
  if(finished)return state;finished=true;active=false;state.active=false;state.reason=reason;
  if(proxy.emit===delayedEmit)proxy.emit=originalEmit;else state.errors.push('emit reference changed while gate owned');
  if(helper.command===observedCommand)helper.command=originalCommand;else state.errors.push('command reference changed while gate owned');
  state.restored=proxy.emit===originalEmit&&helper.command===originalCommand;
  for(const item of pending.splice(0)){try{Reflect.apply(originalEmit,item.receiver,item.args);state.released.push({ordinal:item.ordinal,originalCall:true});}catch(e){state.errors.push(String(e));}}
  record({kind:'owned-iframe-delay-finished',...state});return state;
 }
 function delayedEmit(this:any,...args:any[]){
  const event=args[1]as Attached|undefined,sid=event?.params?.sessionId,info=event?.params?.targetInfo,owner=typeof sid==='string'?proxy.sessions.get(sid):undefined;
  if(active&&event?.method==='Target.attachedToTarget'&&info?.type==='iframe'&&owner?.type==='iframe'&&typeof info.targetId==='string'&&owner.targetId===info.targetId){
   const id=++ordinal;pending.push({receiver:this,args,ordinal:id});state.delayed.push({ordinal:id,attachedSessionId:sid,targetId:info.targetId,wireSessionId:event.sessionId??null});record({kind:'owned-iframe-attachment-delayed',...state.delayed.at(-1)});return;
  }
  return Reflect.apply(originalEmit,this,args);
 }
 function observedCommand(this:any,...args:any[]){
  const first=active&&!started&&Array.isArray(args[0])&&args[0][0]==='snapshot';if(first){started=true;state.firstSnapshotStarted=true;record({kind:'first-real-snapshot-entered'});}
  let promise:Promise<any>;try{promise=Reflect.apply(originalCommand,this,args);}catch(error){if(first)release('first-snapshot-sync-error');throw error;}
  if(first)void promise.then(()=>release('first-snapshot-resolved'),()=>release('first-snapshot-rejected')).catch(error=>{state.errors.push(String(error));record({kind:'gate-release-observation-error',message:String(error)});});
  return promise;
 }
 proxy.emit=delayedEmit;helper.command=observedCommand;
 return{state,release,get originalEmit(){return originalEmit;},get originalCommand(){return originalCommand;}};
}
