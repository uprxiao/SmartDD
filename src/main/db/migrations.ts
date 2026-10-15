// Modeled on Yoda (Apache-2.0) src/main/db/migrations.ts: drizzle-kit generates the SQL,
// Vite bundles it at build time, and this runner applies it in one transaction.
import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import journal from '@root/drizzle/meta/_journal.json';

const sqlFiles = import.meta.glob('@root/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface MigrationRecord {
  idx: number;
  tag: string;
  when: number;
  sql: string;
  hash: string;
}

type JournalEntry = { idx: number; when: number; tag: string };

export function bundledMigrations(): MigrationRecord[] {
  return (journal as { entries: JournalEntry[] }).entries.map((entry) => {
    const key = Object.keys(sqlFiles).find((k) => k.endsWith(`/${entry.tag}.sql`));
    if (!key) throw new Error(`缺少打包的迁移文件：${entry.tag}.sql`);
    const sql = sqlFiles[key];
    return { ...entry, sql, hash: createHash('sha256').update(sql).digest('hex') };
  });
}

function appliedCount(connection: BetterSqlite3.Database): number {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  return (connection.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
}

// SQLite has no `ADD COLUMN IF NOT EXISTS`; drizzle-kit writes `ALTER TABLE `t` ADD `c` ...`.
const ADD_COLUMN_RE = /^ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/i;

/** An ADD COLUMN whose column is already there (a half-applied or replayed migration) is skipped. */
export function columnAlreadyExists(connection: BetterSqlite3.Database, stmt: string): boolean {
  const m = ADD_COLUMN_RE.exec(stmt);
  if (!m) return false;
  const cols = connection.prepare('SELECT name FROM pragma_table_info(?)').all(m[1]) as { name: string }[];
  return cols.some((c) => c.name.toLowerCase() === m[2].toLowerCase());
}

/**
 * Applies every migration past the recorded count, all inside one transaction: either the
 * whole batch lands or the database is left exactly as it was. Returns the applied tags.
 */
export function runMigrations(connection: BetterSqlite3.Database, migrations: MigrationRecord[]): string[] {
  const done = appliedCount(connection);
  if (done > migrations.length) {
    // A newer SmartDD already migrated this database; running older code on it is unsafe.
    throw new Error(`数据库已执行 ${done} 个迁移，当前版本只包含 ${migrations.length} 个，请使用更新版本的 SmartDD`);
  }
  const pending = migrations.slice(done);
  connection.transaction(() => {
    const record = connection.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
    for (const m of pending) {
      for (const stmt of m.sql.split('--> statement-breakpoint')) {
        const trimmed = stmt.trim();
        if (trimmed && !columnAlreadyExists(connection, trimmed)) connection.exec(trimmed);
      }
      record.run(m.hash, m.when);
    }
  })();
  return pending.map((m) => m.tag);
}

export function runBundledMigrations(connection: BetterSqlite3.Database): string[] {
  return runMigrations(connection, bundledMigrations());
}
