import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderInput, RunConfigInput } from '@shared/ai-agents';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AgentService } from './agent-service';
import { migrateAgentProfiles } from './agent-migration';
import { AiProfileService } from './ai-profile-service';
import { createAgentController } from './agent-controller';
import { ProviderService } from './provider-service';
import type { AgentToolService } from './agent-tools';

let sqlite: Database.Database, service: AgentService, legacy: AiProfileService, db: ReturnType<typeof drizzle<typeof schema>>;
let decrypts: number;
let providers: ProviderService;
beforeEach(() => {
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runBundledMigrations(sqlite);
  db = drizzle(sqlite, { schema }); decrypts = 0;
  const secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (value) => Buffer.from(`encrypted:${value}`), decrypt: (value) => { decrypts++; return value.toString().slice(10); } });
  service = new AgentService(db, secrets, () => 1000);
  providers = new ProviderService(db, secrets, service);
  legacy = new AiProfileService(db, secrets, () => 1000);
  service.recordTool({ id: 'claude', kind: 'claude', executable: '/test/claude', installed: true, login: 'api', version: 'test-only' });
  service.recordTool({ id: 'codex', kind: 'codex', executable: '/test/codex', installed: true, login: 'subscription', version: 'test-only' });
});
afterEach(() => sqlite.close());

const provider = (changes: Partial<ProviderInput> = {}): ProviderInput => ({
  name: 'Synthetic provider', preset: 'synthetic-test-only', endpoints: { anthropic: 'https://provider.invalid', responses: 'https://provider.invalid/v1' },
  key: 'PUBLIC_TEST_KEY', models: [{ id: 'm1', name: 'M1', availability: { claude: 'available', codex: 'available' } }, { id: 'm2', name: 'M2' }], ...changes,
});
const config = (providerId: string, changes: Partial<RunConfigInput> = {}): RunConfigInput => ({
  name: 'Claude synthetic', toolId: 'claude', source: 'provider', providerId, models: ['m1'], defaultModel: 'm1', ...changes,
});

it.each(['agent', 'provider'] as const)('notifies task observers after deleting a referenced %s, retaining task history', kind => {
  const p = service.saveProvider(provider()), a = service.saveConfig(config(p.id));
  sqlite.prepare("INSERT INTO tasks(id,cwd,ai_profile_id,ai_profile_name,runner,title,created_at,updated_at) VALUES('observed','/synthetic',?,?, 'claude','original',1,1)").run(a.id, a.name);
  const observations: unknown[] = [];
  const controller = createAgentController(service, {} as AgentToolService, providers, legacy, () => {
    observations.push(sqlite.prepare("SELECT ai_profile_id,ai_profile_name,title FROM tasks WHERE id='observed'").get());
    expect(service.configs().some(c => c.id === a.id)).toBe(false);
  });
  if (kind === 'agent') controller.agents.delete(a.id);
  else expect(controller.agents.deleteProvider(p.id)).toEqual([a.id]);
  expect(observations).toEqual([{ ai_profile_id: null, ai_profile_name: a.name, title: 'original' }]);
  expect(service.providers().some(x => x.id === p.id)).toBe(kind === 'agent');
});

it('does not notify task observers when deletion fails', () => {
  let notifications = 0;
  const controller = createAgentController(service, {} as AgentToolService, providers, legacy, () => notifications++);
  expect(() => controller.agents.delete('missing')).toThrow();
  expect(() => controller.agents.deleteProvider('missing')).toThrow();
  expect(notifications).toBe(0);
});

