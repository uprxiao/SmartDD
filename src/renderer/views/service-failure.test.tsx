// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskView } from '@shared/tasks';
import { ServiceFailureNotice } from './service-failure';

const mock = vi.hoisted(() => ({ stop: vi.fn(), refresh: vi.fn(), drop: vi.fn(), byId: new Map<string, TaskView>() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { tasks: { stopForServiceFailure: mock.stop } } }));
vi.mock('@renderer/core/tasks-store', () => ({ tasksStore: { refresh: mock.refresh, dropTerminal: mock.drop, get byId() { return mock.byId; } } }));
const task = () => ({ id: 'task', ptyId: 'pty-1', archivedAt: null, serviceFailure: { consecutiveFailures: 3, since: 100 } }) as TaskView;
beforeEach(() => { vi.resetAllMocks(); mock.byId.clear(); mock.stop.mockResolvedValue(undefined); mock.refresh.mockResolvedValue(undefined); });
afterEach(cleanup);

it('offers waiting without stopping or replaying; a later failure streak is shown again', () => {
  const current = task(), view = render(<ServiceFailureNotice task={current} />);
  expect(screen.getByRole('alert').textContent).toContain('WillYou 不会自动重发写操作');
  expect(mock.stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续等待' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mock.stop).not.toHaveBeenCalled();
  view.rerender(<ServiceFailureNotice task={{ ...current, serviceFailure: { consecutiveFailures: 3, since: 200 } }} />);
  expect(screen.getByRole('alert')).toBeTruthy();
});
it('only exposes the recovery choice after the exact run has actually stopped', async () => {
  const current = task(); mock.byId.set(current.id, { ...current, ptyId: null });
  render(<ServiceFailureNotice task={current} />);
  fireEvent.click(screen.getByRole('button', { name: '中断并选择配置' }));
  await waitFor(() => expect(mock.drop).toHaveBeenCalledWith('task'));
  expect(mock.stop).toHaveBeenCalledExactlyOnceWith('task', 'pty-1');
});
it('preserves the terminal if a newer run replaced the warning or stopping failed', async () => {
  const current = task(); mock.byId.set(current.id, { ...current, ptyId: 'pty-2' });
  render(<ServiceFailureNotice task={current} />);
  fireEvent.click(screen.getByRole('button', { name: '中断并选择配置' }));
  await screen.findByText('会话状态已改变，请刷新后再操作');
  expect(mock.drop).not.toHaveBeenCalled();
  mock.stop.mockRejectedValueOnce(new Error('停止失败'));
  fireEvent.click(screen.getByRole('button', { name: '中断并选择配置' }));
  await screen.findByText('停止失败');
  expect(mock.drop).not.toHaveBeenCalled();
});
it('does not show stopped, archived or healthy tasks as failures', () => {
  const view = render(<ServiceFailureNotice task={{ ...task(), ptyId: null }} />);
  expect(screen.queryByRole('alert')).toBeNull();
  view.rerender(<ServiceFailureNotice task={{ ...task(), archivedAt: 1 }} />);
  expect(screen.queryByRole('alert')).toBeNull();
  view.rerender(<ServiceFailureNotice task={{ ...task(), serviceFailure: null }} />);
  expect(screen.queryByRole('alert')).toBeNull();
});
