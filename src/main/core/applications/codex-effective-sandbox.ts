import {execFile} from 'node:child_process';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {boundedJson} from '@shared/application-bridge';
import {codexConfigurationArgs,projectLayers} from '../capabilities/discovery';
import {canonicalJson,digest} from './manifest';
import type {TaskLaunchInput,NativeLaunchContext} from './native-launch-context';

type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=['default_permissions','permissions','sandbox_mode','sandbox_workspace_write','approval_policy','approvals_reviewer','features'] as const;
// smol-toml intentionally emits null-prototype records. Normalize them without
// accepting dates, custom prototypes, reserved keys or recursive over-budget input.
function plainJson(value:unknown):unknown{
  const queue=[{value,depth:0}];let nodes=0;
  while(queue.length){const item=queue.pop()!;if(++nodes>20000||item.depth>32)throw Error('budget');const v=item.value;if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))continue;if(!v||typeof v!=='object')throw Error('shape');if(!Array.isArray(v)&&![null,Object.prototype].includes(Object.getPrototypeOf(v)))throw Error('prototype');for(const[key,child]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(key))throw Error('reserved');queue.push({value:child,depth:item.depth+1});}}
  return JSON.parse(JSON.stringify(value));
}
export interface CodexRequirementsProof {version:string;known:boolean;empty:boolean;hash:string|null}
export type CodexCliSandboxPlan={available:false;reason:string;source:string;digest:string|null}|{available:true;kind:'unchanged'|'inherit';parent:string|null;networkProxy:boolean;enableNetwork:boolean;existingNames:string[];source:string;digest:string};
const unsupported=(reason:string,digest:string|null=null):CodexCliSandboxPlan=>({available:false,reason,source:'unverified-effective-policy',digest});
const merge=(first:ObjectValue,second:ObjectValue):ObjectValue=>{const result=structuredClone(first);for(const[key,value]of Object.entries(second))result[key]=object(value)&&object(result[key])?merge(result[key],value):structuredClone(value);return result;};

/** Hash the complete security input. Named rules are inherited, never rebuilt from a mode label. */
export function planCodexCliSandbox(input:{version:string;layers:readonly {source:string;config:ObjectValue;hash:string}[];args:readonly string[];requirements:CodexRequirementsProof}):CodexCliSandboxPlan{
  if(input.version!=='0.166.0')return unsupported('cli-version-unverified');
  if(!input.requirements.known||!input.requirements.empty||input.requirements.version!==input.version||!/^[a-f0-9]{64}$/.test(input.requirements.hash??''))return unsupported('managed-requirements-unverified');
  let valid=true,settings:ObjectValue={};const parsed=codexConfigurationArgs([...input.args],()=>{valid=false;});
  for(const layer of input.layers){if(!boundedJson(layer.config))return unsupported('configuration-budget');const selected=Object.fromEntries(keys.filter(k=>Object.hasOwn(layer.config,k)).map(k=>[k,layer.config[k]]));if(layer.source==='system'&&Object.keys(selected).length)return unsupported('system-policy-unverified');settings=merge(settings,selected);}
  for(const raw of parsed.overrides){let override:ObjectValue;try{override=plainJson(raw) as ObjectValue;}catch{return unsupported('configuration-budget');}settings=merge(settings,Object.fromEntries(keys.filter(k=>Object.hasOwn(override,k)).map(k=>[k,override[k]])));}
  let extraDirectories=false;
  for(let i=0;i<input.args.length;i++){
    const arg=input.args[i];let mode:string|undefined;
    if(arg==='--sandbox'||arg==='-s')mode=input.args[++i];else if(arg.startsWith('--sandbox='))mode=arg.slice(10);else if(arg.startsWith('-s')&&arg.length>2)mode=arg.slice(2).replace(/^=/,'');
    else if(arg==='--dangerously-bypass-approvals-and-sandbox'||arg==='--yolo')mode='danger-full-access';else if(arg==='--approve-for-me'||arg==='--full-auto')mode='workspace-write';
    if(mode!==undefined)settings.sandbox_mode=mode;else if(arg==='--sandbox'||arg==='-s')valid=false;
    if(arg==='--add-dir'||arg.startsWith('--add-dir=')||arg==='--cd'||arg.startsWith('--cd=')||arg==='-C')extraDirectories=true;
    if(arg==='--enable'||arg==='--disable'||arg.startsWith('--enable=')||arg.startsWith('--disable=')){const enabled=arg==='--enable'||arg.startsWith('--enable='),feature=arg.includes('=')?arg.slice(arg.indexOf('=')+1):input.args[++i];if(!feature){valid=false;break;}const features=object(settings.features)?settings.features:{};settings.features={...features,[feature]:enabled};}
  }
  if(!valid||extraDirectories)return unsupported('effective-arguments-unverified');
  const hash=digest(canonicalJson({version:input.version,settings,sources:input.layers.map(l=>({source:l.source,hash:l.hash})),requirements:input.requirements.hash}));
  const mode=settings.sandbox_mode,permissions=object(settings.permissions)?settings.permissions:{},names=Object.keys(permissions);
  if(mode==='danger-full-access'&&!settings.default_permissions)return{available:true,kind:'unchanged',parent:null,networkProxy:false,enableNetwork:false,existingNames:names,source:'explicit-full-access',digest:hash};
  if(settings.sandbox_workspace_write!==undefined&&(!object(settings.sandbox_workspace_write)||Object.keys(settings.sandbox_workspace_write).length))return unsupported('legacy-workspace-rules-unverified',hash);
  let parent:string,network:ObjectValue={},source:string;
  if(settings.default_permissions!==undefined){
    if(typeof settings.default_permissions!=='string'||mode!==undefined)return unsupported('mixed-permissions-settings-unverified',hash);
    parent=settings.default_permissions;if(!/^[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,127}$/.test(parent))return unsupported('permission-name-unverified',hash);source='inherited-named-permissions';const seen=new Set<string>();let at:string|undefined=parent;const chain:ObjectValue[]=[];
    while(at&&!at.startsWith(':')){if(seen.has(at)||seen.size>=32)return unsupported('permission-inheritance-cycle',hash);seen.add(at);const profile:unknown=permissions[at];if(!object(profile)||typeof profile.extends!=='string')return unsupported('permission-parent-unverified',hash);chain.unshift(profile);at=profile.extends;}
    if(![':workspace',':read-only'].includes(at??''))return unsupported('permission-baseline-unverified',hash);
    for(const profile of chain){if(profile.network!==undefined&&!object(profile.network))return unsupported('network-policy-unverified',hash);if(object(profile.network))network=merge(network,profile.network);}
  }else{
    if(mode!=='workspace-write'&&mode!=='read-only')return unsupported('implicit-default-policy-unverified',hash);
    parent=mode==='workspace-write'?':workspace':':read-only';source='equivalent-simple-legacy-policy';
  }
  const features=object(settings.features)?settings.features:{};
  if(network.enabled!==undefined&&typeof network.enabled!=='boolean'||features.network_proxy!==undefined&&typeof features.network_proxy!=='boolean')return unsupported('network-policy-unverified',hash);
  const enabled=network.enabled===true;
  if(enabled&&features.network_proxy!==true)return unsupported('network-proxy-equivalence-unverified',hash);
  if(!enabled&&Object.keys(network).some(k=>k!=='enabled'))return unsupported('inactive-network-rules-would-change',hash);
  return{available:true,kind:'inherit',parent,networkProxy:true,enableNetwork:!enabled,existingNames:names,source,digest:hash};
}

