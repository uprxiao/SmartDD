import { parse as parseToml } from 'smol-toml';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInput, RunConfigInput } from '@shared/ai-agents';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore, type SecretCipher } from '../../secrets';
import type { SpawnOptions } from '../../pty-manager';
import { VALUE_PREFIX } from '../../launch-env';
import { ProjectService } from '../projects/project-service';
import { TaskService, type PtyHost } from '../tasks/task-service';
import { AgentService } from './agent-service';
import { AgentRuntimeService } from './agent-runtime';
import { AiProfileService } from './ai-profile-service';
import { ProviderService } from './provider-service';
import { migrateAgentProfiles } from './agent-migration';
import {CapabilityRegistryService} from '../capabilities/capability-registry';
import {SkillProjectionService} from '../capabilities/skill-projection';

// No real child, CLI, HTTP listener or daily login material is used by this suite.
const OWN_ROOT = process.env.WILLYOU_AI_RUNTIME_TEST_TMP ?? tmpdir();
const KEY_A = 'P1_PUBLIC_RUNTIME_KEY_A';
const KEY_B = 'P1_PUBLIC_RUNTIME_KEY_B';
const KEY_REPLACED = 'P1_PUBLIC_RUNTIME_REPLACED_KEY';
const MODEL_A = 'p1-runtime-a', MODEL_B = 'p1-runtime-b', MODEL_C = 'p1-runtime-c';
const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`P1-CIPHER:${[...plain].reverse().join('')}`),
  decrypt: (bytes) => [...bytes.toString().slice('P1-CIPHER:'.length)].reverse().join(''),
};
class FakePtys extends EventEmitter implements PtyHost {
  spawned: SpawnOptions[] = [];
  killed: string[] = [];
  active = new Set<string>();
  spawn(options: SpawnOptions): string {
    this.spawned.push(options);
    const id = `p1-fake-pty-${this.spawned.length}`;
    this.active.add(id); return id;
  }
  kill(id: string): void {
    this.killed.push(id); this.active.delete(id); this.emit('exit', id, 0);
  }
  get last(): SpawnOptions { return this.spawned[this.spawned.length - 1]; }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const directoryResponse = () => new Response(JSON.stringify({ data: [MODEL_A, MODEL_B, MODEL_C].map(id => ({ id, name: id })) }), { headers: { 'content-type': 'application/json' } });
function toolResponse(kind: 'claude' | 'codex') {
  const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`;
  const item = {type:'function_call',name:'wy_ping',call_id:'p1-synthetic',arguments:'{}'};
  const body = kind === 'claude' ? event('message_start',{}) + event('content_block_start',{index:0,content_block:{type:'tool_use',id:'p1-synthetic',name:'wy_ping',input:{}}}) + event('content_block_stop',{index:0}) + event('message_stop',{}) : event('response.created',{}) + event('response.output_item.done',{item}) + event('response.completed',{response:{status:'completed',output:[item]}});
  return new Response(body,{headers:{'content-type':'text/event-stream'}});
}
const providerInput = (changes: Partial<ProviderInput> = {}): ProviderInput => ({
  name: 'P1 Provider A', endpoints: { anthropic: 'http://127.0.0.1:1/p1-A', responses: 'http://127.0.0.1:1/p1-A/v1' },
  key: KEY_A, models: [MODEL_A, MODEL_B, MODEL_C].map(id => ({ id, name: id })), ...changes,
});
function injected(options: SpawnOptions, name: string): string | undefined {
  return options.env?.[VALUE_PREFIX + name] ?? options.env?.[name];
}
function option(options: SpawnOptions, flag: string): string | undefined {
  const at = options.args.indexOf(flag); return at === -1 ? undefined : options.args[at + 1];
}

let sqlite: Database.Database, db: ReturnType<typeof drizzle<typeof schema>>;
let root: string, home: string, userData: string, cwd: string;
let ptys: FakePtys, agents: AgentService, profiles: AiProfileService, providers: ProviderService;
let runtime: AgentRuntimeService, tasks: TaskService, project: ReturnType<ProjectService['createProject']>;
let tools: { refresh: ReturnType<typeof vi.fn> };
let fetches: { url: string; headers: Headers }[];
let syntheticFetch: typeof fetch;
let base: Record<string, string>;
let permissionPreferences:{selected:'ask'|'auto'|'full';fullConfirmed:boolean};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Uninjected network forbidden'); }));
  root = realpathSync(mkdtempSync(join(OWN_ROOT, 'fixture-')));
  home = join(root, 'home'); userData = join(root, 'userdata'); cwd = join(root, 'project');
  [home, userData, cwd].forEach(path => mkdirSync(path));
  base = { HOME: home, PATH: '/P1_NO_REAL_CLI',
    ANTHROPIC_AUTH_TOKEN: 'P1_PUBLIC_INHERITED_TOKEN', ANTHROPIC_API_KEY: 'P1_PUBLIC_INHERITED_KEY',
    CLAUDE_CODE_OAUTH_TOKEN: 'P1_PUBLIC_INHERITED_OAUTH', CLAUDE_CODE_USE_BEDROCK: '1',
    OPENAI_API_KEY: 'P1_PUBLIC_INHERITED_OPENAI', CLAUDECODE: '1' };
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runBundledMigrations(sqlite);
  db = drizzle(sqlite, { schema }); const secrets = new SecretsStore(db, cipher);
  agents = new AgentService(db, secrets); profiles = new AiProfileService(db, secrets);
  agents.recordTools([
    { id: 'claude', kind: 'claude', executable: '/P1_FAKE_CLI/claude', version: 'P1-synthetic', installed: true, login: 'api' },
    { id: 'codex', kind: 'codex', executable: '/P1_FAKE_CLI/codex', version: 'P1-synthetic', installed: true, login: 'subscription' },
  ]);
  fetches = [];
  syntheticFetch = vi.fn(async (url, init) => {
    fetches.push({ url: String(url), headers: new Headers(init?.headers) });
    return init?.method === 'POST' ? toolResponse(new Headers(init.headers).has('anthropic-beta') ? 'claude' : 'codex') : directoryResponse();
  });
  providers = new ProviderService(db, secrets, agents, { fetch: (...args) => syntheticFetch(...args) });
  tools = { refresh: vi.fn(async () => undefined) };
  permissionPreferences={selected:'ask',fullConfirmed:true}; // Explicit prior confirmation fixture, not a production default.
  runtime = new AgentRuntimeService({ db, agents, tools: tools as never, providers, profiles, userData, baseEnv: () => ({ ...base }),permissionPreferences:()=>permissionPreferences });
  const projects = new ProjectService(db, secrets); project = projects.createProject({ name: 'P1 synthetic runtime', aliases: [], description: '', rulesPath: null }, [{ label: 'P1', path: cwd }]);
  ptys = new FakePtys();
  tasks = new TaskService({ db, ptys, profiles, agentRuns: runtime, projects, baseEnv: () => ({ ...base }), onChanged: () => undefined, codexPollMs: 20, healthPollMs: 20 });
});
afterEach(() => {
  for (const task of tasks.list()) tasks.kill(task.id);
  tasks.dispose();
  expect(ptys.active.size).toBe(0);
  sqlite.close(); rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function setup(changes: Partial<RunConfigInput> = {}, providerChanges: Partial<ProviderInput> = {}) {
  const provider = providers.save(providerInput(providerChanges));
  await providers.check(provider.id, changes.toolId === 'codex' ? 'codex' : 'claude', MODEL_A);
  fetches.length = 0;
  const config = agents.saveConfig({ name: 'P1 Claude A', toolId: 'claude', source: 'provider', providerId: provider.id, models: [MODEL_A, MODEL_B, MODEL_C], defaultModel: MODEL_A, ...changes });
  return { provider, config };
}
const create = (configId: string, permission: 'ask' | 'auto' | 'full' = 'ask', launchToken?: string) => tasks.create({ projectId: project.id, dirId: null, aiProfileId: configId, permission, firstMessage: 'P1 synthetic TaskService boundary', ...(launchToken ? { launchToken } : {}) });
it('launches a manual-model task after endpoint preflight without depending on its broken directory',async()=>{
  const {config}=await setup({}, {models:[MODEL_A,MODEL_B,MODEL_C].map(id=>({id,name:id,catalogSource:'manual'}))});
  vi.mocked(syntheticFetch).mockImplementation(async(url,init)=>{
    fetches.push({url:String(url),headers:new Headers(init?.headers)});
    expect(init?.method).toBe('POST');expect(init?.body).toBe('{}');
    expect(String(url)).not.toContain('models');
    return new Response(JSON.stringify({error:{type:'invalid_request_error'}}),{status:400,headers:{'content-type':'application/json'}});
  });
  const result=await create(config.id);
  expect(ptys.spawned).toHaveLength(1);
  expect(injected(ptys.last,'ANTHROPIC_AUTH_TOKEN')).toBe(KEY_A);
  expect(option(ptys.last,'--model')).toBe(MODEL_A);
  expect(runtime.snapshot(result.task.id)?.model).toBe(MODEL_A);
  expect(fetches).toHaveLength(1);
});
it('passes the actual managed project Skill plugin through TaskService into owned PTY argv and records preparation separately from loading',async()=>{
  const source=join(cwd,'.agents/skills/project-echo');mkdirSync(source,{recursive:true});writeFileSync(join(source,'SKILL.md'),'---\nname: project-echo\ndescription: public synthetic\n---\n');
  const registry=new CapabilityRegistryService(db,()=>[{runner:'codex',cwd,home,stateRoot:join(home,'.codex'),path:'',projectRoot:cwd}]);registry.scan();const id=registry.adoptAll().items.find(x=>x.name==='project-echo')!.id;
  const skills=new SkillProjectionService(db,registry);tasks.dispose();
  runtime=new AgentRuntimeService({db,agents,tools:tools as never,providers,profiles,userData,baseEnv:()=>({...base}),permissionPreferences:()=>permissionPreferences,skills});
  const projectService=new ProjectService(db,new SecretsStore(db,cipher));tasks=new TaskService({db,ptys,profiles,agentRuns:runtime,projects:projectService,baseEnv:()=>({...base}),onChanged:()=>undefined});
  const {config}=await setup();const {task}=await create(config.id);
  expect(runtime.snapshot(task.id)?.managedSkills).toEqual({configured:[id],issues:[]});expect(JSON.stringify(ptys.spawned.at(-1))).toContain('--plugin-dir');
  expect(readFileSync(join(source,'SKILL.md'),'utf8')).toContain('public synthetic');expect(runtime.snapshot(task.id)?.stateRoot).not.toBe(join(home,'.claude'));
});
function writeHistory(taskId: string) {
  const snapshot = runtime.snapshot(taskId)!;
  const folder = join(snapshot.stateRoot, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(folder, { recursive: true }); const file = join(folder, `${taskId}.jsonl`);
  writeFileSync(file, [
    { type: 'assistant', requestedModel: MODEL_A },
    { type: 'assistant', requestedModel: MODEL_B, message: { model: 'p1-response-alias' } },
    { type: 'assistant', isSidechain: true, requestedModel: MODEL_C },
    { type: 'assistant', isApiErrorMessage: true, requestedModel: MODEL_C },
    { type: 'user', message: { content: `requestedModel=${MODEL_C}` } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  return file;
}
function stoppedHistory(configId: string, permission: 'ask' | 'full' = 'ask') {
  return create(configId, permission).then(opened => {
    const file = writeHistory(opened.task.id); tasks.kill(opened.task.id);
    expect(tasks.get(opened.task.id).recovery).toBe('resumable');
    return { opened, file };
  });
}
function taskRow(id: string) { return sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id); }
function assertNoPlaintextPersisted() {
  const dump = JSON.stringify(['tasks', 'ai_task_snapshots', 'ai_profiles', 'ai_providers', 'ai_run_configs', 'app_secrets'].map(table => sqlite.prepare(`SELECT * FROM ${table}`).all()));
  for (const key of [KEY_A, KEY_B, KEY_REPLACED]) expect(dump).not.toContain(key);
}

describe('AgentRuntimeService through actual TaskService software lifecycle', () => {
  function legacy(){
    const row=profiles.create({name:'P1 opaque route',runner:'claude',executable:'/P1_FAKE_CLI/legacy',isDefault:false,color:null,args:['--max-turns','7','--permission-mode','bypassPermissions'],env:[{name:'PUBLIC_CUSTOM_FLAG',secret:false,value:'KEEP'},{name:'ANTHROPIC_AUTH_TOKEN',secret:true,value:KEY_A}]});
    migrateAgentProfiles(db);const config=agents.configs().find(c=>c.id===row.id)!;expect(config.source).toBe('legacy');
    agents.recordTool({...agents.tools().find(t=>t.id===config.toolId)!,installed:true,version:'P1-synthetic'});return row;
  }
  it('manages a new legacy run with an explicit permission snapshot while preserving saved args/env/ciphertext',async()=>{
    const row=legacy(),before=profiles.get(row.id),cipherBefore=sqlite.prepare('SELECT * FROM app_secrets').all();
    const opened=await create(row.id,'ask'),snapshot=runtime.snapshot(opened.task.id)!;
    expect(snapshot.identity).toMatchObject({source:'legacy',configId:row.id});expect(snapshot.identity.legacyRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.permission).toEqual({id:'ask',args:['--permission-mode','default']});
    expect(option(ptys.last,'--permission-mode')).toBe('default');expect(option(ptys.last,'--max-turns')).toBe('7');expect(injected(ptys.last,'PUBLIC_CUSTOM_FLAG')).toBe('KEEP');expect(injected(ptys.last,'ANTHROPIC_AUTH_TOKEN')).toBe(KEY_A);
    expect(ptys.last.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();expect(ptys.last.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();expect(ptys.last.scriptArgs).toEqual(expect.arrayContaining(['-x','CLAUDE_CODE_OAUTH_TOKEN']));
    expect(profiles.get(row.id)).toEqual(before);expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(cipherBefore);
    expect(JSON.stringify(snapshot)).not.toContain(KEY_A);expect(JSON.stringify(snapshot)).not.toContain('PUBLIC_CUSTOM_FLAG');
  });
  it('resumes a recorded legacy run with its original permission and exact native model instead of current home choice',async()=>{
    const row=legacy(),{opened}=await stoppedHistory(row.id,'full');permissionPreferences={selected:'ask',fullConfirmed:true};
    expect(tasks.agentResumePreview(opened.task.id)).toMatchObject({sourceChanged:false,model:{model:MODEL_B,changed:false}});
    await tasks.open({taskId:opened.task.id});expect(option(ptys.last,'--permission-mode')).toBe('bypassPermissions');expect(option(ptys.last,'--model')).toBe(MODEL_B);expect(runtime.snapshot(opened.task.id)?.permission.id).toBe('full');
  });
  it('rejects a changed legacy encrypted identity until the user explicitly reconfirms its current preview',async()=>{
    const row=legacy(),{opened}=await stoppedHistory(row.id);profiles.updateLegacy(row.id,{name:row.name,homeVisible:true,args:row.args,env:[{name:'PUBLIC_CUSTOM_FLAG',secret:false,value:'KEEP'},{name:'ANTHROPIC_AUTH_TOKEN',secret:true,value:KEY_REPLACED}]});
    const preview=tasks.agentResumePreview(opened.task.id)!;expect(preview.sourceChanged).toBe(true);
    await expect(tasks.open({taskId:opened.task.id})).rejects.toThrow('来源');expect(ptys.spawned).toHaveLength(1);
    await tasks.open({taskId:opened.task.id,aiProfileId:row.id,sourceConfirmation:preview.current});expect(injected(ptys.last,'ANTHROPIC_AUTH_TOKEN')).toBe(KEY_REPLACED);
  });
  it('refuses ambiguous legacy permissions and unconfirmed full before any new fork or fake snapshot',async()=>{
    const row=legacy();permissionPreferences={selected:'full',fullConfirmed:false};await expect(create(row.id,'full')).rejects.toThrow('首次使用完全访问');
    profiles.updateLegacy(row.id,{name:row.name,homeVisible:true,args:['--settings','PUBLIC_SENSITIVE_NOT_ECHOED'],env:[]});
    await expect(create(row.id,'ask')).rejects.toThrow('权限边界');expect(ptys.spawned).toHaveLength(0);expect(tasks.list()).toEqual([]);expect(sqlite.prepare('SELECT * FROM ai_task_snapshots').all()).toEqual([]);
  });
  it('distinguishes unrecorded historical permissions from a valid earlier M13 permission snapshot',async()=>{
    const {config}=await setup();const first=await stoppedHistory(config.id,'full');
    const stored=runtime.snapshot(first.opened.task.id)!;delete stored.permissionSource;runtime.save(first.opened.task.id,stored);
    permissionPreferences={selected:'ask',fullConfirmed:true};await tasks.open({taskId:first.opened.task.id});
    expect(runtime.snapshot(first.opened.task.id)).toMatchObject({permission:{id:'full'},permissionSource:'created'});
    tasks.kill(first.opened.task.id);
    sqlite.prepare('DELETE FROM ai_task_snapshots WHERE task_id=?').run(first.opened.task.id);
    const preview=tasks.agentResumePreview(first.opened.task.id)!;
    await tasks.open({taskId:first.opened.task.id,aiProfileId:config.id,sourceConfirmation:preview.current});
    expect(runtime.snapshot(first.opened.task.id)).toMatchObject({permission:{id:'ask'},permissionSource:'unrecorded-history'});
  });
  it.each(['replaced-key','wrong-target','unrecorded-history'] as const)('pins the previewed source even when explicitly switching to a different Agent (%s)',async change=>{
    const a=await setup(),b=await setup({name:'P1 pinned target'},{name:'P1 pinned Provider',key:KEY_B,endpoints:{anthropic:'http://127.0.0.1:1/p1-pinned'}});
    const {opened}=await stoppedHistory(a.config.id),before=taskRow(opened.task.id),snapshot=runtime.snapshot(opened.task.id);
    if(change==='unrecorded-history')sqlite.prepare('DELETE FROM ai_task_snapshots WHERE task_id=?').run(opened.task.id);
    const recorded=runtime.snapshot(opened.task.id);
    const preview=tasks.agentResumePreview(opened.task.id,b.config.id)!;
    if(change!=='wrong-target')providers.save(providerInput({name:b.provider.name,key:KEY_REPLACED,endpoints:b.provider.endpoints}),b.provider.id);
    const confirmation=change==='wrong-target'?snapshot!.identity:preview.current;
    await expect(tasks.open({taskId:opened.task.id,aiProfileId:b.config.id,sourceConfirmation:confirmation})).rejects.toThrow('来源');
    expect(ptys.spawned).toHaveLength(1);expect(taskRow(opened.task.id)).toEqual(before);expect(runtime.snapshot(opened.task.id)).toEqual(recorded);
  });
  it('requires the first full-access confirmation and derives omitted permission from the remembered preference',async()=>{
    const {config}=await setup();permissionPreferences={selected:'full',fullConfirmed:false};
    await expect(tasks.create({projectId:project.id,dirId:null,aiProfileId:config.id,firstMessage:'synthetic'})).rejects.toThrow('首次使用完全访问');
    expect(ptys.spawned).toHaveLength(0);permissionPreferences.fullConfirmed=true;
    const opened=await tasks.create({projectId:project.id,dirId:null,aiProfileId:config.id,firstMessage:'synthetic'});
    expect(runtime.snapshot(opened.task.id)?.permission.id).toBe('full');
  });
  it('creates managed Claude files, per-run inputs and durable secret-free AI snapshot without a capabilities runtime', async () => {
    const { provider, config } = await setup();
    const nativeRoot = join(home, '.claude'); mkdirSync(nativeRoot); const nativeFile = join(nativeRoot, 'settings.json'); writeFileSync(nativeFile, 'P1_NATIVE_CONFIG_UNTOUCHED');
    const original = statSync(nativeFile);
    const opened = await create(config.id);
    expect(ptys.last.command).toBe('/P1_FAKE_CLI/claude');
    expect(option(ptys.last, '--permission-mode')).toBe('default'); expect(option(ptys.last, '--model')).toBe(MODEL_A);
    expect(option(ptys.last, '--setting-sources')).toBe('user'); expect(option(ptys.last, '--add-dir')).toBe(cwd); expect(ptys.last.args).toContain('--strict-mcp-config');
    const snapshot = runtime.snapshot(opened.task.id)!;
    expect(snapshot.identity).toMatchObject({ configId: config.id, providerId: provider.id, providerRevision: 1, source: 'provider' });
    expect(snapshot).toMatchObject({providerName:provider.name,defaultModel:MODEL_A,models:[MODEL_A,MODEL_B,MODEL_C],toolVersion:'P1-synthetic'});
    expect(snapshot.permission).toEqual({ id: 'ask', args: ['--permission-mode', 'default'] }); expect(snapshot.model).toBe(MODEL_A);
    expect(snapshot.stateRoot).toContain(join(userData, 'agents', 'claude'));
    const settings = JSON.parse(readFileSync(join(snapshot.stateRoot, 'settings.json'), 'utf8'));
    expect(settings.modelPicker).toEqual({ options: [MODEL_A, MODEL_B, MODEL_C].map(model => ({ model, label: model })), replaceBuiltInOptions: true });
    expect(settings.skipDangerousModePermissionPrompt).toBeUndefined(); expect(settings.env).toBeUndefined();
    expect(injected(ptys.last, 'ANTHROPIC_AUTH_TOKEN')).toBe(KEY_A); expect(ptys.last.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(ptys.last.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined(); expect(ptys.last.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(ptys.last.scriptArgs).toEqual(expect.arrayContaining(['-x', 'CLAUDE_CODE_OAUTH_TOKEN']));
    expect(readFileSync(nativeFile, 'utf8')).toBe('P1_NATIVE_CONFIG_UNTOUCHED'); expect(statSync(nativeFile).mtimeMs).toBe(original.mtimeMs);
    expect(JSON.stringify(settings)).not.toContain(KEY_A); assertNoPlaintextPersisted(); expect(tools.refresh).toHaveBeenCalledTimes(1);
    expect(fetches[0].headers.get('Authorization')).toBe(`Bearer ${KEY_A}`); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('creates Codex catalog and actual PTY provider/model/permission arguments without touching default config', async () => {
    const { config } = await setup({ toolId: 'codex', name: 'P1 Codex A' });
    const native = join(home, '.codex'); mkdirSync(native); writeFileSync(join(native, 'config.toml'), 'model="P1_KEEP"\n');
    const opened = await create(config.id, 'auto'), args = ptys.last.args;
    expect(args).toContain('--approve-for-me'); expect(option(ptys.last, '-m')).toBe(MODEL_A);
    expect(args).toEqual(expect.arrayContaining(['--disable', 'plugins', 'shell_snapshot', 'analytics.enabled=false']));
    const catalogArg = args.find(value => value.startsWith('model_catalog_json='))!;
    const catalog = JSON.parse(readFileSync(JSON.parse(catalogArg.slice(catalogArg.indexOf('=') + 1)), 'utf8'));
    expect(catalog.models.map((item: { slug: string }) => item.slug)).toEqual([MODEL_A, MODEL_B, MODEL_C]);
    expect(injected(ptys.last, 'OPENAI_API_KEY')).toBe(KEY_A); expect(args.join(' ')).not.toContain(KEY_A);
    expect(runtime.snapshot(opened.task.id)?.permission).toEqual({ id: 'auto', args: ['--approve-for-me'] });
    expect(readFileSync(join(native, 'config.toml'), 'utf8')).toBe('model="P1_KEEP"\n'); assertNoPlaintextPersisted();
  });

  it('resumes exact stopped Claude history with last requestedModel and original permission instead of edited defaults', async () => {
    const { config } = await setup(); const { opened, file } = await stoppedHistory(config.id, 'full'); const original = readFileSync(file);
    agents.saveConfig({ name: 'Renamed only', toolId: 'claude', source: 'provider', providerId: config.providerId, models: [MODEL_A, MODEL_B, MODEL_C], defaultModel: MODEL_C }, config.id);
    await tasks.open({ taskId: opened.task.id });
    expect(option(ptys.last, '--resume')).toBe(opened.task.nativeSessionId); expect(option(ptys.last, '--model')).toBe(MODEL_B);
    expect(option(ptys.last, '--permission-mode')).toBe('bypassPermissions');
    expect(runtime.snapshot(opened.task.id)).toMatchObject({ model: MODEL_B, permission: { id: 'full' } });
    expect(readFileSync(file)).toEqual(original); expect(tasks.get(opened.task.id).nativeSessionId).toBe(opened.task.nativeSessionId);
    assertNoPlaintextPersisted();
  });

  it('requires confirmation before falling back when last native model is no longer selected', async () => {
    const { config } = await setup(); const { opened } = await stoppedHistory(config.id); const before = taskRow(opened.task.id);
    agents.saveConfig({ name: config.name, toolId: 'claude', source: 'provider', providerId: config.providerId, models: [MODEL_A], defaultModel: MODEL_A }, config.id);
    await expect(tasks.open({ taskId: opened.task.id })).rejects.toThrow('确认恢复时的模型');
    expect(ptys.spawned).toHaveLength(1); expect(taskRow(opened.task.id)).toEqual(before);
    await expect(tasks.open({ taskId: opened.task.id, acceptModelChange: true,expectedModel:'stale-preview' })).rejects.toThrow('确认恢复时的模型');
    await tasks.open({ taskId: opened.task.id, acceptModelChange: true,expectedModel:MODEL_A });
    expect(option(ptys.last, '--model')).toBe(MODEL_A); expect(runtime.snapshot(opened.task.id)?.model).toBe(MODEL_A);
  });

  it.each(['key', 'endpoint'] as const)('rejects changed Provider %s identity without reselection and permits explicit current-source restore', async change => {
    const { provider, config } = await setup(); const { opened } = await stoppedHistory(config.id); const before = taskRow(opened.task.id);
    const revised = providers.save(providerInput({ key: change === 'key' ? KEY_REPLACED : undefined,
      ...(change === 'endpoint' ? { endpoints: { anthropic: 'http://127.0.0.1:1/p1-NEW' } } : {}) }), provider.id);
    expect(revised.identityRevision).toBe(2);
    await expect(tasks.open({ taskId: opened.task.id })).rejects.toThrow('来源已变化');
    expect(ptys.spawned).toHaveLength(1); expect(taskRow(opened.task.id)).toEqual(before);
    await expect(tasks.open({ taskId: opened.task.id, aiProfileId: config.id })).rejects.toThrow('来源已变化');
    const preview=tasks.agentResumePreview(opened.task.id,config.id)!;
    expect(preview.sourceChanged).toBe(true);
    await tasks.open({ taskId: opened.task.id, aiProfileId: config.id,sourceConfirmation:preview.current });
    expect(runtime.snapshot(opened.task.id)?.identity.providerRevision).toBe(2);
    expect(option(ptys.last, '--model')).toBe(MODEL_B);
    expect(injected(ptys.last, 'ANTHROPIC_AUTH_TOKEN')).toBe(change === 'key' ? KEY_REPLACED : KEY_A); assertNoPlaintextPersisted();
  });

  it('copies this Claude native session when explicitly changing same-engine config and keeps old source byte-exact', async () => {
    const a = await setup(); const b = await setup({ name: 'P1 Claude B' }, { name: 'P1 Provider B', key: KEY_B, endpoints: { anthropic: 'http://127.0.0.1:1/p1-B' } });
    const { opened, file } = await stoppedHistory(a.config.id, 'full'), original = readFileSync(file);
    const tree = join(file.slice(0, -'.jsonl'.length), 'subagents'); mkdirSync(tree, { recursive: true }); writeFileSync(join(tree, 'p1-child.jsonl'), 'P1_SYNTHETIC_CHILD_ONLY\n');
    await tasks.open({ taskId: opened.task.id, aiProfileId: b.config.id });
    const next = runtime.snapshot(opened.task.id)!;
    expect(next.stateRoot).not.toBe(a.config.id); expect(next.identity.configId).toBe(b.config.id); expect(next.permission.id).toBe('full');
    const destination = join(next.stateRoot, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${opened.task.nativeSessionId}.jsonl`);
    expect(destination).not.toBe(file); expect(readFileSync(destination)).toEqual(original); expect(readFileSync(file)).toEqual(original);
    expect(readFileSync(join(destination.slice(0, -'.jsonl'.length), 'subagents/p1-child.jsonl'), 'utf8')).toBe('P1_SYNTHETIC_CHILD_ONLY\n');
    expect(option(ptys.last, '--resume')).toBe(opened.task.nativeSessionId); expect(option(ptys.last, '--model')).toBe(MODEL_B); expect(injected(ptys.last, 'ANTHROPIC_AUTH_TOKEN')).toBe(KEY_B);
  });

  it('cancels pending tool preflight through actual cancelCreate with zero fork and no running task', async () => {
    const { config } = await setup(), entered = deferred<void>(), release = deferred<void>(), token = randomUUID();
    tools.refresh.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const running = create(config.id, 'ask', token); const rejected = expect(running).rejects.toThrow('取消');
    await entered.promise; expect(tasks.cancelCreate(token)).toBe(true); release.resolve(); await rejected;
    expect(ptys.spawned).toHaveLength(0); expect(tasks.list()).toEqual([]); expect(sqlite.prepare('SELECT * FROM ai_task_snapshots').all()).toEqual([]);
  });

  it('cancels pending Provider refresh with no fork after its synthetic response completes', async () => {
    const { config } = await setup(), entered = deferred<void>(), release = deferred<Response>(), token = randomUUID();
    syntheticFetch = vi.fn(async () => { entered.resolve(); return release.promise; });
    const running = create(config.id, 'ask', token); const rejected = expect(running).rejects.toThrow('取消');
    await entered.promise; expect(tasks.cancelCreate(token)).toBe(true); release.resolve(directoryResponse()); await rejected;
    expect(ptys.spawned).toHaveLength(0); expect(tasks.list()).toEqual([]); expect(sqlite.prepare('SELECT * FROM ai_task_snapshots').all()).toEqual([]);
  });

  it('rolls back task insertion and stops the exact FakePTY when AI snapshot persistence fails', async () => {
    const { config } = await setup();
    sqlite.exec("CREATE TRIGGER p1_snapshot_fail BEFORE INSERT ON ai_task_snapshots BEGIN SELECT RAISE(ABORT,'P1 snapshot storage failure'); END");
    await expect(create(config.id)).rejects.toThrow('P1 snapshot storage failure');
    expect(ptys.spawned).toHaveLength(1); expect(ptys.killed).toEqual(['p1-fake-pty-1']); expect(ptys.active.size).toBe(0);
    expect(sqlite.prepare('SELECT * FROM tasks').all()).toEqual([]); expect(sqlite.prepare('SELECT * FROM ai_task_snapshots').all()).toEqual([]); assertNoPlaintextPersisted();
  });

  it('rolls back resume metadata and stops only the new FakePTY when replacing its AI snapshot fails', async () => {
    const { config } = await setup(); const { opened } = await stoppedHistory(config.id); const before = taskRow(opened.task.id), oldSnapshot = runtime.snapshot(opened.task.id);
    sqlite.exec("CREATE TRIGGER p1_snapshot_update_fail BEFORE UPDATE ON ai_task_snapshots BEGIN SELECT RAISE(ABORT,'P1 snapshot update failure'); END");
    await expect(tasks.open({ taskId: opened.task.id })).rejects.toThrow('P1 snapshot update failure');
    expect(ptys.spawned).toHaveLength(2); expect(ptys.killed).toEqual(['p1-fake-pty-1', 'p1-fake-pty-2']); expect(ptys.active.size).toBe(0);
    expect(taskRow(opened.task.id)).toEqual(before); expect(runtime.snapshot(opened.task.id)).toEqual(oldSnapshot);
  });

  it('runs two different configs concurrently with separate Provider keys, managed roots, files and task snapshots', async () => {
    const a = await setup(); const b = await setup({ name: 'P1 Claude B' }, { name: 'P1 Provider B', key: KEY_B, endpoints: { anthropic: 'http://127.0.0.1:1/p1-B' } });
    const [ta, tb] = await Promise.all([create(a.config.id, 'ask'), create(b.config.id, 'full')]);
    const sa = runtime.snapshot(ta.task.id)!, sb = runtime.snapshot(tb.task.id)!;
    expect(sa.stateRoot).not.toBe(sb.stateRoot); expect(sa.identity.providerId).toBe(a.provider.id); expect(sb.identity.providerId).toBe(b.provider.id);
    const pa = ptys.spawned.find(value => injected(value, 'ANTHROPIC_AUTH_TOKEN') === KEY_A)!, pb = ptys.spawned.find(value => injected(value, 'ANTHROPIC_AUTH_TOKEN') === KEY_B)!;
    expect(pa).toBeDefined(); expect(pb).toBeDefined(); expect(option(pa, '--permission-mode')).toBe('default'); expect(option(pb, '--permission-mode')).toBe('bypassPermissions');
    expect(injected(pa, 'ANTHROPIC_BASE_URL')).toContain('p1-A'); expect(injected(pb, 'ANTHROPIC_BASE_URL')).toContain('p1-B');
    expect(existsSync(join(sa.stateRoot, 'settings.json'))).toBe(true); expect(existsSync(join(sb.stateRoot, 'settings.json'))).toBe(true);
    expect(fetches).toHaveLength(2); expect(new Set(fetches.map(value => value.headers.get('Authorization')))).toEqual(new Set([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]));
    assertNoPlaintextPersisted(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});


describe('Codex global public preference observation',()=>{
  it('records before/after through the owned task exit and never rewrites concurrent native edits',async()=>{
    const native=join(home,'.codex');mkdirSync(native);const file=join(native,'config.toml');
    writeFileSync(file,"# before\nmodel='before-model'\nmodel_reasoning_effort='high'\n");
    const {config:c}=await setup({name:'Observe Codex',toolId:'codex',models:[MODEL_A],defaultModel:MODEL_A});
    const opened=await create(c.id),snap=runtime.snapshot(opened.task.id)!;
    expect(snap.codexGlobal?.before).toEqual({status:'readable',model:'before-model',effort:'high'});
    const edited="# user concurrent change\nmodel='after-model'\nmodel_reasoning_effort='max'\n";writeFileSync(file,edited);const mtime=statSync(file).mtimeMs,mode=statSync(file).mode;
    await tasks.kill(opened.task.id);
    expect(runtime.globalNotices()).toEqual([expect.objectContaining({taskId:opened.task.id,before:expect.objectContaining({model:'before-model'}),after:expect.objectContaining({model:'after-model',effort:'max'}),changed:true})]);
    expect(readFileSync(file,'utf8')).toBe(edited);expect(statSync(file).mtimeMs).toBe(mtime);expect(statSync(file).mode).toBe(mode);
    expect(runtime.globalConfigPath(opened.task.id)).toBe(file);runtime.dismissGlobalNotice(opened.task.id);expect(runtime.globalNotices()).toEqual([]);expect(readFileSync(file,'utf8')).toBe(edited);
  });
  it('reports unreadable TOML without quoting raw content or proposing a false restore',async()=>{
    const native=join(home,'.codex');mkdirSync(native);writeFileSync(join(native,'config.toml'),'model = "PUBLIC_INVALID_SECRET');
    const {config:c}=await setup({name:'Unknown global',toolId:'codex',models:[MODEL_A],defaultModel:MODEL_A});
    const opened=await create(c.id);await tasks.kill(opened.task.id);
    expect(runtime.globalNotices()[0]).toMatchObject({before:{status:'unreadable',model:null,effort:null},after:{status:'unreadable'},changed:true});
    expect(JSON.stringify(runtime.globalNotices())).not.toContain('PUBLIC_INVALID_SECRET');
  });
});

it('discovers managed Claude CLI installations in the actual runtime root without decrypting during scan',async()=>{
 const {config}=await setup();const {managedSourceProfiles}=await import('../capabilities/managed-source-profiles');const {capabilityScanContexts}=await import('../capabilities/scan-contexts');
 const sources=managedSourceProfiles(userData,profiles.list(),agents.configs(),agents.providers());const contexts=capabilityScanContexts(home,base,sources,[cwd]);
 const source=contexts.find(x=>x.configurationId===config.id&&x.runner==='claude'&&x.cwd===cwd)!;expect(source.stateRoot).toContain('/agents/claude/');expect(JSON.stringify(contexts)).not.toContain(KEY_A);
 mkdirSync(join(source.stateRoot,'skills/new-skill'),{recursive:true});writeFileSync(join(source.stateRoot,'skills/new-skill/SKILL.md'),'---\nname: new-skill\ndescription: installed via managed CLI\n---\n');
 const registry=new CapabilityRegistryService(db,()=>contexts);expect(registry.scan().items).toEqual(expect.arrayContaining([expect.objectContaining({name:'new-skill',sourcePath:join(source.stateRoot,'skills/new-skill/SKILL.md')})]));
 const keyName=source.secretEnvNames?.includes('ANTHROPIC_AUTH_TOKEN')?'ANTHROPIC_AUTH_TOKEN':'ANTHROPIC_API_KEY';expect(runtime.sourceEnvironment(config.id)[keyName]).toBe(KEY_A);expect(fetches).toHaveLength(0);expect(ptys.spawned).toHaveLength(0);
});

it('keeps the original Codex native provider identifier configured to the explicitly chosen current provider across repeated same-SID restores', async () => {
  const a = await setup({toolId:'codex',name:'P1 Codex original'});
  const opened = await create(a.config.id, 'ask');
  const firstArgs = [...ptys.last.args];
  const firstProviderArg = firstArgs.find(value=>value.startsWith('model_provider='))!;
  const historicalProvider = JSON.parse(firstProviderArg.slice('model_provider='.length)) as string;
  const SID = randomUUID();
  const now = new Date();
  const day = [String(now.getFullYear()),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')];
  const dir = join(home,'.codex','sessions',...day);mkdirSync(dir,{recursive:true});
  const file = join(dir,`rollout-${Date.now()}-${SID}.jsonl`);
  const raw = [
    {type:'session_meta',payload:{id:SID,cwd,timestamp:new Date().toISOString(),originator:'codex-tui',model_provider:historicalProvider}},
    {type:'turn_context',payload:{model:MODEL_B,approval_policy:'on-request',sandbox_policy:{type:'workspace-write'}}},
  ].map(row=>JSON.stringify(row)).join('\n')+'\n';
  writeFileSync(file,raw);
  await vi.waitFor(()=>expect(tasks.get(opened.task.id).nativeSessionId).toBe(SID),{timeout:1000,interval:20});
  tasks.kill(opened.task.id);expect(tasks.get(opened.task.id).recovery).toBe('resumable');
  const b = await setup({toolId:'codex',name:'P1 Codex chosen'}, {name:'P1 Provider chosen',key:KEY_B,endpoints:{responses:'http://127.0.0.1:1/p1-B/v1'}});
  const bindings = () => {
    const all:Record<string,Record<string,unknown>> = {};
    for(let i=1;i<ptys.last.args.length;i++)if(ptys.last.args[i-1]==='-c'&&ptys.last.args[i].startsWith('model_providers.')){
      const parsed=parseToml(ptys.last.args[i]);Object.assign(all,parsed.model_providers);
    }
    return all;
  };
  // Second restore deliberately has snapshot.configId=B already but native session_meta still A.
  // This catches a fix which aliases only previous host configId rather than original native metadata.
  for(const pass of [1,2]){
    const preview=tasks.agentResumePreview(opened.task.id,b.config.id)!;
    await tasks.open({taskId:opened.task.id,aiProfileId:b.config.id,sourceConfirmation:preview.current});
    expect(ptys.last.args.filter(value=>value.startsWith('model_provider='))).toEqual([`model_provider=${JSON.stringify(historicalProvider)}`]);
    expect(bindings()[historicalProvider],`native original provider must exist on restore ${pass}`).toMatchObject({
      base_url:b.provider.endpoints.responses,wire_api:'responses',env_key:'OPENAI_API_KEY',requires_openai_auth:false,
    });
    expect(injected(ptys.last,'OPENAI_API_KEY')).toBe(KEY_B);
    expect(option(ptys.last,'-m')).toBe(MODEL_B);
    expect(ptys.last.args).toEqual(expect.arrayContaining(['resume',SID]));
    expect(runtime.snapshot(opened.task.id)).toMatchObject({model:MODEL_B,identity:{configId:b.config.id,providerId:b.provider.id},permission:{id:'ask'}});
    expect(tasks.get(opened.task.id).nativeSessionId).toBe(SID);
    expect(readFileSync(file,'utf8')).toBe(raw);
    expect(JSON.stringify(ptys.last.args)).not.toContain(KEY_A);expect(JSON.stringify(ptys.last.args)).not.toContain(KEY_B);assertNoPlaintextPersisted();
    tasks.kill(opened.task.id);
  }
  const stopped=tasks.get(opened.task.id);
  const prepared=await runtime.prepare({profileId:b.config.id,cwd,signal:new AbortController().signal,restore:{
    taskId:stopped.id,runner:'codex',stateRoot:runtime.snapshot(stopped.id)!.stateRoot,sessionId:SID,
    since:stopped.createdAt,recovery:'resumable',explicitlySelected:true,acceptModelChange:false,
  }});
  expect(prepared).not.toBeNull();
  writeFileSync(file,raw.replace(historicalProvider,'willyou_other'));
  expect(()=>prepared!.assertCurrent()).toThrow('供应商记录已变化');
  expect(ptys.spawned).toHaveLength(3);
});
