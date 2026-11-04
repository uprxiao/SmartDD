import {z} from 'zod';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {ApplicationModuleDefinition,ApplicationProviderDefinition,ApplicationModuleServices,ApplicationModuleData} from '../registry';
import type {ApplicationExecutionContext} from '../../execution-context';
import type {ApplicationDataBinding} from '../../application-adapter-registry';
import {UpstreamSessionPool,type UpstreamDefinition} from '../../upstream/session-pool';
import {digest} from '../../manifest';

// A controlled example, never an arbitrary command/URL/real credential importer.
export const sampleKvConfig=z.object({kind:z.literal('sample-kv'),service:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),prefix:z.string().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/),transport:z.enum(['mcp','cli']),authMode:z.literal('token')}).strict();
const key=z.string().min(1).max(256),read=z.object({key}).strict(),write=z.object({key,value:z.string().max(16384),expectedRevision:z.number().int().nonnegative()}).strict(),result=z.object({key,value:z.string().nullable(),revision:z.number().int().nonnegative(),operationId:z.string().nullable()}).strict();
const scriptHash='cfea6411082a57a194f2105356224038a0dba6a1fc6da268b75f507d600653c2';
const rules={
 'sample-kv.entry.read':{id:'sample-kv.entry.read',method:'sample-kv.entry.read',contractMajors:[2],permission:'sample-kv.read',semantics:'read' as const,retry:'safe-read' as const,slots:{required:['sample-kv'],conditional:[]}},
 'sample-kv.entry.write':{id:'sample-kv.entry.write',method:'sample-kv.entry.write',contractMajors:[2],permission:'sample-kv.write',semantics:'write' as const,retry:'never' as const,slots:{required:['sample-kv'],conditional:[]},protection:{kind:'revision' as const,object:'sample_kv_entry',key:'expectedRevision'}},
};
class SampleKvData implements ApplicationModuleData {
 private readonly pool:UpstreamSessionPool;
 constructor(private readonly services:ApplicationModuleServices){this.pool=new UpstreamSessionPool(join(services.store.root,'upstream-sessions/sample-kv'));}
 resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>){
  const rule=rules[method as keyof typeof rules];if(version!==1||!rule||binding.appId!=='sample-kv')throw new ApplicationError('CAPABILITY_UNAVAILABLE','样本应用能力未声明');
  return{semantics:rule.semantics,retry:rule.retry,authorize:(context:import('../../run-registry').RunContext)=>{this.services.selections.requireApplicationEnabled(context.run.projectId,'sample-kv');if(!context.snapshot.packages.some(p=>p.packageHash===binding.packageHash&&p.allowedOperations.includes(rule.permission)))throw new ApplicationError('SCOPE_DENIED','原会话未选用此样本能力');},execute:(context:import('../../run-registry').RunContext,args:Record<string,unknown>,operation:import('../../tool-service').ApplicationOperationContext)=>this.services.contexts.withAgent(context,binding,operation,rule.semantics,scope=>this.execute(scope,method,args))};
 }
 async execute(context:ApplicationExecutionContext,method:string,input:unknown){
  const rule=rules[method as keyof typeof rules];if(!rule)throw new ApplicationError('SCOPE_DENIED','此样本应用没有该能力');this.services.contexts.require(context,rule.permission);
  const args=(rule.semantics==='read'?read:write).parse(input),{connection,secret,configView}=await this.services.contexts.connection(context,'sample-kv'),config=sampleKvConfig.parse(configView.view);
  const packaged=process.resourcesPath?join(process.resourcesPath,'application-upstreams/sample-kv.cjs'):'';const script=realpathSync(packaged&&existsSync(packaged)?packaged:resolve('resources/application-upstreams/sample-kv.cjs')),command=realpathSync(process.execPath);
  const definition:UpstreamDefinition={id:'sample-kv-reference-'+config.transport,kind:config.transport,command,args:[script,config.transport],resources:[{path:command,sha256:digest(readFileSync(command))},{path:script,sha256:scriptHash}],versions:['1.0.0'],isolation:'private-home-xdg',environment:{ELECTRON_RUN_AS_NODE:'1',WILLYOU_SAMPLE_DATA:join(this.services.store.root,'reference-services',digest(config.service))},capabilities:Object.fromEntries(Object.values(rules).map(capability=>[capability.id,{semantics:capability.semantics,input:capability.semantics==='read'?read:write,output:result,inScope:(a,s)=>String(a.key).startsWith(s.prefix),...(config.transport==='mcp'?{tool:capability.semantics==='read'?'kv_get':'kv_put'}:{command:[capability.semantics==='read'?'kv_get':'kv_put']}),arguments:(a,protection)=>({...a,...(capability.semantics==='write'?{operationId:protection}:{})})}]))};
  const session=await this.pool.acquire(definition,{id:connection.id,revision:connection.revision,scope:{prefix:config.prefix},credential:secret});
  try{return await session.invoke(method,args,{signal:context.signal,deadline:Date.now()+30000,operationId:context.operationId,...(rule.semantics==='write'?{protection:context.operationId}:{})});}finally{await session.release();}
 }
 async connectionsChanged(){for(const session of this.pool.status()){const current=this.services.connections.get(session.connectionId);if(!current.enabled||current.authorization!=='connected')await this.pool.retireConnection(current.id);else await this.pool.rotateConnection(current.id,current.revision);}}
 dispose(){return this.pool.close();}
}
export const sampleKvModule:ApplicationModuleDefinition<'sample-kv',readonly[ApplicationProviderDefinition<typeof sampleKvConfig,'sample-kv','sample-kv'>]>={
 appId:'sample-kv',contractMajors:[1],slots:['sample-kv'],stopBeforeSwitch:false,capabilities:rules,
 presentation:{displayName:'接入标准示例',heading:'受控 MCP／CLI 接入示例',mark:'link',projectNote:'仅使用合成凭据与本机样本数据，用于验证应用接入规范。',emptyConnectionSuffix:'',defaultProvider:'sample-kv',panel:null,switchTitle:'切换样本连接'},
 providers:[{id:'sample-kv',appId:'sample-kv',configApiMajor:1,configSchema:sampleKvConfig,authentication:{kind:'secret',modes:['token']},permissions:{read:'sample-kv.read',write:'sample-kv.write'},presentation:{id:'sample-kv',appId:'sample-kv',title:'本机样本连接',icon:'link',initial:{kind:'sample-kv',service:'local-reference',prefix:'demo:',transport:'mcp',authMode:'token'},summaryFields:['service','transport'],locationField:'prefix',secret:{title:'合成 Token',authModeValidation:'样本仅接受 SYNTHETIC_ 开头的合成 Token。'},project:{title:'样本连接',unselectedNote:'不自动选用连接。'},groups:[{key:'service',title:'样本服务',label:'样本服务',type:'text',required:true,validation:'使用小写字母、数字和短横线。'},{key:'prefix',title:'允许的键前缀',label:'允许的键前缀',type:'text',required:true,validation:'请填写可判定的非空键前缀。'},{key:'transport',title:'上游方式',label:'上游方式',type:'select',options:[{value:'mcp',label:'MCP'},{value:'cli',label:'CLI'}],validation:'请选择受控上游方式。'}]},async verify(value,secret){const config=sampleKvConfig.parse(value);if(!secret?.startsWith('SYNTHETIC_'))throw new ApplicationError('AUTH_FAILED','只接受合成测试 Token');return{providerId:'sample-kv',serviceId:'reference:'+config.service,accountId:config.prefix,contractMajor:1};}}],
 legacyPolicy(){throw new ApplicationError('HOST_INCOMPATIBLE','样本应用没有历史 v1 工具');},createData:services=>new SampleKvData(services),
};
