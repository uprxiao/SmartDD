import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '@shared/tasks';

const rpc = vi.hoisted(() => ({ tasks: { open: vi.fn(), list: vi.fn(), kill: vi.fn(), closeSession: vi.fn(), create: vi.fn(), delete: vi.fn(), setArchived: vi.fn(), stopAndArchive: vi.fn() } }));
const files = vi.hoisted(() => ({ prepareFileWorkspaceClose: vi.fn() }));
vi.mock('../features/files/workspace-store', () => files);
vi.mock('../lib/ipc', () => ({ rpc, events: { on: () => () => undefined } }));
vi.mock('./terminal-size', () => ({ terminalSize: () => ({ cols: 80, rows: 24 }) }));

import { navigation } from './navigation';
import { tasksStore } from './tasks-store';

beforeEach(() => {
  files.prepareFileWorkspaceClose.mockResolvedValue({ assertCurrent: vi.fn(), commit: vi.fn(async () => undefined), cancel: vi.fn() });
  rpc.tasks.closeSession.mockImplementation(async (id: string) => ({ ...tasksStore.byId.get(id), ptyId: null }));
});
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
    const closing = tasksStore.closeTab(stopped.id);
    expect(tasksStore.tabs).toContain(stopped.id);
    expect(tasksStore.closing.has(stopped.id)).toBe(true);
    release({ task: { ...stopped, ptyId: 'late-pty' }, ptyId: 'late-pty' });
    await closing;

    expect(rpc.tasks.closeSession).toHaveBeenCalledWith(stopped.id);
    expect(rpc.tasks.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(tasksStore.resuming.has(stopped.id)).toBe(false));
    expect(tasksStore.tabs).toEqual([]);
    expect(tasksStore.terminals.has(stopped.id)).toBe(false);
  });
});

describe('tasksStore session close transaction', () => {
  const opened = (id: string) => {
    const a = { id, projectId: 'kept-project', title: 'Kept history', archivedAt: null, ptyId: 'pty-' + id } as TaskView;
    const b = { id: id + '-other', archivedAt: null, ptyId: 'pty-other' } as TaskView;
    tasksStore.tasks = [a, b]; tasksStore.tabs = [a.id, b.id]; tasksStore.terminals.clear();
    tasksStore.terminals.set(a.id, a.ptyId!); tasksStore.terminals.set(b.id, b.ptyId!);
    navigation.openTask(a.id); return { a, b };
  };
  it('keeps view and terminal when file preparation fails and never requests a stop', async () => {
    const { a, b } = opened('save-failure');
    files.prepareFileWorkspaceClose.mockRejectedValueOnce(new Error('keep draft'));
    await expect(tasksStore.closeTab(a.id)).rejects.toThrow('keep draft');
    expect(navigation.currentTaskId).toBe(a.id); expect(tasksStore.tabs).toEqual([a.id, b.id]);
    expect(tasksStore.terminals.get(a.id)).toBe(a.ptyId); expect(rpc.tasks.closeSession).not.toHaveBeenCalled();
    expect(tasksStore.closing.size).toBe(0);
  });
  it('waits for exact terminal exit before scope commit and keeps other sessions intact', async () => {
    const { a, b } = opened('exit-receipt');
    const preparation = { assertCurrent: vi.fn(), commit: vi.fn(async () => undefined), cancel: vi.fn() };
    files.prepareFileWorkspaceClose.mockResolvedValueOnce(preparation);
    let exited!: (task: TaskView) => void;
    rpc.tasks.closeSession.mockImplementationOnce(() => new Promise(resolve => { exited = resolve; }));
    const closing = tasksStore.closeTab(a.id);
    await vi.waitFor(() => expect(rpc.tasks.closeSession).toHaveBeenCalledWith(a.id));
    expect(navigation.currentTaskId).toBe(a.id); expect(preparation.commit).not.toHaveBeenCalled();
    navigation.openTask(b.id); exited({ ...a, ptyId: null }); await closing;
    expect(preparation.commit).toHaveBeenCalledOnce(); expect(navigation.currentTaskId).toBe(b.id);
    expect(tasksStore.terminals.get(b.id)).toBe(b.ptyId); expect(tasksStore.terminals.has(a.id)).toBe(false);
    expect(tasksStore.byId.get(a.id)).toMatchObject({ title: 'Kept history', projectId: 'kept-project', archivedAt: null });
    expect(rpc.tasks.delete).not.toHaveBeenCalled(); expect(rpc.tasks.setArchived).not.toHaveBeenCalled();
  });
  it('does not evict files or hide the view after a failed stop and permits an explicit retry', async () => {
    const { a } = opened('stop-failure');
    const preparation = { assertCurrent: vi.fn(), commit: vi.fn(async () => undefined), cancel: vi.fn() };
    files.prepareFileWorkspaceClose.mockResolvedValue(preparation);
    rpc.tasks.closeSession.mockRejectedValueOnce(new Error('PTY still alive'));
    await expect(tasksStore.closeTab(a.id)).rejects.toThrow('PTY still alive');
    expect(preparation.commit).not.toHaveBeenCalled(); expect(preparation.cancel).toHaveBeenCalledOnce();
    expect(navigation.currentTaskId).toBe(a.id); expect(tasksStore.terminals.get(a.id)).toBe(a.ptyId);
    await tasksStore.closeTab(a.id); expect(tasksStore.tabs).not.toContain(a.id);
  });
  it('keeps the view when scope release fails, including an explicitly discarded draft', async () => {
    const { a } = opened('scope-failure');
    files.prepareFileWorkspaceClose.mockResolvedValueOnce({ assertCurrent: vi.fn(), commit: vi.fn(async () => { throw new Error('scope not released'); }), cancel: vi.fn() });
    await expect(tasksStore.closeTab(a.id, 'discard')).rejects.toThrow('scope not released');
    expect(files.prepareFileWorkspaceClose).toHaveBeenCalledWith({ kind: 'task', taskId: a.id }, 'discard');
    expect(navigation.currentTaskId).toBe(a.id); expect(tasksStore.tabs).toContain(a.id);
  });
  it('drains a late resume before closing and cannot stop or replace the later reopened PTY', async () => {
    const { a, b } = opened('generation');
    tasksStore.tasks = [{ ...a, ptyId: null, aiProfileId: 'profile', recovery: 'resumable' }, b];
    tasksStore.terminals.delete(a.id);
    let late!: (result: { task: TaskView; ptyId: string }) => void;
    rpc.tasks.open.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
    const resuming = tasksStore.resume({ taskId: a.id });
    const closing = tasksStore.closeTab(a.id);
    tasksStore.show(a.id);
    await expect(tasksStore.resume({ taskId: a.id })).rejects.toThrow('会话正在关闭');
    expect(rpc.tasks.open).toHaveBeenCalledOnce(); expect(rpc.tasks.closeSession).not.toHaveBeenCalled();
    late({ task: a, ptyId: 'old-late-pty' }); await Promise.all([resuming, closing]);
    rpc.tasks.open.mockResolvedValueOnce({ task: a, ptyId: 'fresh-reopened-pty' });
    rpc.tasks.list.mockResolvedValue([a, b]);
    await tasksStore.resume({ taskId: a.id });
    expect(tasksStore.terminals.get(a.id)).toBe('fresh-reopened-pty');
    expect(rpc.tasks.closeSession).toHaveBeenCalledOnce(); expect(rpc.tasks.kill).not.toHaveBeenCalled();
  });
});
