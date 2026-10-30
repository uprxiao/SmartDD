import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '@shared/tasks';

const rpc = vi.hoisted(() => ({ tasks: { open: vi.fn(), list: vi.fn(), kill: vi.fn(), create: vi.fn(), delete: vi.fn(), setArchived: vi.fn(), stopAndArchive: vi.fn() } }));
vi.mock('../lib/ipc', () => ({ rpc, events: { on: () => () => undefined } }));
vi.mock('./terminal-size', () => ({ terminalSize: () => ({ cols: 80, rows: 24 }) }));

import { navigation } from './navigation';
import { tasksStore } from './tasks-store';

afterEach(() => vi.clearAllMocks());

describe('tasksStore archiving', () => {
  it('archives the visible task only after confirmation succeeds, preserves terminals, and restores without launching', async () => {
    const a = { id: 'archive-a', projectId: 'original-project', archivedAt: null, ptyId: 'pty-a' } as TaskView;
    const b = { id: 'archive-b', archivedAt: null, ptyId: 'pty-b' } as TaskView;
    tasksStore.tasks = [a, b];
    tasksStore.tabs = [a.id, b.id];
    tasksStore.terminals.clear();
    tasksStore.terminals.set(a.id, a.ptyId!);
    tasksStore.terminals.set(b.id, b.ptyId!);
    navigation.openTask(a.id);
    let finish!: (result: TaskView) => void;
    rpc.tasks.stopAndArchive.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const archived = { ...a, archivedAt: 100, ptyId: null };
    rpc.tasks.list.mockResolvedValue([archived, b]);
    const pending = tasksStore.setArchived(a.id, true, true);
    expect(navigation.currentTaskId).toBe(a.id);
    finish(archived);
    await pending;
    expect(navigation.currentViewId).toBe('home');
    expect(navigation.homePreset?.projectId).toBe(a.projectId);
    expect([...tasksStore.terminals]).toEqual([[a.id, 'pty-a'], [b.id, 'pty-b']]);
    tasksStore.show(a.id); // Archived search/list results do not auto-start.
    expect(rpc.tasks.open).not.toHaveBeenCalled();
    rpc.tasks.setArchived.mockResolvedValue({ ...a, ptyId: null });
    rpc.tasks.list.mockResolvedValue([{ ...a, ptyId: null }, b]);
    await tasksStore.setArchived(a.id, false);
    expect(tasksStore.byId.get(a.id)?.projectId).toBe('original-project');
    expect(navigation.currentTaskId).toBe(a.id);
    expect(rpc.tasks.open).not.toHaveBeenCalled();
    expect(rpc.tasks.kill).not.toHaveBeenCalled();
    expect(rpc.tasks.delete).not.toHaveBeenCalled();
  });

  it('leaves the task and navigation unchanged when stopping fails', async () => {
    const a = { id: 'archive-fail', archivedAt: null, ptyId: 'pty-fail' } as TaskView;
    tasksStore.tasks = [a];
    navigation.openTask(a.id);
    rpc.tasks.stopAndArchive.mockRejectedValue(new Error('stop failed'));
    await expect(tasksStore.setArchived(a.id, true, true)).rejects.toThrow('stop failed');
    expect(navigation.currentTaskId).toBe(a.id);
    expect(tasksStore.byId.get(a.id)?.archivedAt).toBeNull();
  });

  it('does not steal focus from another conversation opened while archive was pending', async () => {
    const a = { id: 'background-archive', archivedAt: null, ptyId: 'pty-a' } as TaskView;
    const b = { id: 'foreground-archive', archivedAt: null, ptyId: 'pty-b' } as TaskView;
    tasksStore.tasks = [a, b];
    navigation.openTask(a.id);
    let finish!: (result: TaskView) => void;
    rpc.tasks.stopAndArchive.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const archived = { ...a, archivedAt: 100, ptyId: null };
    rpc.tasks.list.mockResolvedValue([archived, b]);
    const pending = tasksStore.setArchived(a.id, true, true);
    navigation.openTask(b.id);
    finish(archived);
    await pending;
    expect(navigation.currentTaskId).toBe(b.id);
    expect(navigation.currentViewId).toBe('task');
  });
});

