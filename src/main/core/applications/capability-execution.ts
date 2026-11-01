import { ApplicationError } from '@shared/applications';
import { boundedJson } from '@shared/application-bridge';
import type { ApplicationCapability } from '@shared/application-capabilities';
import type { CallerContext } from './caller-context';
import type { ApplicationExecutionContext, ApplicationExecutionContexts } from './execution-context';
import type { ApplicationDataBinding } from './application-adapter-registry';
import type { ApplicationModuleRegistry, TrustedApplicationModule } from './modules/registry';
import type { BuiltinPackageRegistry } from './builtin-package-registry';
import { canonicalJson } from './manifest';
import {applicationResultV2Schema,type ApplicationResultV2} from '@shared/application-result';
import {applicationResourceRefSchema} from '@shared/application-data';

interface CapabilityData {
  receiptOnly?(context:ApplicationExecutionContext,method:string,input:unknown):boolean;
  execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>;
}
/** UI, MCP and CLI converge here after their own host-issued identity checks. */
export class ApplicationCapabilityExecution {
  constructor(private readonly contexts:ApplicationExecutionContexts,private readonly modules:ApplicationModuleRegistry<readonly TrustedApplicationModule[]>,private readonly packages:BuiltinPackageRegistry,private readonly data:CapabilityData){}

