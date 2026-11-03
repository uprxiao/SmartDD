import { ApplicationError } from '@shared/applications';
import commands from '@shared/browser-s1-commands.json';
import type { ApplicationModuleData, ApplicationModuleDefinition, ApplicationModuleServices, ApplicationModuleCapability } from '../registry';
import type { ApplicationExecutionContext } from '../../execution-context';
import type { BrowserService } from '../../../browser/service';
import type { ApplicationDataBinding } from '../../application-adapter-registry';
import type { RunContext } from '../../run-registry';
import type { ApplicationOperationContext } from '../../tool-service';

const rules:Record<string,ApplicationModuleCapability & {semantics:'read'|'write'}>=Object.fromEntries(commands.map(command=>[command.id,{
  id:command.id,method:command.id,contractMajors:[2],permission:'browser.'+command.semantics,
  semantics:command.semantics==='read'?'read':'write',retry:command.semantics==='read'?'safe-read':'never',slots:{required:[],conditional:[]},
  ...(command.semantics==='write'?{protection:{kind:'operation-receipt' as const,object:'browser_operation',key:'requestId'}}:{}),
}]));

class BrowserModuleData implements ApplicationModuleData {
  constructor(private readonly services:ApplicationModuleServices){}
  resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>){
    const rule=rules[method];
    if(version!==1||!rule||binding.appId!=='browser'||binding.entry!=='cli')
      throw new ApplicationError('CAPABILITY_UNAVAILABLE','浏览器只接受已登记的CLI能力');
    return {
      semantics:rule.semantics,retry:rule.retry,timeoutMs:110000,
      authorize:(run:RunContext)=>{
        this.services.selections.requireApplicationEnabled(run.run.projectId,'browser');
        if(!run.snapshot.packages.some(item=>item.appId==='browser'&&item.packageHash===binding.packageHash&&item.allowedOperations.includes(rule.permission)))
          throw new ApplicationError('SCOPE_DENIED','本次运行未选用此浏览器能力');
      },
      execute:(run:RunContext,args:Record<string,unknown>,operation:ApplicationOperationContext)=>
        this.services.contexts.withAgent(run,binding,operation,rule.semantics,context=>this.execute(context,method,args)),
    };
  }
  async execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>{
    const rule=rules[method],command=commands.find(item=>item.id===method);
    if(!rule||!command)throw new ApplicationError('CAPABILITY_UNAVAILABLE','S1未开放此浏览器命令');
    this.services.contexts.require(context,rule.permission);
    const caller=this.services.contexts.caller(context);
    if(caller.kind!=='agent'||caller.entry!=='cli'||!context.projectId||!context.taskId||!context.runId)
      throw new ApplicationError('SCOPE_DENIED','浏览器需要宿主签发的项目任务CLI运行身份');
    this.services.selections.requireApplicationEnabled(context.projectId,'browser');
    if(!input||typeof input!=='object'||Array.isArray(input))throw new ApplicationError('INVALID_INPUT','浏览器参数必须为对象');
    const service=this.services.retained.get('browser') as BrowserService|undefined;
    if(!service)throw new ApplicationError('BROWSER_UNAVAILABLE','浏览器主进程服务尚未就绪');
    return service.execute({projectId:context.projectId,taskId:context.taskId,runId:context.runId,requestId:caller.requestId,
      operationId:context.operationId,signal:context.signal,assertActive:()=>this.services.contexts.require(context,rule.permission)},
      command.command.slice(1).join(' '),input as Record<string,unknown>);
  }
}

export const browserModule:ApplicationModuleDefinition<'browser',readonly []>={
  appId:'browser',contractMajors:[1],connectionless:true,providers:[],slots:[],stopBeforeSwitch:false,capabilities:rules,
  presentation:{displayName:'浏览器',heading:'项目任务内置浏览器',mark:'link',projectNote:'使用任务中的内置网页，无需配置外部账号连接。',emptyConnectionSuffix:'',defaultProvider:'',panel:null,switchTitle:'浏览器'},
  legacyPolicy(){throw new ApplicationError('HOST_INCOMPATIBLE','浏览器没有历史MCP入口');},
  createData:services=>new BrowserModuleData(services),
};