// Regression for the M3 review (M1): closing a tab means ending its session, even mid-resume.
describe('tasksStore.resume', () => {
  it('views unknown native history without launching, then permits an explicit same-task resume', async () => {
    const original = { id:'unknown-history-view', nativeSessionId:'original-native-id', ptyId:null, aiProfileId:'profile', archivedAt:null, recovery:'resumable', runtimeSnapshot:null } as TaskView;
    tasksStore.tasks=[original];tasksStore.tabs=[];tasksStore.terminals.clear();tasksStore.resuming.clear();
    tasksStore.show(original.id);
    expect(navigation.currentTaskId).toBe(original.id);
    expect(rpc.tasks.open).not.toHaveBeenCalled();
    expect(tasksStore.resuming.has(original.id)).toBe(false);
    expect(tasksStore.byId.get(original.id)?.runtimeSnapshot).toBeNull();
    const resumed={...original,ptyId:'explicit-history-pty'};
    rpc.tasks.open.mockResolvedValue({task:resumed,ptyId:resumed.ptyId});rpc.tasks.list.mockResolvedValue([resumed]);
    await tasksStore.resume({taskId:original.id});
    expect(rpc.tasks.open).toHaveBeenCalledTimes(1);
    expect(rpc.tasks.open).toHaveBeenCalledWith(expect.objectContaining({taskId:original.id}));
    expect(tasksStore.byId.get(original.id)?.nativeSessionId).toBe(original.nativeSessionId);
    expect(tasksStore.byId.get(original.id)?.runtimeSnapshot).toBeNull();
    expect(tasksStore.terminals.get(original.id)).toBe(resumed.ptyId);
  });
  it('switches sidebar conversations without restarting processes or discarding terminals', () => {
    const a = { id: 'sidebar-a', ptyId: 'pty-a' } as TaskView;
    const b = { id: 'sidebar-b', ptyId: 'pty-b' } as TaskView;
    tasksStore.tasks = [a, b];
    tasksStore.tabs = [a.id, b.id];
    tasksStore.terminals.clear();
    tasksStore.terminals.set(a.id, a.ptyId!);
    tasksStore.terminals.set(b.id, b.ptyId!);
    tasksStore.show(a.id);
    navigation.openSettings('voice');
    tasksStore.show(b.id);
    tasksStore.show(a.id);
    expect(navigation.currentTaskId).toBe(a.id);
    expect(navigation.currentViewId).toBe('task');
    expect([...tasksStore.terminals]).toEqual([[a.id, 'pty-a'], [b.id, 'pty-b']]);
    expect(rpc.tasks.open).not.toHaveBeenCalled();
    expect(rpc.tasks.kill).not.toHaveBeenCalled();
  });

  it('keeps an in-flight resume attached to its original conversation after a sidebar switch', async () => {
    const a = { id: 'resuming-a', ptyId: null, aiProfileId: 'profile', archivedAt: null, recovery: 'resumable' } as TaskView;
    const b = { id: 'running-b', ptyId: 'pty-b' } as TaskView;
    tasksStore.tasks = [a, b];
    tasksStore.tabs = [b.id];
    tasksStore.terminals.clear();
    tasksStore.terminals.set(b.id, b.ptyId!);
    let release!: (r: { task: TaskView; ptyId: string }) => void;
    rpc.tasks.open.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    rpc.tasks.list.mockResolvedValue([{ ...a, ptyId: 'pty-a' }, b]);
    tasksStore.show(a.id);
    tasksStore.show(b.id);
    release({ task: { ...a, ptyId: 'pty-a' }, ptyId: 'pty-a' });
    await vi.waitFor(() => expect(tasksStore.resuming.has(a.id)).toBe(false));
    expect(navigation.currentTaskId).toBe(b.id);
    expect(tasksStore.terminals.get(a.id)).toBe('pty-a');
    expect(tasksStore.terminals.get(b.id)).toBe('pty-b');
    expect(rpc.tasks.kill).not.toHaveBeenCalled();
  });

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