it('legacy editor keeps runner/path/color and encrypted values, permits legacy duplicate names, and changes only its own visibility',()=>{
  const normal=service.saveConfig(config(service.saveProvider(provider()).id,{name:'Shared name'}));
  const old=legacy.create({name:'Legacy old',runner:'codex',executable:'/test/original-codex',args:['--custom','two words'],color:'#aabbcc',isDefault:false,
    env:[{name:'PUBLIC_LEGACY_KEY',secret:true,value:'PUBLIC_VALUE_ONLY'},{name:'KEEP',secret:false,value:'unchanged'}]});
  migrateAgentProfiles(db);const meta=service.configs().find(c=>c.id===old.id)!;
  service.recordTool({id:meta.toolId,kind:'codex',executable:'/test/original-codex',installed:true,login:'none',version:'test'});
  const before=sqlite.prepare('SELECT key,secret FROM app_secrets ORDER BY key').all();
  const result=legacy.updateLegacy(old.id,{name:'Shared name',args:old.args,env:old.env.map(e=>({name:e.name,secret:e.secret,value:e.secret?undefined:e.value})),homeVisible:false});
  expect(result).toMatchObject({name:'Shared name',runner:old.runner,executable:old.executable,color:old.color,args:old.args});
  expect(result.env).toEqual(old.env);expect(sqlite.prepare('SELECT key,secret FROM app_secrets ORDER BY key').all()).toEqual(before);
  expect(service.configs().find(c=>c.id===old.id)).toMatchObject({source:'legacy',homeVisible:false});
  expect(service.configs().find(c=>c.id===normal.id)).toMatchObject({homeVisible:true,isDefault:true});
});

it('legacy edit and secret replacement roll back together when default visibility is invalid',()=>{
  const old=legacy.create({name:'Old default',runner:'codex',executable:'/test/codex',args:['--unknown'],color:null,isDefault:true,env:[{name:'PUBLIC_KEY',secret:true,value:'PUBLIC_OLD'}]});
  migrateAgentProfiles(db);const meta=service.configs().find(c=>c.id===old.id)!;
  service.recordTool({id:meta.toolId,kind:'codex',executable:'/test/codex',installed:true,login:'none',version:'test'});
  const before=legacy.get(old.id),cipher=sqlite.prepare('SELECT * FROM app_secrets').all();
  expect(()=>legacy.updateLegacy(old.id,{name:'Must roll back',env:[{name:'PUBLIC_KEY',secret:true,value:'PUBLIC_NEW'}],args:['changed'],homeVisible:false})).toThrow('默认');
  expect(legacy.get(old.id)).toEqual(before);expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(cipher);
  expect(service.configs().find(c=>c.id===old.id)?.homeVisible).toBe(true);
});

