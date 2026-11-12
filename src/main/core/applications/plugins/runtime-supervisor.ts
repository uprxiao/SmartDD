import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import type {ProcessIdentity,ProcessIdentityReader} from '../process-identity';
import type {ResourceStore} from '../resource-store';
import {PluginProcess,type PluginProcessOptions} from './process';
import type {StoredPlugin} from './package-store';

export type PluginProcessEvents=Pick<PluginProcessOptions,'onBeforeSpawn'|'onSpawn'|'onClose'>;
export interface PluginRuntimeOptions {
  processes:ProcessIdentityReader;
  createProcess(plugin:StoredPlugin,dataRoot:string,events:PluginProcessEvents):PluginProcess;
  now?:()=>number;
}
interface RuntimeEntry {
  leaseId:string;appId:string;hash:string;child:PluginProcess;references:number;retired:boolean;
  idle:Promise<void>;resolveIdle:(()=>void)|undefined;
}
interface LeaseRow {
  lease_id:string;app_id:string;host_instance_id:string;host_pid:number;host_started_at:string;
  pid:number|null;process_started_at:string|null;state:'reserved'|'launching'|'running'|'closed';
}
/** Records kernel identities before dispatch and retains resources until the exact child closes. */
export class PluginRuntimeSupervisor {
  readonly host:ProcessIdentity;
  private readonly entries=new Set<RuntimeEntry>();
  private readonly current=new Map<string,RuntimeEntry>();
  private readonly recoveryFailures=new Set<string>();
  private closed=false;
  constructor(readonly store:ResourceStore,private readonly options:PluginRuntimeOptions) {
    const host=options.processes.read(process.pid);
    if(!host||host.pid!==process.pid||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(host.startedAt))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验插件宿主的内核身份');
    this.host=host;
  }
  health(appId:string):{paused:boolean;errorCode:string|null} {
    if(this.recoveryFailures.has(appId))return{paused:true,errorCode:'RESOURCE_RECOVERY_REQUIRED'};
    const row=this.store.sqlite.prepare('SELECT paused,error_code FROM plugin_runtime_health WHERE app_id=?').get(appId) as {paused:number;error_code:string|null}|undefined;
    return{paused:row?.paused===1,errorCode:row?.error_code??null};
  }
  resetHealth(appId:string):void {this.store.sqlite.prepare('DELETE FROM plugin_runtime_health WHERE app_id=?').run(appId);this.recoveryFailures.delete(appId);}
  private failed(appId:string,hash:string,code:string|null):void {
    const active=this.store.sqlite.prepare('SELECT installed,package_hash FROM plugin_installations WHERE app_id=?').get(appId) as {installed:number;package_hash:string|null}|undefined;
    if(active?.installed!==1||active.package_hash!==hash)return;
    const now=this.options.now?.()??Date.now(),row=this.store.sqlite.prepare('SELECT failures_json FROM plugin_runtime_health WHERE app_id=?').get(appId) as {failures_json:string}|undefined;
    let raw:unknown=[],damaged=false;try{raw=row?JSON.parse(row.failures_json):[];if(!Array.isArray(raw))throw new Error();}catch{damaged=true;this.recoveryFailures.add(appId);}
    const times=Array.isArray(raw)?raw.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value<=now&&value>now-60000):[];
    times.push(now);
    this.store.sqlite.prepare('INSERT INTO plugin_runtime_health(app_id,failures_json,paused,error_code,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET failures_json=excluded.failures_json,paused=excluded.paused,error_code=excluded.error_code,updated_at=excluded.updated_at').run(appId,JSON.stringify(times.slice(-3)),damaged||times.length>=3?1:0,damaged?'RESOURCE_RECOVERY_REQUIRED':code??'CAPABILITY_UNAVAILABLE',new Date(now).toISOString());
  }
  private open(plugin:StoredPlugin,dataRoot:string,kind:'invocation'|'activation'):RuntimeEntry {
    if(this.closed)throw new ApplicationError('CANCELED','插件进程监督已停止');
    const leaseId=randomUUID(),appId=plugin.plugin.manifest.id,hash=plugin.plugin.hash;
    this.store.sqlite.transaction(()=>{
      const foreign=this.store.sqlite.prepare("SELECT 1 FROM plugin_runtime_leases WHERE app_id=? AND state<>'closed' AND host_instance_id<>?").get(appId,this.store.instanceId);
      const changing=this.store.sqlite.prepare("SELECT 1 FROM plugin_lifecycle_changes WHERE app_id=? AND state IN ('preparing','prepared','swapping','recovery-required') AND host_instance_id<>?").get(appId,this.store.instanceId);
      if(foreign||changing)throw new ApplicationError('RESOURCE_BUSY','其他宿主正在使用或变更该插件');
      this.store.sqlite.prepare("INSERT INTO plugin_runtime_leases(lease_id,app_id,package_hash,kind,host_instance_id,host_pid,host_started_at,state,created_at) VALUES(?,?,?,?,?,?,?,'reserved',?)").run(leaseId,appId,hash,kind,this.store.instanceId,this.host.pid,this.host.startedAt,new Date().toISOString());
    }).immediate();
    let entry:RuntimeEntry;
    try {
      const child=this.options.createProcess(plugin,dataRoot,{
        onBeforeSpawn:()=>{
          const changed=this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='launching' WHERE lease_id=? AND host_instance_id=? AND state='reserved'").run(leaseId,this.store.instanceId);
          if(changed.changes!==1)throw new ApplicationError('RESOURCE_STATE_CHANGED','插件启动预留已变化');
        },
        onSpawn:pid=>{
          const identity=this.options.processes.read(pid);
          if(!identity||identity.pid!==pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验本次插件进程，已停止启动');
          const changed=this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET pid=?,process_started_at=?,state='running' WHERE lease_id=? AND host_instance_id=? AND state='launching'").run(pid,identity.startedAt,leaseId,this.store.instanceId);
          if(changed.changes!==1)throw new ApplicationError('RESOURCE_STATE_CHANGED','插件进程占用已变化');
        },
        onClose:event=>{
          this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='closed',ended_at=? WHERE lease_id=? AND host_instance_id=?").run(new Date().toISOString(),leaseId,this.store.instanceId);
          if(kind==='invocation'&&!event.expected)this.failed(appId,hash,event.errorCode);
          if(entry?.references===0)this.entries.delete(entry);
          if(this.current.get(appId)===entry)this.current.delete(appId);
        },
      });
      entry={leaseId,appId,hash,child,references:0,retired:kind==='activation',idle:Promise.resolve(),resolveIdle:undefined};
      this.entries.add(entry);return entry;
    }catch(error){
      this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='closed',ended_at=? WHERE lease_id=? AND state='reserved'").run(new Date().toISOString(),leaseId);throw error;
    }
  }
  private async stop(entry:RuntimeEntry):Promise<void> {
    await entry.child.close();
    if(!entry.child.pid)this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='closed',ended_at=? WHERE lease_id=? AND state IN ('reserved','launching')").run(new Date().toISOString(),entry.leaseId);
    let row=this.store.sqlite.prepare('SELECT state,host_instance_id,pid FROM plugin_runtime_leases WHERE lease_id=?').get(entry.leaseId) as {state:string;host_instance_id:string;pid:number|null}|undefined;
    // The original ChildProcess close event is stronger evidence than a failed observer write.
    if(row&&row.state!=='closed'&&row.host_instance_id===this.store.instanceId&&(row.pid===null||row.pid===entry.child.pid)){
      this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='closed',ended_at=? WHERE lease_id=? AND host_instance_id=?").run(new Date().toISOString(),entry.leaseId,this.store.instanceId);
      row={...row,state:'closed'};
    }
    if(row?.state!=='closed')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件进程收尾尚未确认，保留原包与数据');
    if(this.current.get(entry.appId)===entry)this.current.delete(entry.appId);
    this.entries.delete(entry);
  }
  async probe(plugin:StoredPlugin,dataRoot:string,signal?:AbortSignal):Promise<void> {
    const entry=this.open(plugin,dataRoot,'activation');
    try{await entry.child.initialize(signal);}finally{await this.stop(entry);}
  }
  async run<T>(plugin:StoredPlugin,dataRoot:string,work:(child:PluginProcess)=>Promise<T>):Promise<T> {
    if(this.closed)throw new ApplicationError('CANCELED','插件进程监督已停止');
    const appId=plugin.plugin.manifest.id;
    const health=this.health(appId);
    if(health.paused)throw new ApplicationError(health.errorCode==='RESOURCE_RECOVERY_REQUIRED'?'RESOURCE_RECOVERY_REQUIRED':'CAPABILITY_UNAVAILABLE','插件进程异常或收尾未完成，调用已暂停；请核对后重新启动插件');
    let entry=this.current.get(appId);
    if(entry&&!entry.retired&&!entry.child.isClosed&&entry.child.shouldRecycle){
      if(entry.references>0)throw new ApplicationError('RESOURCE_BUSY','插件当前请求接近输出预算，请等已接受的调用完成');
      entry.retired=true;await this.stop(entry);entry=this.current.get(appId);
      if(this.closed)throw new ApplicationError('CANCELED','插件进程监督已停止');
    }
    if(!entry||entry.retired||entry.child.isClosed||entry.hash!==plugin.plugin.hash){
      if(entry)entry.retired=true;
      entry=this.open(plugin,dataRoot,'invocation');this.current.set(appId,entry);
    }
    if(entry.references++===0)entry.idle=new Promise(resolve=>{entry!.resolveIdle=resolve;});
    try{return await work(entry.child);}
    finally {
      if(--entry.references===0){
        entry.resolveIdle?.();entry.resolveIdle=undefined;
        if(entry.child.shouldRecycle)entry.retired=true;
        if(entry.retired||entry.child.isClosed||!entry.child.pid)try{await this.stop(entry);}catch{this.recoveryFailures.add(appId);}
      }
    }
  }
  async drain(appId:string):Promise<void> {
    const entries=[...this.entries].filter(entry=>entry.appId===appId);
    for(const entry of entries)entry.retired=true;
    await Promise.all(entries.map(entry=>entry.idle));
    await Promise.all(entries.map(entry=>this.stop(entry)));
  }
  /** Recover only after proving the recorded host is gone; never signal a reused or unknown PID. */
  async recover():Promise<void> {
    if(this.entries.size)throw new ApplicationError('RESOURCE_BUSY','当前插件进程仍在运行，不能恢复遗留占用');
    const rows=this.store.sqlite.prepare("SELECT * FROM plugin_runtime_leases WHERE state<>'closed'").all() as LeaseRow[];
    for(const row of rows){
      if(this.options.processes.state({pid:row.host_pid,startedAt:row.host_started_at})!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原插件宿主尚未确认退出，保留原占用');
      if(row.state==='reserved'&&row.pid===null){this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='closed',ended_at=? WHERE lease_id=? AND state='reserved'").run(new Date().toISOString(),row.lease_id);continue;}
      if(row.pid===null||row.process_started_at===null)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原插件启动身份未完成登记，不能安全清理');
      const identity={pid:row.pid,startedAt:row.process_started_at},deadline=performance.now()+2000;let sentTerm=false,sentKill=false;
      while(this.options.processes.state(identity)==='running'&&performance.now()<deadline){
        const signal:NodeJS.Signals|undefined=!sentTerm?'SIGTERM':!sentKill&&performance.now()>deadline-1750?'SIGKILL':undefined;
        if(signal){if(this.options.processes.state(identity)==='running')try{process.kill(identity.pid,signal);}catch{/* Probe the original identity again. */}if(signal==='SIGTERM')sentTerm=true;else sentKill=true;}
        await new Promise<void>(resolve=>setTimeout(resolve,10));
      }
      if(this.options.processes.state(identity)!=='stopped')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原插件进程未确认退出，保留原包与数据');
      this.store.sqlite.prepare("UPDATE plugin_runtime_leases SET state='closed',ended_at=? WHERE lease_id=? AND state<>'closed'").run(new Date().toISOString(),row.lease_id);
    }
  }
  async close():Promise<void> {
    this.closed=true;
    const entries=[...this.entries];for(const entry of entries)entry.retired=true;
    const results=await Promise.allSettled(entries.map(entry=>this.stop(entry)));
    for(const result of results)if(result.status==='rejected')throw result.reason;
  }
}
