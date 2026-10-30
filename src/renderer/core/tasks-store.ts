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
  /** A close is a transaction: its view remains available until every step succeeds. */
  closing = new Set<string>();
  private readonly resumeEpochs = new Map<string, number>();
  private readonly opening = new Map<string, Promise<{ task: TaskView; ptyId: string }>>();
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
    if (this.closing.has(taskId)) return;
    this.tabs = withTab(this.tabs, taskId, navigation.currentViewId === 'task' ? navigation.currentTaskId : null);
    navigation.openTask(taskId);
    const task = this.byId.get(taskId);
    if (task && !this.terminals.has(taskId)) void this.autoResume(task);
  }

  /** Resume a stopped task on its original profile, once per opened tab. False: not tried. */
  async autoResume(task: TaskView): Promise<boolean> {
    if (this.closing.has(task.id)) return false;
    if (!shouldAutoResume(task, this.autoResumed)) return false;
    const epoch = this.resumeEpochs.get(task.id) ?? 0;
    this.autoResumed.add(task.id);
    this.resuming.add(task.id);
    this.resumeErrors.delete(task.id);
    try {
      await this.resume({ taskId: task.id });
    } catch (e) {
      if ((this.resumeEpochs.get(task.id) ?? 0) === epoch) runInAction(() => this.resumeErrors.set(task.id, rpcErrorMessage(e)));
    } finally {
      if ((this.resumeEpochs.get(task.id) ?? 0) === epoch) runInAction(() => this.resuming.delete(task.id));
    }
    return true;
  }

  async resume(req: OpenTaskRequest): Promise<void> {
    if (this.closing.has(req.taskId)) throw new Error('会话正在关闭，请稍后再打开');
    if (this.opening.has(req.taskId)) throw new Error('会话正在恢复，请稍后再试');
    const epoch = this.resumeEpochs.get(req.taskId) ?? 0;
    const hadTab = this.tabs.includes(req.taskId);
    const opening = rpc.tasks.open({ ...terminalSize(), ...req });
    this.opening.set(req.taskId, opening);
    let res: Awaited<typeof opening>;
    try { res = await opening; }
    finally { if (this.opening.get(req.taskId) === opening) this.opening.delete(req.taskId); }
    // The closing transaction owns this launch now. It waits for this exact
    // response before stopping, so an obsolete reply can never kill a reopened PTY.
    if ((this.resumeEpochs.get(req.taskId) ?? 0) !== epoch || this.closing.has(req.taskId)) return;
    // The tab was closed while the CLI was starting: closing means ending, so end it now.
    if (hadTab && !this.tabs.includes(req.taskId)) {
      await rpc.tasks.kill(req.taskId);
      await this.refresh();
      return;
    }
    runInAction(() => {
      this.terminals.set(req.taskId, res.ptyId);
      this.autoResumed.add(req.taskId);
      this.resumeErrors.delete(req.taskId);
    });
    await this.refresh();
  }

  /** Archive only after main confirms success; preserve other sessions and terminal scrollback. */
  async setArchived(taskId: string, archived: boolean, stopRunning = false): Promise<void> {
    if (this.closing.has(taskId)) throw new Error('会话正在关闭，请稍后再试');
    const result = archived && stopRunning
      ? await rpc.tasks.stopAndArchive(taskId)
      : await rpc.tasks.setArchived(taskId, archived);
    runInAction(() => {
      this.tasks = this.tasks.map((task) => task.id === taskId ? result : task);
      // Keep the terminal's scrollback in memory. Unarchiving never starts a CLI by itself.
      this.autoResumed.add(taskId);
      this.resumeErrors.delete(taskId);
      if (archived) {
        const wasVisible = navigation.currentTaskId === taskId && navigation.currentViewId === 'task';
        navigation.closeTask(taskId);
        if (wasVisible && result.projectId) navigation.newTask(result.projectId);
      }
    });
    await this.refresh();
  }

  /** Hide an exited terminal so the stopped panel (profile choice, recovery info) shows. */
  dropTerminal(taskId: string): void {
    this.terminals.delete(taskId);
    this.autoResumed.add(taskId);
  }

  /** Closing a tab ends its session; opening the task again resumes it. */
  async closeTab(taskId: string, action: 'save' | 'discard' = 'save'): Promise<void> {
    if (this.closing.has(taskId)) throw new Error('会话正在关闭，请稍后再试');
    this.closing.add(taskId);
    this.resumeEpochs.set(taskId, (this.resumeEpochs.get(taskId) ?? 0) + 1);
    let preparation: Awaited<ReturnType<(typeof import('../features/files/workspace-store'))['prepareFileWorkspaceClose']>> | undefined;
    let opened: { task: TaskView; ptyId: string } | undefined;
    let closed = false;
    try {
      // Main opens synchronously, but the IPC reply may be late. Drain only
      // this task's request; attempts to reopen it stay blocked until commit.
      opened = await this.opening.get(taskId)?.catch(() => undefined);
      const { prepareFileWorkspaceClose } = await import('../features/files/workspace-store');
      preparation = await prepareFileWorkspaceClose({ kind: 'task', taskId }, action);
      preparation.assertCurrent();
      const result = await rpc.tasks.closeSession(taskId);
      preparation.assertCurrent();
      await preparation.commit();
      runInAction(() => {
        const next = nextTabAfterClose(this.tabs, taskId, navigation.currentTaskId);
        this.tasks = this.tasks.map(task => task.id === taskId ? result : task);
        this.tabs = this.tabs.filter(id => id !== taskId);
        this.terminals.delete(taskId);
        this.autoResumed.delete(taskId);
        this.resumeErrors.delete(taskId);
        if (navigation.currentTaskId === taskId) {
          if (next && navigation.currentViewId === 'task') navigation.openTask(next);
          else navigation.closeTask(taskId);
        }
      });
      closed = true;
    } finally {
      preparation?.cancel();
      runInAction(() => {
        // Failed save/stop keeps the original view, including a launch whose
        // reply was held by this transaction. Never reopen or kill it again.
        if (!closed && opened && this.tabs.includes(taskId)) this.terminals.set(taskId, opened.ptyId);
        this.resuming.delete(taskId);
        this.closing.delete(taskId);
      });
    }
  }

  async remove(taskId: string): Promise<void> {
    if (this.closing.has(taskId)) throw new Error('会话正在关闭，请稍后再试');
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
