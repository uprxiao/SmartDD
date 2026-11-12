import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {accessSync,constants,lstatSync,openSync,readSync,closeSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {PARENT_AGENT_VARS,VALUE_PREFIX} from '../../launch-env';
import {RUNTIME_ISOLATION} from '../capabilities/capability-service';
import type {TaskLaunchInput,NativeLaunchContext} from './native-launch-context';
import type {OwnedCapabilityRun} from './run-registry';
import type {RunBackendAuthority} from './run-backend-authority';
import type {ProcessIdentityReader} from './process-identity';
import type {FrozenPluginSkillSet} from './plugins/frozen-skills';
import {CodexPrivateServer} from './codex-private-server';
import {digest} from './manifest';
import {codexClientArgs} from './codex-client-args';

export type PrivateCodexTaskServer=Pick<CodexPrivateServer,'url'|'start'|'stop'|'state'|'recoveryWarnings'>;
export interface CodexTaskServerRequest {
  task:TaskLaunchInput;native:NativeLaunchContext;run:OwnedCapabilityRun;skills:FrozenPluginSkillSet;
  profileArgs:readonly string[];managedArgs:readonly string[];environment:Readonly<Record<string,string>>;storeId:string;
}
const unsupported=()=>new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前 Codex 参数或安装方式尚未验证私有插件交付；保留原生配置，请核对本次能力提示');
/** Convert only explicitly understood native flags. Never silently drop an
 * unknown permission/provider option or reinterpret it as an app-server flag.
 * Remote resume projects permission choices through the native restore request.
 */
export function codexServerArgs(profile:readonly string[],managed:readonly string[]):string[]{
  const args:string[]=[],explicit:string[]=[];
  for(let i=0;i<profile.length;i++){
    let arg=profile[i],value:string|undefined;
    if(arg.startsWith('-c')&&arg!=='-c'&&!arg.startsWith('--')){const assignment=arg.slice(2).replace(/^=/,'');if(!assignment.includes('='))throw unsupported();args.push('-c',assignment);continue;}
    const equal=arg.indexOf('=');if(equal>0){value=arg.slice(equal+1);arg=arg.slice(0,equal);}
    if(['-c','--config','--enable','--disable','-m','--model','-s','--sandbox','-a','--ask-for-approval'].includes(arg)){
      value??=profile[++i];if(value===undefined||!value.length)throw unsupported();
      if(['-c','--config','--enable','--disable'].includes(arg))args.push(arg,value);
      else{
        const key=arg==='-m'||arg==='--model'?'model':arg==='-s'||arg==='--sandbox'?'sandbox_mode':'approval_policy';
        if(key==='sandbox_mode'&&!['read-only','workspace-write','danger-full-access'].includes(value)||key==='approval_policy'&&!['on-request','never'].includes(value))throw unsupported();
        // Native TUI ConfigOverrides take precedence over TOML -c overrides,
        // regardless of their argv positions. Preserve that ordering when the
        // dedicated flags are expressed as app-server config switches.
        explicit.push('-c',key+'='+JSON.stringify(value));
      }
    }else if(arg==='--strict-config'&&value===undefined)args.push(arg);
    else if(arg==='--search'&&value===undefined)explicit.push('-c','web_search="live"');
    else if(!['--no-alt-screen','--no-daemon'].includes(arg)||value!==undefined)throw unsupported();
  }
  // Only the immutable adapter's generated config switches may follow the
  // profile; prompts, endpoint selection and subcommands do not enter here.
  for(let i=0;i<managed.length;i++){
    const flag=managed[i],value=managed[++i];if(!['-c','--config','--enable','--disable'].includes(flag)||typeof value!=='string'||!value.length)throw unsupported();args.push(flag,value);
  }
  return [...args,...explicit];
}

/** Direct spawn has no login shell: strip the same inherited namespaces and
 * reapply this profile, pinned native roots and host per-run injection explicitly.
 */
export function codexServerEnvironment(task:TaskLaunchInput,injected:Readonly<Record<string,string>>):Record<string,string>{
  const env:Record<string,string>={};
  for(const [key,value]of Object.entries(task.environment))if(!key.startsWith(VALUE_PREFIX)&&!PARENT_AGENT_VARS.includes(key)&&![...task.profile.isolatePrefixes,...RUNTIME_ISOLATION].some(prefix=>key.startsWith(prefix)))env[key]=value;
  Object.assign(env,task.profile.env,{HOME:task.home,CODEX_HOME:task.stateRoot},injected);return env;
}

/** Resolve known official native/npm installations without executing JavaScript
 * loaders or using a shell. Verify the native binary's own version before use.
 */
export async function codexServerExecutable(native:NativeLaunchContext,task:TaskLaunchInput):Promise<{path:string;sha256:string}>{
  if(process.platform!=='darwin'||native.version!=='0.167.1')throw unsupported();
  let path=realpathSync(native.command);
  const header=Buffer.alloc(4);let fd=openSync(path,'r');try{readSync(fd,header,0,4,0);}finally{closeSync(fd);}
  const macho=new Set(['cffaedfe','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca']);
  if(!macho.has(header.toString('hex'))){
    if(!path.endsWith('/bin/codex.js'))throw unsupported();
    const root=dirname(dirname(path)),metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
    if(metadata.name!=='@openai/codex'||metadata.version!==native.version)throw unsupported();
    const packageName=process.arch==='arm64'?'@openai/codex-darwin-arm64':process.arch==='x64'?'@openai/codex-darwin-x64':null;if(!packageName)throw unsupported();
    const require=createRequire(path);let vendor:string;
    try{
      const packageFile=require.resolve(packageName+'/package.json'),platformPackage=JSON.parse(readFileSync(packageFile,'utf8'));
      // Official 0.167.1 installs the platform artifact through an npm alias:
      // its metadata is @openai/codex@0.167.1-darwin-arm64, not the alias name.
      const alias=platformPackage.name==='@openai/codex'&&platformPackage.version===native.version+'-darwin-'+process.arch&&platformPackage.os?.includes('darwin')&&platformPackage.cpu?.includes(process.arch);
      const named=platformPackage.name===packageName&&platformPackage.version===native.version;
      if(!alias&&!named)throw unsupported();vendor=join(dirname(packageFile),'vendor');
    }
    catch(error){if(error instanceof ApplicationError)throw error;vendor=join(root,'vendor');}
    path=realpathSync(join(vendor,process.arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin','bin','codex'));
  }
  const stat=lstatSync(path);accessSync(path,constants.X_OK);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024*1024)throw unsupported();
  fd=openSync(path,'r');try{readSync(fd,header,0,4,0);}finally{closeSync(fd);}if(!macho.has(header.toString('hex')))throw unsupported();
  const sha256=digest(readFileSync(path));
  const version=await new Promise<string>((resolve,reject)=>execFile(path,['--version'],{cwd:task.cwd,env:codexServerEnvironment(task,{}),signal:task.signal,timeout:5000,maxBuffer:8192,encoding:'utf8',windowsHide:true},(error,stdout)=>error?reject(unsupported()):resolve(stdout.trim())));
  if(version!=='codex-cli '+native.version||digest(readFileSync(path))!==sha256)throw unsupported();
  return{path,sha256};
}

export async function prepareCodexTaskServer(request:CodexTaskServerRequest,authority:RunBackendAuthority,processes:ProcessIdentityReader):Promise<PrivateCodexTaskServer>{
  try{
    const args=codexServerArgs(request.profileArgs,request.managedArgs),environment=codexServerEnvironment(request.task,request.environment),executable=await codexServerExecutable(request.native,request.task);
    const client=codexClientArgs(request.profileArgs,request.managedArgs,request.task.mode==='resume');
    const resume=request.task.mode==='resume'&&client.permissionKeys.length?{threadId:request.task.sessionId!,permissionKeys:client.permissionKeys}:undefined;
    return await CodexPrivateServer.prepare({run:request.run,version:request.native.version,storeId:request.storeId,executable,args,environment,cwd:request.task.cwd,skills:request.skills.skills.map((s,i)=>({path:request.skills.codexRoots[i],name:s.nativeName})),signal:request.task.signal,resume},authority,processes);
  }catch(error){if(request.task.signal.aborted)throw new ApplicationError('CANCELED','私有 Codex 准备已取消');if(error instanceof ApplicationError)throw error;throw unsupported();}
}
