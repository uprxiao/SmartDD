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
 it('plans explicit independent Codex standards and context without allowing an app bridge or silently accepting an ordinary empty scope',async()=>{
  const snapshot=f.plan('codex');await f.sessions.create(snapshot,f.home);const input=await f.request(snapshot),legacy=input.mcp.filter(m=>m.kind==='legacy-project-context'),safe={...input,independentCapabilities:true as const,applicationScope:[],mcp:legacy};expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,{...input,applicationScope:[]})).toThrow();expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,{...input,applicationScope:[],independentCapabilities:true})).toThrow();const plan=f.adapters.plan(snapshot.adapterBinding.hash,safe),flags=(parseToml(plan.args.find(a=>a.startsWith('skills.config='))!).skills as {config:{path:string;enabled:boolean}[]}).config;for(const p of snapshot.packages)for(const s of p.skills)expect(flags).toContainEqual({path:s.projectionPath,enabled:false});for(const s of snapshot.standardSkills)expect(flags).toContainEqual({path:s.projectionPath,enabled:true});expect(plan.args.join('\n')).not.toContain('mcp_servers.'+snapshot.mcp.find(m=>m.kind==='applications')!.serverName);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);
 });


 it.each(['skill','native-tool','mcp'] as const)('attributes only the exact native %s collision before publication',async kind=>{
  const snapshot=f.plan('codex'),p=snapshot.packages[0],name=kind==='skill'?'smartdd-session:'+p.skills[0].nativeName:kind==='mcp'?snapshot.mcp.find(m=>m.kind==='applications')!.serverName:snapshot.adapterBinding.nativeToolNames[Object.keys(p.toolContractMajors)[0]],input={command:'/private/version-only',version:'0.162.1',userSkillConfig:[],inventory:[{kind,name,path:'/private/user-owned',ownerStoreId:null,contentHash:null}]};expect([...nativeApplicationConflicts(snapshot,input)].sort()).toEqual((kind==='mcp'?snapshot.packages.map(p=>p.appId):[p.appId]).sort());input.inventory[0].name=name+'-unrelated';expect([...nativeApplicationConflicts(snapshot,input)]).toEqual([]);
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
  it('rejects unsupported CLI/platform assumptions, native-root changes, secrets and replacement runtime paths', async () => {
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
});
