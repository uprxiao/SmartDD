import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HealthEvent } from '../ai/health-classify';
import { SessionTail } from './session-health';

let dir: string;
let file: string;
let events: HealthEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'smartdd-tail-'));
  file = join(dir, 's.jsonl');
  events = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const reply = (text = 'hi') => line({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text }] } });
const apiError = (error: string, status: number, text: string) =>
  line({ type: 'assistant', isApiErrorMessage: true, error, apiErrorStatus: status, message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
const tail = (launchedAt: number, locate: () => string | null = () => file) =>
  new SessionTail({ runner: 'claude', locate, launchedAt, onEvent: (e) => events.push(e) });

describe('SessionTail', () => {
  it('waits for the file, then reports replies and API errors in order', () => {
    let exists = false;
    const t = tail(Date.now() - 1000, () => (exists ? file : null));
    t.poll();
    expect(events).toEqual([]);
    writeFileSync(file, line({ type: 'user', message: { content: 'x' } }) + reply());
    exists = true;
    t.poll();
    expect(events).toEqual([{ category: 'ok', message: '' }]);
    appendFileSync(file, reply('again') + line({ type: 'system', subtype: 'api_error', error: { status: 402 } }));
    t.poll();
    // Every reply is passed on (ProfileHealth dedupes); a retry notice is no verdict.
    expect(events).toEqual([{ category: 'ok', message: '' }, { category: 'ok', message: '' }]);
    appendFileSync(file, apiError('unknown', 402, 'API Error: 402 Insufficient Balance'));
    t.poll();
    expect(events[2]).toEqual({ category: 'billing', message: 'API Error: 402 Insufficient Balance' });
    appendFileSync(file, reply());
    t.poll();
    expect(events[3].category).toBe('ok'); // recovered (e.g. topped up): ok again
    expect(t.sawEvent).toBe(true);
  });

  it('keeps a half-written line until it is complete', () => {
    const t = tail(Date.now() - 1000);
    const full = apiError('authentication_failed', 401, 'Invalid API key');
    writeFileSync(file, full.slice(0, 40));
    t.poll();
    expect(events).toEqual([]);
    appendFileSync(file, full.slice(40));
    t.poll();
    expect(events).toEqual([{ category: 'auth', message: 'Invalid API key' }]);
  });

  it('skips what a resumed session wrote before this launch', () => {
    writeFileSync(file, apiError('authentication_failed', 401, 'old key'));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(file, old, old);
    // birthtime cannot be set back, so launch "later" than the file's creation instead.
    const t = tail(Date.now() + 10_000);
    t.poll();
    expect(events).toEqual([]);
    appendFileSync(file, reply());
    t.poll();
    expect(events).toEqual([{ category: 'ok', message: '' }]);
  });

  it('reads Codex rollouts', () => {
    const t = new SessionTail({ runner: 'codex', locate: () => file, launchedAt: Date.now() - 1000, onEvent: (e) => events.push(e) });
    writeFileSync(
      file,
      line({ type: 'session_meta', payload: { id: 'x' } }) +
        line({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: null, error: { message: 'unexpected status 401 Unauthorized', codex_error_info: { http_connection_failed: { http_status_code: 401 } } } } })
    );
    t.poll();
    expect(events).toEqual([{ category: 'auth', message: 'unexpected status 401 Unauthorized' }]);
    appendFileSync(file, line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }));
    t.poll();
    expect(events[1].category).toBe('ok');
  });
});
