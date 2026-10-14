import Database from 'better-sqlite3';
import type { SessionRecord } from '@shared/types';

export type Db = Database.Database;

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      runner TEXT NOT NULL,
      cwd TEXT NOT NULL,
      native_session_id TEXT,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_secrets (
      key TEXT PRIMARY KEY,
      secret TEXT NOT NULL
    );
  `);
  return db;
}

interface SessionRow {
  id: string;
  runner: SessionRecord['runner'];
  cwd: string;
  native_session_id: string | null;
  title: string;
  created_at: number;
}

const toRecord = (r: SessionRow): SessionRecord => ({
  id: r.id,
  runner: r.runner,
  cwd: r.cwd,
  nativeSessionId: r.native_session_id,
  title: r.title,
  createdAt: r.created_at,
});

export function listSessions(db: Db): SessionRecord[] {
  return (db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as SessionRow[]).map(toRecord);
}

export function insertSession(db: Db, s: SessionRecord): void {
  db.prepare(
    'INSERT INTO sessions (id, runner, cwd, native_session_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.runner, s.cwd, s.nativeSessionId, s.title, s.createdAt);
}

export function setNativeSessionId(db: Db, id: string, nativeId: string): void {
  db.prepare('UPDATE sessions SET native_session_id = ? WHERE id = ?').run(nativeId, id);
}

export function claimedNativeIds(db: Db): Set<string> {
  const rows = db.prepare('SELECT native_session_id FROM sessions WHERE native_session_id IS NOT NULL').all() as {
    native_session_id: string;
  }[];
  return new Set(rows.map((r) => r.native_session_id));
}
