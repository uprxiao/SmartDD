import { ApplicationError } from '@shared/applications';
import { boundedJson } from '@shared/application-bridge';
import type { ApplicationCapability } from '@shared/application-capabilities';
import type { CallerContext } from './caller-context';
import type { ApplicationExecutionContext, ApplicationExecutionContexts } from './execution-context';
import type { ApplicationDataBinding } from './application-adapter-registry';
import type { ApplicationModuleRegistry, TrustedApplicationModule } from './modules/registry';
import type { BuiltinPackageRegistry } from './builtin-package-registry';
import { canonicalJson } from './manifest';

interface CapabilityData {
  execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>;
}
/** UI, MCP and CLI converge here after their own host-issued identity checks. */
export class ApplicationCapabilityExecution {
  constructor(private readonly contexts:ApplicationExecutionContexts,private readonly modules:ApplicationModuleRegistry<readonly TrustedApplicationModule[]>,private readonly packages:BuiltinPackageRegistry,private readonly data:CapabilityData){}

  private declaration(packageHash:string,capabilityId:string,contractMajor:number):ApplicationCapability{
    const application=this.packages.assertTrusted(packageHash);
    const capability=this.modules.legacyCapabilities(application.manifest).find(c=>c.id===capabilityId&&c.contractMajor===contractMajor);
    if(!capability)throw new ApplicationError('SCOPE_DENIED','原应用包没有声明本次能力契约');
    const trusted=this.modules.capability(application.appId,capabilityId,contractMajor);
    for(const key of ['semantics','permission','retry','slots','protection','approval'] as const){
      if(canonicalJson(capability[key]??null)!==canonicalJson(trusted[key]??null))throw new ApplicationError('HOST_INCOMPATIBLE','包声明与受信业务能力不一致');
    }
    return capability;
  }
  forMethod(binding:Readonly<ApplicationDataBinding>,method:string,contractMajor:number):ApplicationCapability{
    const application=this.packages.assertTrusted(binding.packageHash);
    const capability=this.modules.legacyCapabilities(application.manifest).find(c=>c.legacyTool?.name===binding.toolName&&c.legacyTool.contractMajor===contractMajor);
    if(application.appId!==binding.appId||!capability||capability.permission!==binding.permission||this.modules.capability(binding.appId,capability.id,contractMajor).method!==method)throw new ApplicationError('SCOPE_DENIED','固定Data API路由不能替换业务能力');
    return this.declaration(binding.packageHash,capability.id,contractMajor);
  }
  async execute(caller:CallerContext,capabilityId:string,contractMajor:number,args:unknown,signal?:AbortSignal):Promise<unknown>{
    // Authentication precedes argument interpretation, slot/credential resolution and business work.
    const context=this.contexts.contextFor(caller);
    if(caller.kind==='management'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','连接管理身份不能读取项目业务数据');
    const capability=this.declaration(context.packageHash,capabilityId,contractMajor);
    this.contexts.require(context,capability.permission);
    if(!capability.id.startsWith(context.appId+'.')||capability.semantics!=='read'&&(context.semantics!=='write'||caller.kind==='internal'))throw new ApplicationError('SCOPE_DENIED','本次调用上下文未授权该业务动作');
    if(caller.kind==='agent'&&capability.legacyTool?.name!==context.action)throw new ApplicationError('SCOPE_DENIED','网关签发身份只允许当前固定能力');
    if(!boundedJson(args)||!args||typeof args!=='object'||Array.isArray(args))throw new ApplicationError('INVALID_INPUT','能力参数必须是有界对象');
    const implementation=this.modules.capability(context.appId,capabilityId,contractMajor);
    return this.contexts.withSignal(context,signal,async()=>{
      await this.contexts.requireSlots(context,capability.slots.required);
      const result=await this.data.execute(context,implementation.method,args);
      this.contexts.require(context,capability.permission);
      return result;
    });
  }
}
