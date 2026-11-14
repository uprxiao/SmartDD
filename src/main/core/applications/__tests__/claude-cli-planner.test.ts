import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {nativeLaunchFieldSchemas} from '@shared/agent-adapters';
const {plan}=createRequire(import.meta.url)(resolve('resources/agent-adapters/claude-code/1.3.0/planner.cjs'));
const policy={runner:'claude-code' as const,endpoint:'/private/tmp/wy-cli-501-Abc123/cli.sock',kind:'allow-unix' as const,source:'measured-user-only',digest:'a'.repeat(64)};
const request=()=>({snapshot:{runner:'claude-code'},native:{runner:'claude-code'},cliVersion:'2.1.322',mcp:[],cliSandbox:{...policy}});
describe('Claude candidate CLI planning: no version declaration or activation',()=>{
 it('delivers one measured Unix address without changing enabled, approvals, file rules or domains',()=>{
  const input=request(),before=structuredClone(input),result=plan(input);
  expect(result.args).toEqual(['--settings',JSON.stringify({sandbox:{network:{allowUnixSockets:[policy.endpoint]}}})]);
  expect(result.files).toEqual({});expect(input).toEqual(before);
  expect(result.args.join(' ')).not.toContain('shell_snapshot');expect(result.args.join(' ')).not.toContain('permission-mode');
 });
 it('keeps the native off/full-access policy unchanged when no relaxation is needed',()=>{
  const result=plan({...request(),cliSandbox:{...policy,kind:'unchanged'}});
  expect(result.args).toEqual([]);expect(result.files).toEqual({});
 });
 it('preserves MCP delivery and emits no CLI arguments without a checked payload',()=>{
  const mcp=[{serverName:'owned_bridge',command:'/fixed/node',args:['/fixed/bridge.cjs'],env:{ELECTRON_RUN_AS_NODE:'1'}}],result=plan({...request(),cliSandbox:undefined,mcp,mcpConfigPath:'/private/tmp/owned/mcp.json'});
  expect(result.args).toEqual(['--mcp-config','/private/tmp/owned/mcp.json']);expect(JSON.parse(result.files['mcp.json'])).toEqual({mcpServers:{owned_bridge:{command:mcp[0].command,args:mcp[0].args,env:mcp[0].env}}});
 });
 it.each(['/private/tmp/other/cli.sock','/private/tmp/wy-cli-501-Abc123/../cli.sock','/tmp/wy-cli-501-Abc123/cli.sock','/private/tmp/wy-cli-501-Abc123/anything.sock'])('rejects endpoints outside the exact host layout %s',endpoint=>{expect(()=>plan({...request(),cliSandbox:{...policy,endpoint}})).toThrow();});
 it.each(['2.1.318','2.1.324','unverified'])('does not infer CLI support for another version %s',cliVersion=>{expect(()=>plan({...request(),cliVersion})).toThrow();});
 it('rejects cross-runner delivery and credential or broad-access fields at both boundaries',()=>{
  expect(()=>plan({...request(),native:{runner:'codex'}})).toThrow();
  expect(()=>plan({...request(),snapshot:{runner:'codex'}})).toThrow();
  for(const extra of [{runner:'codex'},{token:'PUBLIC_UNEXPECTED_FIELD'},{allowAllUnixSockets:true},{enabled:false},{digest:'invalid'}]){
   const value={...policy,...extra};expect(nativeLaunchFieldSchemas.cliSandbox.safeParse(value).success).toBe(false);expect(()=>plan({...request(),cliSandbox:value})).toThrow();
  }
  expect(nativeLaunchFieldSchemas.cliSandbox.safeParse(policy).success).toBe(true);
 });
 it('keeps the retained MCP-only adapter byte-identical and rejecting CLI',()=>{
  const path=resolve('resources/agent-adapters/claude-code/1.2.0/planner.cjs'),before=readFileSync(path),old=createRequire(import.meta.url)(path);
  expect(()=>old.plan('claude-code',{mcp:[],cliSandbox:policy})).toThrow();
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(createHash('sha256').update(before).digest('hex'));
 });
});
