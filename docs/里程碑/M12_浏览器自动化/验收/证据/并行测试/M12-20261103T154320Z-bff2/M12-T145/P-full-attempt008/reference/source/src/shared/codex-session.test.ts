import { describe, expect, it } from 'vitest';
import { codexOwnerOf, parseCodexSessionMeta, pickCodexSession, type CodexRolloutMeta, type CodexWaiter } from './codex-session';
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
  const c = (id: string, cwd: string, dt: number, firstUserMessage?: string): CodexRolloutMeta => ({
    id, cwd, timestampMs: base + dt, originator: 'codex-tui', ...(firstUserMessage ? { firstUserMessage } : {}),
  });
  const w = (taskId: string, dt = 0, firstMessage = '', realCwd = '/p'): CodexWaiter => ({ taskId, realCwd, launchedAtMs: base + dt, firstMessage });
  const pick = (cands: CodexRolloutMeta[], taskId: string, waiters: CodexWaiter[], claimed: string[] = []) =>
    pickCodexSession(cands, { taskId, waiters, claimedIds: new Set(claimed) })?.id ?? null;

  it('只匹配同目录且在启动之后创建的会话，取最早一个', () => {
    expect(pick([c('old', '/p', -60_000), c('other', '/q', 5_000), c('b', '/p', 9_000), c('a', '/p', 4_000)], 't', [w('t')])).toBe('a');
  });

  it('跳过已被其他会话认领的 id', () => {
    expect(pick([c('a', '/p', 4_000), c('b', '/p', 9_000)], 't', [w('t')], ['a'])).toBe('b');
  });

  it('没有候选时返回 null，而不是猜一个', () => {
    expect(pick([c('old', '/p', -60_000)], 't', [w('t')])).toBeNull();
  });

  it('同目录多个等待中的任务：归启动时间最接近的那个，另一个拿不到', () => {
    const waiters = [w('first', 0), w('second', 10_000)];
    const cands = [c('s2', '/p', 10_500)];
    expect(pick(cands, 'second', waiters)).toBe('s2');
    expect(pick(cands, 'first', waiters)).toBeNull();
    expect(codexOwnerOf(c('tie', '/p', 2_000), [w('a', 0), w('b', 4_000)])).toBe('b'); // equally close: the later launch
  });

  it('首条消息两边都已知且不同 → 不认领；Codex 截断时前缀也算一致', () => {
    const waiters = [w('first', 0, 'fix the login bug'), w('second', 10_000, 'write docs')];
    expect(codexOwnerOf(c('x', '/p', 10_500, 'fix the login bug'), waiters)).toBe('first');
    expect(codexOwnerOf(c('y', '/p', 10_500, 'something else'), waiters)).toBeNull();
    expect(codexOwnerOf(c('z', '/p', 10_500, 'write'), waiters)).toBe('second');
  });
});

describe('buildRunnerArgs', () => {
  it('claude 新建和重开用 --session-id，恢复用 --resume；配置参数在前', () => {
    expect(buildRunnerArgs('claude', { mode: 'new', sessionId: 'u1', cwd: '/p', profileArgs: ['--model', 'm'] })).toEqual([
      '--model',
      'm',
      '--session-id',
      'u1',
    ]);
    expect(buildRunnerArgs('claude', { mode: 'reopen', sessionId: 'u1', cwd: '/p', firstMessage: 'x' })).toEqual(['--session-id', 'u1']);
    expect(buildRunnerArgs('claude', { mode: 'resume', sessionId: 'u1', cwd: '/p' })).toEqual(['--resume', 'u1']);
    expect(() => buildRunnerArgs('claude', { mode: 'new', cwd: '/p' })).toThrow('缺少 session ID');
  });

  it('codex 新建无参数，恢复用 resume --cd', () => {
    expect(buildRunnerArgs('codex', { mode: 'new', sessionId: null, cwd: '/p' })).toEqual([]);
    expect(buildRunnerArgs('codex', { mode: 'resume', sessionId: 't1', cwd: '/a b' })).toEqual(['resume', '--cd', '/a b', 't1']);
    expect(() => buildRunnerArgs('codex', { mode: 'resume', cwd: '/p' })).toThrow('无法恢复');
  });

  it('首条消息只在新建时作为单个参数传入，以 - 开头时前置 --', () => {
    const msg = '修复 $(rm -rf ~) "引号" 和\n换行';
    expect(buildRunnerArgs('codex', { mode: 'new', cwd: '/p', firstMessage: msg })).toEqual([msg]);
    expect(buildRunnerArgs('claude', { mode: 'new', sessionId: 'u', cwd: '/p', firstMessage: '-h' })).toEqual(['--session-id', 'u', '--', '-h']);
    expect(buildRunnerArgs('codex', { mode: 'resume', sessionId: 't', cwd: '/p', firstMessage: 'x' })).toEqual(['resume', '--cd', '/p', 't']);
  });
});
