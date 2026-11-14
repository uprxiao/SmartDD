import { applyMcpNativePolicy } from './mcp-source';
import { expect,it } from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseMcpSource,resolveMcpSource,mcpUrlIssue} from './mcp-source';
import {convertMcp} from './mcp-conversion';
const launcherSource=readFileSync(resolve('resources/runtime/wy-mcp-launch.cjs'),'utf8');
it('preserves source-specific template and literal semantics, including defaults and explicit empty values',()=>{
  const raw={command:'/bin/public',args:['${X}','pre-${X}-post','${MISSING:-fallback}','$5','${EMPTY:-default}'],env:{OWN:'${X}'}};
  expect(resolveMcpSource(parseMcpSource('echo','claude',raw),{X:'VALUE',EMPTY:''},'codex')).toMatchObject({args:['VALUE','pre-VALUE-post','fallback','$5',''],env:{OWN:'VALUE'}});
  expect(resolveMcpSource(parseMcpSource('echo','codex',raw),{},'claude')).toMatchObject({args:raw.args,env:raw.env});
});
it('handles Codex explicit references without expanding its literal values',()=>{
  const source=parseMcpSource('http','codex',{url:'https://mcp.example.invalid/',http_headers:{Literal:'${X}'},env_http_headers:{Key:'MCP_HEADER'},bearer_token_env_var:'MCP_BEARER'});
  expect(resolveMcpSource(source,{MCP_HEADER:'HEADER',MCP_BEARER:'TOKEN'},'claude').headers).toEqual({Literal:'${X}',Key:'HEADER',Authorization:'Bearer TOKEN'});
});
it('matches Claude source HTTP second expansion and fails atomically for a second-stage missing reference',()=>{
  const source=parseMcpSource('http','claude',{url:'https://mcp.example.invalid',headers:{Key:'${X}'}});
  expect(resolveMcpSource(source,{X:'${Y}',Y:'FINAL'},'codex').headers.Key).toBe('FINAL');
  expect(()=>resolveMcpSource(source,{X:'${MISSING}'},'codex')).toThrow('缺少变量 MISSING');
});
it.each(['https://u:p@example.invalid','https://example.invalid?api_key=PUBLIC','https://example.invalid#access_token=PUBLIC','https://example.invalid/${X}'])('rejects credential-bearing URLs before files or slots exist: %s',url=>{
  expect(mcpUrlIssue(url)).toContain('URL 含凭据');expect(()=>parseMcpSource('remote','claude',{url})).toThrow(/改用请求头或环境变量/);
});
it.each(['env','arg','header'])('fails an entire server on a missing required variable in %s',where=>{
  const raw=where==='env'?{command:'/bin/public',env:{OWN:'${MISSING}'}}:where==='arg'?{command:'/bin/public',args:['first','${MISSING}','last']}:{url:'https://mcp.example.invalid',headers:{Key:'${MISSING}'}};
  expect(()=>resolveMcpSource(parseMcpSource('missing','claude',raw),{},'codex')).toThrow(/缺少变量 MISSING/);
});
it('marks OAuth, disabled servers, application-owned commands and SSE to Codex explicitly unsupported',()=>{
  expect(()=>resolveMcpSource(parseMcpSource('sse','claude',{type:'sse',url:'https://mcp.example.invalid'}),{},'codex')).toThrow('Codex 不支持 SSE');
  expect(()=>resolveMcpSource(parseMcpSource('oauth','codex',{url:'https://mcp.example.invalid',oauth:true}),{},'codex')).toThrow('codex mcp login');
  expect(()=>resolveMcpSource(parseMcpSource('off','claude',{command:'/bin/public',enabled:false}),{},'codex')).toThrow('来源已停用');
  expect(()=>parseMcpSource('owned','claude',{command:'/Applications/Other.app/Contents/MacOS/helper'})).toThrow('其他应用包');
});
it('never serializes raw own keys or argv values into the public carrier; marker-looking argv are data',()=>{
  const source=parseMcpSource('beta','codex',{command:'/bin/public',args:['@WYARG:WY_MCPV_alpha_1','--arg','PUBLIC_ARGUMENT_KEY'],env:{cmd:'PUBLIC_CMD',cwd:'PUBLIC_CWD',k:'PUBLIC_K',ANTHROPIC_API_KEY:'PUBLIC_MCP_KEY'}});
  const converted=convertMcp({source,target:'claude',serverId:'beta',sourceEnvironment:{},runRoot:'/private/owned/run',cwd:'/private/project',executable:'/private/WillYou',launcherSource,stripNames:['WILLYOU_RUN_TOKEN'],autoApprove:false});
  const persisted=JSON.stringify({files:converted.files,config:converted.claudeServer,permissionArgs:converted.permissionArgs});
  for(const value of ['PUBLIC_ARGUMENT_KEY','PUBLIC_CMD','PUBLIC_CWD','PUBLIC_K','PUBLIC_MCP_KEY'])expect(persisted).not.toContain(value);
  expect(Object.values(converted.env)).toEqual(expect.arrayContaining(['@WYARG:WY_MCPV_alpha_1','--arg','PUBLIC_ARGUMENT_KEY','PUBLIC_MCP_KEY']));
  expect(converted.files.every(x=>x.mode===0o600)).toBe(true);
});
it('uses a fixed JSON header helper for Claude literal ${...}, without embedding values in the helper',()=>{
  const source=parseMcpSource('http','codex',{url:'https://mcp.example.invalid',http_headers:{Key:'${LITERAL} PUBLIC_HEADER_KEY'}});
  const converted=convertMcp({source,target:'claude',serverId:'http',sourceEnvironment:{},runRoot:'/private/owned/run',cwd:'/private/project',executable:"/private/a'b/WillYou",launcherSource,stripNames:[],autoApprove:false});
  expect(converted.claudeServer?.headersHelper).toBe('/private/owned/run/http-headers.sh');expect(JSON.stringify(converted.files)).not.toContain('PUBLIC_HEADER_KEY');expect(Object.values(converted.env)).toEqual(['${LITERAL} PUBLIC_HEADER_KEY']);expect(converted.files.find(x=>x.mode===0o700)?.content).toContain("a'\"'\"'b");
});
it('disabled tools take precedence over source automatic approval',()=>{
  const source=parseMcpSource('echo','codex',{command:'/bin/public',disabled_tools:['write'],tools:{read:{approval_mode:'approve'},write:{approval_mode:'approve'}}});
  const converted=convertMcp({source,target:'claude',serverId:'s',sourceEnvironment:{},runRoot:'/private/owned/run',cwd:'/private/project',executable:'/private/WillYou',launcherSource,stripNames:[],autoApprove:false});
  expect(converted.permissionArgs).toEqual(['--disallowedTools','mcp__echo__write','--allowedTools','mcp__echo__read']);
});

