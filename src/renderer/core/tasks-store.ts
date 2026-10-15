import { makeAutoObservable, runInAction } from 'mobx';
import { tasksChangedEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { CreateTaskRequest, OpenTaskRequest, TaskView } from '@shared/tasks';
import { events, rpc } from '@renderer/lib/ipc';
import { shouldAutoResume } from './auto-resume';
import { navigation } from './navigation';
import { nextTabAfterClose, withTab } from './task-tabs';
import { terminalSize } from './terminal-size';

/**
 * Main owns the truth (records + which task runs in which PTY); this mirrors tasks.list and
 * keeps the window's task tabs, each with the terminal it shows, so scrollback survives
 * switching. Tabs live in memory only: a restart opens nothing (PRD F05).
 */
class TasksStore {
  tasks: TaskView[] = [];
  loaded = false;
  /** Open task tabs, in strip order. */
  tabs: string[] = [];
  /** taskId → ptyId of every terminal this window has shown, including exited ones. */
  terminals = new Map<string, string>();
  /** Tabs whose auto-resume is in flight. */
  resuming = new Set<string>();
  /** Why the last auto-resume of a tab failed. */
  resumeErrors = new Map<string, string>();
  /** Tabs already auto-resumed (or that must not be, until reopened): see shouldAutoResume. */
  private autoResumed = new Set<string>();

  constructor() {
    makeAutoObservable(this);
    events.on(tasksChangedEvent, () => void this.refresh());
  }

  get byId(): Map<string, TaskView> {
    return new Map(this.tasks.map((t) => [t.id, t]));
  }

  get current(): TaskView | null {
    return navigation.currentTaskId ? (this.byId.get(navigation.currentTaskId) ?? null) : null;
  }

  get openTabs(): TaskView[] {
    return this.tabs.map((id) => this.byId.get(id)).filter((t): t is TaskView => t !== undefined);
  }

  async refresh(): Promise<void> {
    const list = await rpc.tasks.list({ includeArchived: true });
    runInAction(() => {
      this.tasks = list;
      this.loaded = true;
      // Deleted tasks drop their tab and terminal.
      for (const id of [...this.terminals.keys()]) if (!list.some((t) => t.id === id)) this.terminals.delete(id);
      this.tabs = this.tabs.filter((id) => list.some((t) => t.id === id));
    });
  }

  /** Throws so the caller shows the error where the user acted. */
  async create(req: CreateTaskRequest): Promise<TaskView> {
    const res = await rpc.tasks.create({ ...terminalSize(), ...req });
    runInAction(() => {
      this.terminals.set(res.task.id, res.ptyId);
      this.autoResumed.add(res.task.id);
      this.tabs = withTab(this.tabs, res.task.id, navigation.currentViewId === 'task' ? navigation.currentTaskId : null);
    });
    await this.refresh();
    navigation.openTask(res.task.id);
    return res.task;
  }

  /**
   * Open a task in its tab (a new one if needed) and, when it is stopped, resume it on the
   * profile it ran on. The stopped panel only stays when there is a real choice to make.
   */
  show(taskId: string): void {
    this.tabs = withTab(this.tabs, taskId, navigation.currentViewId === 'task' ? navigation.currentTaskId : null);
    navigation.openTask(taskId);
    const task = this.byId.get(taskId);
    if (task && !this.terminals.has(taskId)) void this.autoResume(task);
  }

  /** Resume a stopped task on its original profile, once per opened tab. False: not tried. */
  async autoResume(task: TaskView): Promise<boolean> {
    if (!shouldAutoResume(task, this.autoResumed)) return false;
    this.autoResumed.add(task.id);
    this.resuming.add(task.id);
    this.resumeErrors.delete(task.id);
    try {
      await this.resume({ taskId: task.id });
    } catch (e) {
      runInAction(() => this.resumeErrors.set(task.id, rpcErrorMessage(e)));
    } finally {
      runInAction(() => this.resuming.delete(task.id));
    }
    return true;
  }

  async resume(req: OpenTaskRequest): Promise<void> {
    const res = await rpc.tasks.open({ ...terminalSize(), ...req });
    runInAction(() => {
      this.terminals.set(req.taskId, res.ptyId);
      this.autoResumed.add(req.taskId);
      this.resumeErrors.delete(req.taskId);
    });
    await this.refresh();
  }

  /** Hide an exited terminal so the stopped panel (profile choice, recovery info) shows. */
  dropTerminal(taskId: string): void {
    this.terminals.delete(taskId);
    this.autoResumed.add(taskId);
  }

  /** Closing a tab ends its session; opening the task again resumes it. */
  async closeTab(taskId: string): Promise<void> {
    const task = this.byId.get(taskId);
    const next = nextTabAfterClose(this.tabs, taskId, navigation.currentTaskId);
    this.tabs = this.tabs.filter((id) => id !== taskId);
    this.terminals.delete(taskId);
    this.autoResumed.delete(taskId);
    this.resumeErrors.delete(taskId);
    if (navigation.currentTaskId === taskId) {
      if (next && navigation.currentViewId === 'task') navigation.openTask(next);
      else navigation.closeTask(taskId);
    }
    if (task?.ptyId) await rpc.tasks.kill(taskId);
  }

  async remove(taskId: string): Promise<void> {
    await rpc.tasks.delete(taskId);
    runInAction(() => {
      this.terminals.delete(taskId);
      this.tabs = this.tabs.filter((id) => id !== taskId);
    });
    navigation.closeTask(taskId);
    await this.refresh();
  }
}

export const tasksStore = new TasksStore();
