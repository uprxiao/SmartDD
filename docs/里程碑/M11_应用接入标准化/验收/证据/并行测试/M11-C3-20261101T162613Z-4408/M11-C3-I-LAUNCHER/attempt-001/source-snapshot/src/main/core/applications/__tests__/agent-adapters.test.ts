import {BRIDGE_LIMITS} from '@shared/application-bridge';
import {nativeApplicationConflicts} from '../native-application-conflicts';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAgentAdapters } from '../agent-assets';
import { ownedBundle, writeOwnedBundle } from '../owned-bundle';
import { agentFixture } from './agent-fixture';
let f: Awaited<ReturnType<typeof agentFixture>>;
beforeEach(async () => { f = await agentFixture(); }); afterEach(() => f.cleanup());
describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('fixed adapter packages and actual complete Skill projection plans', () => {
  it('M11 S0b delivers Codex 0.166.0 through a new fixed adapter without widening retained or unknown versions',async()=>{
    const original=f.plan('codex'),retained=f.adapters.verify(original.adapterBinding.hash),source=bundledAgentAdapters().find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.2.0')!;
    const current=await f.adapters.install(source.metadata,source.files),snapshot=structuredClone(original);
    snapshot.adapterBinding={...snapshot.adapterBinding,version:current.metadata.version,hash:current.hash};snapshot.agentAtCreation.version='0.166.0';
    await f.sessions.create(snapshot,f.home);const request=await f.request(snapshot),plan=f.adapters.plan(current.hash,request);
    const flags=parseToml(plan.args.filter((_,i)=>i>0&&plan.args[i-1]==='-c').join('\n')) as {skills:{config:{path:string;enabled:boolean}[]};mcp_servers:Record<string,{command:string;tools:Record<string,{output_token_limit:number}>}>};
    expect(flags.skills.config).toContainEqual({path:snapshot.packages[0].skills[0].projectionPath,enabled:true});
    const bridge=request.mcp.find(m=>m.kind==='applications')!;
    expect(flags.mcp_servers[bridge.serverName].command).toBe(process.execPath);
    for(const name of Object.keys(snapshot.packages[0].toolContractMajors))expect(flags.mcp_servers[bridge.serverName].tools[name]).toEqual({output_token_limit:BRIDGE_LIMITS.responseBytes});
    expect(plan.bridgeRecovery).toBe('unverified');expect(current.metadata.cliVersions).toEqual(['0.166.0']);
    expect(()=>f.adapters.plan(current.hash,{...request,cliVersion:'0.166.1'})).toThrow('尚未验证');
    expect(f.adapters.verify(retained.hash).manifest).toEqual(retained.manifest);
    const fixedOld=f.plan('codex');await f.sessions.create(fixedOld,f.home);const oldRequest=await f.request(fixedOld,request.catalog!);
    expect(()=>f.adapters.plan(retained.hash,{...oldRequest,cliVersion:'0.166.0'})).toThrow('尚未验证');
    expect((await f.sessions.get(fixedOld.taskId)).snapshot.adapterBinding).toEqual(fixedOld.adapterBinding);
  });
  it('keeps the original fixed Codex application response complete within its host budget without altering snapshot or global tool policy',async()=>{
    const snapshot=f.plan('codex');await f.sessions.create(snapshot,f.home);const input=await f.request(snapshot),original=await f.sessions.get(snapshot.taskId),adapter=f.adapters.verify(snapshot.adapterBinding.hash),entry=join(f.store.root,adapter.resource.relativePath,'index.cjs'),bytes=readFileSync(entry),inventory=structuredClone(input.inventory),userConfig=structuredClone(input.userSkillConfig);
    const plan=f.adapters.plan(snapshot.adapterBinding.hash,input),flags=parseToml(plan.args.filter((_,i)=>i>0&&plan.args[i-1]==='-c').join('\n')) as {mcp_servers:Record<string,{command:string;tools?:Record<string,{output_token_limit:number;approval_mode?:string}>}>;tool_output_token_limit?:number};
    const bridge=input.mcp.find(m=>m.kind==='applications')!;expect(flags.mcp_servers[bridge.serverName].command).toBe(bridge.command);
    const expected=Object.fromEntries(snapshot.packages.flatMap(pack=>Object.keys(pack.toolContractMajors)).map(name=>[name,{output_token_limit:BRIDGE_LIMITS.responseBytes}]));
    expect(flags.mcp_servers[bridge.serverName].tools).toEqual(expected);expect(flags.tool_output_token_limit).toBeUndefined();
    for(const m of input.mcp.filter(m=>m.kind!=='applications'))expect(flags.mcp_servers[m.serverName].tools).toBeUndefined();
    expect(input.inventory).toEqual(inventory);expect(input.userSkillConfig).toEqual(userConfig);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(original.snapshot);expect(readFileSync(entry)).toEqual(bytes);expect(f.adapters.verify(snapshot.adapterBinding.hash).hash).toBe(adapter.hash);
  });
  it('keeps Codex output overrides absent when applications are unavailable and leaves Claude loading unchanged',async()=>{
    for(const runner of ['codex','claude-code'] as const){
      const snapshot=f.plan(runner);await f.sessions.create(snapshot,f.home);const input=await f.request(snapshot);
      const request=runner==='codex'?{...input,independentCapabilities:true as const,applicationScope:[],mcp:input.mcp.filter(m=>m.kind==='legacy-project-context')}:input;
      const plan=f.adapters.plan(snapshot.adapterBinding.hash,request);expect(plan.args.join('\n')).not.toContain('output_token_limit');
      expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);
    }
  });
 it('plans explicit independent Codex standards and context without allowing an app bridge or silently accepting an ordinary empty scope',async()=>{
  const snapshot=f.plan('codex');await f.sessions.create(snapshot,f.home);const input=await f.request(snapshot),legacy=input.mcp.filter(m=>m.kind==='legacy-project-context'),safe={...input,independentCapabilities:true as const,applicationScope:[],mcp:legacy};expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,{...input,applicationScope:[]})).toThrow();expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,{...input,applicationScope:[],independentCapabilities:true})).toThrow();const plan=f.adapters.plan(snapshot.adapterBinding.hash,safe),flags=(parseToml(plan.args.find(a=>a.startsWith('skills.config='))!).skills as {config:{path:string;enabled:boolean}[]}).config;for(const p of snapshot.packages)for(const s of p.skills)expect(flags).toContainEqual({path:s.projectionPath,enabled:false});for(const s of snapshot.standardSkills)expect(flags).toContainEqual({path:s.projectionPath,enabled:true});expect(plan.args.join('\n')).not.toContain('mcp_servers.'+snapshot.mcp.find(m=>m.kind==='applications')!.serverName);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);
 });


 it.each(['skill','native-tool','mcp'] as const)('attributes only the exact native %s collision before publication',async kind=>{
  const snapshot=f.plan('codex'),p=snapshot.packages[0],name=kind==='skill'?'smartdd-session:'+p.skills[0].nativeName:kind==='mcp'?snapshot.mcp.find(m=>m.kind==='applications')!.serverName:snapshot.adapterBinding.nativeToolNames[Object.keys(p.toolContractMajors)[0]],input={command:'/private/version-only',version:'0.162.1',userSkillConfig:[],inventory:[{kind,name,path:'/private/user-owned',ownerStoreId:null,contentHash:null}]};expect([...nativeApplicationConflicts(snapshot,input)].sort()).toEqual((kind==='mcp'?snapshot.packages.map(p=>p.appId):[p.appId]).sort());input.inventory[0].name=name+'-unrelated';expect([...nativeApplicationConflicts(snapshot,input)]).toEqual([]);
 });

  it('requires a callable fixed recovery entry and exact native-version evidence',async()=>{
    const source=bundledAgentAdapters()[0],version='1.0.7';
    const metadata={...source.metadata,version,bridgeRecovery:'supported' as const,configReload:'supported' as const,recoveryRequiresAgentRestart:false,recoveryEntry:'replaceBridge' as const,recoveryEvidence:source.metadata.cliVersions.map(cliVersion=>({cliVersion,baseline:'controlled adapter fixture only'}))};
    const files={...source.files,'index.cjs':Buffer.from(source.files['index.cjs'].toString().replace("exports.version = '1.0.0'",`exports.version = '${version}'`))};
    const missing=await f.adapters.install(metadata,files);
    expect(()=>f.adapters.recovery(missing.hash,metadata.cliVersions[0])).toThrow('已验证入口');
    const readyVersion='1.0.8',ready=await f.adapters.install({...metadata,version:readyVersion},{...files,'index.cjs':Buffer.from(files['index.cjs'].toString().replace(`exports.version = '${version}'`,`exports.version = '${readyVersion}'`)+"\nexports.replaceBridge = async function(request) { if (request.signal.aborted) throw new Error('aborted'); };\n")});
    const descriptor=f.adapters.recovery(ready.hash,metadata.cliVersions[0]);expect(descriptor.capability).toBe('supported');expect(descriptor.replace).toBeTypeOf('function');
    expect(f.adapters.recovery(ready.hash,'99.99.99')).toEqual({capability:'unverified'});
    const controller=new AbortController();controller.abort();
    await expect(descriptor.replace!({runId:'fixture',serverName:'mail',bridgeInstanceId:'fixture',generation:1,bootstrapPath:'/private/fixture',signal:controller.signal})).rejects.toMatchObject({code:'CANCELED'});
  });
  it('installs complete CJS adapters without replacing one version and retains the old adapter after a new install', async () => {
    const source = bundledAgentAdapters()[0], first = await f.adapters.install(source.metadata,source.files); expect(first.hash).toBe(f.installedAdapters[0].hash);
    const changed = { ...source.files,'planner.cjs': Buffer.from(source.files['planner.cjs'].toString() + '\n// changed\n') }; await expect(f.adapters.install(source.metadata,changed)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const next = await f.adapters.install({ ...source.metadata,version: '1.0.1' },{ ...source.files,'index.cjs': Buffer.from(source.files['index.cjs'].toString().replace("exports.version = '1.0.0'","exports.version = '1.0.1'")) }); expect(next.hash).not.toBe(first.hash); expect(f.adapters.verify(first.hash).hash).toBe(first.hash);
  });
  it('prepares Claude with one stable full plugin and two original MCP keys; child Node mode stays inside MCP JSON', async () => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot), result = f.adapters.plan(snapshot.adapterBinding.hash,input);
    expect(result.args).toEqual(['--plugin-dir',input.pluginRoot,'--mcp-config',join(f.store.root,'runs',snapshot.projectId,snapshot.taskId,input.runId,'mcp.json')]); expect(result.phase).toBe('prepared'); expect(result.bridgeRecovery).toBe('unverified');
    const config = JSON.parse(result.files['mcp.json']); expect(Object.keys(config.mcpServers)).toEqual(snapshot.mcp.map(m => m.serverName)); expect(config.mcpServers[snapshot.mcp[0].serverName].env).toEqual({ ELECTRON_RUN_AS_NODE: '1' }); expect(result.args).not.toContain('ELECTRON_RUN_AS_NODE'); expect(result.args).not.toContain('--strict-mcp-config'); expect(result.args).not.toContain('--setting-sources');
    expect(JSON.parse(readFileSync(join(input.pluginRoot!,'.claude-plugin/plugin.json'),'utf8')).name).toBe('smartdd-session');
  });
  it('changes neither stable projection path nor content when the native ID is first completed', async () => {
    const snapshot = f.plan(), current = await f.sessions.create(snapshot,f.home), first = await f.projector.claude(snapshot.taskId), before = f.snapshotTree(first.root);
    const bound = await f.sessions.bindNativeSession(snapshot.taskId,current.pointer.snapshotHash,{ ...snapshot.native,runner: 'claude-code',sessionId: 'actual-test-native-id' }); const second = await f.projector.claude(snapshot.taskId); expect(second.root).toBe(first.root); expect(second.resource.contentHash).toBe(first.resource.contentHash); expect(f.snapshotTree(second.root)).toEqual(before); expect(bound.snapshot.native.sessionId).toBe('actual-test-native-id');
  });
  it.each(['plugin','skill','mcp','native-tool'] as const)('rejects a colliding user %s without changing its files or renaming the fixed mapping', async kind => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot), path = join(f.root,'user-capability.txt'); writeFileSync(path,'user-owned');
    const name = kind === 'plugin' ? 'smartdd-session' : kind === 'skill' ? snapshot.packages[0].skills[0].nativeName : kind === 'mcp' ? snapshot.mcp[0].serverName : Object.values(snapshot.adapterBinding.nativeToolNames)[0]; input.inventory.push({ kind,name,path,ownerStoreId: null,contentHash: null });
    expect(() => f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('冲突'); expect(readFileSync(path,'utf8')).toBe('user-owned'); expect((await f.sessions.get(snapshot.taskId)).snapshot.adapterBinding.nativeToolNames).toEqual(snapshot.adapterBinding.nativeToolNames);
  });
  it('recognizes its exact existing plugin identity while rejecting a different plugin tree under the same task', async () => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot); input.inventory.push({ kind: 'plugin',name: 'smartdd-session',path: input.pluginRoot!,ownerStoreId: f.store.storeId,contentHash: input.pluginHash }); expect(f.adapters.plan(snapshot.adapterBinding.hash,input).agentId).toBe('claude-code');
    writeFileSync(join(input.pluginRoot!,'skills',snapshot.packages[0].skills[0].nativeName,'references/version.txt'),'changed'); expect(() => f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('内容');
  });
  it('rejects unsupported CLI assumptions, native-root changes, secrets and replacement runtime paths', async () => {
    const snapshot = f.plan(); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot);
    expect(() => f.adapters.plan(snapshot.adapterBinding.hash,{ ...input,cliVersion: '99.0.0' })).toThrow('尚未验证'); expect(() => f.adapters.plan(snapshot.adapterBinding.hash,{ ...input,native: { ...input.native,cwd: f.root } })).toThrow('原生身份');
    expect(() => f.adapters.plan(snapshot.adapterBinding.hash,{ ...input,approved: true } as never)).toThrow('未允许'); const wrong = structuredClone(input); wrong.mcp[0].env.API_KEY = 'not-a-real-secret'; expect(() => f.adapters.plan(snapshot.adapterBinding.hash,wrong)).toThrow('业务桥'); wrong.mcp[0].env = { ELECTRON_RUN_AS_NODE: '1' }; wrong.mcp[0].args[0] = '/some/new/runtime.cjs'; expect(() => f.adapters.plan(snapshot.adapterBinding.hash,wrong)).toThrow('业务桥');
  });
  it('builds Codex complete enable/disable rules and preserves user records including literal punctuation', async () => {
    const snapshot = f.plan('codex'); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot), name = 'smartdd-a-fixture-other-123456789abc', root = join(f.home,'.agents/skills',name), bundle = ownedBundle({ kind: 'codex-agent-projection-v1',nativeName: name,sourceHash: 'a'.repeat(64) },{ 'SKILL.md': Buffer.from('---\nname: '+name+'\ndescription: fixture other\n---\n') }); writeOwnedBundle(root,bundle,f.store.storeId); input.catalog!.entries.push({ resourceId: 'other-fixture',storeId: f.store.storeId,path: join(root,'SKILL.md'),nativeName: name,sourceHash: 'a'.repeat(64),projectionHash: bundle.hash });
    const user = { path: join(f.home,'user skill "quote" ; $(literal)/SKILL.md'),enabled: true,note: 'user stays' }; input.userSkillConfig = [user]; const result = f.adapters.plan(snapshot.adapterBinding.hash,input), overrides = [];
    for (let i=0;i<result.args.length;i++) if (result.args[i] === '-c') overrides.push(parseToml(result.args[++i])); const skillConfig = (overrides.find(o => 'skills' in o)!.skills as { config: unknown[] }).config;
    expect(skillConfig[0]).toEqual(user); expect(skillConfig).toContainEqual({ path: snapshot.packages[0].skills[0].projectionPath,enabled: true }); expect(skillConfig).toContainEqual({ path: join(root,'SKILL.md'),enabled: false }); expect(result.files).toEqual({}); expect(result.args).not.toContain('--add-dir');
    const server = snapshot.mcp[0].serverName; expect(overrides.some(o => Object.hasOwn(o.mcp_servers as object ?? {},server))).toBe(true);
  });
  it('rejects current user override conflicts and missing/moved/tampered Codex projection identities', async () => {
    const snapshot = f.plan('codex'); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot); input.userSkillConfig = [{ path: snapshot.packages[0].skills[0].projectionPath,enabled: false }]; expect(() => f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('启停设置'); input.userSkillConfig = [];
    const old = input.catalog!.entries.pop()!; expect(() => f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('未在完整目录'); input.catalog!.entries.push(old); writeFileSync(old.path,'different Skill'); expect(() => f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('内容');
  });
  it('does not silently infer a catalog or replace a pinned adapter with another installed version', async () => {
    const snapshot = f.plan('codex'); await f.sessions.create(snapshot,f.home); const input = await f.request(snapshot); expect(() => f.adapters.plan(snapshot.adapterBinding.hash,{ ...input,catalog: null })).toThrow('清单尚未核验'); expect(() => f.adapters.plan(f.installedAdapters[0].hash,input)).toThrow('原快照不一致');
  });
  const negativePlatforms: {runner:'claude-code'|'codex';platform:NodeJS.Platform;arch:string}[] = ['claude-code','codex'].flatMap(runner => ([['win32','x64'],['linux','x64'],['darwin','x64']] as const).map(([platform,arch]) => ({runner:runner as 'claude-code'|'codex',platform,arch})));
  it.each(negativePlatforms)('PW rejects the explicit U platform substitute $runner/$platform-$arch without changing the original projection or plan',async({runner,platform,arch})=>{
    const snapshot=f.plan(runner);await f.sessions.create(snapshot,f.home);const input=await f.request(snapshot),before=structuredClone(input),good=f.adapters.plan(snapshot.adapterBinding.hash,input),home=f.snapshotTree(f.home),plugin=input.pluginRoot?f.snapshotTree(input.pluginRoot):null,stored=await f.sessions.get(snapshot.taskId);
    const actualPlatform=Object.getOwnPropertyDescriptor(process,'platform'),actualArch=Object.getOwnPropertyDescriptor(process,'arch');if(!actualPlatform||!actualArch)throw Error('Original process tuple descriptor required');
    try{Object.defineProperty(process,'platform',{...actualPlatform,value:platform});Object.defineProperty(process,'arch',{...actualArch,value:arch});expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('尚未验证');expect(f.adapters.recovery(snapshot.adapterBinding.hash,input.cliVersion)).toEqual({capability:'unverified'});}
    finally{Object.defineProperty(process,'platform',actualPlatform);Object.defineProperty(process,'arch',actualArch);}
    expect(input).toEqual(before);expect(f.snapshotTree(f.home)).toEqual(home);if(input.pluginRoot)expect(f.snapshotTree(input.pluginRoot)).toEqual(plugin);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(stored.snapshot);expect(f.adapters.plan(snapshot.adapterBinding.hash,input)).toEqual(good);
  });
  it.each([['claude-code',''],['claude-code','99.0.0'],['codex',''],['codex','99.0.0']] as const)('PW rejects an absent or future %s CLI version %j without selecting a fallback version',async(runner,cliVersion)=>{
    const snapshot=f.plan(runner);await f.sessions.create(snapshot,f.home);const input=await f.request(snapshot),before=structuredClone(input),original=await f.sessions.get(snapshot.taskId),home=f.snapshotTree(f.home);
    expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,{...input,cliVersion})).toThrow('尚未验证');expect(f.adapters.recovery(snapshot.adapterBinding.hash,cliVersion)).toEqual({capability:'unverified'});expect(input).toEqual(before);expect(f.snapshotTree(f.home)).toEqual(home);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(original.snapshot);expect(f.adapters.plan(snapshot.adapterBinding.hash,input).agentId).toBe(runner);
  });

});