it('preserves an explicitly empty HTTP header when Codex omits empty env_http_headers',()=>{
  const source=parseMcpSource('empty','claude',{url:'https://public.example.test/mcp',headers:{'X-Empty':'${EMPTY:-d}','X-Key':'${KEY}'}});
  const converted=convertMcp({source,target:'codex',serverId:'empty',sourceEnvironment:{EMPTY:'',KEY:'PUBLIC_NONEMPTY_KEY'},runRoot:'/tmp/public-run',cwd:'/tmp/public-cwd',executable:'/tmp/WillYou',launcherSource:'//public',stripNames:[],autoApprove:false});
  expect(converted.codexServer).toMatchObject({http_headers:{'X-Empty':''},env_http_headers:{'X-Key':expect.stringMatching(/^WY_MCPV_empty_/)} });
  expect((converted.codexServer!.env_http_headers as object)).not.toHaveProperty('X-Empty');expect(JSON.stringify(converted.codexServer)).not.toContain('PUBLIC_NONEMPTY_KEY');
});

it.each(['echo,Write','echo *','*','echo(mcp__other__*)','echo\\nWrite'])('rejects tool approval grammar injection %s',name=>{
 expect(()=>parseMcpSource('server','codex',{command:'/usr/bin/true',tools:{[name]:{approval_mode:'approve'}}})).toThrow(/名称/);
 expect(()=>parseMcpSource('server','codex',{command:'/usr/bin/true',disabled_tools:[name]})).toThrow(/名称/);
});

it.each(['x-api-key','X-Amz-Signature','auth_token','bearer_token','accessKeyId','header.Authorization','clientSecret'])('refuses suspected credential query %s before generation',key=>{
  expect(()=>parseMcpSource('remote','codex',{url:`https://public.example.test/mcp?${key}=PUBLIC_PRIVATE_SENTINEL`})).toThrow(/URL 含凭据/);
});

it('carries native deny and ask ahead of auto-approve and refuses unexpressible source globs',()=>{
 const source=parseMcpSource('server','claude',{command:'/usr/bin/true'});
 const patched=applyMcpNativePolicy(source,{allow:['mcp__server__read'],deny:['mcp__server__write'],ask:['mcp__server__inspect'],unverified:false});
 const converted=convertMcp({source:patched,target:'codex',serverId:'server',sourceEnvironment:{},runRoot:'/tmp/public',cwd:'/tmp/cwd',executable:'/tmp/WillYou',launcherSource:'//public',stripNames:[],autoApprove:true});
 expect(converted.codexServer).toMatchObject({default_tools_approval_mode:'approve',disabled_tools:['write'],tools:{read:{approval_mode:'approve'},inspect:{approval_mode:'prompt'}}});
 expect(()=>applyMcpNativePolicy(source,{allow:[],deny:['mcp__server__write*'],ask:[],unverified:false})).toThrow(/匹配规则/);
 expect(applyMcpNativePolicy(source,{allow:[],deny:['mcp__server__*'],ask:[],unverified:false}).enabled).toBe(false);
});
