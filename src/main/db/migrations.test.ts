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

const ALL = ['0000_init', '0001_projects', '0002_tasks'];

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
      'project_databases',
      'project_dirs',
      'project_servers',
      'projects',
      'sessions',
      'tasks',
    ]);
    expect(columns(db, 'app_settings')).toEqual(['key', 'value', 'updated_at']);
    expect(recorded(db)).toEqual(bundledMigrations().map((m) => m.hash));
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
    db.exec('DELETE FROM __drizzle_migrations WHERE id IN (SELECT id FROM __drizzle_migrations ORDER BY id DESC LIMIT 2)');
    expect(runBundledMigrations(db)).toEqual(['0001_projects', '0002_tasks']);
    expect(db.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'kept' }]);
  });

  it('re-runs 0002 without duplicating tasks copied from sessions', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO sessions VALUES ('s1', 'codex', '/tmp', 'n1', 'old', 5)");
    db.exec("UPDATE tasks SET title = 'renamed' WHERE id = 's1'");
    db.exec('DELETE FROM __drizzle_migrations WHERE id = (SELECT MAX(id) FROM __drizzle_migrations)');
    expect(runBundledMigrations(db)).toEqual(['0002_tasks']);
    expect(db.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 's1', title: 'old' }]);
    db.exec("UPDATE tasks SET title = 'renamed' WHERE id = 's1'");
    db.exec('DELETE FROM __drizzle_migrations WHERE id = (SELECT MAX(id) FROM __drizzle_migrations)');
    runBundledMigrations(db);
    expect(db.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 's1', title: 'renamed' }]);
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

  it('refuses a database migrated by a newer version', () => {
    const db = memoryDb();
    runMigrations(db, [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x)')]);
    expect(() => runMigrations(db, [m(0, 'CREATE TABLE a (x)')])).toThrow(/更新版本/);
  });
});
