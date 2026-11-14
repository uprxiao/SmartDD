import type { Runner } from '@shared/types';

export type McpValue={literal:string}|{parts:({text:string}|{ref:string;fallback?:string})[]};
export interface McpSource {
  name:string;runner:Runner;transport:'stdio'|'http'|'sse';command?:string;args:McpValue[];cwd?:string;
  url?:string;env:Record<string,McpValue>;headers:Record<string,McpValue>;disabledTools:string[];
  allowedTools:string[]|null;approvedTools:string[];promptTools:string[];defaultApproval:'prompt'|'approve';enabled:boolean;oauthRequired:boolean;
}
export class McpSourceError extends Error {
  constructor(readonly reason:string,readonly variable?:string){super(variable?`缺少变量 ${variable}；请在来源 CLI 的环境中配置后重试`:reason);}
}
export interface McpNativePolicy {allow:string[];deny:string[];ask:string[];unverified:boolean}
/** Native deny/ask rules must survive a user's per-server auto-approve choice.
 * Unexpressible source globs/configuration carriers fail closed for this MCP. */
export function applyMcpNativePolicy(source:McpSource,policy?:McpNativePolicy):McpSource {
  if(!policy)return source;
  if(policy.unverified)throw new McpSourceError('来源权限配置尚不能等价转换，请在目标 CLI 单独配置');
  const result={...source,disabledTools:[...source.disabledTools],approvedTools:[...source.approvedTools],promptTools:[...source.promptTools]};
  for(const kind of ['allow','deny','ask'] as const)for(const rule of policy[kind]){
    if(rule==='*'||rule===`mcp__${source.name}`||rule===`mcp__${source.name}__*`){
      if(kind==='deny')result.enabled=false;
      else if(kind==='allow')result.defaultApproval='approve';
      else throw new McpSourceError('来源要求逐个询问全部工具，尚不能等价转换；请在目标 CLI 单独配置');
      continue;
    }
    if(!rule.startsWith('mcp__'))continue;
    const prefix=`mcp__${source.name}__`;
    if(rule.startsWith(prefix)){
      const tool=rule.slice(prefix.length);if(!TOOL.test(tool))throw new McpSourceError('来源工具权限包含尚不支持的匹配规则，请在目标 CLI 单独配置');
      result[kind==='allow'?'approvedTools':kind==='deny'?'disabledTools':'promptTools'].push(tool);
    }else if(rule.includes('*')||rule.includes('?'))throw new McpSourceError('来源工具权限包含尚不支持的匹配规则，请在目标 CLI 单独配置');
  }
  return result;
}
const NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;
const TOOL=/^[A-Za-z0-9_.-]{1,128}$/;
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>{throw new McpSourceError('MCP 声明格式无效；请在来源 CLI 中修复');};
function string(v:unknown):string {if(typeof v!=='string'||v.includes('\0')||v.length>65536)return invalid();return v;}
function strings(v:unknown):string[]{if(!Array.isArray(v)||v.length>4096)return invalid();return v.map(string);}
export function mcpValue(value:string,runner:Runner):McpValue {
  if(runner!=='claude')return{literal:value};
  const parts:({text:string}|{ref:string;fallback?:string})[]=[],pattern=/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
  let cursor=0,match:RegExpExecArray|null;
  while((match=pattern.exec(value))){if(match.index>cursor)parts.push({text:value.slice(cursor,match.index)});parts.push({ref:match[1],...(match[2]!==undefined?{fallback:match[2]}:{})});cursor=pattern.lastIndex;}
  if(!parts.length)return{literal:value};if(cursor<value.length)parts.push({text:value.slice(cursor)});return{parts};
}
export function evaluateMcpValue(value:McpValue,env:Record<string,string|undefined>):string {
  if('literal'in value)return value.literal;
  return value.parts.map(part=>{
    if('text'in part)return part.text;
    // Native Claude's :- fallback applies to an absent variable. An explicitly
    // empty value stays empty; this is not a shell expansion implementation.
    if(Object.hasOwn(env,part.ref)&&env[part.ref]!==undefined)return env[part.ref]!;
    if(part.fallback!==undefined)return part.fallback;
    throw new McpSourceError('missing_variable',part.ref);
  }).join('');
}
export function mcpReferenceNames(source:McpSource,environment:Record<string,string|undefined>):string[]{
  const names=new Set<string>();
  const add=(value:McpValue)=>{if('parts'in value)for(const part of value.parts)if('ref'in part)names.add(part.ref);};
  for(const value of [...source.args,...Object.values(source.env),...Object.values(source.headers)])add(value);
  if(source.runner==='claude')for(const value of Object.values(source.headers))try{add(mcpValue(evaluateMcpValue(value,environment),'claude'));}catch{/* Missing first-layer refs remain in names. */}
  return [...names].sort();
}
export function mcpUrlIssue(value:string):string|null {
  if(value.includes('${'))return '不支持转换：URL 含凭据（变量引用）；改用请求头或环境变量鉴权';
  let url:URL;try{url=new URL(value);}catch{return 'MCP URL 无效';}
  if(!['http:','https:'].includes(url.protocol))return 'MCP URL 仅支持 HTTP 或 HTTPS';
  const sensitive=(key:string)=>{
    const normalized=key.toLowerCase().replace(/[-_.\s]/g,'');
    return /token|apikey|accesskey|secret|password|passwd|authorization|signature|credential|bearer|session/.test(normalized)||['key','pwd','auth','sig','code','sid'].includes(normalized);
  };
  if(url.username||url.password||[...url.searchParams.keys()].some(sensitive)||/[?&#=]/.test(url.hash))return '不支持转换：URL 含凭据；改用请求头或环境变量鉴权';
  return null;
}
export function parseMcpSource(name:string,runner:Runner,raw:unknown):McpSource {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(name)||!object(raw))return invalid();
  if(runner!=='claude'&&runner!=='codex')throw new McpSourceError('来源工具尚不支持 MCP 转换');
  const transport=raw.url!==undefined?(raw.type==='sse'?'sse':'http'):'stdio';
  const source:McpSource={name,runner,transport,args:[],env:Object.create(null),headers:Object.create(null),disabledTools:[],allowedTools:null,approvedTools:[],promptTools:[],defaultApproval:'prompt',enabled:raw.enabled!==false&&raw.disabled!==true,oauthRequired:raw.oauth===true||(object(raw.auth)&&raw.auth.type==='oauth')};
  if(raw.headersHelper!==undefined||raw.http_headers_helper!==undefined)throw new McpSourceError('来源依赖认证脚本，请在目标 CLI 单独配置；扫描不会执行脚本');
  if(raw.default_tools_approval_mode!==undefined){if(!['prompt','approve'].includes(String(raw.default_tools_approval_mode)))throw new McpSourceError('来源 MCP 的自动分类审批尚不支持跨工具转换');source.defaultApproval=raw.default_tools_approval_mode as 'prompt'|'approve';}
  const values=(input:unknown,target:Record<string,McpValue>,names:'env'|'headers')=>{
    if(input===undefined)return;if(!object(input))return invalid();
    for(const[k,v]of Object.entries(input)){
      if(names==='env'?!NAME.test(k):! /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k))return invalid();target[k]=mcpValue(string(v),runner);
    }
  };
  if(transport==='stdio'){
    source.command=string(raw.command);if(!source.command.trim()||source.command.includes('${'))throw new McpSourceError('不支持转换：command 含变量引用或为空');
    if(/\.app\/(?:Contents\/)?/i.test(source.command))throw new McpSourceError('命令位于其他应用包内，不能迁移');
    source.args=(raw.args===undefined?[]:strings(raw.args)).map(v=>mcpValue(v,runner));values(raw.env,source.env,'env');
    if(raw.cwd!==undefined)source.cwd=string(raw.cwd);
    if(runner==='codex'&&raw.env_vars!==undefined)for(const key of strings(raw.env_vars)){if(!NAME.test(key))return invalid();if(!Object.hasOwn(source.env,key))source.env[key]={parts:[{ref:key}]};}
  }else{
    source.url=string(raw.url);const issue=mcpUrlIssue(source.url);if(issue)throw new McpSourceError(issue);
    values(runner==='codex'?raw.http_headers:raw.headers,source.headers,'headers');
    if(runner==='codex'&&raw.env_http_headers!==undefined){if(!object(raw.env_http_headers))return invalid();for(const[header,key]of Object.entries(raw.env_http_headers)){if(! /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header)||typeof key!=='string'||!NAME.test(key))return invalid();source.headers[header]={parts:[{ref:key}]};}}
    if(runner==='codex'&&raw.bearer_token_env_var!==undefined){const key=string(raw.bearer_token_env_var);if(!NAME.test(key))return invalid();source.headers.Authorization={parts:[{text:'Bearer '},{ref:key}]};}
  }
  const tools=(v:unknown)=>strings(v).map(name=>{if(!TOOL.test(name))throw new McpSourceError('来源工具名称无法可靠映射审批规则，请在目标 CLI 单独配置');return name;});
  if(raw.disabled_tools!==undefined)source.disabledTools=tools(raw.disabled_tools);
  if(raw.enabled_tools!==undefined)source.allowedTools=tools(raw.enabled_tools);
  if(raw.tools!==undefined){if(!object(raw.tools))return invalid();for(const[tool,policy]of Object.entries(raw.tools)){
    if(!TOOL.test(tool))throw new McpSourceError('来源工具名称无法可靠映射审批规则，请在目标 CLI 单独配置');
    if(!object(policy))return invalid();if(policy.enabled===false||policy.approval_mode==='deny')source.disabledTools.push(tool);
    else if(policy.approval_mode==='approve')source.approvedTools.push(tool);
    else if(policy.approval_mode==='prompt')source.promptTools.push(tool);
  }}
  return source;
}

