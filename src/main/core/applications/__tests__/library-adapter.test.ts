import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {LibraryLoadRequest} from '@shared/agent-adapters';
import {cliFixture} from './cli-fixture';

/** M11 R1.0 R16: library adapters plan only bridges and the CLI permission profile; no catalog, skills.config or plugin dir. */
let f:Awaited<ReturnType<typeof cliFixture>>;
const request=():LibraryLoadRequest=>{
 const plan=f.runs.bridgePreparation(f.run.runId).plan!,bridge=f.snapshot.mcp.find(m=>m.kind==='applications')!,runtime=f.store.get('runtime:'+bridge.runtimeHash);
 return{snapshot:f.snapshot,runId:f.run.runId,cliVersion:'0.166.0',currentExecutable:process.execPath,native:{...f.snapshot.native,runner:'codex',home:f.home},inventory:[],planHash:plan.planHash,
  mcp:[{kind:'applications',serverName:bridge.serverName,command:process.execPath,args:[join(f.store.root,runtime.relativePath,'mcp-bridge.cjs'),'--bootstrap',join(f.root,'bootstrap.json')],env:{ELECTRON_RUN_AS_NODE:'1'}}]};
};
beforeEach(async()=>{f=await cliFixture({adapterVersion:'1.4.0'});});
afterEach(async()=>{await f?.cleanup();});

describe('M11 R1.0 library adapter planning',()=>{
 it('plans the application bridge without any Skill catalog or skills.config',()=>{
  const plan=f.adapters.planLibrary(f.snapshot.adapterBinding.hash,request()),argv=plan.args.join(' ');
  expect(argv).toContain('mcp_servers.'+request().mcp[0].serverName+'.command=');expect(argv).not.toContain('skills.config');expect(argv).not.toContain('--plugin-dir');
 });
 it('refuses the old catalog planner, a sandbox that differs from the run plan, and a user MCP of the same name',()=>{
  const {planHash:_plan,...base}=request(),legacy={...base,pluginRoot:null,pluginHash:null,catalog:{generation:'g',entries:[]},userSkillConfig:[]};
  expect(()=>f.adapters.plan(f.snapshot.adapterBinding.hash,legacy)).toThrow(expect.objectContaining({code:'HOST_INCOMPATIBLE'}));
  expect(()=>f.adapters.planLibrary(f.snapshot.adapterBinding.hash,{...request(),cliSandbox:{endpoint:'/private/tmp/wy-cli-1/cli.sock',kind:'inherit',parent:':workspace',networkProxy:false,enableNetwork:false,existingNames:[],source:'test',digest:'a'.repeat(64)}})).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
  const input=request();expect(()=>f.adapters.planLibrary(f.snapshot.adapterBinding.hash,{...input,inventory:[{kind:'mcp',name:input.mcp[0].serverName,path:'',ownerStoreId:null,contentHash:null}]})).toThrow(expect.objectContaining({code:'AGENT_CAPABILITY_NAME_CONFLICT'}));
 });
 it('adds only the inherited CLI permission profile for Codex and refuses CLI for Claude Code',()=>{
  const {plan}=createRequire(import.meta.url)(resolve('resources/agent-adapters/codex/1.4.0/planner.cjs')) as {plan:(agent:string,input:unknown)=>{args:string[];files:Record<string,string>}};
  const sandbox={endpoint:'/private/tmp/wy-cli-501-x/cli.sock',kind:'inherit',parent:':workspace',networkProxy:true,enableNetwork:true,existingNames:[]};
  const codex=plan('codex',{mcp:[],cliSandbox:sandbox}).args.join(' ');
  expect(codex).toMatch(/default_permissions="wy_cli_[0-9a-f]{12}"/);expect(codex).toContain('.network.unix_sockets={"/private/tmp/wy-cli-501-x/cli.sock"="allow"}');expect(codex).toContain('features.network_proxy=true');expect(codex).not.toContain('skills.config');
  const claude=plan('claude-code',{mcp:[{serverName:'s',command:'c',args:[],env:{}}],mcpConfigPath:'/tmp/mcp.json'});expect(claude.args).toEqual(['--mcp-config','/tmp/mcp.json']);expect(JSON.parse(claude.files['mcp.json'])).toEqual({mcpServers:{s:{command:'c',args:[],env:{}}}});
  expect(()=>plan('claude-code',{mcp:[],cliSandbox:sandbox})).toThrow();
 });
});
