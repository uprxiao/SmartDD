import {openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync,constants} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';
import {boundedJson} from '@shared/application-bridge';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import type {TaskLaunchInput,NativeLaunchContext} from './native-launch-context';

type ObjectValue=Record<string,unknown>;
const object=(v:unknown):v is ObjectValue=>!!v&&typeof v==='object'&&!Array.isArray(v);
export type ClaudeCliSandboxPlan={available:false;reason:string;source:string;digest:string|null}|{available:true;runner:'claude-code';kind:'unchanged'|'allow-unix';source:string;digest:string};
const unavailable=(reason:string):ClaudeCliSandboxPlan=>({available:false,reason,source:'claude-effective-policy-unverified',digest:null});
const verification=new WeakMap<object,()=>void>();
export interface ClaudePolicyInput {version:string;runner:string;cwd:string;args:readonly string[];settings:unknown;source:{hash:string;regular:boolean;stable:boolean};managed:{known:boolean;empty:boolean;hash:string}}
/** Finite, measured scope. Unknown sources preserve Native/MCP delivery instead
 * of guessing a sandbox. This function neither edits flags nor reconstructs
 * permission/deny/domain rules; the native settings source remains authoritative.
 */
export function planClaudeCliSandbox(input:ClaudePolicyInput):ClaudeCliSandboxPlan{
 if(input.runner!=='claude'||input.version!=='2.1.322')return unavailable('agent-cli-unverified');
 if(!input.managed.known||!input.managed.empty||!/^[a-f0-9]{64}$/.test(input.managed.hash))return unavailable('managed-policy-unverified');
 if(!input.source.regular||!input.source.stable||!/^[a-f0-9]{64}$/.test(input.source.hash)||!object(input.settings)||!boundedJson(input.settings))return unavailable('settings-source-unverified');
 if(['env','apiKeyHelper','headersHelper','awsAuthRefresh','awsCredentialExport','forceLoginMethod'].some(key=>Object.hasOwn(input.settings as ObjectValue,key)))return unavailable('settings-routing-unverified');
 let sources=0,modes=0,mode:string|undefined;
 for(let i=0;i<input.args.length;i++){
  const flag=input.args[i];
  if(flag==='--setting-sources'){if(++sources!==1||input.args[++i]!=='user')return unavailable('settings-source-unverified');}
  else if(flag==='--permission-mode'){mode=input.args[++i];if(++modes!==1||!['default','bypassPermissions'].includes(mode??''))return unavailable('permission-mode-unverified');}
  else if(flag==='--model'){if(!input.args[++i])return unavailable('native-arguments-unverified');}
  else if(flag==='--add-dir'){if(input.args[++i]!==input.cwd)return unavailable('native-arguments-unverified');}
  else if(flag!=='--strict-mcp-config')return unavailable('native-arguments-unverified');
 }
 if(sources!==1||modes!==1)return unavailable('settings-source-unverified');
 const sandbox=input.settings.sandbox;
 if(sandbox!==undefined&&!object(sandbox))return unavailable('sandbox-policy-unverified');
 const s=object(sandbox)?sandbox:{};
 if(s.enabled!==undefined&&typeof s.enabled!=='boolean')return unavailable('sandbox-policy-unverified');
 // Official default is off, including the ordinary modelPicker-only managed
 // file. autoAllow's version-specific default matters only with sandbox on.
 const enabled=s.enabled===true;
 if(enabled){
  if(mode!=='default'||s.autoAllowBashIfSandboxed!==false)return unavailable('sandbox-approval-unverified');
  if(s.network!==undefined&&!object(s.network))return unavailable('sandbox-policy-unverified');
  const network=object(s.network)?s.network:{};
  if(Object.hasOwn(network,'allowUnixSockets')||Object.hasOwn(network,'allowAllUnixSockets'))return unavailable('unix-socket-merge-unverified');
  if(s.excludedCommands!==undefined&&(!Array.isArray(s.excludedCommands)||s.excludedCommands.length))return unavailable('sandbox-exclusions-unverified');
  if(s.enableWeakerNestedSandbox===true||s.enableWeakerNetworkIsolation===true)return unavailable('sandbox-isolation-unverified');
 }
 return{available:true,runner:'claude-code',kind:enabled?'allow-unix':'unchanged',source:'claude-managed-user-only-v1',digest:digest(canonicalJson({version:input.version,args:input.args,source:input.source.hash,managed:input.managed.hash}))};
}
function readSettings(path:string):{value:unknown;hash:string}{
 const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid?.()||before.size>2*1024*1024)throw Error('settings identity');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const opened=fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino)throw Error('settings changed');const bytes=readFileSync(fd),after=fstatSync(fd);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||bytes.length!==before.size)throw Error('settings changed');return{value:JSON.parse(bytes.toString('utf8')),hash:digest(bytes)};}finally{closeSync(fd);}
}
export interface ClaudeManagedPolicyProof {known:boolean;empty:boolean;hash:string|null}
export function readClaudeManagedPolicy(root:string,probe?:{username:string;exists:(path:string)=>boolean}):ClaudeManagedPolicyProof{
 try{
  // Native 2.1.322 resolves the managed username through os.userInfo(), not
  // HOME. A private CLI HOME must not hide the real account's MDM policy.
  const username=probe?.username??userInfo().username;if(!/^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/.test(username))return{known:false,empty:false,hash:null};
  const paths=['/Library/Application Support/ClaudeCode/managed-settings.json','/Library/Application Support/ClaudeCode/managed-settings.d',join('/Library/Managed Preferences',username,'com.anthropic.claudecode.plist'),'/Library/Managed Preferences/com.anthropic.claudecode.plist','/etc/claude-code/managed-settings.json',join(root,'managed-settings.json'),join(root,'managed-settings.d')],present=probe?.exists??(path=>{try{lstatSync(path);return true;}catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return false;throw error;}});
  if(paths.some(path=>present(path)))return{known:true,empty:false,hash:null};return{known:true,empty:true,hash:digest(canonicalJson(paths.map(path=>({path,present:false}))))};
 }catch{return{known:false,empty:false,hash:null};}
}

