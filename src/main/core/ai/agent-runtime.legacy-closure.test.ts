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
import { migrateAgentProfiles } from './agent-migration';
import { AgentRuntimeService } from './agent-runtime';
import { AiProfileService } from './ai-profile-service';
import { ProviderService } from './provider-service';

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


function legacyConfig(){
 const profile=profiles.create({name:'Public Legacy B',runner:'claude',executable:'/P1_FAKE_CLI/legacy-claude',env:[{name:'CUSTOM_LEGACY_ROUTE',secret:false,value:'KEEP_ORIGINAL'},{name:'ANTHROPIC_AUTH_TOKEN',secret:true,value:KEY_B},{name:'CLAUDE_CONFIG_DIR',secret:false,value:join(home,'legacy-B-root')}],args:['--max-turns','7'],color:null,isDefault:false});
 migrateAgentProfiles(db);agents.recordTools(agents.tools().map(tool=>({...tool,installed:true})));
 expect(agents.configs().find(c=>c.id===profile.id)?.source).toBe('legacy');return profile;
}
function evidence(name:string,data:unknown){const out=process.env.WILLYOU_LEGACY_TEST_ARTIFACTS;if(out)writeFileSync(join(out,name+'.json'),JSON.stringify(data,null,2));}
it('normal history cannot bypass source confirmation by selecting legacy with the former normal tuple',async()=>{
 const {config}=await setup();const {opened}=await stoppedHistory(config.id);const before=runtime.snapshot(opened.task.id)!;const legacy=legacyConfig(),spawnCount=ptys.spawned.length;
 let error:unknown;let result:unknown;try{result=await tasks.open({taskId:opened.task.id,aiProfileId:legacy.id,sourceConfirmation:before.identity});}catch(e){error=e;}
 evidence('stale-confirmation',{error:String(error),result,spawnCountBefore:spawnCount,spawnCountAfter:ptys.spawned.length,currentSnapshot:runtime.snapshot(opened.task.id)});
 expect(error).toBeInstanceOf(Error);expect(ptys.spawned).toHaveLength(spawnCount);expect(runtime.snapshot(opened.task.id)).toEqual(before);
});
it('normal-to-legacy either refuses safely or publishes a truthful legacy snapshot, never a stale normal account',async()=>{
 const {config}=await setup();const {opened}=await stoppedHistory(config.id);const before=runtime.snapshot(opened.task.id)!,legacy=legacyConfig(),oldRow=taskRow(opened.task.id),spawnCount=ptys.spawned.length;
 let error:unknown;try{await tasks.open({taskId:opened.task.id,aiProfileId:legacy.id});}catch(e){error=e;}
 const snapshot=runtime.snapshot(opened.task.id);evidence('snapshot-truth',{error:String(error),before,after:snapshot,profileId:tasks.get(opened.task.id).aiProfileId,spawnCountBefore:spawnCount,spawnCountAfter:ptys.spawned.length,lastCommand:ptys.last.command,lastArgs:ptys.last.args});
 if(error){expect(ptys.spawned).toHaveLength(spawnCount);expect(taskRow(opened.task.id)).toEqual(oldRow);expect(snapshot).toEqual(before);return;}
 expect(snapshot?.identity).toMatchObject({source:'legacy',configId:legacy.id});expect(snapshot?.identity).not.toEqual(before.identity);expect(tasks.get(opened.task.id).aiProfileId).toBe(legacy.id);
});
