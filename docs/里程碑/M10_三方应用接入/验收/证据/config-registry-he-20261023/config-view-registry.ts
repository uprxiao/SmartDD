import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {connectionConfigSchema,type ConnectionConfig} from '@shared/application-connections';
import {canonicalJson,digest} from './manifest';

export interface ConfigViewKey {providerId:string;sourceSchemaVersion:number;targetApiMajor:number;identityContractMajor:number}
export interface ConfigViewConverter extends ConfigViewKey {
 implementationVersion:string;
 sourceSchema:z.ZodType;
 authModes:readonly string[];
 authentication:(source:unknown)=>string;
 convert:(source:unknown)=>unknown;
}
const key=(v:ConfigViewKey)=>JSON.stringify([v.providerId,v.sourceSchemaVersion,v.targetApiMajor,v.identityContractMajor]);
const incompatible=()=>new ApplicationError('CONFIG_INCOMPATIBLE','当前配置不能等价转换为原包配置');
/** Compiled host definitions only. Package/client input cannot register converters.
 * No credentials or execution context are passed into a converter. */
export class ConfigViewRegistry {
 private readonly entries=new Map<string,{definition:ConfigViewConverter;hash:string}>();
 constructor(definitions:readonly ConfigViewConverter[]){
  for(const input of definitions){
   if(!/^[a-z][a-z0-9.-]{0,127}$/.test(input.providerId)||![input.sourceSchemaVersion,input.targetApiMajor,input.identityContractMajor].every(v=>Number.isSafeInteger(v)&&v>0)||!input.implementationVersion||!input.authModes.length||new Set(input.authModes).size!==input.authModes.length||this.entries.has(key(input)))throw new Error('配置转换器注册无效或重复');
   const definition=Object.freeze({...input,authModes:Object.freeze([...input.authModes])});
   const hash=digest(canonicalJson({key:JSON.parse(key(input)),implementationVersion:input.implementationVersion,sourceSchema:z.toJSONSchema(input.sourceSchema),targetSchema:z.toJSONSchema(connectionConfigSchema),authModes:input.authModes,authentication:String(input.authentication),implementation:String(input.convert)}));
   this.entries.set(key(input),{definition,hash});
  }
 }
 resolve(request:ConfigViewKey,source:unknown,allowedAuthModes:readonly string[]){
  const entry=this.entries.get(key(request));if(!entry)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','没有已验证的配置转换器');
  try{
   const parsed=entry.definition.sourceSchema.safeParse(structuredClone(source));if(!parsed.success)throw incompatible();
   const auth=entry.definition.authentication(parsed.data);if(!entry.definition.authModes.includes(auth)||!allowedAuthModes.includes(auth))throw incompatible();
   const converted=entry.definition.convert(structuredClone(parsed.data));
   const result=connectionConfigSchema.safeParse(converted);if(!result.success||result.data.kind!==request.providerId)throw incompatible();
   const outputAuth=result.data.kind==='foxmail'?'local-readonly':result.data.authMode;if(outputAuth!==auth)throw incompatible();
   const view=Object.freeze(result.data);return{view,viewMajor:request.targetApiMajor,viewDigest:digest(canonicalJson(view)),converterHash:entry.hash};
  }catch{throw incompatible();}
 }
}
const auth=(source:unknown)=>{const config=source as ConnectionConfig;return config.kind==='foxmail'?'local-readonly':config.authMode;};
export const builtinConfigViews=new ConfigViewRegistry(['zentao','foxmail','smtp'].map(providerId=>({providerId,sourceSchemaVersion:1,targetApiMajor:1,identityContractMajor:1,implementationVersion:'1',sourceSchema:connectionConfigSchema,authModes:providerId==='foxmail'?['local-readonly']:providerId==='smtp'?['password']:['token','password'],authentication:auth,convert:(source:unknown)=>source})));