/** Executes native configuration validation only, without a thread, model or MCP command. */
export async function readCodexRequirements(input:TaskLaunchInput,native:NativeLaunchContext):Promise<CodexRequirementsProof>{
  const unavailable:CodexRequirementsProof={version:native.version,known:false,empty:false,hash:null};if(native.version!=='0.166.0'||input.signal.aborted)return unavailable;
  return new Promise(resolve=>execFile(native.command,['app-server','--print-startup-config'],{cwd:input.cwd,env:input.environment,signal:input.signal,timeout:5000,maxBuffer:128*1024,encoding:'utf8',windowsHide:true},(error,stdout)=>{
    if(error)return resolve(unavailable);
    try{const value:unknown=JSON.parse(stdout);if(!boundedJson(value)||!object(value)||value.appServerVersion!==native.version||!object(value.configRequirements)||!Object.hasOwn(value.configRequirements,'requirements'))return resolve(unavailable);resolve({version:native.version,known:true,empty:value.configRequirements.requirements===null,hash:digest(canonicalJson(value.configRequirements))});}catch{resolve(unavailable);}
  }));
}
export async function inspectCodexCliSandbox(input:TaskLaunchInput,native:NativeLaunchContext,readRequirements=readCodexRequirements):Promise<CodexCliSandboxPlan>{
  if(input.profile.runner!=='codex'||native.version!=='0.166.0')return unsupported('agent-cli-unverified');
  let valid=true;const args=codexConfigurationArgs(input.profile.args,()=>{valid=false;});if(!valid)return unsupported('effective-arguments-unverified');
  const files=[{path:'/etc/codex/config.toml',source:'system'},{path:join(input.stateRoot,'config.toml'),source:'user'},...(args.profile?[{path:join(input.stateRoot,args.profile+'.config.toml'),source:'profile'}]:[]),...projectLayers(input.cwd,input.home).map(path=>({path:join(path,'.codex/config.toml'),source:'project'}))];
  const layers:{source:string;config:ObjectValue;hash:string}[]=[];
  try{
    if(existsSync('/etc/codex/managed_config.toml'))return unsupported('managed-configuration-present');
    for(const file of files){if(!existsSync(file.path)){if(file.source==='profile')return unsupported('profile-configuration-unavailable');continue;}const stat=lstatSync(file.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)return unsupported('configuration-unreadable');const bytes=readFileSync(file.path);if(bytes.length!==stat.size||!Buffer.from(bytes.toString('utf8')).equals(bytes))return unsupported('configuration-changed');const config=plainJson(parseToml(bytes.toString('utf8')));if(!object(config)||!boundedJson(config)||config.profile!==undefined)return unsupported('configuration-unverified');layers.push({source:file.source,config,hash:digest(bytes)});}
  }catch{return unsupported('configuration-unreadable');}
  return planCodexCliSandbox({version:native.version,layers,args:input.profile.args,requirements:await readRequirements(input,native)});
}
