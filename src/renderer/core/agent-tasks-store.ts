// M14 新任务列表（侧栏与首页）。开发期由本机开关启用；关闭时沿用旧任务入口不变。
import { makeAutoObservable, runInAction } from 'mobx';
import { agentTaskEvent } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';

export type AgentTaskSummary = Awaited<ReturnType<typeof rpc.agentTasks.list>>[number];
const FLAG = 'willyou-m14-agent-workspace';
const readFlag = () => { try { return localStorage.getItem(FLAG) === 'true'; } catch { return false; } };

class AgentTasksStore {
  enabled = typeof localStorage !== 'undefined' && readFlag();
  tasks: AgentTaskSummary[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() { makeAutoObservable<AgentTasksStore, 'timer' | 'unsubscribe'>(this, { timer: false, unsubscribe: false }); }

  setEnabled(on: boolean) {
    this.enabled = on;
    try { localStorage.setItem(FLAG, String(on)); } catch { /* 无痕环境 */ }
    if (on) this.start(); else this.stopListening();
  }

  start() {
    if (!this.enabled || this.unsubscribe) return;
    this.unsubscribe = events.on(agentTaskEvent, () => this.scheduleRefresh());
    void this.refresh();
  }
  private stopListening() { this.unsubscribe?.(); this.unsubscribe = null; }
  private scheduleRefresh() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 150); }

  async refresh() {
    try { const list = await rpc.agentTasks.list(); runInAction(() => { this.tasks = list; }); }
    catch { /* 主进程未就绪时保留旧列表 */ }
  }
  of(projectId: string) { return this.tasks.filter(t => t.projectId === projectId); }
}

export const agentTasksStore = new AgentTasksStore();
