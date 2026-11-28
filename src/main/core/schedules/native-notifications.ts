import type {Notification,NotificationConstructorOptions,NotificationCloseEventParams} from 'electron';
import type {ScheduleNotice} from './service';

export type ScheduleNotificationTarget={planId:string;runId?:string;taskId?:string;turnId?:string;requestId?:string};
type Entry={key:string;native:Notification;shownAt?:number;clicking:boolean;detach:()=>void};
const bodyFor=(status:string)=>status==='completed'?'定时任务已完成':status==='waiting'?'定时任务等待处理':status==='unknown'?'定时任务结果待核对':status==='repair'?'定时任务配置需修正':'定时任务执行失败';

/** Own the native objects, not just the durable notice rows. Electron removes
 * newly constructed macOS notifications (and their native delegate) on GC.
 * A temporary banner timeout is not a dismissal from notification history. */
export class ScheduleNativeNotifications {
  private readonly active=new Map<string,Entry>();
  private disposed=false;
  private pruning=false;
  private lastPruneAt=-Infinity;
  constructor(private readonly options:{
    create:(options:NotificationConstructorOptions)=>Notification;
    open:(target:ScheduleNotificationTarget)=>Promise<void>|void;
    error:(error:unknown)=>void;
    /** Optional actual OS history, used only to release our absent objects. */
    history?:()=>Promise<ReadonlySet<string>>;
    now?:()=>number;
    pruneThreshold?:number;
  }){}
  get activeCount(){return this.active.size;}
  private now(){return this.options.now?.()??Date.now();}
  private release(entry:Entry){if(this.active.get(entry.key)!==entry)return;this.active.delete(entry.key);entry.detach();}
  show(notice:ScheduleNotice,shown:()=>void):void{
    if(this.disposed||this.active.has(notice.key))return;
    const native=this.options.create({title:'WillYou · '+notice.title,body:bodyFor(notice.status)});
    const target:ScheduleNotificationTarget={planId:notice.planId,
      ...(notice.runId?{runId:notice.runId}:{}),...(notice.taskId?{taskId:notice.taskId}:{}),
      ...(notice.turnId?{turnId:notice.turnId}:{}),...(notice.requestId?{requestId:notice.requestId}:{})};
    const entry:Entry={key:notice.key,native,clicking:false,detach:()=>{}};
    const current=()=>!this.disposed&&this.active.get(entry.key)===entry;
    const onShow=()=>{if(!current())return;entry.shownAt=this.now();shown();void this.prune();};
    const onClick=()=>{
      if(!current()||entry.clicking)return;entry.clicking=true;
      // Keep the object until the actual route has finished, even if the OS
      // emits a dismissal while the main window is being restored.
      let opened:Promise<void>;
      try{opened=Promise.resolve(this.options.open(target));}catch(error){opened=Promise.reject(error);}
      void opened.catch(error=>this.options.error(error)).finally(()=>this.release(entry));
    };
    const onClose=(event:NotificationCloseEventParams)=>{
      if(!current()||entry.clicking)return;
      if(event?.reason==='userCanceled')this.release(entry);else void this.prune();
    };
    const onFailed=()=>{if(current()&&!entry.clicking)this.release(entry);};
    entry.detach=()=>{native.removeListener('show',onShow);native.removeListener('click',onClick);native.removeListener('close',onClose);native.removeListener('failed',onFailed);};
    this.active.set(entry.key,entry);
    native.once('show',onShow);native.once('click',onClick);native.on('close',onClose);native.once('failed',onFailed);
    try{native.show();}catch(error){this.release(entry);throw error;}
  }
  private async prune():Promise<void>{
    // Some platforms do not emit a close event for each removed notification.
    // Amortize the history lookup, and never expire a still-delivered object by
    // age or by a cap: its later click must continue to work.
    const now=this.now(),history=this.options.history;
    if(this.disposed||!history||this.pruning||this.active.size<(this.options.pruneThreshold??32)||now-this.lastPruneAt<30_000)return;
    const candidates=[...this.active.values()].filter(e=>!e.clicking&&e.shownAt!==undefined&&now-e.shownAt>=10_000);
    if(!candidates.length)return;this.pruning=true;this.lastPruneAt=now;
    try{const present=await history();if(!this.disposed)for(const entry of candidates)if(!entry.clicking&&!present.has(entry.native.id))this.release(entry);}
    catch{/* Absence was not established. Retain the native delegate. */}
    finally{this.pruning=false;}
  }
  dispose():void{this.disposed=true;for(const entry of [...this.active.values()])this.release(entry);}
}
