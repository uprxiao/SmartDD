import {createRequire} from 'node:module';
import {parse as parseToml} from 'smol-toml';
import {BRIDGE_LIMITS} from '@shared/application-bridge';
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
 it('refuses a sandbox that differs from the run plan and a user MCP of the same name',()=>{
  expect(()=>f.adapters.planLibrary(f.snapshot.adapterBinding.hash,{...request(),cliSandbox:{endpoint:'/private/tmp/wy-cli-1/cli.sock',kind:'inherit',parent:':workspace',networkProxy:false,enableNetwork:false,existingNames:[],source:'test',digest:'a'.repeat(64)}})).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
  const input=request();expect(()=>f.adapters.planLibrary(f.snapshot.adapterBinding.hash,{...input,inventory:[{kind:'mcp',name:input.mcp[0].serverName,path:'',ownerStoreId:null,contentHash:null}]})).toThrow(expect.objectContaining({code:'AGENT_CAPABILITY_NAME_CONFLICT'}));
 });
 it('rejects a valid Claude sandbox payload on a Codex run before invoking an immutable planner',()=>{
  expect(()=>f.adapters.planLibrary(f.snapshot.adapterBinding.hash,{...request(),cliSandbox:{runner:'claude-code',endpoint:'/private/tmp/wy-cli-501-Abc123/cli.sock',kind:'allow-unix',source:'test',digest:'a'.repeat(64)}})).toThrow('CLI沙箱不属于本次Agent');
 });
 it('adds only the inherited CLI permission profile for Codex and refuses CLI for Claude Code',()=>{
  const {plan}=createRequire(import.meta.url)(resolve('resources/agent-adapters/codex/1.4.0/planner.cjs')) as {plan:(agent:string,input:unknown)=>{args:string[];files:Record<string,string>}};
  const sandbox={endpoint:'/private/tmp/wy-cli-501-x/cli.sock',kind:'inherit',parent:':workspace',networkProxy:true,enableNetwork:true,existingNames:[]};
  const codex=plan('codex',{mcp:[],cliSandbox:sandbox}).args.join(' ');
  expect(codex).toMatch(/default_permissions="wy_cli_[0-9a-f]{12}"/);expect(codex).toContain('.network.unix_sockets={"/private/tmp/wy-cli-501-x/cli.sock"="allow"}');expect(codex).toContain('features.network_proxy=true');expect(codex).not.toContain('skills.config');
  const claude=plan('claude-code',{mcp:[{serverName:'s',command:'c',args:[],env:{}}],mcpConfigPath:'/tmp/mcp.json'});expect(claude.args).toEqual(['--mcp-config','/tmp/mcp.json']);expect(JSON.parse(claude.files['mcp.json'])).toEqual({mcpServers:{s:{command:'c',args:[],env:{}}}});
  expect(()=>plan('claude-code',{mcp:[],cliSandbox:sandbox})).toThrow();
 });
 // Ported from the pre-R1.0 planner tests (S3d-c): the same version, budget and platform rules hold for library plans.
 it('keeps every declared tool response within the host budget without a global tool limit',()=>{
  const plan=f.adapters.planLibrary(f.snapshot.adapterBinding.hash,request()),flags=parseToml(plan.args.filter((_,i)=>i>0&&plan.args[i-1]==='-c').join('\n')) as {mcp_servers:Record<string,{tools?:Record<string,{output_token_limit:number}>}>;tool_output_token_limit?:number};
  const expected=Object.fromEntries(f.snapshot.packages.flatMap(p=>Object.keys(p.toolContractMajors)).map(name=>[name,{output_token_limit:BRIDGE_LIMITS.responseBytes}]));
  expect(Object.keys(expected).length).toBeGreaterThan(0);expect(flags.mcp_servers[request().mcp[0].serverName].tools).toEqual(expected);expect(flags.tool_output_token_limit).toBeUndefined();
 });
 it('plans an undeclared semantic version best-effort without a CLI sandbox and rejects absent or unparseable versions',()=>{
  const hash=f.snapshot.adapterBinding.hash;expect(f.adapters.versionSupport(hash,'99.0.0')).toBe('best-effort');expect(f.adapters.levels(hash,'99.0.0')).toEqual([]);
  expect(f.adapters.planLibrary(hash,{...request(),cliVersion:'99.0.0'}).args.join(' ')).not.toContain('wy_cli_');
  expect(()=>f.adapters.planLibrary(hash,{...request(),cliVersion:'99.0.0',cliSandbox:{endpoint:'/private/tmp/wy-cli-denied/endpoint.sock',kind:'inherit',parent:':read-only',networkProxy:false,enableNetwork:false,existingNames:[],source:'test',digest:'a'.repeat(64)}})).toThrow('未声明版本不能注入');
  for(const cliVersion of ['','unverified']){expect(f.adapters.versionSupport(hash,cliVersion)).toBe('unsupported');expect(()=>f.adapters.planLibrary(hash,{...request(),cliVersion})).toThrow('尚未验证');expect(f.adapters.recovery(hash,cliVersion)).toEqual({capability:'unverified'});}
 });
 it.each([{platform:'darwin',arch:'x64'},{platform:'linux',arch:'arm64'},{platform:'win32',arch:'x64'}] as const)('rejects the unverified platform $platform-$arch',({platform,arch})=>{
  const actualPlatform=Object.getOwnPropertyDescriptor(process,'platform')!,actualArch=Object.getOwnPropertyDescriptor(process,'arch')!,good=f.adapters.planLibrary(f.snapshot.adapterBinding.hash,request());
  try{Object.defineProperty(process,'platform',{...actualPlatform,value:platform});Object.defineProperty(process,'arch',{...actualArch,value:arch});expect(()=>f.adapters.planLibrary(f.snapshot.adapterBinding.hash,request())).toThrow('尚未验证');}
  finally{Object.defineProperty(process,'platform',actualPlatform);Object.defineProperty(process,'arch',actualArch);}
  expect(f.adapters.planLibrary(f.snapshot.adapterBinding.hash,request())).toEqual(good);
 });
});
