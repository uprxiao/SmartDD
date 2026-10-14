import { describe, expect, it } from 'vitest';
import { parseCodexSessionMeta, pickCodexSession, type CodexRolloutMeta } from './codex-session';
import { buildRunnerArgs } from './runner-args';

const line = (payload: object, type = 'session_meta') => JSON.stringify({ type, payload });

describe('parseCodexSessionMeta', () => {
  it('解析 session_meta 首行', () => {
    const m = parseCodexSessionMeta(
      line({ id: 'abc', cwd: '/private/tmp/x', timestamp: '2026-10-14T09:00:00.000Z', originator: 'codex-tui' })
    );
    expect(m).toEqual({ id: 'abc', cwd: '/private/tmp/x', timestampMs: Date.parse('2026-10-14T09:00:00.000Z'), originator: 'codex-tui' });
  });

  it('非 session_meta、缺字段或坏 JSON 返回 null', () => {
    expect(parseCodexSessionMeta(line({ id: 'a', cwd: '/x' }, 'response_item'))).toBeNull();
    expect(parseCodexSessionMeta(line({ cwd: '/x' }))).toBeNull();
    expect(parseCodexSessionMeta('{oops')).toBeNull();
  });
});

describe('pickCodexSession', () => {
  const base = Date.parse('2026-10-14T09:00:00.000Z');
  const c = (id: string, cwd: string, dt: number): CodexRolloutMeta => ({ id, cwd, timestampMs: base + dt, originator: 'codex-tui' });

  it('只匹配同目录且在启动之后创建的会话，取最早一个', () => {
    const got = pickCodexSession(
      [c('old', '/p', -60_000), c('other', '/q', 5_000), c('b', '/p', 9_000), c('a', '/p', 4_000)],
      { realCwd: '/p', launchedAtMs: base, claimedIds: new Set() }
    );
    expect(got?.id).toBe('a');
  });

  it('跳过已被其他会话认领的 id', () => {
    const got = pickCodexSession([c('a', '/p', 4_000), c('b', '/p', 9_000)], {
      realCwd: '/p',
      launchedAtMs: base,
      claimedIds: new Set(['a']),
    });
    expect(got?.id).toBe('b');
  });

  it('没有候选时返回 null，而不是猜一个', () => {
    expect(pickCodexSession([c('old', '/p', -60_000)], { realCwd: '/p', launchedAtMs: base, claimedIds: new Set() })).toBeNull();
  });
});

describe('buildRunnerArgs', () => {
  it('claude 新建用 --session-id，恢复用 --resume', () => {
    expect(buildRunnerArgs('claude', { newSessionId: 'u1' })).toEqual(['--session-id', 'u1']);
    expect(buildRunnerArgs('claude', { resumeSessionId: 'u1' })).toEqual(['--resume', 'u1']);
  });

  it('codex 新建无参数，恢复用 resume 子命令', () => {
    expect(buildRunnerArgs('codex', { newSessionId: 'ignored' })).toEqual([]);
    expect(buildRunnerArgs('codex', { resumeSessionId: 't1' })).toEqual(['resume', 't1']);
  });
});
