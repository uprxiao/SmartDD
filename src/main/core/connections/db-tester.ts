import { Socket } from 'node:net';
import mysql from 'mysql2/promise';
import pg from 'pg';
import type { ConnectionTestResult, DbTransport } from '@shared/projects';
import { classifyError, withDeadline } from './classify';
import { redact } from './redact';

export interface DbTarget {
  transport: DbTransport;
  host: string;
  port: number;
  database: string;
  schema: string | null;
  username: string;
  password: string;
}

export const DEFAULT_TEST_TIMEOUT_MS = 8000;

/**
 * Handshake plus one read-only statement. Never writes. Every failure comes back as a
 * classified result; this function does not throw.
 */
export async function testDatabase(target: DbTarget, timeoutMs = DEFAULT_TEST_TIMEOUT_MS): Promise<ConnectionTestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const detail = target.transport === 'mysql' ? await testMysql(target, timeoutMs) : await testPostgres(target, timeoutMs);
    return { ok: true, category: 'ok', message: '', ms: elapsed(), detail: redact(detail, [target.password]) };
  } catch (error) {
    const { category, message } = classifyError(target.transport, error);
    return { ok: false, category, message: redact(message, [target.password]), ms: elapsed() };
  }
}

async function testMysql(t: DbTarget, timeoutMs: number): Promise<string> {
  let conn: mysql.Connection | undefined;
  let timedOut = false;
  const work = (async () => {
    const c = await mysql.createConnection({
      host: t.host,
      port: t.port,
      user: t.username,
      password: t.password,
      database: t.database || undefined,
      connectTimeout: timeoutMs,
    });
    conn = c;
    // The deadline may have fired while the handshake finished; don't leave the socket open.
    if (timedOut) c.destroy();
    const [rows] = await c.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version, DATABASE() AS db');
    return `MySQL ${rows[0]?.version ?? '?'}${rows[0]?.db ? `，当前库 ${rows[0].db}` : ''}`;
  })();
  try {
    return await withDeadline(work, timeoutMs, () => {
      timedOut = true;
      conn?.destroy();
    });
  } finally {
    if (!timedOut) await conn?.end().catch(() => conn?.destroy());
  }
}

/**
 * pg-protocol throws from inside the socket's 'data' listener when a server sends a message it
 * cannot parse (openGauss sends authentication codes it does not know). Uncaught, that would take
 * down the main process; here it becomes a socket error, which `connect()` rejects with.
 */
function guardedSocket(): Socket {
  const socket = new Socket();
  const emit = socket.emit.bind(socket) as (event: string | symbol, ...args: unknown[]) => boolean;
  socket.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event !== 'data') return emit(event, ...args);
    try {
      return emit(event, ...args);
    } catch (error) {
      socket.destroy(error as Error);
      return false;
    }
  }) as Socket['emit'];
  return socket;
}

async function testPostgres(t: DbTarget, timeoutMs: number): Promise<string> {
  // Every field is explicit: `pg` falls back to PG* environment variables and ~/.pgpass for
  // anything falsy, which would silently test a different target than the form shows.
  const password = t.password;
  const client = new pg.Client({
    host: t.host,
    port: t.port,
    user: t.username,
    // Postgres itself defaults the database to the user name; say so instead of reading PGDATABASE.
    database: t.database || t.username,
    password: () => password,
    ssl: false,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    application_name: 'WillYou connection test',
    stream: guardedSocket,
  });
  // A socket error after connect() settled would otherwise be an unhandled 'error' event.
  client.on('error', () => {});
  const work = (async () => {
    await client.connect();
    const version = (await client.query<{ v: string }>('SELECT version() AS v')).rows[0]?.v ?? '?';
    const db = (await client.query<{ d: string }>('SELECT current_database() AS d')).rows[0]?.d;
    if (t.schema) {
      const found = await client.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [t.schema]);
      if (found.rowCount === 0) {
        throw Object.assign(new Error(`schema "${t.schema}" does not exist`), { code: '3F000' });
      }
    }
    return `${version.split(',')[0]}，当前库 ${db}${t.schema ? `，schema ${t.schema} 存在` : ''}`;
  })();
  try {
    return await withDeadline(work, timeoutMs, () => void client.end().catch(() => {}));
  } finally {
    await client.end().catch(() => {});
  }
}
