import {BrowserError} from './errors';

export interface BrowserReferenceGuardState {
  blocked:string[];
  accepted:string[];
  connected:boolean;
  pending?:boolean;
}
export interface BrowserReferenceDeferral {
  failed?:(reason:'stale'|'unknown')=>void;
  completed?:()=>void;
  cancel?:()=>Promise<void>;
  signal?:AbortSignal;
}
interface PendingGuard extends BrowserReferenceDeferral {
  id:string;
  inspect:()=>Promise<BrowserReferenceGuardState>;
  finish:()=>Promise<BrowserReferenceGuardState>;
  resume?:()=>Promise<boolean>;
  cancelling?:Promise<void>;
  finishing?:Promise<BrowserReferenceGuardState>;
  reported?:boolean;
  stopped?:()=>void;
}
export interface BrowserGuardSettlement {pending:boolean;blocked:boolean;unknown?:boolean}

/** Retains the exact armed node while a synchronous dialog blocks JavaScript.
 * No cleanup JavaScript is sent while the dialog is open. The next input waits
 * for the original gesture's terminal event; it never arms over an old guard. */
export class BrowserDeferredReferenceGuards {
  private readonly dialogs=new Set<string>();
  private readonly guards=new Map<string,PendingGuard>();
  private readonly interrupted=new Set<()=>void>();
  private settling?:Promise<BrowserGuardSettlement>;
  get pending(){return this.guards.size>0;}
  get dialogOpen(){return this.dialogs.size>0;}
  opening(key:string){this.dialogs.add(key);for(const notify of [...this.interrupted])notify();}
  closed(key:string){this.dialogs.delete(key);}
  discard(){
    for(const guard of this.guards.values()){
      if(guard.stopped)guard.signal?.removeEventListener('abort',guard.stopped);
      if(!guard.reported){guard.reported=true;try{guard.failed?.('stale');}catch{/* Page disposal must still discard its owned guard. */}}
    }
    this.dialogs.clear();this.guards.clear();for(const notify of [...this.interrupted])notify();
  }
  defer(guard:PendingGuard):BrowserReferenceGuardState{
    this.guards.set(guard.id,guard);
    if(guard.signal){
      guard.stopped=()=>{if(!guard.reported){guard.reported=true;guard.failed?.('unknown');}};
      if(guard.signal.aborted)guard.stopped();else guard.signal.addEventListener('abort',guard.stopped,{once:true});
    }
    return{blocked:[],accepted:[],connected:false,pending:true};
  }
  async observe<T>(work:()=>Promise<T>):Promise<{value:T}|null>{
    if(this.dialogOpen)return null;
    let notify!:()=>void;
    const interruption=new Promise<null>(resolve=>{notify=()=>resolve(null);this.interrupted.add(notify);});
    try{return await Promise.race([work().then(value=>({value})),interruption]);}
    finally{this.interrupted.delete(notify);}
  }
  settle():Promise<BrowserGuardSettlement>{
    if(this.settling)return this.settling;
    this.settling=this.settleOwned().finally(()=>{this.settling=undefined;});
    return this.settling;
  }
  private async settleOwned():Promise<BrowserGuardSettlement>{
    let blocked=false;
    for(const guard of [...this.guards.values()]){
      if(this.dialogOpen)return{pending:true,blocked};
      const deadline=Date.now()+5000;
      try{
        if(guard.resume){
          // The owned continuation records dispatch before awaiting its ack.
          // A new dialog before dispatch leaves it pending; an uncertain sent
          // release is never issued twice.
          if(!await guard.resume())return{pending:this.pending,blocked};
          guard.resume=undefined;
        }
        while(this.guards.get(guard.id)===guard){
          if(this.dialogOpen)return{pending:true,blocked};
          const observed=await this.observe(guard.inspect);
          if(!observed)return{pending:this.pending,blocked};
          if(this.guards.get(guard.id)!==guard)break;
          const state=observed.value;
          if(state.blocked.length||!state.connected||state.accepted.includes('click')){
            blocked ||= Boolean(state.blocked.length||!state.connected);
            if((state.blocked.length||!state.connected)&&guard.cancel){
              // Stop unissued kernel releases and wait for already sent input
              // before removing the old guard from a replaced node.
              if(!guard.cancelling){guard.cancelling=guard.cancel();void guard.cancelling.catch(()=>{});}
              const cancelled=await this.observe(()=>guard.cancelling!);
              if(!cancelled)return{pending:this.pending,blocked};
              if(this.guards.get(guard.id)!==guard)break;
            }
            // Keep the same cleanup promise if another dialog interrupts it.
            // A later input remains behind this entry until cleanup completes.
            if(this.dialogOpen)return{pending:true,blocked};
            if(!guard.finishing){guard.finishing=guard.finish();void guard.finishing.catch(()=>{});}
            const finished=await this.observe(()=>guard.finishing!);
            if(!finished)return{pending:this.pending,blocked};
            if(this.guards.get(guard.id)!==guard)break;
            const final=finished.value;
            const failed=Boolean(final.blocked.length||!final.connected||!final.accepted.includes('click'));
            blocked ||= failed;
            if(failed&&!guard.reported){guard.reported=true;guard.failed?.('stale');}
            this.guards.delete(guard.id);
            if(guard.stopped)guard.signal?.removeEventListener('abort',guard.stopped);
            if(!failed)guard.completed?.();
            break;
          }
          if(Date.now()>=deadline)throw new BrowserError('BROWSER_TIMEOUT','弹框已处理，但原点击收尾未确认；请重新加载网页后再观察，勿重发原点击');
          await new Promise<void>(resolve=>setTimeout(resolve,10));
        }
      }catch{
        if(this.guards.get(guard.id)!==guard)continue;
        if(!guard.reported){guard.reported=true;guard.failed?.('unknown');}
        // Leave the guard armed on an uncertain continuation. Navigation or
        // page close discards it; a new input cannot overwrite its identity.
        return{pending:true,blocked,unknown:true};
      }
    }
    return{pending:this.pending,blocked};
  }
  async assertReady():Promise<void>{
    const state=await this.settle();
    if(state.pending)throw new BrowserError('BROWSER_ERROR',state.unknown?'原点击收尾结果未知；请重新加载网页后再观察，勿重发原点击':'请先处理网页的JS对话框；原点击尚未收尾，勿重发');
  }
}