/** Initial production scope is a host-owned, explicit third-party user-only
 * configuration. Other native/managed sources need their own measured merge.
 * No login helper/model/subprocess is invoked and no credential store is read.
 */
export async function inspectClaudeCliSandbox(input:TaskLaunchInput,native:NativeLaunchContext,managedProbe=readClaudeManagedPolicy):Promise<ClaudeCliSandboxPlan>{
 if(input.profile.runner!=='claude'||native.version!=='2.1.322')return unavailable('agent-cli-unverified');
 const root=input.stateRoot;
 const safeEnvironment=new Set(['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL','CLAUDE_CODE_DISABLE_1M_CONTEXT','CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD','CLAUDE_CODE_SUBAGENT_MODEL']);
 // The normal launch planner pins this model variable alongside --model. It
 // cannot grant a different model or become an unchecked environment override.
 const selectedModels=input.profile.args.flatMap((flag,index)=>flag==='--model'?[input.profile.args[index+1]]:[]);
 try{
  if(!/\/agents\/claude\/[a-f0-9]{32}$/.test(root)||realpathSync(root)!==root||input.environment.CLAUDE_CONFIG_DIR!==root)return unavailable('settings-source-unverified');
  const remoteProof=()=>{
   const subagentModel=input.environment.CLAUDE_CODE_SUBAGENT_MODEL||null;
   if(subagentModel!==null&&(selectedModels.length!==1||!selectedModels[0]||subagentModel!==selectedModels[0]))throw Error('unverified subagent model');
   for(const[name,value]of Object.entries(input.environment))if(value&&(name.startsWith('_CLAUDE_CODE_')||name.startsWith('CLAUDE_CODE_')&&!safeEnvironment.has(name)))throw Error('unverified policy override');
   const base=new URL(input.environment.ANTHROPIC_BASE_URL??'');if(!['http:','https:'].includes(base.protocol)||base.username||base.password||/^(?:.*\.)?(?:anthropic\.com|claude\.ai)$/i.test(base.hostname.replace(/\.$/,'')))throw Error('remote managed eligibility unverified');
   return digest(canonicalJson({customBase:digest(base.href),provider:'custom-anthropic',remoteEligible:false,subagentModel}));
  };
  const remoteHash=remoteProof();
  if(input.environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC!=='1')return unavailable('managed-policy-unverified');
  const managed=managedProbe(root);if(!managed.known||!managed.empty||!managed.hash)return unavailable('managed-policy-unverified');
  const assertManaged=()=>{const next=managedProbe(root);if(!next.known||!next.empty||next.hash!==managed.hash)throw Error('managed policy changed');};
  const path=join(root,'settings.json'),settings=readSettings(path),policy=planClaudeCliSandbox({version:native.version,runner:input.profile.runner,cwd:input.cwd,args:input.profile.args,settings:settings.value,source:{hash:settings.hash,regular:true,stable:true},managed:{known:managed.known,empty:managed.empty,hash:digest(canonicalJson({local:managed.hash,remote:remoteHash}))}});
  if(policy.available)verification.set(policy,()=>{assertManaged();if(remoteProof()!==remoteHash)throw Error('routing changed');if(realpathSync(root)!==root||readSettings(path).hash!==settings.hash)throw Error('settings changed');});
  return policy;
 }catch{return unavailable('settings-source-unverified');}
}
/** Recheck the original source immediately before a CLI-bearing fork. */
export function verifyClaudeCliSandbox(policy:ClaudeCliSandboxPlan):void{
 if(!policy.available)return;try{const verify=verification.get(policy);if(!verify)throw Error('missing inspection');verify();}catch{throw new ApplicationError('RESOURCE_STATE_CHANGED','Claude 沙箱配置在启动前已变化，请重新启动');}
}