  private declaration(packageHash:string,capabilityId:string,contractMajor:number):ApplicationCapability{
    const application=this.packages.assertTrusted(packageHash);
    const capability=this.modules.capabilityViews(application.manifest).find(c=>c.id===capabilityId&&c.contractMajor===contractMajor);
    if(!capability)throw new ApplicationError('SCOPE_DENIED','原应用包没有声明本次能力契约');
    const trusted=this.modules.capability(application.appId,capabilityId,contractMajor);
    for(const key of ['semantics','permission','retry','slots','protection','approval'] as const){
      if(canonicalJson(capability[key]??null)!==canonicalJson(trusted[key]??null))throw new ApplicationError('HOST_INCOMPATIBLE','包声明与受信业务能力不一致');
    }
    return capability;
  }
  forMethod(binding:Readonly<ApplicationDataBinding>,method:string,contractMajor:number):ApplicationCapability{
    const application=this.packages.assertTrusted(binding.packageHash);
    const capability=this.modules.capabilityViews(application.manifest).find(c=>c.contractMajor===contractMajor&&(c.binding.mcp?.tool===binding.toolName||c.binding.fallback&&'mcp'in c.binding.fallback&&c.binding.fallback.mcp.tool===binding.toolName));
    if(application.appId!==binding.appId||!capability||capability.permission!==binding.permission||this.modules.capability(binding.appId,capability.id,contractMajor).method!==method)throw new ApplicationError('SCOPE_DENIED','固定Data API路由不能替换业务能力');
    return this.declaration(binding.packageHash,capability.id,contractMajor);
  }
  tool(packageHash:string,toolName:string,contractMajor:number){
    const application=this.packages.assertTrusted(packageHash),capability=this.modules.capabilityViews(application.manifest).find(c=>c.contractMajor===contractMajor&&(c.binding.mcp?.tool===toolName||c.binding.fallback&&'mcp'in c.binding.fallback&&c.binding.fallback.mcp.tool===toolName));
    if(!capability)throw new ApplicationError('SCOPE_DENIED','固定应用没有此MCP能力');
    return{capability,method:this.modules.capability(application.appId,capability.id,contractMajor).method,binding:{packageHash,appId:application.appId,toolName,permission:capability.permission}};
  }
  /** UI follows the current fixed package contract; callers still enter the same authenticated executor. */
  async forUi(context:ApplicationExecutionContext,capabilityId:string,args:unknown):Promise<unknown>{
    this.contexts.assertActive(context);if(context.callerKind!=='ui'||context.scopeKind!=='project')throw new ApplicationError('SCOPE_DENIED','页面入口只能使用真实项目页面上下文');
    const application=this.packages.assertTrusted(context.packageHash),capability=this.modules.capabilityViews(application.manifest).find(c=>c.id===capabilityId);
    if(!capability)throw new ApplicationError('SCOPE_DENIED','项目原包未声明此能力');
    const value=await this.execute(this.contexts.caller(context),capabilityId,capability.contractMajor,args);
    return capability.contractMajor===2?applicationResultV2Schema.parse(value).data:value;
  }
  private result(caller:CallerContext,context:ApplicationExecutionContext,capability:ApplicationCapability,data:unknown):ApplicationResultV2{
    const object=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{},record=(value:unknown)=>value&&typeof value==='object'?value as Record<string,unknown>:{};
    const resources=new Map<string,ApplicationResultV2['resources'][number]>(),visit=(value:unknown):void=>{const parsed=applicationResourceRefSchema.safeParse(value);if(parsed.success){resources.set(parsed.data.id+':'+parsed.data.revision,parsed.data);return;}if(Array.isArray(value))for(const item of value)visit(item);else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);};
    if(!boundedJson(data))throw new ApplicationError('INVALID_RESPONSE','业务结果不是有界JSON');visit(data);
    const revision=record(object.reference).contentRevision??record(object.draft).revision??record(object.intent).reviewHash;
    const state=record(object.intent).state,missing=Array.isArray(object.missing)?object.missing.filter((v):v is string=>typeof v==='string'):[];
    return applicationResultV2Schema.parse({schema:'willyou-app-result-v2',contractMajor:2,status:'ok',capabilityId:capability.id,data,source:{appId:context.appId,packageHash:context.packageHash,connections:this.contexts.sourceRevisions(context),revision:typeof revision==='string'||typeof revision==='number'?String(revision):null},completeness:{complete:object.complete!==false&&missing.length===0,missing},pagination:Object.hasOwn(object,'nextCursor')?{nextCursor:typeof object.nextCursor==='string'?object.nextCursor:null,total:typeof object.total==='number'?object.total:null}:null,resources:[...resources.values()],operation:{id:context.operationId,requestId:caller.kind==='agent'?caller.requestId:null,origin:caller.kind==='agent'?caller.entry:caller.kind==='internal'?'internal':'ui',effectState:capability.semantics==='read'?'read-only':state==='unknown'?'unknown':'completed'}});
  }
  async execute(caller:CallerContext,capabilityId:string,contractMajor:number,args:unknown,signal?:AbortSignal):Promise<unknown>{
    // Authentication precedes argument interpretation, slot/credential resolution and business work.
    const context=this.contexts.contextFor(caller);
    if(caller.kind==='management'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','连接管理身份不能读取项目业务数据');
    const capability=this.declaration(context.packageHash,capabilityId,contractMajor);
    this.contexts.require(context,capability.permission);
    if(!capability.id.startsWith(context.appId+'.')||capability.semantics!=='read'&&(context.semantics!=='write'||caller.kind==='internal'))throw new ApplicationError('SCOPE_DENIED','本次调用上下文未授权该业务动作');
    if(caller.kind==='agent'&&capability.binding.mcp?.tool!==context.action&&!(capability.binding.fallback&&'mcp'in capability.binding.fallback&&capability.binding.fallback.mcp.tool===context.action))throw new ApplicationError('SCOPE_DENIED','网关签发身份只允许当前固定能力');
    if(!boundedJson(args)||!args||typeof args!=='object'||Array.isArray(args))throw new ApplicationError('INVALID_INPUT','能力参数必须是有界对象');
    const implementation=this.modules.capability(context.appId,capabilityId,contractMajor);
    return this.contexts.withSignal(context,signal,async()=>{
      // A retained v1 external-write call can return an already claimed receipt without re-entering its provider.
      // Only a compiled module can attest this; v2 callers use the dependency-free result capability.
      const receiptOnly=capability.semantics==='external-write'&&this.packages.packages.get(context.packageHash).manifest.schema==='smartdd-app-package-v1'&&this.data.receiptOnly?.(context,implementation.method,args);
      if(!receiptOnly)await this.contexts.requireSlots(context,capability.slots.required);
      const result=await this.data.execute(context,implementation.method,args);
      this.contexts.require(context,capability.permission);
      return contractMajor===2?this.result(caller,context,capability,result):result;
    });
  }
}
