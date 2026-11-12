import {ApplicationError} from '@shared/applications';
import type {ApplicationEntry} from '@shared/application-capabilities';
import type {BridgeTool,BridgeToolCall} from '@shared/application-bridge';
import {pluginSessionSelectionSchema,type PluginSessionSelection} from '@shared/plugin-session';
import type {PluginCapability} from '@shared/plugins';
import type {RunContext} from '../run-registry';
import type {AdditionalApplicationTools,ApplicationOperationContext,SelectedApplicationTool} from '../tool-service';
import {pluginLegacyResult} from './legacy-result';
import type {ApplicationResultV2} from '@shared/application-result';
import {applicationPreflightFailure} from '../capability-preflight';
import {digest} from '../manifest';
import {requirePlanEntry} from '../run-plan';
import type {PluginLifecycle,PluginInvocation} from './lifecycle';
import type {StoredPlugin} from './package-store';
import type {ValidatedPlugin,JsonSchema} from './package';

type SelectedCapability=PluginSessionSelection['capabilities'][number];
/** These are trusted host functions, never plugin callbacks or model arguments. */
export interface PluginToolPolicy {
  authorize(context:RunContext,selection:PluginSessionSelection,capability:SelectedCapability):void;
  connection(context:RunContext,selection:PluginSessionSelection,capability:SelectedCapability,signal:AbortSignal):Promise<unknown>;
  sourceRevisions?(context:RunContext,selection:PluginSessionSelection,capability:SelectedCapability,connection:unknown):ApplicationResultV2['source']['connections'];
  approve(context:RunContext,selection:PluginSessionSelection,capability:SelectedCapability,input:Record<string,unknown>,operation:ApplicationOperationContext):Promise<void|(()=>void)>;
}

/** 27 bytes: fits the native 64-byte MCP name budget even with the fixed bridge prefix. */
export const pluginMcpToolName=(capabilityId:string)=>'smartdd_p'+digest(capabilityId).slice(0,16)+'_v1';
export function capturePluginSession(stored:StoredPlugin,connections:PluginSessionSelection['connections'],entry:ApplicationEntry='mcp',bindingRevision?:number):PluginSessionSelection {
  const {manifest,hash}=stored.plugin;
  return pluginSessionSelectionSchema.parse({appId:manifest.id,packageHash:hash,version:manifest.version,entry,connections,...(bindingRevision===undefined?{}:{bindingRevision}),
    capabilities:Object.entries(manifest.capabilities).filter(([,cap])=>cap.agentVisible!==false).map(([id,cap])=>({id,permission:cap.permission,semantics:cap.semantics,slots:cap.slots,mcpTool:pluginMcpToolName(id),
      aliases:Object.entries(manifest.legacyToolNames).filter(([alias,target])=>target===id&&/^smartdd_[a-z0-9_]+_v[1-9][0-9]*$/.test(alias)).map(([alias])=>alias),
    })),
  });
}

/** Publish a self-contained schema; package-local $id references must also work in an Agent client. */
export function pluginToolSchema(plugin:ValidatedPlugin,path:string):BridgeTool['inputSchema'] {
  const source=plugin.schemas.get(path);if(!source||source.type!=='object')throw new ApplicationError('INVALID_PACKAGE','Agent工具需要对象Schema');
  const entries=[...plugin.schemas],byId=new Map(entries.flatMap(([file,schema])=>[[file,file],...(typeof schema.$id==='string'?[[schema.$id,file]]:[])] as [string,string][]));
  let namespace='wy_package_';while(Object.keys((source.$defs??{}) as JsonSchema).some(key=>key.startsWith(namespace)))namespace+='x';
  const locations=new Map(entries.map(([file])=>[file,file===path?'#':'#/$defs/'+namespace+digest(file).slice(0,16)]));
  const reachable=new Set<string>([path]);
  const rewrite=(value:unknown,file:string):unknown=>{
    if(Array.isArray(value))return value.map(v=>rewrite(v,file));
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$id').map(([key,child])=>{
      if(key!=='$ref'||typeof child!=='string')return[key,rewrite(child,file)];
      const split=child.indexOf('#'),name=split<0?child:child.slice(0,split),fragment=split<0?'':child.slice(split+1);
      let target=name?byId.get(name):file;
      const base=plugin.schemas.get(file)?.$id;
      if(!target&&typeof base==='string')try{target=byId.get(new URL(name,base).href);}catch{/* Non-URL $ids are resolved exactly. */}
      if(!target||fragment&&!fragment.startsWith('/'))throw new ApplicationError('INVALID_PACKAGE','工具Schema引用不能独立发布');
      reachable.add(target);return[key,locations.get(target)!+fragment];
    }));
  };
  const root=rewrite(source,path) as JsonSchema,defs:JsonSchema={};
  const done=new Set<string>([path]);
  for(const file of reachable){if(done.has(file))continue;done.add(file);defs[namespace+digest(file).slice(0,16)]=rewrite(plugin.schemas.get(file)!,file);}
  // Retain the root's own definitions as well as the package-local referenced documents.
  return {...root,...(Object.keys(defs).length?{$defs:{...(root.$defs as JsonSchema??{}),...defs}}:{})} as BridgeTool['inputSchema'];
}

