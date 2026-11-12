import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {PLUGIN_LIMITS,pluginUiReadSchema,pluginPageContextSchema,type PluginPageContext,type PluginUiRead} from '@shared/plugins';
import {canonicalJson,digest} from '../manifest';
import type {ResourceStore} from '../resource-store';
import type {PluginLifecycle} from './lifecycle';
import type {PluginProjectPolicy} from './project-policy';
import type {ProcessIdentityReader} from '../process-identity';
import {z} from 'zod';
import {PluginUiActions} from './ui-actions';

/** A page read is a UI/project operation. It cannot borrow an Agent run or execute arbitrary capabilities. */
export class PluginUiReads {
  readonly actions=new PluginUiActions();
  private closed=false;
  private readonly pending=new Map<string,{owner:string;controller:AbortController;done:Promise<unknown>}>();
  constructor(private readonly store:ResourceStore,private readonly lifecycle:PluginLifecycle,private readonly policy:PluginProjectPolicy,private readonly processes:ProcessIdentityReader){}
  context(raw:PluginPageContext){
    const input=pluginPageContextSchema.parse(raw);if(this.closed)throw new ApplicationError('CANCELED','插件页面服务已停止');
    return this.lifecycle.withInvocation(input.appId,async stored=>{
      if(stored.plugin.hash!==input.packageHash)throw new ApplicationError('REVISION_CONFLICT','插件页面版本已变化，请刷新');
      const panel=stored.plugin.manifest.ui.panels.find(p=>p.id===input.panelId);if(!panel)throw new ApplicationError('SCOPE_DENIED','当前插件没有此页面');
      // Metadata-only preparation. This reservation never dispatches a child or calls the external service.
      return this.policy.withUiRead(input.projectId,stored,panel.source.capability,new AbortController().signal,async scope=>({connectionSummary:scope.summary,connectionScope:scope.scopeHash}),false);
    });
  }
  read(owner:string,raw:PluginUiRead){
    const input=pluginUiReadSchema.parse(raw),key=owner+':'+input.requestId;
    if(this.closed)throw new ApplicationError('CANCELED','插件页面服务已停止');
    if(this.pending.has(key))throw new ApplicationError('RESOURCE_BUSY','此页面请求正在执行');
    if(this.pending.size>=16||[...this.pending.values()].filter(p=>p.owner===owner).length>=4)throw new ApplicationError('RESOURCE_BUSY','页面读取过多，请等待当前请求完成');
    if(!boundedJson(input.input)||Buffer.byteLength(JSON.stringify(input.input))>PLUGIN_LIMITS.frameBytes/2)throw new ApplicationError('TOO_LARGE','插件页面输入超过预算');
    const controller=new AbortController();
    // Start after registration so cancellation never misses a just-created request.
    const done=Promise.resolve().then(()=>this.execute(owner,input,controller.signal));
    this.pending.set(key,{owner,controller,done});
    void done.finally(()=>this.pending.delete(key)).catch(()=>{});return done;
  }
  cancel(owner:string,requestId:string){pluginUiReadSchema.shape.requestId.parse(requestId);const found=this.pending.get(owner+':'+requestId);found?.controller.abort();return{cancelled:!!found};}
  private async execute(owner:string,input:PluginUiRead,signal:AbortSignal){
    const operationId=randomUUID();let recorded=false;
    const checkSignal=()=>{if(signal.aborted)throw new ApplicationError('CANCELED','插件页面读取已取消');};
    try{
      return await this.lifecycle.withInvocation(input.appId,async(stored,invocation)=>{
        checkSignal();
        if(stored.plugin.hash!==input.packageHash)throw new ApplicationError('REVISION_CONFLICT','插件页面版本已变化，请刷新');
        const panel=stored.plugin.manifest.ui.panels.find(p=>p.id===input.panelId);
        if(!panel)throw new ApplicationError('SCOPE_DENIED','当前插件没有此页面');
        const allowed=new Set([panel.source.capability,...Object.values(panel.details).flatMap(d=>[d.source.capability,...d.sections.flatMap(s=>s.read?[s.read]:[])])]);
        const cap=stored.plugin.manifest.capabilities[input.capability],validators=stored.plugin.contracts.get(input.capability);
        if(!allowed.has(input.capability)||!cap||cap.semantics!=='read'||!validators)throw new ApplicationError('SCOPE_DENIED','此页面未声明该读取能力');
        if(!validators.input(input.input).valid)throw new ApplicationError('INVALID_INPUT','插件页面输入不符合能力契约');
        return this.policy.withUiRead(input.projectId,stored,input.capability,signal,async scope=>{
          invocation.assertActive();scope.check();
          if(input.connectionScope&&input.connectionScope!==scope.scopeHash)throw new ApplicationError('REVISION_CONFLICT','列表来源连接已变化，请重新读取列表');
          const scopeHash=digest(canonicalJson({owner,requestId:input.requestId,projectId:input.projectId,appId:input.appId,panelId:input.panelId,hash:input.packageHash,capability:input.capability,input:input.input}));
          this.store.sqlite.transaction(()=>{
            this.store.sqlite.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,app_id,package_hash,data_api,action,semantics,scope_hash,targets_json,state,started_at) VALUES(?,'ui','project',?,?,?,1,?,'read',?,?,'running',?)")
              .run(operationId,input.projectId,input.appId,input.packageHash,input.capability,scopeHash,canonicalJson(scope.targets),new Date().toISOString());
            const host=this.lifecycle.runtimes.host;this.store.sqlite.prepare('INSERT INTO plugin_ui_reads VALUES(?,?,?,?)').run(operationId,this.store.instanceId,host.pid,host.startedAt);
          }).immediate();recorded=true;
          const value=await invocation.execute(input.capability,input.input,scope.connection,signal,undefined,{projectId:input.projectId,operationId,callerKind:'ui'});
          checkSignal();invocation.assertActive();scope.check();
          if(!boundedJson(value)||!validators.output(value).valid)throw new ApplicationError('INVALID_RESPONSE','插件页面结果不符合能力契约');
          const actionReceipt=this.actions.remember(owner,input,panel,stored.plugin.manifest.displayName,value,scope.summary,scope.scopeHash,scope.check);
          this.finish(operationId,'succeeded',null);
          return{requestId:input.requestId,operationId,packageHash:stored.plugin.hash,value,connectionSummary:scope.summary,connectionScope:scope.scopeHash,...(actionReceipt?{actionReceipt}:{})};
        });
      });
    }catch(error){
      if(recorded)this.finish(operationId,signal.aborted?'cancelled':'failed',error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE');
      throw error;
    }
  }
  private finish(id:string,state:string,code:string|null){this.store.sqlite.transaction(()=>{
    this.store.sqlite.prepare("UPDATE application_data_operations SET state=?,error_code=?,ended_at=? WHERE operation_id=? AND state='running'").run(state,code,new Date().toISOString(),id);
    this.store.sqlite.prepare('DELETE FROM plugin_ui_reads WHERE operation_id=?').run(id);
  }).immediate();}
  recover(){
    const read=()=>this.store.sqlite.prepare("SELECT u.*,o.app_id,o.caller_kind,o.scope_kind,o.project_id,o.task_id,o.run_id,o.job_id,o.parent_operation_id,o.semantics,o.state FROM plugin_ui_reads u JOIN application_data_operations o ON o.operation_id=u.operation_id").all() as {operation_id:string;host_instance_id:string;host_pid:number;host_started_at:string;app_id:string;caller_kind:string;scope_kind:string;project_id:string|null;task_id:string|null;run_id:string|null;job_id:string|null;parent_operation_id:string|null;semantics:string;state:string}[];
    const released:string[]=[],pending:string[]=[];
    for(const row of read()){
      if(!z.uuid().safeParse(row.operation_id).success||!z.uuid().safeParse(row.host_instance_id).success||!Number.isSafeInteger(row.host_pid)||row.host_pid<1||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(row.host_started_at)||row.caller_kind!=='ui'||row.scope_kind!=='project'||!row.project_id||row.task_id!==null||row.run_id!==null||row.job_id!==null||row.parent_operation_id!==null||row.semantics!=='read'||row.state!=='running'||!this.store.sqlite.prepare('SELECT 1 FROM plugin_installations WHERE app_id=?').get(row.app_id)){pending.push(row.operation_id);continue;}
      let state:ReturnType<ProcessIdentityReader['state']>='unknown';try{state=this.processes.state({pid:row.host_pid,startedAt:row.host_started_at});}catch{/* Unknown identity cannot authorize cancellation. */}
      if(state!=='stopped'){pending.push(row.operation_id);continue;}
      this.store.sqlite.transaction(()=>{const current=read().find(v=>v.operation_id===row.operation_id);if(canonicalJson(current??null)!==canonicalJson(row)){pending.push(row.operation_id);return;}this.finish(row.operation_id,'cancelled','CANCELED');released.push(row.operation_id);}).immediate();
    }
    return{released,pending};
  }
  async close(){this.closed=true;this.actions.close();const pending=[...this.pending.values()];for(const p of pending)p.controller.abort();await Promise.allSettled(pending.map(p=>p.done));this.actions.close();}
}
