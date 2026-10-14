import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

export interface DbClient {
  db: AppDb;
  sqlite: Database.Database;
  close: () => void;
}

export function openDbClient(filePath: string): DbClient {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  return { db: drizzle(sqlite, { schema }), sqlite, close: () => sqlite.close() };
}