/** External code never enters PackageRegistry or the compiled builtin trust set. */
export class PluginSessionTools implements AdditionalApplicationTools {
  constructor(private readonly lifecycle:PluginLifecycle,private readonly policy:PluginToolPolicy){}
  private match(context:RunContext,call:Pick<BridgeToolCall,'operation'|'contractMajor'>,entry:ApplicationEntry):{selection:PluginSessionSelection;capability:SelectedCapability}|undefined {
    if(context.snapshot.schema!==3)return;
    for(const selection of context.snapshot.externalPlugins??[]){
      const capability=selection.capabilities.find(c=>entry==='cli'?c.id===call.operation:c.mcpTool===call.operation||c.aliases.includes(call.operation));
      if(!capability)continue;
      const major=entry==='mcp'?Number(/_v([1-9][0-9]*)$/.exec(call.operation)?.[1]):1;
      if(call.contractMajor!==major||!context.plan)throw new ApplicationError('SCOPE_DENIED','插件能力不在本次运行契约中');
      const allowed=requirePlanEntry(context.plan,capability.id,1,entry);
      if(selection.entry!==entry||allowed.appId!==selection.appId||allowed.packageHash!==selection.packageHash||allowed.mcpTool!==capability.mcpTool)throw new ApplicationError('SCOPE_DENIED','插件能力与原运行允许表不符');
      return{selection,capability};
    }
  }
  private current(selection:PluginSessionSelection):StoredPlugin {
    const state=this.lifecycle.state(selection.appId);
    if(!state.installed||!state.hash)throw new ApplicationError('NOT_FOUND','插件已卸载');
    if(!state.enabled)throw new ApplicationError('APP_NOT_ENABLED','插件已停用');
    if(state.paused)throw new ApplicationError('CAPABILITY_UNAVAILABLE','插件连续异常退出，需显式重启');
    return this.lifecycle.packages.get(state.hash);
  }
  private build(context:RunContext,call:Pick<BridgeToolCall,'operation'|'contractMajor'>,selected:{selection:PluginSessionSelection;capability:SelectedCapability},stored:StoredPlugin,invocation?:PluginInvocation):SelectedApplicationTool {
    const {selection,capability:launch}=selected,{manifest}=stored.plugin;
    const id=Object.hasOwn(manifest.capabilities,launch.id)?launch.id:Object.hasOwn(manifest.legacyToolNames,launch.id)?manifest.legacyToolNames[launch.id]:undefined;
    const cap:PluginCapability|undefined=id?manifest.capabilities[id]:undefined;
    if(!id||!cap||cap.agentVisible===false)throw new ApplicationError('CAPABILITY_UNAVAILABLE','插件已删除此能力，需更新任务使用方式');
    if(cap.permission!==launch.permission||cap.semantics!==launch.semantics||cap.slots.some(slot=>!launch.slots.includes(slot)))throw new ApplicationError('CONFIG_INCOMPATIBLE','插件能力授权范围已变化，请重启会话');
    const authorize=(fresh:RunContext,connectionId:string|null)=>{
      if(connectionId!==null||fresh.run.runId!==context.run.runId||fresh.run.projectId!==context.run.projectId||fresh.run.taskId!==context.run.taskId)throw new ApplicationError('SCOPE_DENIED','插件调用不能替换任务、项目或连接');
      if(this.current(selection).plugin.hash!==stored.plugin.hash)throw new ApplicationError('RESOURCE_STATE_CHANGED','插件版本已变化，请重新发起调用');
      invocation?.assertActive();this.policy.authorize(fresh,selection,launch);
    };
    const legacy=Object.hasOwn(manifest.legacyToolContracts??{},call.operation)?manifest.legacyToolContracts![call.operation]:undefined;
    if(legacy&&manifest.legacyToolNames[call.operation]!==id)throw new ApplicationError('CONFIG_INCOMPATIBLE','旧工具契约与当前能力不符');
    if(call.contractMajor!==1&&!legacy)throw new ApplicationError('CONFIG_INCOMPATIBLE','插件没有声明旧版工具的结果契约');
    const annotations={readOnlyHint:cap.semantics==='read',destructiveHint:cap.semantics!=='read',idempotentHint:cap.semantics==='read',openWorldHint:true};
    const tool:BridgeTool={name:call.operation,description:cap.title,inputSchema:pluginToolSchema(stored.plugin,legacy?.input??cap.input),outputSchema:pluginToolSchema(stored.plugin,legacy?.output??cap.output),annotations,contractMajor:call.contractMajor};
    return{application:{appId:selection.appId,packageHash:stored.plugin.hash,manifest:{schema:manifest.schema}},declaration:{name:call.operation,contractMajor:call.contractMajor,permission:cap.permission,annotations},tool,validators:legacy?stored.plugin.legacyContracts.get(call.operation)!:stored.plugin.contracts.get(id)!,
      handler:{semantics:cap.semantics==='read'?'read':'write',retry:'never',authorize,
        execute:async(fresh,input,operation)=>{
          if(!invocation)throw new ApplicationError('SCOPE_DENIED','插件调用尚未取得执行预留');
          const acceptedInput=structuredClone(input);
          let connection:unknown,approval:void|(()=>void)=undefined;
          const effect=(value:'not-started'|'unknown')=>{
            const changed=this.lifecycle.store.sqlite.prepare("UPDATE application_invocations SET effect_state=? WHERE operation_id=? AND run_id=? AND request_id=? AND package_hash=? AND semantics='write' AND state='running'").run(value,operation.operationId,fresh.run.runId,operation.requestId,stored.plugin.hash);
            if(changed.changes!==1)throw new ApplicationError('SCOPE_DENIED','插件写操作没有当前执行账本');
          };
          try{
            if(cap.semantics!=='read')effect('not-started');
            authorize(fresh,operation.connectionId);
            if(cap.semantics!=='read')approval=await this.policy.approve(fresh,selection,launch,acceptedInput,operation);
            approval?.();
            if(operation.signal.aborted)throw new ApplicationError('CANCELED','插件调用已取消');
            authorize(fresh,operation.connectionId);
            approval?.();
            connection=await this.policy.connection(fresh,selection,launch,operation.signal);
            if(operation.signal.aborted)throw new ApplicationError('CANCELED','插件调用已取消');
            authorize(fresh,operation.connectionId);
            approval?.();
          }catch(error){throw applicationPreflightFailure(error,operation.operationId);}
          let raw:unknown;
          try{raw=await invocation.execute(id,acceptedInput,connection,operation.signal,cap.semantics==='read'?undefined:()=>{if(operation.signal.aborted)throw new ApplicationError('CANCELED','插件写入已取消');authorize(fresh,operation.connectionId);approval?.();effect('unknown');},{projectId:fresh.run.projectId,operationId:operation.operationId,callerKind:'agent',runId:fresh.run.runId});}

          catch(error){if(cap.semantics!=='read'&&!(error instanceof ApplicationError&&error.code==='UPSTREAM_RESULT_UNKNOWN'))throw applicationPreflightFailure(error,operation.operationId);throw error;}

            if(!legacy)return raw;
            const connections=this.policy.sourceRevisions?.(fresh,selection,launch,connection)??(cap.slots.length?undefined:[]);
            if(!connections)throw new ApplicationError('CONFIG_INCOMPATIBLE','缺少旧结果契约所需的宿主连接修订');
            return pluginLegacyResult(stored.plugin,call.operation,{capabilityId:id,semantics:cap.semantics,appId:selection.appId,packageHash:stored.plugin.hash,connections,operationId:operation.operationId,requestId:operation.requestId,origin:operation.entry??selection.entry},raw);
        },
      },
    };
  }
  select(context:RunContext,call:Pick<BridgeToolCall,'operation'|'contractMajor'>,entry:ApplicationEntry):SelectedApplicationTool|undefined {
    const selected=this.match(context,call,entry);if(!selected)return;
    const result=this.build(context,call,selected,this.current(selected.selection));result.handler!.authorize(context,null);return result;
  }
  withSelection<T>(context:RunContext,call:Pick<BridgeToolCall,'operation'|'contractMajor'>,entry:ApplicationEntry,work:(selected:SelectedApplicationTool)=>Promise<T>):Promise<T>|undefined {
    const selected=this.match(context,call,entry);if(!selected)return;
    // Authenticate and authorize before reserving a runtime; reservation itself starts no child.
    this.policy.authorize(context,selected.selection,selected.capability);
    return this.lifecycle.withInvocation(selected.selection.appId,(stored,invocation)=>work(this.build(context,call,selected,stored,invocation)));
  }
  list(context:RunContext,entry:ApplicationEntry):{tools:BridgeTool[];unavailable:{appId:string;code:string}[]} {
    const tools:BridgeTool[]=[],unavailable:{appId:string;code:string}[]=[];
    if(context.snapshot.schema!==3)return{tools,unavailable};
    for(const selection of context.snapshot.externalPlugins??[]){
      if(selection.entry!==entry)continue;
      for(const cap of selection.capabilities){
        try{
          const names=entry==='cli'?[cap.id]:[cap.mcpTool,...cap.aliases];
          const group=names.map(operation=>this.select(context,{operation,contractMajor:entry==='cli'?1:Number(/_v([1-9][0-9]*)$/.exec(operation)?.[1])},entry)!.tool);tools.push(...group);
        }catch(error){unavailable.push({appId:selection.appId,code:error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE'});break;}
      }
    }
    return{tools,unavailable};
  }
}
