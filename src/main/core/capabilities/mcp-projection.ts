import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Runner } from '@shared/types';
import type { CapabilityRegistryService } from './capability-registry';
import { convertMcp, type McpConversion } from './mcp-conversion';
import { mcpReferenceNames, McpSourceError } from './mcp-source';

const bundled = import.meta.glob('@root/resources/runtime/*', {query:'?raw',import:'default',eager:true}) as Record<string,string>;
const launcherSource=Object.entries(bundled).find(([path])=>path.endsWith('/wy-mcp-launch.cjs'))?.[1];
export interface McpProjectionInput {
  runner:Runner;cwd:string;runRoot:string;
  /** Only names are used. Values belong to the model runtime, never source expansion. */
  injectedNames:string[];
}
export interface McpProjectionResult {
  args:string[];env:Record<string,string>;secretValues:string[];
  configured:string[];issues:{id:string;reason:string}[];
}
const inside=(base:string,path:string)=>{const rest=relative(base,resolve(path));return Boolean(rest)&&rest!=='..'&&!rest.startsWith('..'+sep);};
const inline=(value:unknown):string=>{
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='boolean')return String(value);
  if(Array.isArray(value))return '['+value.map(inline).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+inline(v)).join(',')+'}';
  throw new Error('MCP 配置值不能可靠转换');
};

/** Materialize only new host-owned per-run controls. No global CLI config,
 * decrypted credentials, shell rc or source declaration is ever written here. */
function writeControls(userData:string,runRoot:string,files:McpConversion['files']){
  const base=realpathSync(userData),runs=join(base,'agents','runs');
  if(!inside(runs,runRoot)||!/^[-a-f0-9]{36}\/mcp$/.test(relative(runs,runRoot).split(sep).join('/')))throw new Error('MCP 本次运行目录身份无效');
  const unique=new Map<string,McpConversion['files'][number]>();
  for(const file of files){
    if(!inside(runRoot,file.path)||dirname(file.path)!==runRoot)throw new Error('MCP 配置超出本次运行目录');
    const old=unique.get(file.path);if(old&&(old.content!==file.content||old.mode!==file.mode))throw new Error('MCP 控制文件同名冲突');
    unique.set(file.path,file);
  }
  let current=base;
  for(const part of relative(base,runRoot).split(sep)){
    current=join(current,part);if(!existsSync(current))mkdirSync(current,{mode:0o700});
    const st=lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink()||process.getuid&&st.uid!==process.getuid())throw new Error('MCP 管理目录身份异常');
  }
  const written:string[]=[];
  try{
    for(const file of unique.values()){writeFileSync(file.path,file.content,{flag:'wx',mode:file.mode});written.push(file.path);}
  }catch(error){for(const path of written)unlinkSync(path);throw error;}
}

export class McpProjectionService {
  constructor(private readonly registry:Pick<CapabilityRegistryService,'selected'|'resolveMcpSource'>,private readonly options:{
    userData:string;executable:string;launcherSource?:string;
    /** Resolve saved source-profile env in main only, at launch, without running helpers. */
    profileEnvironment?:(id:string)=>Record<string,string>;
  }){}
  prepare(input:McpProjectionInput):McpProjectionResult {
    const result:McpProjectionResult={args:[],env:Object.create(null),secretValues:[],configured:[],issues:[]};
    const files:McpConversion['files']=[],claude:Record<string,unknown>=Object.create(null),ask:string[]=[];
    const runRoot=join(input.runRoot,'mcp');
    for(const item of this.registry.selected(input.cwd).filter(row=>row.kind==='mcp')){
      try{
        const resolved=this.registry.resolveMcpSource(item.id);if(!resolved)throw new McpSourceError('来源已删除，请重新扫描');
        const references=mcpReferenceNames(resolved.source,resolved.environment);
        const needsSecret=references.some(name=>resolved.secretEnvNames?.includes(name));
        const environment={...resolved.environment,...(resolved.configurationId&&needsSecret?this.options.profileEnvironment?.(resolved.configurationId):{})};
        const source={...resolved.source,env:{...resolved.source.env}};
        if(environment.PATH&&!Object.hasOwn(source.env,'PATH'))source.env.PATH={literal:environment.PATH};
        // A relative native command/cwd is anchored to its source project, not
        // to another Agent's configuration directory or the host process cwd.
        if(source.cwd)source.cwd=resolve(input.cwd,source.cwd);
        if(source.command?.includes('/')&&!source.command.startsWith('/'))source.command=resolve(source.cwd??input.cwd,source.command);
        const conversion=convertMcp({source,target:input.runner,serverId:createHash('sha256').update(item.id).digest('hex').slice(0,32),sourceEnvironment:environment,
          runRoot,cwd:input.cwd,executable:this.options.executable,launcherSource:this.options.launcherSource??launcherSource??'',stripNames:[...new Set([...input.injectedNames,'NODE_OPTIONS'])],autoApprove:item.autoApprove});
        if(!conversion.files.every(file=>typeof file.content==='string'))throw new McpSourceError('MCP 运行资产缺失，请重新安装 WillYou');
        files.push(...conversion.files);Object.assign(result.env,conversion.env);result.secretValues.push(...Object.values(conversion.env).filter(Boolean));
        // Codex splits override paths literally; quotes would become part of
        // the server name. parseMcpSource permits only safe bare-key characters.
        if(input.runner==='codex')result.args.push('-c',`mcp_servers.${conversion.serverName}=${inline(conversion.codexServer)}`);
        else{claude[conversion.serverName]=conversion.claudeServer;result.args.push(...conversion.permissionArgs);ask.push(...conversion.claudeAskTools);}
        result.configured.push(item.id);
      }catch(error){
        // Raw parser/native errors may include configuration values. Only our
        // controlled, value-free diagnostics are safe for snapshots and RPC.
        result.issues.push({id:item.id,reason:error instanceof McpSourceError?error.message:'来源配置读取失败，请在来源 CLI 检查后重新扫描'});
      }
    }
    if(Object.keys(claude).length){const path=join(runRoot,'servers.json');files.push({path,content:JSON.stringify({mcpServers:claude},null,2)+'\n',mode:0o600});result.args.push('--mcp-config',path);}
    if(ask.length){const path=join(runRoot,'permissions.json');files.push({path,content:JSON.stringify({permissions:{ask}},null,2)+'\n',mode:0o600});result.args.push('--settings',path);}
    if(files.length)writeControls(this.options.userData,runRoot,files);
    return result;
  }
}
