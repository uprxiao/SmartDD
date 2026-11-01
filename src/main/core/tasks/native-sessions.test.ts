import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexStateDb, codexThreads, recentCodexRollouts, stateRootFor } from './native-sessions';

let root: string;
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'smartdd-codex-home-'))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('does not infer a Codex state root for another registered Agent during static preview', () => {
  expect(() => stateRootFor('scripted-test', { CODEX_HOME: '/another-agent' }, { HOME: root })).toThrow('能力预览尚未验证');
});

it.each(['claude', 'codex'] as const)('%s discovery follows the profile HOME and inherited explicit state root', (runner) => {
  const key = runner === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
  expect(stateRootFor(runner, { HOME: '/selected' }, { HOME: '/other' })).toBe(`/selected/.${runner}`);
  expect(stateRootFor(runner, {}, { [key]: '/inherited' })).toBe('/inherited');
  expect(stateRootFor(runner, { [key]: '/profile' }, { [key]: '/inherited' })).toBe('/profile');
});

// The columns SmartDD reads, as in Codex's state_5.sqlite (created_at in seconds, created_at_ms optional).
const makeDb = (name: string, rows: [string, string, number, number | null, string, number][]) => {
  const db = new Database(join(root, name));
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, created_at INTEGER NOT NULL, created_at_ms INTEGER,
    first_user_message TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'cli', originator TEXT)`);
  const ins = db.prepare('INSERT INTO threads (id, cwd, created_at, created_at_ms, first_user_message, archived) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(...r);
  db.close();
};

describe('codexThreads', () => {
  const t = 1_800_000_000_000;

  it('reads recent, unarchived threads with a first message from the newest state DB', () => {
    makeDb('state_4.sqlite', [['from-old-db', '/p', t / 1000, t, 'x', 0]]);
    makeDb('state_5.sqlite', [
      ['a', '/p', t / 1000, t + 500, 'fix the bug', 0],
      ['no-message-yet', '/p', t / 1000, t + 600, '', 0],
      ['archived', '/p', t / 1000, t + 700, 'y', 1],
      ['too-old', '/p', t / 1000 - 60, null, 'z', 0],
      ['seconds-only', '/p', t / 1000 + 1, null, 'w', 0],
    ]);
    expect(codexStateDb(root)).toBe(join(root, 'state_5.sqlite'));
    const got = codexThreads(root, t)!.sort((x, y) => x.timestampMs - y.timestampMs);
    expect(got.map((r) => [r.id, r.timestampMs, r.firstUserMessage])).toEqual([
      ['a', t + 500, 'fix the bug'],
      ['seconds-only', t + 1000, 'w'],
    ]);
  });

  it('returns null without a readable index, so discovery falls back to rollouts', async () => {
    expect(codexThreads(root, t)).toBeNull();
    writeFileSync(join(root, 'state_5.sqlite'), 'not a database');
    expect(codexThreads(root, t)).toBeNull();
    const now = new Date();
    const day = join(root, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
    mkdirSync(day, { recursive: true });
    const meta = { type: 'session_meta', payload: { id: 'r1', cwd: '/p', timestamp: now.toISOString(), originator: 'codex_cli_rs' } };
    writeFileSync(join(day, 'rollout-x-r1.jsonl'), `${JSON.stringify(meta)}\n`);
    expect((await recentCodexRollouts(root, now.getTime() - 1000)).map((m) => m.id)).toEqual(['r1']);
  });

  it('drops sessions dated in the future (a real index had created_at centuries ahead)', async () => {
    const now = Date.now();
    makeDb('state_5.sqlite', [
      ['real', '/p', Math.floor(now / 1000), now, 'hi', 0],
      ['bogus', '/p', 197136680837, null, 'hi', 0],
    ]);
    expect(codexThreads(root, now - 1000)!.map((r) => r.id).sort()).toEqual(['bogus', 'real']);
    expect((await recentCodexRollouts(root, now - 1000)).map((m) => m.id)).toEqual(['real']);
  });
});
