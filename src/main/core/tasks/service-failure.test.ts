import { describe, expect, it } from 'vitest';
import { serviceEvent, ServiceFailureStreak } from './service-failure';

// Shape observed in official Claude2.1.322 Native JSONL, not print stdout.
const retry = (uuid = 'retry-1') => ({ type: 'system', subtype: 'api_error', level: 'error', source: 'request_retry', retryAttempt: 1, maxRetries: 10, retryInMs: 522, uuid, error: { status: 503, connection: null, isNetworkDown: false, noResponse: null } });
describe('trusted runtime service observations', () => {
  it('recognizes repeated interactive Native requests without pretending to know their HTTP status', () => {
    const native = (id: string, digest = 'a'.repeat(64)) => ({ type: 'api-request', id, timestamp: '2026-11-13T08:00:27.867Z', querySource: 'repl_main_thread', sessionId: 'same-native-session', requestDigest: digest, shapeHash: 'b'.repeat(64) });
    const streak = new ServiceFailureStreak();
    for (let i = 1; i <= 4; i++) {
      const event = serviceEvent('claude', native(String(i)));
      expect(event).not.toBeNull();
      streak.take(event!, i * 1000);
      expect(Boolean(streak.notice)).toBe(i === 4);
    }
    streak.take({ kind: 'success', id: 'real-answer' }, 5000);
    expect(streak.notice).toBeNull();
    for (let i = 5; i <= 9; i++) streak.take(serviceEvent('claude', native(String(i), String(i).repeat(64)))!, i * 1000);
    expect(streak.notice).toBeNull();
    expect(serviceEvent('claude', { ...native('side'), querySource: 'agent_subagent' })).toBeNull();
    expect(serviceEvent('claude', { type: 'user', message: { content: JSON.stringify(native('spoof')) } })).toBeNull();
  });
  it('accepts the actual Native retry carrier and rejects text, sidechains and unrelated system records', () => {
    expect(serviceEvent('claude', retry())).toEqual({ kind: 'failure', id: 'retry-1' });
    for (const row of [
      { type: 'user', message: { content: JSON.stringify(retry()) } },
      { ...retry(), isSidechain: true }, { ...retry(), source: 'tool' },
      { ...retry(), retryAttempt: '1' }, { ...retry(), uuid: undefined },
      { ...retry(), error: { message: '503' } }, { ...retry(), subtype: 'api_retry' },
    ]) expect(serviceEvent('claude', row)).toBeNull();
    expect(serviceEvent('claude', { type: 'assistant', message: { model: 'real', content: [{ type: 'text', text: '503 is an example, not a service error' }] } })).toMatchObject({ kind: 'success' });
  });
  it('uses structured Codex error records, not model text', () => {
    expect(serviceEvent('codex', { type: 'event_msg', payload: { type: 'error', message: 'unexpected status 503' } })).toEqual({ kind: 'failure', id: undefined });
    expect(serviceEvent('codex', { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'unexpected status 503' }] } })).toBeNull();
  });
  it('does not count duplicate request ids, another session, or attempts outside the observation window', () => {
    const streak = new ServiceFailureStreak();
    const request = (id: string, signature = 'session:shape:digest') => ({ kind: 'request' as const, id, signature, at: 1000 });
    for (let i = 0; i < 10; i++) streak.take(request('same-id'), 1000 + i);
    expect(streak.notice).toBeNull();
    streak.take(request('another', 'different-session:shape:digest'), 2000);
    streak.take(request('third'), 3000);
    streak.take(request('fourth'), 124000);
    streak.take(request('fifth'), 125000);
    expect(streak.notice).toBeNull();
  });
  it('deduplicates Native UUIDs, raises after three failures and clears only on a real success', () => {
    const streak = new ServiceFailureStreak();
    for (let i = 0; i < 8; i++) expect(streak.take({ kind: 'failure', id: 'one' }, 100)).toBe(false);
    expect(streak.notice).toBeNull();
    expect(streak.take({ kind: 'failure', id: 'two' }, 200)).toBe(false);
    expect(streak.take({ kind: 'failure', id: 'three' }, 300)).toBe(true);
    expect(streak.notice).toEqual({ consecutiveFailures: 3, since: 100 });
    expect(streak.take({ kind: 'failure', id: 'four' }, 400)).toBe(false);
    expect(streak.take({ kind: 'success', id: 'answer' }, 500)).toBe(true);
    expect(streak.notice).toBeNull();
    expect(streak.take({ kind: 'failure', id: 'five' }, 600)).toBe(false);
  });
});
