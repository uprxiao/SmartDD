import {execFile} from 'node:child_process';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {boundedJson} from '@shared/application-bridge';
import {codexConfigurationArgs,projectLayers} from '../capabilities/discovery';
import {canonicalJson,digest} from './manifest';
import {ApplicationError} from '@shared/applications';
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
const sourceChecks=new WeakMap<object,()=>void>();
/** Pure plans and trusted injected inspectors have no filesystem source. Every
 * successful production inspection below retains its own synchronous recheck. */
export function verifyCodexCliSandbox(policy:CodexCliSandboxPlan):void{
  if(!policy.available)return;
  try{sourceChecks.get(policy)?.();}catch{throw new ApplicationError('RESOURCE_STATE_CHANGED','Codex 沙箱配置在启动前已变化，请重新启动');}
}
const merge=(first:ObjectValue,second:ObjectValue):ObjectValue=>{const result=structuredClone(first);for(const[key,value]of Object.entries(second))result[key]=object(value)&&object(result[key])?merge(result[key],value):structuredClone(value);return result;};

const valueFlags=new Set(['--config','-c','--profile','-p','--model','-m','--ask-for-approval','-a','--local-provider']);
function sandboxArgument(args:readonly string[],index:number):{mode:string|undefined;width:1|2}|null{
  const arg=args[index];
  if(arg==='--sandbox'||arg==='-s')return{mode:args[index+1],width:2};
  if(arg.startsWith('--sandbox='))return{mode:arg.slice(10),width:1};
  if(arg.startsWith('-s')&&arg.length>2)return{mode:arg.slice(2).replace(/^=/,''),width:1};
  return null;
}

/** Remove only a proved equivalent legacy selector while the private named policy is delivered.
 * Codex 0.166.0's ConfigOverrides.sandbox_mode otherwise overrides default_permissions.
 * Approval flags (including --approve-for-me) retain their native semantics and order.
 * Called only for a CLI-bearing run: disable native shell snapshots for that run so
 * its environment-only authorization cannot be copied into the shell snapshot cache.
 */
export function codexProfileArgsForCli(args:readonly string[],policy:CodexCliSandboxPlan):string[]{
  if(!policy.available)return [...args];
  if(policy.kind!=='inherit')return [...args,'--disable','shell_snapshot'];
  const output:string[]=[];let selectors=0;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(valueFlags.has(arg)){output.push(arg);if(i+1<args.length)output.push(args[++i]);continue;}
    const selector=sandboxArgument(args,i);
    if(!selector){output.push(arg);continue;}
    const expected=selector.mode==='read-only'?':read-only':selector.mode==='workspace-write'?':workspace':null;
    if(!expected||policy.parent!==expected||++selectors>1)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','显式sandbox参数与已核验的临时权限不等价');
    i+=selector.width-1;
  }
  if(selectors&&args.some(arg=>['--approve-for-me','--not-so-yolo','--full-auto','--dangerously-bypass-approvals-and-sandbox','--yolo','--'].includes(arg)))
    throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','原生参数组合尚未核验，不能改写sandbox参数');
  return [...output,'--disable','shell_snapshot'];
}

