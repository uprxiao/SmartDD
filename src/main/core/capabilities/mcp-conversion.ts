import { join, isAbsolute } from 'node:path';
import type { Runner } from '@shared/types';
import { McpSourceError, resolveMcpSource, type McpSource } from './mcp-source';

type Slot={slot:string};
export interface McpConversion {
  /** Values are process-only. Never persist this member or return it through RPC. */
  env:Record<string,string>;
  files:{path:string;content:string;mode:0o600|0o700}[];
  claudeServer?:Record<string,unknown>;
  codexServer?:Record<string,unknown>;
  permissionArgs:string[];
  claudeAskTools:string[];
  serverName:string;
}
export interface McpConversionInput {
  source:McpSource;target:Runner;serverId:string;sourceEnvironment:Record<string,string|undefined>;
  runRoot:string;cwd:string;executable:string;launcherSource:string;stripNames:string[];
  autoApprove:boolean;
}
const shell=(text:string)=>"'"+text.replaceAll("'","'\"'\"'")+"'";

/** Source semantics are fully resolved before emitting any file/slot. Control
 * structures stay in a public JSON plan; every server-supplied value (including
 * literal argv) travels by a server-private environment slot. */
export function convertMcp(input:McpConversionInput):McpConversion {
  if(!/^[A-Za-z0-9_]{1,64}$/.test(input.serverId)||![input.runRoot,input.cwd,input.executable].every(isAbsolute))throw new McpSourceError('MCP 本次运行路径或身份无效');
  const source=resolveMcpSource(input.source,input.sourceEnvironment,input.target);
  if(input.target==='claude'&&source.allowedTools!==null)throw new McpSourceError('来源工具白名单尚不能等价转换到 Claude Code；请在目标 CLI 单独配置');
  if(Object.keys(source.env).some(name=>name.startsWith('WY_MCPV_')))throw new McpSourceError('MCP 自有环境变量不能占用 WillYou 私有槽前缀');
  const env:Record<string,string>=Object.create(null),files:McpConversion['files']=[],permissionArgs:string[]=[];
  let counter=0;const slot=(value:string):Slot=>{const key=`WY_MCPV_${input.serverId}_${++counter}`;env[key]=value;return{slot:key};};
  const launcher=join(input.runRoot,'wy-mcp-launch.cjs'),planPath=join(input.runRoot,input.serverId+'.json');
  const result:McpConversion={env,files,permissionArgs,serverName:source.name,claudeAskTools:[]};
  const tools:Record<string,{approval_mode:'approve'|'prompt'}>=Object.create(null);
  for(const tool of source.approvedTools)if(!source.disabledTools.includes(tool))tools[tool]={approval_mode:'approve'};
  for(const tool of source.promptTools)if(!source.disabledTools.includes(tool))tools[tool]={approval_mode:'prompt'};
  const defaultApproval=input.autoApprove?'approve':source.defaultApproval;
  if(input.target==='claude'){
    for(const tool of source.disabledTools)permissionArgs.push('--disallowedTools',`mcp__${source.name}__${tool}`);
    for(const tool of source.approvedTools)if(!source.disabledTools.includes(tool))permissionArgs.push('--allowedTools',`mcp__${source.name}__${tool}`);
    if(defaultApproval==='approve')permissionArgs.push('--allowedTools',`mcp__${source.name}__*`);
    result.claudeAskTools=source.promptTools.filter(tool=>!source.disabledTools.includes(tool)).map(tool=>`mcp__${source.name}__${tool}`);
  }
  if(source.transport==='stdio'){
    const ownEnv:Record<string,Slot>=Object.create(null);
    for(const[name,value]of Object.entries(source.env))ownEnv[name]=slot(value);
    const plan={version:1,mode:'spawn',serverId:input.serverId,command:source.command,args:source.args.map(slot),cwd:source.cwd??input.cwd,ownEnv,stripNames:input.stripNames};
    files.push({path:launcher,content:input.launcherSource,mode:0o600},{path:planPath,content:JSON.stringify(plan,null,2)+'\n',mode:0o600});
    const server={command:input.executable,args:[launcher,'--plan',planPath],env:{ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:''}};
    if(input.target==='claude')result.claudeServer={type:'stdio',...server};
    else result.codexServer={...server,env_vars:Object.keys(env),default_tools_approval_mode:defaultApproval,...(source.disabledTools.length?{disabled_tools:source.disabledTools}:{}),...(source.allowedTools?{enabled_tools:source.allowedTools}:{}),...(Object.keys(tools).length?{tools}:{})};
  }else{
    const headers:Record<string,Slot>=Object.create(null);for(const[name,value]of Object.entries(source.headers))headers[name]=slot(value);
    if(input.target==='codex'){
      // Codex drops empty env_http_headers values instead of sending an empty
      // header. Empty literals contain no credential and preserve source HTTP
      // semantics; all nonempty values remain in process-only slots.
      const empty=Object.keys(headers).filter(name=>source.headers[name]==='');
      const nonempty=Object.entries(headers).filter(([name])=>source.headers[name]!=='');
      result.codexServer={url:source.url,default_tools_approval_mode:defaultApproval,...(empty.length?{http_headers:Object.fromEntries(empty.map(name=>[name,'']))}:{}),...(nonempty.length?{env_http_headers:Object.fromEntries(nonempty.map(([name,ref])=>[name,ref.slot]))}:{}),...(source.disabledTools.length?{disabled_tools:source.disabledTools}:{}),...(source.allowedTools?{enabled_tools:source.allowedTools}:{}),...(Object.keys(tools).length?{tools}:{})};
    }
    else{
      result.claudeServer={type:source.transport,url:source.url};
      if(counter){
        // Claude recursively expands values in headers. A fixed helper returns
        // JSON after slot resolution, preserving literal ${...} without a shell.
        files.push({path:launcher,content:input.launcherSource,mode:0o600},{path:planPath,content:JSON.stringify({version:1,mode:'headers',serverId:input.serverId,headers},null,2)+'\n',mode:0o600});
        const helper=join(input.runRoot,input.serverId+'-headers.sh');
        files.push({path:helper,mode:0o700,content:`#!/bin/sh\nunset NODE_OPTIONS\nexport ELECTRON_RUN_AS_NODE=1\nexec ${shell(input.executable)} ${shell(launcher)} --plan ${shell(planPath)}\n`});
        result.claudeServer.headersHelper=helper;
      }
    }
  }
  return result;
}
