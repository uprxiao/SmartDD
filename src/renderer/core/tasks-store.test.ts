import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '@shared/tasks';

const rpc = vi.hoisted(() => ({ tasks: { open: vi.fn(), list: vi.fn(), kill: vi.fn(), create: vi.fn(), delete: vi.fn() } }));
vi.mock('../lib/ipc', () => ({ rpc, events: { on: () => () => undefined } }));
vi.mock('./terminal-size', () => ({ terminalSize: () => ({ cols: 80, rows: 24 }) }));

import { navigation } from './navigation';
import { tasksStore } from './tasks-store';

afterEach(() => vi.clearAllMocks());

// Regression for the M3 review (M1): closing a tab means ending its session, even mid-resume.
describe('tasksStore.resume', () => {
  it('ends the CLI that comes up after its tab was closed, and shows no terminal for it', async () => {
    const stopped = { id: 'tab-task', ptyId: null, archivedAt: null, aiProfileId: 'profile', recovery: 'resumable' } as TaskView;
    tasksStore.tasks = [stopped];
    tasksStore.tabs = [];
    tasksStore.terminals.clear();
    tasksStore.resuming.clear();
    navigation.newTask();
    let release!: (r: { task: TaskView; ptyId: string }) => void;
    rpc.tasks.open.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    rpc.tasks.list.mockResolvedValue([stopped]);

    tasksStore.show(stopped.id);
    expect(tasksStore.resuming.has(stopped.id)).toBe(true);
    await tasksStore.closeTab(stopped.id);
    release({ task: { ...stopped, ptyId: 'late-pty' }, ptyId: 'late-pty' });

    await vi.waitFor(() => expect(rpc.tasks.kill).toHaveBeenCalledWith(stopped.id));
    await vi.waitFor(() => expect(tasksStore.resuming.has(stopped.id)).toBe(false));
    expect(tasksStore.tabs).toEqual([]);
    expect(tasksStore.terminals.has(stopped.id)).toBe(false);
  });
});
