import { beforeEach, expect, it, vi } from 'vitest';
import { ptyDataEvent, ptyExitEvent } from '@shared/events';

type PtyPayload = { ptyId: string; data: string } | { ptyId: string; code: number };
const { listeners } = vi.hoisted(() => ({ listeners: new Map<string, (payload: PtyPayload) => void>() }));
vi.mock('@renderer/lib/ipc', () => ({
  events: { on: (event: { name: string }, listener: (payload: PtyPayload) => void) => listeners.set(event.name, listener) },
}));

beforeEach(() => {
  vi.resetModules();
  listeners.clear();
});

it('restores the same shell output, including its pasted input, after the view is remounted', async () => {
  const { attachPty } = await import('./pty-buffer');
  const shell = 'task-shell';
  const emit = (data: string) => listeners.get(ptyDataEvent.name)!({ ptyId: shell, data });
  const original = { data: vi.fn(), exit: vi.fn() };
  emit('prompt % ');
  const detach = attachPty(shell, original);
  emit('echo ready');
  detach();
  emit('\r\n');

  const other = { data: vi.fn(), exit: vi.fn() };
  attachPty('other-task-shell', other);
  expect(other.data).not.toHaveBeenCalled();

  const reopened = { data: vi.fn(), exit: vi.fn() };
  attachPty(shell, reopened);
  expect(reopened.data.mock.calls).toEqual([['prompt % '], ['echo ready'], ['\r\n']]);
  emit('ready\r\n');
  expect(reopened.data).toHaveBeenLastCalledWith('ready\r\n');
  expect(original.data.mock.calls).toEqual([['prompt % '], ['echo ready']]);
});

it('releases a mounted shell buffer when the underlying PTY exits', async () => {
  const { attachPty } = await import('./pty-buffer');
  const shell = 'replaced-shell';
  const oldView = { data: vi.fn(), exit: vi.fn() };
  const detach = attachPty(shell, oldView);
  listeners.get(ptyDataEvent.name)!({ ptyId: shell, data: 'old prompt' });
  detach();
  listeners.get(ptyExitEvent.name)!({ ptyId: shell, code: 0 });

  const view = { data: vi.fn(), exit: vi.fn() };
  attachPty(shell, view);
  expect(view.data).not.toHaveBeenCalled();
});