/** Evaluate the entire server before allocating any private slot or file. */
export function resolveMcpSource(source:McpSource,environment:Record<string,string|undefined>,target:Runner){
  if(!source.enabled)throw new McpSourceError('来源已停用，不注入');
  if(source.oauthRequired)throw new McpSourceError(`需在 ${target==='codex'?'Codex':'Claude Code'} 单独认证${target==='codex'?'；请运行 codex mcp login':''}`);
  if(source.transport==='sse'&&target==='codex')throw new McpSourceError('Codex 不支持 SSE');
  const env:Record<string,string>=Object.create(null),headers:Record<string,string>=Object.create(null);
  for(const[k,value]of Object.entries(source.env))env[k]=evaluateMcpValue(value,environment);
  const args=source.args.map(value=>evaluateMcpValue(value,environment));
  for(const[k,value]of Object.entries(source.headers)){
    const first=evaluateMcpValue(value,environment);
    // Claude expands its config, then expands the resulting HTTP header once
    // more in the transport. Codex headers remain literal after explicit refs.
    const resolved=source.runner==='claude'?evaluateMcpValue(mcpValue(first,'claude'),environment):first;
    if(/[\r\n]/.test(resolved))throw new McpSourceError('请求头值包含非法换行');headers[k]=resolved;
  }
  return{...source,args,env,headers};
}
