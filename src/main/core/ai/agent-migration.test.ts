import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledMigrations, runBundledMigrations, runMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { migrateAgentProfiles } from './agent-migration';

let sqlite: Database.Database, db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => { sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite); db = drizzle(sqlite, { schema }); });
afterEach(() => sqlite.close());
function old(id: string, runner: string, env = '[]', args = '[]', isDefault = false) {
  sqlite.prepare('INSERT INTO ai_profiles(id,name,runner,env,args,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, id, runner, env, args, Number(isDefault), id.charCodeAt(0), 2);
}
const providerEnv = JSON.stringify([
  { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://old.invalid/anthropic' },
  { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: null }, { name: 'ANTHROPIC_MODEL', secret: false, value: 'model-old' },
]);

describe('M13 old profile metadata migration', () => {
  it('upgrades a genuine pre-M13 schema and can start again without changing the old profile or task', () => {
    sqlite.close(); sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON');
    const migrations = bundledMigrations(), index = migrations.findIndex((migration) => migration.tag === '0032_ai_agent_entities');
    runMigrations(sqlite, migrations.slice(0, index)); db = drizzle(sqlite, { schema });
    old('old', 'claude', providerEnv, '[]', true);
    sqlite.prepare("INSERT INTO app_secrets VALUES('ai:old:env:ANTHROPIC_AUTH_TOKEN','ORIGINAL_OPAQUE_BYTES')").run();
    sqlite.prepare("INSERT INTO tasks(id,cwd,ai_profile_id,ai_profile_name,runner,title,created_at,updated_at) VALUES('t','/synthetic','old','old','claude','original',1,1)").run();
    const profile = sqlite.prepare('SELECT * FROM ai_profiles').all(), task = sqlite.prepare('SELECT * FROM tasks').all();
    expect(runBundledMigrations(sqlite)).toContain('0032_ai_agent_entities');
    expect(migrateAgentProfiles(db).migrated).toEqual(['old']);
    expect(runBundledMigrations(sqlite)).toEqual([]); expect(migrateAgentProfiles(db).skipped).toEqual(['old']);
    expect(sqlite.prepare('SELECT * FROM ai_profiles').all()).toEqual(profile); expect(sqlite.prepare('SELECT * FROM tasks').all()).toEqual(task);
    expect(sqlite.prepare('SELECT secret FROM app_secrets').get()).toEqual({ secret: 'ORIGINAL_OPAQUE_BYTES' });
  });

  it('preserves exact IDs, task FKs, profile bytes and credential references without decrypting', () => {
    old('claude-login', 'claude'); old('provider', 'claude', providerEnv, '[]', true);
    old('codex-login', 'codex', '[]', JSON.stringify(['--model', 'model-old', '-c', 'model_reasoning_effort="high"']));
    old('unknown', 'claude', '[{"name":"UNKNOWN","secret":false,"value":"kept"}]');
    sqlite.prepare("INSERT INTO app_secrets VALUES('ai:provider:env:ANTHROPIC_AUTH_TOKEN','ORIGINAL_OPAQUE_BYTES')").run();
    sqlite.prepare("INSERT INTO tasks(id,cwd,ai_profile_id,ai_profile_name,runner,title,created_at,updated_at) VALUES('t','/synthetic','provider','provider','claude','original',1,1)").run();
    const profiles = sqlite.prepare('SELECT * FROM ai_profiles ORDER BY id').all(), tasks = sqlite.prepare('SELECT * FROM tasks').all(), secrets = sqlite.prepare('SELECT * FROM app_secrets').all();
    expect(migrateAgentProfiles(db)).toMatchObject({ migrated: expect.arrayContaining(['claude-login', 'provider', 'codex-login']), legacy: ['unknown'] });
    expect(sqlite.prepare('SELECT * FROM ai_profiles ORDER BY id').all()).toEqual(profiles);
    expect(sqlite.prepare('SELECT * FROM tasks').all()).toEqual(tasks); expect(sqlite.prepare('SELECT * FROM app_secrets').all()).toEqual(secrets);
    expect(sqlite.prepare('SELECT secret_ref FROM ai_providers').get()).toEqual({ secret_ref: 'ai:provider:env:ANTHROPIC_AUTH_TOKEN' });
    expect(sqlite.prepare('SELECT profile_id FROM ai_run_configs ORDER BY sort_order LIMIT 1').get()).toEqual({ profile_id: 'provider' });
    const migrated = sqlite.prepare('SELECT * FROM ai_run_configs ORDER BY profile_id').all();
    expect(migrateAgentProfiles(db).skipped).toHaveLength(4); expect(sqlite.prepare('SELECT * FROM ai_run_configs ORDER BY profile_id').all()).toEqual(migrated);
    expect(sqlite.prepare('SELECT * FROM ai_providers').all()).toHaveLength(1); expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps damaged JSON and provider-changing Codex options wholly legacy, never guesses login', () => {
    old('broken-env', 'claude', 'broken'); old('broken-args', 'codex', '[]', '{"unexpected":true}');
    old('endpoint-override', 'codex', '[]', '["-c","model_provider=\"third_party\""]');
    old('different-agent', 'custom-agent');
    expect(migrateAgentProfiles(db).legacy).toHaveLength(4);
    expect(sqlite.prepare('SELECT DISTINCT source FROM ai_run_configs').all()).toEqual([{ source: 'legacy' }]);
    expect(sqlite.prepare("SELECT kind FROM ai_tools WHERE executable='custom-agent'").get()).toEqual({ kind: 'custom-agent' });
    expect(sqlite.prepare('SELECT * FROM ai_providers').all()).toEqual([]);
  });

  it('leaves missing/ambiguous credentials and model mappings unchanged as legacy', () => {
    old('missing', 'claude', providerEnv);
    old('ambiguous', 'claude', providerEnv.replace(']', ',{"name":"ANTHROPIC_API_KEY","secret":true,"value":null}]'));
    old('no-model', 'claude', JSON.stringify(JSON.parse(providerEnv).filter((row: { name: string }) => row.name !== 'ANTHROPIC_MODEL')));
    expect(migrateAgentProfiles(db).legacy).toHaveLength(3);
  });

  it('rolls the entire metadata migration back when a later row fails', () => {
    old('a', 'claude'); old('b', 'codex'); const before = sqlite.prepare('SELECT * FROM ai_profiles').all();
    sqlite.exec("CREATE TRIGGER fail_agent BEFORE INSERT ON ai_run_configs WHEN NEW.profile_id='b' BEGIN SELECT RAISE(ABORT, 'synthetic fault'); END");
    expect(() => migrateAgentProfiles(db)).toThrow('synthetic fault');
    expect(sqlite.prepare('SELECT * FROM ai_profiles').all()).toEqual(before);
    for (const name of ['ai_run_configs', 'ai_providers', 'ai_tools']) expect(sqlite.prepare(`SELECT * FROM ${name}`).all()).toEqual([]);
    sqlite.exec('DROP TRIGGER fail_agent'); expect(migrateAgentProfiles(db).migrated).toHaveLength(2);
  });

  it('retains duplicate old login combinations as legacy rather than rewriting IDs or accounts', () => {
    old('a', 'claude'); old('b', 'claude'); migrateAgentProfiles(db);
    expect(sqlite.prepare('SELECT profile_id,source FROM ai_run_configs ORDER BY profile_id').all()).toEqual([{ profile_id: 'a', source: 'login' }, { profile_id: 'b', source: 'legacy' }]);
    expect(sqlite.prepare('SELECT id FROM ai_profiles ORDER BY id').all()).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
