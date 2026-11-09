// Where Claude Code and Codex keep their own session files (verified in M0). SmartDD reads file
// names, the first line of Codex rollouts and Codex's thread index (state_N.sqlite, read-only);
// session-health.ts additionally reads the lines that
// carry the API's verdict (a reply arrived / which error) — never the conversation text itself.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { parseCodexSessionMeta, type CodexRolloutMeta } from '@shared/codex-session';
import type { Runner } from '@shared/types';

/** CLAUDE_CONFIG_DIR / CODEX_HOME as the CLI will see it: the profile wins, then the inherited env. */
export function stateRootFor(runner: Runner, profileEnv: Record<string, string>, baseEnv: Record<string, string>): string {
  const home = profileEnv.HOME || baseEnv.HOME || homedir();
  if (runner === 'claude') return profileEnv.CLAUDE_CONFIG_DIR || baseEnv.CLAUDE_CONFIG_DIR || join(home, '.claude');
  if (runner !== 'codex') throw new Error('当前运行器的能力预览尚未验证');
  return profileEnv.CODEX_HOME || baseEnv.CODEX_HOME || join(home, '.codex');
}

// Claude stores <root>/projects/<cwd with every non-alphanumeric char replaced by "->/<id>.jsonl.
export const encodeClaudeDir =(cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** The session file's path, or null while Claude has not written it. `scan` also looks in every project folder. */
export function claudeSessionFile(root: string, cwd: string, sessionId: string, scan = true): string | null {
  const projects = join(root, 'projects');
  const candidates = new Set([cwd]);
  try {
    candidates.add(realpathSync(cwd));
  } catch {
    // Directory gone; the recorded path is all we have.
  }
  for (const c of candidates) {
    const f = join(projects, encodeClaudeDir(c), `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  // Fallback for encodings we do not predict (e.g. a future Claude version).
  if (!scan || !existsSync(projects)) return null;
  for (const d of readdirSync(projects)) {
    const f = join(projects, d, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

export function claudeSessionFileExists(root: string, cwd: string, sessionId: string): boolean {
  return claudeSessionFile(root, cwd, sessionId) != null;
}

/** rollout-<time>-<id>.jsonl under sessions/YYYY/MM/DD: the recent days first, then (if `scan`) every day folder. */
export function codexRolloutFile(root: string, sessionId: string, sinceMs: number, scan: boolean): string | null {
  const sessions = join(root, 'sessions');
  const suffix = `-${sessionId}.jsonl`;
  const inDir = (dir: string) => {
    if (!existsSync(dir)) return null;
    const name = readdirSync(dir).find((n) => n.startsWith('rollout-') && n.endsWith(suffix));
    return name ? join(dir, name) : null;
  };
  for (const dir of codexDayDirs(sessions, sinceMs)) {
    const f = inDir(dir);
    if (f) return f;
  }
  if (!scan || !existsSync(sessions)) return null;
  const sub = (dir: string) => readdirSync(dir).filter((n) => /^\d+$/.test(n)).sort().reverse();
  for (const y of sub(sessions)) {
    for (const m of sub(join(sessions, y))) {
      for (const d of sub(join(sessions, y, m))) {
        const f = inDir(join(sessions, y, m, d));
        if (f) return f;
      }
    }
  }
  return null;
}

/**
 * Sessions Codex created since `sinceMs`: its thread index first (it carries the first user
 * message, which tells same-directory tasks apart), the rollout files as fallback.
 */
export async function recentCodexRollouts(root: string, sinceMs: number): Promise<CodexRolloutMeta[]> {
  const byId = new Map<string, CodexRolloutMeta>();
  for (const m of await rolloutMetas(root, sinceMs)) byId.set(m.id, m);
  for (const m of codexThreads(root, sinceMs) ?? []) byId.set(m.id, m);
  // Seen in a real index: rows whose created_at lies centuries ahead. Such a row would pass
  // "created after launch" for every task in its directory, so anything from the future is dropped.
  const latest = Date.now() + 60_000;
  return [...byId.values()].filter((m) => m.timestampMs <= latest);
}

/** The newest state_N.sqlite under the Codex home, or null. */
export function codexStateDb(root: string): string | null {
  if (!existsSync(root)) return null;
  const n = (f: string) => Number(/^state_(\d+)\.sqlite$/.exec(f)?.[1] ?? -1);
  const best = readdirSync(root)
    .filter((f) => n(f) >= 0)
    .sort((a, b) => n(b) - n(a))[0];
  return best ? join(root, best) : null;
}

/** Threads with a first user message from Codex's index; null when there is no readable index. */
export function codexThreads(root: string, sinceMs: number): CodexRolloutMeta[] | null {
  const file = codexStateDb(root);
  if (!file) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    const rows = db
      .prepare(
        `SELECT id, cwd, COALESCE(created_at_ms, created_at * 1000) AS ms, first_user_message AS msg, COALESCE(originator, source) AS origin
         FROM threads WHERE archived = 0 AND first_user_message <> '' AND COALESCE(created_at_ms, created_at * 1000) >= ?`
      )
      .all(sinceMs - 2000) as { id: string; cwd: string; ms: number; msg: string; origin: string | null }[];
    return rows.map((r) => ({ id: r.id, cwd: r.cwd, timestampMs: r.ms, originator: r.origin ?? '', firstUserMessage: r.msg }));
  } catch {
    // Missing table or column (another Codex version), locked or unreadable: fall back to rollouts.
    return null;
  } finally {
    db?.close();
  }
}

async function rolloutMetas(root: string, sinceMs: number): Promise<CodexRolloutMeta[]> {
  const out: CodexRolloutMeta[] = [];
  for (const dayDir of codexDayDirs(join(root, 'sessions'), sinceMs)) {
    if (!existsSync(dayDir)) continue;
    for (const name of readdirSync(dayDir)) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const file = join(dayDir, name);
      if (statSync(file).mtimeMs < sinceMs - 2000) continue;
      const meta = parseCodexSessionMeta(await readFirstLine(file));
      if (meta) out.push(meta);
    }
  }
  return out;
}

// Rollout folders are named by local date; check launch day and today to survive midnight.
function codexDayDirs(sessionsRoot: string, sinceMs: number): string[] {
  const days = new Set<string>();
  for (const t of [sinceMs, Date.now()]) {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    days.add(join(sessionsRoot, String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate())));
  }
  return [...days];
}

async function readFirstLine(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const nl = text.indexOf('\n');
    return nl === -1 ? text : text.slice(0, nl);
  } finally {
    await fh.close();
  }
}