/** Hash the complete security input. Named rules are inherited, never rebuilt from a mode label. */
export function planCodexCliSandbox(input:{version:string;layers:readonly {source:string;config:ObjectValue;hash:string}[];args:readonly string[];requirements:CodexRequirementsProof}):CodexCliSandboxPlan{
  if(input.version!=='0.166.0')return unsupported('cli-version-unverified');
  if(!input.requirements.known||!input.requirements.empty||input.requirements.version!==input.version||!/^[a-f0-9]{64}$/.test(input.requirements.hash??''))return unsupported('managed-requirements-unverified');
  let valid=true,settings:ObjectValue={};const parsed=codexConfigurationArgs([...input.args],()=>{valid=false;});
  for(const layer of input.layers){if(!boundedJson(layer.config))return unsupported('configuration-budget');const selected=Object.fromEntries(keys.filter(k=>Object.hasOwn(layer.config,k)).map(k=>[k,layer.config[k]]));if(layer.source==='system'&&Object.keys(selected).length)return unsupported('system-policy-unverified');settings=merge(settings,selected);}
  for(const raw of parsed.overrides){let override:ObjectValue;try{override=plainJson(raw) as ObjectValue;}catch{return unsupported('configuration-budget');}settings=merge(settings,Object.fromEntries(keys.filter(k=>Object.hasOwn(override,k)).map(k=>[k,override[k]])));}
  let extraDirectories=false,explicitMode:string|undefined,selectors=0,bypass=false,autoReview=false;
  const enabledFeatures=new Set<string>(),disabledFeatures=new Set<string>();
  for(let i=0;i<input.args.length;i++){
    const arg=input.args[i];
    if(valueFlags.has(arg)){if(++i>=input.args.length)valid=false;continue;}
    if(arg==='--'){valid=false;break;}
    const selector=sandboxArgument(input.args,i);
    if(selector){explicitMode=selector.mode;selectors++;i+=selector.width-1;if(!['read-only','workspace-write','danger-full-access'].includes(explicitMode??''))valid=false;}
    if(arg==='--dangerously-bypass-approvals-and-sandbox'||arg==='--yolo')bypass=true;
    if(arg==='--approve-for-me'||arg==='--not-so-yolo'||arg==='--full-auto')autoReview=true;
    if(arg==='--add-dir'||arg.startsWith('--add-dir=')||arg==='--cd'||arg.startsWith('--cd=')||arg==='-C')extraDirectories=true;
    if(arg==='--enable'||arg==='--disable'||arg.startsWith('--enable=')||arg.startsWith('--disable=')){const enabled=arg==='--enable'||arg.startsWith('--enable='),feature=arg.includes('=')?arg.slice(arg.indexOf('=')+1):input.args[++i];if(!feature||!/^[a-z][a-z0-9_]{0,127}$/.test(feature)){valid=false;break;}const own=enabled?enabledFeatures:disabledFeatures,other=enabled?disabledFeatures:enabledFeatures;if(other.has(feature)){valid=false;break;}own.add(feature);const features=object(settings.features)?settings.features:{};settings.features={...features,[feature]:enabled};}
  }
  // The fixed native CLI rejects auto-review mixed with a sandbox/bypass selector.
  if(selectors>1||autoReview&&(selectors>0||bypass))valid=false;
  if(bypass)settings.sandbox_mode='danger-full-access';else if(explicitMode!==undefined)settings.sandbox_mode=explicitMode;else if(autoReview)settings.sandbox_mode='workspace-write';
  if(!valid||extraDirectories)return unsupported('effective-arguments-unverified');
  const hash=digest(canonicalJson({version:input.version,settings,args:input.args,sources:input.layers.map(l=>({source:l.source,hash:l.hash})),requirements:input.requirements.hash}));
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
  // Native feature switches are applied after raw -c overrides. An appended
  // features.network_proxy=true cannot defeat an explicit --disable switch.
  // Enabling the child network bit in that state could remove its confinement.
  if(disabledFeatures.has('network_proxy'))return unsupported('network-proxy-disabled-by-arguments',hash);
  if(network.enabled!==undefined&&typeof network.enabled!=='boolean'||features.network_proxy!==undefined&&typeof features.network_proxy!=='boolean')return unsupported('network-policy-unverified',hash);
  const enabled=network.enabled===true;
  if(enabled&&features.network_proxy!==true)return unsupported('network-proxy-equivalence-unverified',hash);
  if(!enabled&&Object.keys(network).some(k=>k!=='enabled'))return unsupported('inactive-network-rules-would-change',hash);
  return{available:true,kind:'inherit',parent,networkProxy:true,enableNetwork:!enabled,existingNames:names,source,digest:hash};
}

/** Only root configuration overrides belong to the startup print command.
 * TUI selectors are checked separately by the policy planner; forwarding a
 * profile or a prompt to app-server would inspect a different source or run an
 * unsupported command. Feature switches are grouped in native CLI order.
 */
export function codexRequirementsArgs(args:readonly string[]):string[]|null{
  if(args.length>256||args.some(arg=>arg.length>65536))return null;
  let valid=true;const parsed=codexConfigurationArgs([...args],()=>{valid=false;});
  if(!valid||parsed.profile)return null;
  const raw:string[]=[],enabled:string[]=[],disabled:string[]=[];let autoReview=false;
  const irrelevantValues=new Set(['--model','-m','--ask-for-approval','-a','--sandbox','-s']);
  for(let i=0;i<args.length;i++){
    const arg=args[i];let assignment:string|undefined;
    if(arg==='--config'||arg==='-c')assignment=args[++i];
    else if(arg.startsWith('--config='))assignment=arg.slice(9);
    else if(arg.startsWith('-c')&&arg.length>2)assignment=arg.slice(2).replace(/^=/,'');
    else if(arg==='--enable'||arg==='--disable'||arg.startsWith('--enable=')||arg.startsWith('--disable=')){
      const feature=arg.includes('=')?arg.slice(arg.indexOf('=')+1):args[++i];
      if(!feature||!/^[a-z][a-z0-9_]{0,127}$/.test(feature))return null;
      (arg==='--enable'||arg.startsWith('--enable=')?enabled:disabled).push(feature);continue;
    }else if(irrelevantValues.has(arg)){if(!args[++i])return null;continue;}
    else if(arg==='--approve-for-me'||arg==='--not-so-yolo'||arg==='--full-auto'){autoReview=true;continue;}
    else if(['--yolo','--dangerously-bypass-approvals-and-sandbox','--no-alt-screen','--search'].includes(arg)||arg.startsWith('--model=')||arg.startsWith('--ask-for-approval=')||sandboxArgument(args,i)?.width===1)continue;
    else return null;
    if(assignment===undefined||/[\r\n]/.test(assignment))return null;
    // Native has a permissive string fallback which differs from discovery's
    // TOML fallback. Only unambiguous TOML literals can share this proof.
    const equal=assignment.indexOf('=');if(equal<=0)return null;
    try{const value=parseToml('__value__='+assignment.slice(equal+1));if(Object.keys(value).length!==1||!Object.hasOwn(value,'__value__')||!boundedJson(plainJson(value)))return null;}catch{return null;}
    raw.push('-c',assignment);
  }
  for(const [features,value]of [[enabled,true],[disabled,false]] as const)for(const feature of features)raw.push('-c',`features.${feature}=${value}`);
  if(autoReview)raw.push('-c','approvals_reviewer="auto_review"','-c','approval_policy="on-request"','-c','sandbox_mode="workspace-write"');
  return [...raw,'app-server','--print-startup-config'];
}

