import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { bundledMigrations, runBundledMigrations, runMigrations, type MigrationRecord } from './migrations';

const open: Database.Database[] = [];
function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

const ALL = ['0000_init', '0001_projects', '0002_tasks', '0003_ai_profile_check', '0004_capabilities', '0005_project_transfer', '0006_application_packages', '0007_application_connections', '0008_mail_drafts', '0009_mail_execution', '0010_capability_session_identity'];

const tables = (db: Database.Database) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const recorded = (db: Database.Database) =>
  (db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY id').all() as { hash: string }[]).map((r) => r.hash);

describe('bundled migrations', () => {
  it('loads every journal entry with its SQL and hash', () => {
    const migrations = bundledMigrations();
    expect(migrations.map((m) => m.tag)).toEqual(ALL);
    expect(migrations[0].sql).toContain('app_settings');
    expect(migrations[1].sql).toContain('project_databases');
    expect(migrations[2].sql).toContain('ai_profiles');
    expect(migrations[3].sql).toContain('check_status');
    for (const m of migrations) expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates the schema on an empty database and records the hash', () => {
    const db = memoryDb();
    expect(runBundledMigrations(db)).toEqual(ALL);
    expect(tables(db)).toEqual([
      '__drizzle_migrations',
      'ai_profiles',
      'app_secrets',
      'app_settings',
      'application_binding_changes',
      'application_binding_slot_revisions',
      'application_catalog_state',
      'application_connections',
      'application_project_bindings',
      'application_project_settings',
      'application_secret_changes',
      'capability_active_packages',
      'capability_install_journal',
      'capability_packages',
      'capability_resource_dependencies',
      'capability_resource_leases',
      'capability_resource_operations',
      'capability_resources',
      'capability_runs',
      'capability_schema_migrations',
      'capability_session_holds',
      'capability_session_identities',
      'capability_session_mcp_names',
      'capability_session_refs',
      'capability_session_snapshots',
      'capability_snapshot_versions',
      'imported_keys',
      'mail_attachment_objects',
      'mail_blob_objects',
      'mail_blob_writes',
      'mail_draft_mutations',
      'mail_draft_revisions',
      'mail_drafts',
      'mail_send_executions',
      'mail_send_grants',
      'mail_send_intents',
      'project_capabilities',
      'project_databases',
      'project_dirs',
      'project_import_receipts',
      'project_servers',
      'projects',
      'sessions',
      'skill_versions',
      'tasks',
    ]);
    expect(columns(db, 'app_settings')).toEqual(['key', 'value', 'updated_at']);
    expect(recorded(db)).toEqual(bundledMigrations().map((m) => m.hash));
  });

  it('upgrades existing draft attachments and seeds independent nullable connection-slot revisions without resetting data', () => {
    const db = memoryDb(); runMigrations(db,bundledMigrations().slice(0,9));
    db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','kept',1,1)");
    db.exec("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,updated_at) VALUES('old-project','mail',1,7,'2026-10-20T00:00:00Z')");
    db.exec("INSERT INTO mail_blob_objects VALUES('old-content',3,'2026-10-20T00:00:00Z'); INSERT INTO mail_attachment_objects(id,project_id,content_hash,filename,content_type,byte_size,created_at) VALUES('old-attachment','old-project','old-content','old.txt','text/plain',3,'2026-10-20T00:00:00Z')");
    expect(runBundledMigrations(db)).toEqual(['0009_mail_execution','0010_capability_session_identity']);
    expect(db.prepare('SELECT id,kind,filename FROM mail_attachment_objects').all()).toEqual([{ id: 'old-attachment',kind: 'attachment',filename: 'old.txt' }]);
    expect(db.prepare('SELECT slot,revision FROM application_binding_slot_revisions ORDER BY slot').all()).toEqual([{ slot: 'foxmail',revision: 7 },{ slot: 'smtp',revision: 7 }]);
    db.exec('DELETE FROM __drizzle_migrations WHERE id>=10'); runBundledMigrations(db); expect(db.prepare('SELECT count(*) AS n FROM mail_attachment_objects').get()).toEqual({ n: 1 });
  });

  it('retains native run history after project deletion and skips its completed FK rebuild on replay', () => {
    const db = memoryDb(); runMigrations(db,bundledMigrations().slice(0,10));
    db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('retained-project','history',1,1)");
    db.exec("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES('history-task',2,'{}','fixture-hash','2026-10-20T00:00:00Z','created','tombstone')");
    db.exec("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES('historical-run','history-task','retained-project','codex','stopped','2026-10-20T00:00:00Z')");
    runBundledMigrations(db); db.exec("DELETE FROM projects WHERE id='retained-project'");
    expect(db.prepare('SELECT run_id,project_id,state FROM capability_runs').all()).toEqual([{ run_id: 'historical-run',project_id: 'retained-project',state: 'stopped' }]);
    db.exec('DELETE FROM __drizzle_migrations WHERE id=11'); runBundledMigrations(db);
    expect(db.prepare('SELECT count(*) AS n FROM capability_runs').get()).toEqual({ n: 1 }); expect(tables(db)).not.toContain('capability_runs_retained');
  });

  it('is a no-op the second time', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    expect(runBundledMigrations(db)).toEqual([]);
    expect(recorded(db)).toHaveLength(ALL.length);
  });

  it('re-runs 0001 safely when its tables exist but the record is missing', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'kept', 1, 1)");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 1');
    expect(runBundledMigrations(db)).toEqual(ALL.slice(1));
    expect(db.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'kept' }]);
  });

  it('re-runs 0002 without duplicating tasks copied from sessions', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO sessions VALUES ('s1', 'codex', '/tmp', 'n1', 'old', 5)");
    db.exec("UPDATE tasks SET title = 'renamed' WHERE id = 's1'");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 2');
    expect(runBundledMigrations(db)).toEqual(ALL.slice(2));
    expect(db.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 's1', title: 'old' }]);
    db.exec("UPDATE tasks SET title = 'renamed' WHERE id = 's1'");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 2');
    runBundledMigrations(db);
    expect(db.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 's1', title: 'renamed' }]);
  });

  it('re-runs 0003 when its columns already exist, keeping the stored results', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO ai_profiles (id, name, runner, check_status, created_at, updated_at) VALUES ('a1', 'cc', 'claude', 'failed', 1, 1)");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 3');
    expect(runBundledMigrations(db)).toEqual(ALL.slice(3));
    expect(columns(db, 'ai_profiles').filter((c) => c.startsWith('check_'))).toEqual([
      'check_status',
      'check_category',
      'check_source',
      'check_message',
      'check_ms',
      'check_at',
    ]);
    expect(db.prepare('SELECT check_status FROM ai_profiles').all()).toEqual([{ check_status: 'failed' }]);
  });

  it('adopts an M0 database without touching existing rows', () => {
    const db = memoryDb();
    // The M0 schema, created by hand before migrations existed.
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, runner TEXT NOT NULL, cwd TEXT NOT NULL,
        native_session_id TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE app_secrets (key TEXT PRIMARY KEY, secret BLOB NOT NULL);
      CREATE TABLE probe_kv (k TEXT PRIMARY KEY, v TEXT);
      INSERT INTO sessions VALUES ('s1', 'claude', '/tmp', NULL, 'old', 1);
    `);
    expect(runBundledMigrations(db)).toEqual(ALL);
    expect(tables(db)).toContain('app_settings');
    expect(tables(db)).toContain('probe_kv');
    expect(db.prepare('SELECT title FROM sessions').all()).toEqual([{ title: 'old' }]);
    expect(db.prepare('SELECT id, runner, cwd, title, project_id, created_at, last_launched_at FROM tasks').all()).toEqual([
      { id: 's1', runner: 'claude', cwd: '/tmp', title: 'old', project_id: null, created_at: 1, last_launched_at: 1 },
    ]);
  });
});

describe('runMigrations', () => {
  const m = (idx: number, sql: string): MigrationRecord => ({ idx, tag: `m${idx}`, when: idx, sql, hash: `h${idx}` });

  it('applies only the migrations past the recorded count', () => {
    const db = memoryDb();
    runMigrations(db, [m(0, 'CREATE TABLE a (x)')]);
    expect(runMigrations(db, [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x)')])).toEqual(['m1']);
    expect(tables(db)).toEqual(['__drizzle_migrations', 'a', 'b']);
    expect(recorded(db)).toEqual(['h0', 'h1']);
  });

  it('rolls back the whole batch when one statement fails', () => {
    const db = memoryDb();
    const batch = [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x);\n--> statement-breakpoint\nNOT SQL')];
    expect(() => runMigrations(db, batch)).toThrow();
    expect(tables(db)).toEqual(['__drizzle_migrations']);
    expect(recorded(db)).toEqual([]);
  });

  it('skips ADD COLUMN for a column that is already there', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE a (x, y)');
    expect(runMigrations(db, [m(0, 'ALTER TABLE `a` ADD `y` text;\n--> statement-breakpoint\nALTER TABLE a ADD COLUMN z integer')])).toEqual(['m0']);
    expect(columns(db, 'a')).toEqual(['x', 'y', 'z']);
  });

  it('refuses a database migrated by a newer version', () => {
    const db = memoryDb();
    runMigrations(db, [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x)')]);
    expect(() => runMigrations(db, [m(0, 'CREATE TABLE a (x)')])).toThrow(/更新版本/);
  });
});
