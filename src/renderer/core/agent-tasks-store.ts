// M14 新任务列表（侧栏与首页）。
import { makeAutoObservable, runInAction } from 'mobx';
import { agentTaskEvent } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';
import { navigation } from '@renderer/core/navigation';

export type AgentTaskSummary = Awaited<ReturnType<typeof rpc.agentTasks.list>>[number];
const NOTIFY = 'willyou-m14-request-notify';
export const requestNotifyEnabled = () => { try { return localStorage.getItem(NOTIFY) !== 'false'; } catch { return true; } };
export const setRequestNotify = (on: boolean) => { try { localStorage.setItem(NOTIFY, String(on)); } catch { /* 无痕 */ } void rpc.schedule.setNotifyEnabled(on).catch(()=>{}); };

class AgentTasksStore {
  tasks: AgentTaskSummary[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() { makeAutoObservable<AgentTasksStore, 'timer' | 'unsubscribe'>(this, { timer: false, unsubscribe: false }); }

  start() {
    if (this.unsubscribe) return;
    void rpc.schedule.setNotifyEnabled(requestNotifyEnabled()).catch(()=>{});
    this.unsubscribe = events.on(agentTaskEvent, e => {
      if (e.type === 'task.removed' && navigation.currentViewId === 'agentTask' && navigation.currentAgentTaskId === e.taskId) {
        navigation.newTask(this.tasks.find(task => task.taskId === e.taskId)?.projectId ?? undefined);
      }
      this.scheduleRefresh();
      // 窗口在后台时用系统通知提醒待处理请求（需求 R01，设置可关）；页面内不做通知卡片。
      if (e.type === 'request.opened' && !e.scheduled && requestNotifyEnabled() && typeof Notification !== 'undefined' && !document.hasFocus()) {
        const title = this.tasks.find(t => t.taskId === e.taskId)?.title ?? '任务';
        const n = new Notification('WillYou · 等待你处理', { body: title });
        n.onclick = () => { window.focus(); navigation.openAgentTask(e.taskId); };
      }
    });
    void this.refresh();
  }
  private scheduleRefresh() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 150); }

  async refresh() {
    try { const list = await rpc.agentTasks.list(); runInAction(() => { this.tasks = list; }); }
    catch { /* 主进程未就绪时保留旧列表 */ }
  }
  of(projectId: string|null) {
    const rows = this.tasks.filter(t => t.projectId === projectId).sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''));
    const ids = new Set(rows.map(t => t.taskId));
    return rows.filter(t => !t.parentTaskId || !ids.has(t.parentTaskId)).flatMap(t => [t, ...rows.filter(c => c.parentTaskId === t.taskId)]);
  }
}

export const agentTasksStore = new AgentTasksStore();
