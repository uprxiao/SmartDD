import {z} from 'zod';
import type Database from 'better-sqlite3';
import {ApplicationError} from '@shared/applications';
import {type ApplicationId,type ConnectionConfig,type ApplicationConnection,type SaveApplicationConnection,type VerifiedConnectionIdentity,type VerifiedConnectionCandidate,type ProjectApplicationSelection,type ProjectApplicationSelectionInput} from '@shared/application-connections';

export interface HostedConfiguration {kind:string}
/** Main-process compiled identities only; persisted rows never implement this catalog. */
export interface ApplicationHostCatalog {appIds():readonly string[]}
export type HostedIdentity<C extends HostedConfiguration>=Omit<VerifiedConnectionIdentity,'providerId'>&{providerId:C['kind']};
export type HostedConnection<C extends HostedConfiguration,A extends string>=Omit<ApplicationConnection,'appId'|'providerId'|'config'|'identity'>&{appId:A;providerId:C['kind'];config:C;identity:HostedIdentity<C>};
export type HostedSave<C extends HostedConfiguration>=Omit<SaveApplicationConnection,'config'>&{config:C};
export type HostedCandidate<C extends HostedConfiguration>=Omit<VerifiedConnectionCandidate,'identity'>&{identity:HostedIdentity<C>};
export type HostedSelectionInput<C extends HostedConfiguration,A extends string>=Omit<ProjectApplicationSelectionInput,'appId'|'connections'|'repair'>&{appId:A;connections:Partial<Record<C['kind'],string|null>>;repair?:{slot:C['kind'];fingerprint:string}};
export type HostedSelection<C extends HostedConfiguration,A extends string>=Omit<ProjectApplicationSelection,'appId'|'connections'|'slotRevisions'|'repair'>&{appId:A;connections:Partial<Record<C['kind'],string|null>>;slotRevisions:Partial<Record<C['kind'],number>>;repair?:{slots:C['kind'][];fingerprint:string}};
export interface HostProvider<C extends HostedConfiguration,A extends string>{
 id:C['kind'];appId:A;configApiMajor:1;configSchemaVersion?:number;configSchema:z.ZodType<C>;
 authentication:{kind:'secret';modes:readonly string[]}|{kind:'none';mode:string};
 permissions:{read:string;write:string};
 /** Non-authority defaults pinned per read operation; only trusted, unauthenticated providers may declare them. */
 readDefaultKeys?:readonly string[];
 validateCandidate?:(config:C,previous:C|null,secretSupplied:boolean)=>void;
}
export interface HostApplicationDefinitions<C extends HostedConfiguration,A extends string>{
 api:1;applications:readonly {id:A;slots:readonly C['kind'][];stopBeforeSwitch:boolean}[];
 providers:readonly HostProvider<C,A>[];
}
const id=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const text=z.string().trim().min(1).max(512).refine(s=>!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(s));
const identitySchema=z.object({providerId:id,serviceId:text,accountId:text,contractMajor:z.literal(1)}).strict();
const saveFields=z.object({id:z.uuid().optional(),expectedRevision:z.number().int().nonnegative(),name:text.max(120),config:z.unknown(),secret:z.string().min(1).max(65536).optional(),acceptedImpactHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const selectionFields=z.object({projectId:z.string().min(1).max(128),appId:id,expectedRevision:z.number().int().nonnegative(),enabled:z.boolean(),connections:z.record(id,z.uuid().nullable()),repair:z.object({slot:id,fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict();
const exactKeys=(value:unknown,keys:readonly string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&keys.includes(key));
/** Compiled main-process definitions only. Neither RPC nor package manifests can
 * register schemas,executors or providers. Persistent rows are FK metadata,not
 * executable approval; every use still needs this current host definition. */
export class HostApplicationRegistry<C extends HostedConfiguration,A extends string>{
 private readonly applications=new Map<string,{id:A;slots:readonly C['kind'][];stopBeforeSwitch:boolean}>();
 private readonly providers=new Map<string,HostProvider<C,A>>();
 constructor(definitions:HostApplicationDefinitions<C,A>){
  const invalid=()=>new ApplicationError('INVALID_INPUT','受信宿主应用定义无效、重复或版本不支持');
  if(!exactKeys(definitions,['api','applications','providers'])||definitions.api!==1||!Array.isArray(definitions.applications)||!definitions.applications.length||definitions.applications.length>128||!Array.isArray(definitions.providers)||!definitions.providers.length||definitions.providers.length>256)throw invalid();
  for(const application of definitions.applications){
   if(!exactKeys(application,['id','slots','stopBeforeSwitch'])||!id.safeParse(application.id).success||this.applications.has(application.id)||typeof application.stopBeforeSwitch!=='boolean'||!Array.isArray(application.slots)||!application.slots.length||application.slots.length>32||new Set(application.slots).size!==application.slots.length)throw invalid();
   this.applications.set(application.id,Object.freeze({...application,slots:Object.freeze([...application.slots])}));
  }
  for(const provider of definitions.providers){
   if(!exactKeys(provider,['id','appId','configApiMajor','configSchemaVersion','configSchema','authentication','permissions','readDefaultKeys','validateCandidate'])||!id.safeParse(provider.id).success||this.providers.has(provider.id)||!this.applications.has(provider.appId)||provider.configApiMajor!==1||!Number.isSafeInteger(provider.configSchemaVersion??1)||(provider.configSchemaVersion??1)<1||!provider.configSchema||typeof provider.configSchema.safeParse!=='function'||!exactKeys(provider.permissions,['read','write'])||![provider.permissions.read,provider.permissions.write].every(p=>typeof p==='string'&&p.startsWith(provider.appId+'.')&&/^[a-z][a-z0-9.-]{0,127}$/.test(p)))throw invalid();
   const auth=provider.authentication;
   if(!auth||auth.kind!=='none'&&auth.kind!=='secret'||auth.kind==='secret'&&(!exactKeys(auth,['kind','modes'])||!Array.isArray(auth.modes)||!auth.modes.length||new Set(auth.modes).size!==auth.modes.length||auth.modes.some((v:unknown)=>!id.safeParse(v).success))||auth.kind==='none'&&(!exactKeys(auth,['kind','mode'])||!id.safeParse(auth.mode).success))throw invalid();
   if(provider.readDefaultKeys!==undefined&&(!Array.isArray(provider.readDefaultKeys)||!provider.readDefaultKeys.length||provider.readDefaultKeys.length>8||auth.kind!=='none'||new Set(provider.readDefaultKeys).size!==provider.readDefaultKeys.length||provider.readDefaultKeys.some((key:unknown)=>typeof key!=='string'||!/^[a-z][A-Za-z0-9]{0,63}$/.test(key)||['kind','constructor','prototype'].includes(key))))throw invalid();
   if(provider.validateCandidate!==undefined&&typeof provider.validateCandidate!=='function')throw invalid();
   this.providers.set(provider.id,Object.freeze({...provider,...(provider.readDefaultKeys?{readDefaultKeys:Object.freeze([...provider.readDefaultKeys])}:{}),permissions:Object.freeze({...provider.permissions}),authentication:auth.kind==='secret'?Object.freeze({kind:'secret' as const,modes:Object.freeze([...auth.modes])}):Object.freeze({...auth})}));
  }
  for(const application of this.applications.values())if(application.slots.some(slot=>this.providers.get(slot)?.appId!==application.id))throw invalid();
  for(const provider of this.providers.values())if(!this.applications.get(provider.appId)!.slots.includes(provider.id))throw invalid();
 }
 application(value:string){const found=this.applications.get(value);if(!found)throw new ApplicationError('CONFIG_INCOMPATIBLE','当前宿主没有此应用定义');return found;}
 provider(value:string){const found=this.providers.get(value);if(!found)throw new ApplicationError('CONFIG_INCOMPATIBLE','当前宿主没有此连接类型定义');return found;}
 appId(value:string):A{return this.application(value).id;}
 providerApplication(value:string):A{return this.provider(value).appId;}
 appIds():readonly A[]{return[...this.applications.values()].map(v=>v.id);}
 parseConfig(value:unknown):C{
  const shape=z.object({kind:id}).passthrough().safeParse(value);if(!shape.success)throw new ApplicationError('INVALID_INPUT','连接字段无效，请核对表单');
  const provider=this.providers.get(shape.data.kind),parsed=provider?.configSchema.safeParse(value);
  if(!parsed?.success||parsed.data.kind!==provider!.id)throw new ApplicationError('INVALID_INPUT','连接字段无效，请核对表单');
  this.authMode(parsed.data);return parsed.data;
 }
 parseSave(value:unknown):HostedSave<C>{const parsed=saveFields.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','连接字段无效，请核对表单');return{...parsed.data,config:this.parseConfig(parsed.data.config)};}
 parseSelection(value:unknown):HostedSelectionInput<C,A>{
  const parsed=selectionFields.safeParse(value),application=parsed.success?this.applications.get(parsed.data.appId):undefined;
  if(!parsed.success||!application||application.slots.some(slot=>!Object.hasOwn(parsed.data.connections,slot))||Object.keys(parsed.data.connections).some(slot=>!application.slots.includes(slot))||parsed.data.repair&&!application.slots.includes(parsed.data.repair.slot))throw new ApplicationError('INVALID_INPUT','项目连接必须按来源类别分别单选，也可明确不选用');
  const connections:Partial<Record<C['kind'],string|null>>={};for(const slot of application.slots)connections[slot]=parsed.data.connections[slot];return{...parsed.data,appId:application.id,connections};
 }
 parseIdentity(value:unknown,expectedProvider?:string):HostedIdentity<C>{
  const parsed=identitySchema.safeParse(value);if(!parsed.success)throw new ApplicationError('AUTH_REQUIRED','无法核实当前服务和账号身份');const provider=this.provider(parsed.data.providerId);
  if(expectedProvider!==undefined&&provider.id!==expectedProvider)throw new ApplicationError('AUTH_REQUIRED','无法核实当前服务和账号身份');return{...parsed.data,providerId:provider.id};
 }
 authMode(config:C):string{
  const auth=this.provider(config.kind).authentication;if(auth.kind==='none')return auth.mode;const value:unknown=Reflect.get(config,'authMode');
  if(typeof value!=='string'||!auth.modes.includes(value))throw new ApplicationError('INVALID_INPUT','连接认证方式不属于已注册宿主契约');return value;
 }
 requiresSecret(config:C):boolean{return this.provider(config.kind).authentication.kind==='secret';}
 validateCandidate(config:C,previous:C|null,secretSupplied:boolean):void{
  if(previous&&previous.kind!==config.kind)throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION','已有连接不能替换应用类型，请新建连接');
  if(!this.requiresSecret(config)&&secretSupplied)throw new ApplicationError('INVALID_INPUT','本地只读来源不保存发件凭据');this.provider(config.kind).validateCandidate?.(config,previous,secretSupplied);
 }
 /** Same SQLite store and transaction as normal connections. No rows confer
  * authority on a program that has not compiled the corresponding definition. */
 register(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
   for(const application of this.applications.values())sqlite.prepare('INSERT OR IGNORE INTO application_host_applications(app_id) VALUES(?)').run(application.id);
   for(const provider of this.providers.values()){
    const existing=sqlite.prepare('SELECT app_id,config_api_major FROM application_host_providers WHERE provider_id=?').get(provider.id) as {app_id:string;config_api_major:number}|undefined;
    if(existing&&(existing.app_id!==provider.appId||existing.config_api_major!==provider.configApiMajor))throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','已登记连接类型的应用归属或契约不符，保留原数据');
    sqlite.prepare('INSERT OR IGNORE INTO application_host_providers(provider_id,app_id,config_api_major) VALUES(?,?,?)').run(provider.id,provider.appId,provider.configApiMajor);
   }
  }).immediate();
 }
}
export {builtinHostApplications} from './modules';