/** Executes native configuration validation only, without a thread, model or MCP command. */
export async function readCodexRequirements(input:TaskLaunchInput,native:NativeLaunchContext):Promise<CodexRequirementsProof>{
  const unavailable:CodexRequirementsProof={version:native.version,known:false,empty:false,hash:null};if(native.version!=='0.166.0'||input.signal.aborted)return unavailable;
  const args=codexRequirementsArgs(input.profile.args);if(!args)return unavailable;
  return new Promise(resolve=>execFile(native.command,args,{cwd:input.cwd,env:input.environment,signal:input.signal,timeout:5000,maxBuffer:128*1024,encoding:'utf8',windowsHide:true},(error,stdout)=>{
    if(error)return resolve(unavailable);
    try{const value:unknown=JSON.parse(stdout);if(!boundedJson(value)||!object(value)||value.appServerVersion!==native.version||!object(value.configRequirements)||!Object.hasOwn(value.configRequirements,'requirements'))return resolve(unavailable);resolve({version:native.version,known:true,empty:value.configRequirements.requirements===null,hash:digest(canonicalJson(value.configRequirements))});}catch{resolve(unavailable);}
  }));
}
export async function inspectCodexCliSandbox(input:TaskLaunchInput,native:NativeLaunchContext,readRequirements=readCodexRequirements):Promise<CodexCliSandboxPlan>{
  if(input.profile.runner!=='codex'||native.version!=='0.166.0')return unsupported('agent-cli-unverified');
  let valid=true;const args=codexConfigurationArgs(input.profile.args,()=>{valid=false;});if(!valid)return unsupported('effective-arguments-unverified');
  const context=()=>canonicalJson({cwd:input.cwd,home:input.home,stateRoot:input.stateRoot,args:input.profile.args,command:native.command,version:native.version});
  const originalContext=context();
  const files=()=>[{path:'/etc/codex/config.toml',source:'system'},{path:join(input.stateRoot,'config.toml'),source:'user'},...(args.profile?[{path:join(input.stateRoot,args.profile+'.config.toml'),source:'profile'}]:[]),...projectLayers(input.cwd,input.home).map(path=>({path:join(path,'.codex/config.toml'),source:'project'}))];
  const readSource=(path:string)=>{
    let before;try{before=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    if(!before.isFile()||before.isSymbolicLink()||before.size>1024*1024)throw Error('configuration identity');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const opened=fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino)throw Error('configuration changed');
      const bytes=readFileSync(fd),after=fstatSync(fd),current=lstatSync(path);
      if([opened,after,current].some(stat=>!stat.isFile()||stat.isSymbolicLink()||stat.dev!==before.dev||stat.ino!==before.ino||stat.size!==before.size||stat.mtimeMs!==before.mtimeMs||stat.ctimeMs!==before.ctimeMs)||bytes.length!==before.size||!Buffer.from(bytes.toString('utf8')).equals(bytes))throw Error('configuration changed');
      return{bytes,identity:{dev:before.dev,ino:before.ino,size:before.size,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs,hash:digest(bytes)}};
    }finally{closeSync(fd);}
  };
  const capture=()=>{
    try{lstatSync('/etc/codex/managed_config.toml');throw Error('managed configuration present');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    return files().map(file=>({...file,value:readSource(file.path)}));
  };
  try{
    const captured=capture(),signature=(sources:ReturnType<typeof capture>)=>canonicalJson(sources.map(({path,source,value})=>({path,source,identity:value?.identity??null}))),original=signature(captured);
    const layers:{source:string;config:ObjectValue;hash:string}[]=[];
    for(const file of captured){if(!file.value){if(file.source==='profile')return unsupported('profile-configuration-unavailable');continue;}const config=plainJson(parseToml(file.value.bytes.toString('utf8')));if(!object(config)||!boundedJson(config)||config.profile!==undefined)return unsupported('configuration-unverified');layers.push({source:file.source,config,hash:file.value.identity.hash});}
    const policy=planCodexCliSandbox({version:native.version,layers,args:[...input.profile.args],requirements:await readRequirements(input,native)});
    if(policy.available){const check=()=>{if(context()!==originalContext||signature(capture())!==original)throw Error('configuration changed');};check();sourceChecks.set(policy,check);}
    return policy;
  }catch{return unsupported('configuration-unreadable');}
}
