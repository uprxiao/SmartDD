import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {type ConnectionConfig} from '@shared/application-connections';
import {canonicalJson,digest} from './manifest';
import {builtinApplicationModules} from './modules';

export interface ConfigViewKey {providerId:string;sourceSchemaVersion:number;targetApiMajor:number;identityContractMajor:number}
export interface ConfigViewConverter<V extends {kind:string}=ConnectionConfig> extends ConfigViewKey {
 implementationVersion:string;
 sourceSchema:z.ZodType;
 targetSchema:z.ZodType<V>;
 outputAuthentication:(view:V)=>string;
 authModes:readonly string[];
 authentication:(source:unknown)=>string;
 convert:(source:unknown)=>unknown;
}
const key=(v:ConfigViewKey)=>JSON.stringify([v.providerId,v.sourceSchemaVersion,v.targetApiMajor,v.identityContractMajor]);
const incompatible=()=>new ApplicationError('CONFIG_INCOMPATIBLE','当前配置不能等价转换为原包配置');
/** Compiled host definitions only. Package/client input cannot register converters.
 * No credentials or execution context are passed into a converter. */
export class ConfigViewRegistry<V extends {kind:string}=ConnectionConfig> {
 private readonly entries=new Map<string,{definition:ConfigViewConverter<V>;hash:string}>();
 constructor(definitions:readonly ConfigViewConverter<V>[]){
  for(const input of definitions){
   if(!/^[a-z][a-z0-9.-]{0,127}$/.test(input.providerId)||![input.sourceSchemaVersion,input.targetApiMajor,input.identityContractMajor].every(v=>Number.isSafeInteger(v)&&v>0)||!input.implementationVersion||!input.authModes.length||new Set(input.authModes).size!==input.authModes.length||this.entries.has(key(input)))throw new Error('配置转换器注册无效或重复');
   const definition=Object.freeze({...input,authModes:Object.freeze([...input.authModes])});
   const hash=digest(canonicalJson({key:JSON.parse(key(input)),implementationVersion:input.implementationVersion,sourceSchema:z.toJSONSchema(input.sourceSchema),targetSchema:z.toJSONSchema(input.targetSchema),authModes:input.authModes,authentication:String(input.authentication),outputAuthentication:String(input.outputAuthentication),implementation:String(input.convert)}));
   this.entries.set(key(input),{definition,hash});
  }
 }
 resolve(request:ConfigViewKey,source:unknown,allowedAuthModes:readonly string[]){
  const entry=this.entries.get(key(request));if(!entry)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','没有已验证的配置转换器');
  try{
   const parsed=entry.definition.sourceSchema.safeParse(structuredClone(source));if(!parsed.success||canonicalJson(parsed.data)!==canonicalJson(source))throw incompatible();
   const auth=entry.definition.authentication(parsed.data);if(!entry.definition.authModes.includes(auth)||!allowedAuthModes.includes(auth))throw incompatible();
   const converted=entry.definition.convert(structuredClone(parsed.data));
   const result=entry.definition.targetSchema.safeParse(converted);if(!result.success||result.data.kind!==request.providerId||canonicalJson(result.data)!==canonicalJson(converted))throw incompatible();
   const outputAuth=entry.definition.outputAuthentication(result.data);if(outputAuth!==auth)throw incompatible();
   const view=Object.freeze(result.data);return{view,viewMajor:request.targetApiMajor,viewDigest:digest(canonicalJson(view)),converterHash:entry.hash};
  }catch{throw incompatible();}
 }
}
let current:ConfigViewRegistry<ConnectionConfig>|undefined;
// Resolve lazily after module composition; initialization never follows the
// connection/context import cycle into a partially initialized registry.
export const builtinConfigViews:Pick<ConfigViewRegistry<ConnectionConfig>,'resolve'>={resolve:(...args)=>{
 // The compiled tuple supplies all current configuration variants. Retained
 // converters still validate their exact target schema before returning a view.
 current??=new ConfigViewRegistry(builtinApplicationModules.configViews() as unknown as readonly ConfigViewConverter<ConnectionConfig>[]);
 return current.resolve(...args);
}};
