import { makeAutoObservable, runInAction } from 'mobx';
import { tasksChangedEvent } from '@shared/events';
import type { CreateTaskRequest, OpenTaskRequest, TaskView } from '@shared/tasks';
import { events, rpc } from '@renderer/lib/ipc';
import { shouldAutoResume } from './auto-resume';
import { navigation } from './navigation';

/**
 * Main owns the truth (records + which task runs in which PTY); this mirrors tasks.list and
 * remembers which terminals the renderer has mounted so their scrollback survives navigation.
 */
class TasksStore {
  tasks: TaskView[] = [];
  loaded = false;
  /** taskId → ptyId of every terminal this window has shown, including exited ones. */
  terminals = new Map<string, string>();
  /** Tasks this window has already auto-resumed (or must not): see shouldAutoResume. */
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

  async refresh(): Promise<void> {
    const list = await rpc.tasks.list({ includeArchived: true });
    runInAction(() => {
      this.tasks = list;
      this.loaded = true;
      // Deleted tasks drop their terminal.
      for (const id of [...this.terminals.keys()]) if (!list.some((t) => t.id === id)) this.terminals.delete(id);
    });
  }

  /** Throws so the caller shows the error where the user acted. */
  async create(req: CreateTaskRequest): Promise<TaskView> {
    const res = await rpc.tasks.create(req);
    runInAction(() => {
      this.terminals.set(res.task.id, res.ptyId);
      this.autoResumed.add(res.task.id);
    });
    await this.refresh();
    navigation.openTask(res.task.id);
    return res.task;
  }

  /** Show a task; the stopped panel resumes it on its original profile (autoResume). */
  show(taskId: string): void {
    navigation.openTask(taskId);
  }

  /** Resume a stopped task on its original profile, at most once per window. False: not tried. */
  async autoResume(task: TaskView): Promise<boolean> {
    if (!shouldAutoResume(task, this.autoResumed)) return false;
    this.autoResumed.add(task.id);
    await this.resume({ taskId: task.id });
    return true;
  }

  async resume(req: OpenTaskRequest): Promise<void> {
    const res = await rpc.tasks.open(req);
    runInAction(() => {
      this.terminals.set(req.taskId, res.ptyId);
      this.autoResumed.add(req.taskId);
    });
    await this.refresh();
    navigation.openTask(req.taskId);
  }

  /** Hide an exited terminal so the stopped panel (profile choice, recovery info) shows. */
  dropTerminal(taskId: string): void {
    this.terminals.delete(taskId);
    this.autoResumed.add(taskId);
  }

  async remove(taskId: string): Promise<void> {
    await rpc.tasks.delete(taskId);
    runInAction(() => this.terminals.delete(taskId));
    navigation.closeTask(taskId);
    await this.refresh();
  }
}

export const tasksStore = new TasksStore();
