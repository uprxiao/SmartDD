import { afterEach, expect, it, vi } from 'vitest';
import type { AgentLiveFrame } from '@shared/events';
import { EVENT_LIMIT } from './agent-task-service';
import { AgentLiveOutput } from './live-output';

const frame = (text: string, itemKey = 'answer', runId = 'run') => ({ taskId: 'task', runId, itemKey, text });

afterEach(() => { vi.useRealTimers(); });

it('A45 coalesces adjacent Unicode and escaped deltas within the serialized frame budget', () => {
  vi.useFakeTimers();
  const delivered: AgentLiveFrame[] = [];
  const output = new AgentLiveOutput(value => delivered.push(value));
  const oversized = '安全😀\n"\\\u0000'.repeat(10_000);
  try {
    output.append(frame(oversized));
    for (let index = 0; index < 30; index++) output.append(frame('甲乙丙😀'));
    vi.advanceTimersByTime(49);
    expect(delivered).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(delivered).toHaveLength(1);
    vi.runAllTimers();
    expect(delivered.length).toBeLessThan(30);
    expect(delivered.every(value => Buffer.byteLength(JSON.stringify(value)) <= EVENT_LIMIT)).toBe(true);
    expect(delivered.every(value => Buffer.from(value.text).toString() === value.text)).toBe(true);
    expect(delivered.map(value => value.text).join('')).toBe(oversized + '甲乙丙😀'.repeat(30));
  } finally { output.close(); }
});

it('A45 bounds each pending run without delaying other runs and discards unsent previews at the terminal event', () => {
  vi.useFakeTimers();
  const delivered: AgentLiveFrame[] = [];
  const output = new AgentLiveOutput(value => delivered.push(value));
  try {
    for (let index = 0; index < 130; index++) output.append(frame('x', String(index)));
    output.append(frame('another run', 'answer', 'second'));
    vi.advanceTimersByTime(50);
    expect(delivered.map(value => value.runId)).toEqual(['run', 'second']);
    vi.runAllTimers();
    const first = delivered.filter(value => value.runId === 'run');
    expect(first).toHaveLength(128);
    expect(first.at(-1)?.previewIncomplete).toBe(true);
    output.end('run');
    output.append(frame('stale preview'));
    output.end('run');
    output.append(frame('next turn'));
    vi.runAllTimers();
    expect(delivered.at(-1)?.text).toBe('next turn');
    expect(delivered.some(value => value.text === 'stale preview')).toBe(false);
  } finally { output.close(); }
});

it('A45 caps queued previews across runs at 64 MiB and admits new previews after draining', () => {
  vi.useFakeTimers();
  let deliveredBytes = 0;
  const deliveredFrames = new Map<string, number>();
  let finalText = '';
  const output = new AgentLiveOutput(value => {
    deliveredBytes += Buffer.byteLength(JSON.stringify(value));
    deliveredFrames.set(value.runId, (deliveredFrames.get(value.runId) ?? 0) + 1);
    finalText = value.text;
  });
  const backlog = 'x'.repeat(4 * 1024 * 1024);
  try {
    for (let index = 0; index < 20; index++) output.append(frame(backlog, 'answer', `parallel-${index}`));
    vi.runAllTimers();
    expect(deliveredBytes).toBeGreaterThan(63 * 1024 * 1024);
    expect(deliveredBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect([...deliveredFrames.values()].every(count => count <= 128)).toBe(true);

    output.append(frame('new accepted preview', 'answer', 'after-drain'));
    vi.runAllTimers();
    expect(finalText).toBe('new accepted preview');
  } finally { output.close(); }
});