describe('M13 Provider and RunConfig data', () => {
  it.each([
    {runner:'claude',name:'CC-work',login:'subscription',expected:'Claude Code · 订阅'},
    {runner:'claude',name:'CC-work',login:'api',expected:'Claude Code · API'},
    {runner:'codex',name:'Codex',login:'subscription',expected:'Codex · 订阅'},
    {runner:'claude',name:'My personal CLI',login:'api',expected:'My personal CLI'},
  ] as const)('names migrated known login defaults from actual detection without overwriting custom names ($name/$login)',({runner,name,login,expected})=>{
    const old=legacy.create({name,runner,executable:null,args:[],env:[],isDefault:false,color:null});
    migrateAgentProfiles(db);const config=service.configs().find(c=>c.id===old.id)!;
    expect(config.source).toBe('login');const tool=service.tools().find(t=>t.id===config.toolId)!;
    service.recordTool({...tool,installed:true,login});expect(legacy.get(old.id).name).toBe(expected);
    expect(service.configs().find(c=>c.id===old.id)?.id).toBe(old.id);
  });
  it('keeps keys encrypted and never decrypts for views or presence checks', () => {
    const p = service.saveProvider(provider()); service.saveConfig(config(p.id));
    expect(p.hasKey).toBe(true); expect(JSON.stringify(service.providers())).not.toContain('PUBLIC_TEST_KEY');
    expect(JSON.stringify(service.configs())).not.toContain('PUBLIC_TEST_KEY'); expect(decrypts).toBe(0);
    const raw = sqlite.prepare('SELECT * FROM ai_providers').all(); expect(JSON.stringify(raw)).not.toContain('PUBLIC_TEST_KEY');
    expect((sqlite.prepare('SELECT secret FROM app_secrets').get() as { secret: string }).secret).not.toContain('PUBLIC_TEST_KEY');
  });

  it('revisions identity for endpoint/auth/key replacement, not names/catalog/first key', () => {
    const original = provider({ key: undefined }); const p = service.saveProvider(original);
    expect(p.identityRevision).toBe(1);
    expect(service.saveProvider({ ...original, key: 'FIRST_PUBLIC_KEY' }, p.id).identityRevision).toBe(1);
    expect(service.saveProvider({ ...original, name: 'Renamed' }, p.id).identityRevision).toBe(1);
    expect(service.saveProvider({ ...original, key: 'SECOND_PUBLIC_KEY' }, p.id).identityRevision).toBe(2);
    expect(service.saveProvider({ ...original, endpoints: { responses: 'https://other.invalid' } }, p.id).identityRevision).toBe(3);
    expect(service.saveProvider({ ...original, endpoints: { responses: 'https://other.invalid' }, authType: 'api-key' }, p.id).identityRevision).toBe(4);
    expect(service.saveProvider({ ...original, endpoints: { responses: 'https://other.invalid' }, authType: 'api-key', key: null }, p.id)).toMatchObject({ identityRevision: 5, hasKey: false });
  });

  it('does not share credentials, models or identity revisions between equal endpoint entities', () => {
    const a = service.saveProvider(provider()), b = service.saveProvider(provider({ name: 'Other', key: 'OTHER_PUBLIC_KEY' }));
    service.saveProvider(provider({ key: 'REPLACEMENT' }), a.id);
    expect(service.providers().find((p) => p.id === b.id)).toMatchObject({ identityRevision: 1, hasKey: true });
    const rows = sqlite.prepare('SELECT secret_ref FROM ai_providers').all() as { secret_ref: string }[];
    expect(new Set(rows.map((row) => row.secret_ref)).size).toBe(2);
  });

  it('does not accept credentials embedded in a renderer-visible endpoint', () => {
    expect(() => service.saveProvider(provider({ endpoints: { responses: 'https://provider.invalid/v1?api_key=PUBLIC_TEST' } }))).toThrow('服务地址');
    expect(service.providers()).toEqual([]); expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual([]);
  });

  it('rolls back ciphertext and metadata together when provider metadata cannot be saved', () => {
    const p = service.saveProvider(provider()), before = sqlite.prepare('SELECT * FROM app_secrets').all();
    sqlite.exec("CREATE TRIGGER fail_provider BEFORE UPDATE ON ai_providers BEGIN SELECT RAISE(ABORT, 'synthetic fault'); END");
    expect(() => service.saveProvider(provider({ key: 'NOT_COMMITTED' }), p.id)).toThrow('synthetic fault');
    expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(before);
    expect(service.providers()[0].identityRevision).toBe(1);
  });

  it('enforces normal name/combination uniqueness but legacy is exempt from both', () => {
    sqlite.prepare("INSERT INTO ai_profiles(id,name,runner,created_at,updated_at,env,args) VALUES('old','Shared name','claude',1,1,'invalid','[]')").run();
    migrateAgentProfiles(db); const p = service.saveProvider(provider());
    const a = service.saveConfig(config(p.id, { name: 'Shared name' }));
    expect(() => service.saveConfig(config(p.id, { name: 'Another' }))).toThrow('该组合已有智能体');
    expect(() => service.saveConfig(config(p.id, { name: 'Shared name', toolId: 'codex' }))).toThrow('名称已存在');
    expect(service.configs().filter((row) => row.name === a.name)).toHaveLength(2);
  });

  it('drops unavailable/offline models and selects the first retained model as default', () => {
    const p = service.saveProvider(provider({ models: [
      { id: 'm1', name: 'bad', availability: { claude: 'unavailable', codex: 'available' } },
      { id: 'm2', name: 'retained' }, { id: 'm3', name: 'offline', offline: true },
      { id: 'm4', name: 'protocol-check', availability: { claude: 'available', codex: 'available' } },
    ] }));
    expect(service.saveConfig(config(p.id, { models: ['m1', 'm2', 'm3', 'absent'], defaultModel: 'm1' }))).toMatchObject({ models: ['m2'], defaultModel: 'm2' });
    expect(() => service.saveConfig(config(p.id, { name: 'Codex invalid model', toolId: 'codex', models: ['m3'] }))).toThrow('至少选择一个');
  });

  it('rejects incompatible protocols without creating a profile or changing the default', () => {
    const p = service.saveProvider(provider({ endpoints: { openai: 'https://chat-only.invalid' } }));
    expect(() => service.saveConfig(config(p.id))).toThrow('所需协议');
    expect(service.configs()).toEqual([]); expect(sqlite.prepare('SELECT * FROM ai_profiles').all()).toEqual([]);
  });

  it('keeps the default first and hands over by current visible order without auto-creating configs', () => {
    const p = service.saveProvider(provider());
    const a = service.saveConfig(config(p.id)), b = service.saveConfig(config(p.id, { toolId: 'codex', name: 'Codex synthetic' }));
    const c = service.saveConfig({ name: 'Codex login', toolId: 'codex', source: 'login' });
    service.reorder(c.id, 0); expect(service.configs().map((row) => row.id)).toEqual([a.id, c.id, b.id]);
    service.deleteConfig(a.id); expect(service.configs()[0]).toMatchObject({ id: c.id, isDefault: true });
    expect(() => service.reorder(c.id, 2)).toThrow('固定在第一位');
    expect(() => service.saveConfig({ name: c.name, toolId: 'codex', source: 'login', homeVisible: false }, c.id)).toThrow('不能关闭默认');
    service.recordTool({ id: 'claude', kind: 'claude', executable: '/test/claude', installed: true, login: 'api', version: 'new' });
    expect(service.configs()).toHaveLength(2);
  });

  it('updates existing login state/name, hides logout, and never steals back the default', () => {
    const a = service.saveConfig({ name: 'Codex · 订阅', toolId: 'codex', source: 'login', nameCustomized: false });
    const p = service.saveProvider(provider()); const b = service.saveConfig(config(p.id));
    service.recordTool({ id: 'codex', kind: 'codex', executable: '/test/codex', installed: true, login: 'none', version: 'test' });
    expect(service.configs().find((row) => row.id === a.id)).toMatchObject({ homeVisible: false, loggedOut: true });
    expect(service.configs()[0]).toMatchObject({ id: b.id, isDefault: true });
    service.recordTool({ id: 'codex', kind: 'codex', executable: '/test/codex', installed: true, login: 'api', version: 'test' });
    expect(service.configs().find((row) => row.id === a.id)).toMatchObject({ name: 'Codex · API', homeVisible: true, loggedOut: false, isDefault: false });
    expect(service.configs()[0].id).toBe(b.id);
  });

  it('deletes a provider/config but retains task launch metadata and keeps other sources intact', () => {
    const p = service.saveProvider(provider()), a = service.saveConfig(config(p.id));
    service.saveConfig({ name: 'Codex login', toolId: 'codex', source: 'login' });
    sqlite.prepare("INSERT INTO tasks(id,cwd,ai_profile_id,ai_profile_name,runner,title,created_at,updated_at) VALUES('t','/synthetic',?,?, 'claude','original',1,1)").run(a.id, a.name);
    expect(service.deleteProvider(p.id)).toEqual([a.id]);
    expect(sqlite.prepare('SELECT ai_profile_id,ai_profile_name FROM tasks').get()).toEqual({ ai_profile_id: null, ai_profile_name: a.name });
    expect(service.configs()[0]).toMatchObject({ name: 'Codex login', isDefault: true });
    expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual([]);
  });

  it('does not delete a migrated Provider key when only its RunConfig is deleted', () => {
    sqlite.prepare("INSERT INTO ai_profiles(id,name,runner,env,args,created_at,updated_at) VALUES('m','Migrated','claude',?, '[]',1,1)").run(JSON.stringify([
      { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://m.invalid' },
      { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: null }, { name: 'ANTHROPIC_MODEL', secret: false, value: 'm1' },
    ]));
    sqlite.prepare("INSERT INTO app_secrets VALUES('ai:m:env:ANTHROPIC_AUTH_TOKEN','UNCHANGED_CIPHERTEXT')").run();
    migrateAgentProfiles(db); service.deleteConfig('m');
    expect(service.providers()[0].hasKey).toBe(true);
    expect(sqlite.prepare('SELECT secret FROM app_secrets').get()).toEqual({ secret: 'UNCHANGED_CIPHERTEXT' });
  });

  it('prevents old CRUD/launch interfaces from bypassing migrated Provider identity and ownership', () => {
    const profile = legacy.create({ name: 'Old provider', runner: 'claude', executable: null, args: [], color: null, isDefault: true, env: [
      { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://old.invalid' },
      { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'OLD_PUBLIC_KEY' }, { name: 'ANTHROPIC_MODEL', secret: false, value: 'm1' },
    ] });
    migrateAgentProfiles(db); const providerBefore = service.providers()[0], secretsBefore = sqlite.prepare('SELECT * FROM app_secrets').all();
    expect(() => legacy.update(profile.id, { name: 'Bypass', runner: 'claude', executable: null, args: [], env: [], color: null, isDefault: false })).toThrow('智能体页面');
    expect(() => legacy.resolve(profile.id)).toThrow('智能体运行入口');
    expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(secretsBefore); expect(service.providers()[0].identityRevision).toBe(providerBefore.identityRevision);
    legacy.delete(profile.id); expect(service.providers()[0].hasKey).toBe(true);
    expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(secretsBefore);
  });

  it('does not clear shell login credentials for a migrated native-login profile', () => {
    const profile = legacy.create({ name: 'Old login', runner: 'claude', executable: null, args: [], color: null, isDefault: true, env: [] });
    migrateAgentProfiles(db); expect(legacy.resolve(profile.id)).toMatchObject({ env: {}, isolatePrefixes: [] });
  });

  it('publishes a complete startup scan before selecting a replacement default', () => {
    const a = legacy.create({ name: 'Old Claude', runner: 'claude', executable: null, args: [], color: null, isDefault: false, env: [] });
    const b = legacy.create({ name: 'Old Codex', runner: 'codex', executable: null, args: [], color: null, isDefault: true, env: [] });
    migrateAgentProfiles(db); const rows = service.configs();
    service.recordTools([
      { id: rows.find((row) => row.id === a.id)!.toolId, kind: 'claude', executable: '/test/claude', installed: true, login: 'api', version: 'test' },
      { id: rows.find((row) => row.id === b.id)!.toolId, kind: 'codex', executable: '/test/codex', installed: true, login: 'subscription', version: 'test' },
    ]);
    expect(service.configs()[0]).toMatchObject({ id: b.id, isDefault: true });
  });
});

it('stores only the permitted key suffix on explicit save without decrypting on list; metadata edits keep it and clearing removes it',()=>{
 const saved=service.saveProvider(provider({key:'PUBLIC-TAIL-1234'}));expect(saved.keyHint).toBe('1234');
 const reads=decrypts;expect(service.providers()[0].keyHint).toBe('1234');expect(decrypts).toBe(reads);
 expect(service.saveProvider({...provider(),key:undefined,name:'Renamed suffix'},saved.id).keyHint).toBe('1234');
 expect(service.saveProvider({...provider(),key:null,name:'Renamed suffix'},saved.id).keyHint).toBeNull();
 expect(JSON.stringify(service.providers())).not.toContain('PUBLIC-TAIL-1234');
});
it('never reveals an entire short key as its masked suffix',()=>{
 const saved=service.saveProvider(provider({key:'1234'}));expect(saved.hasKey).toBe(true);expect(saved.keyHint).toBeNull();expect(Object.keys(saved)).not.toContain('key');
});
