// 新任务的手动终端（需求 R01、技术方案 §3 terminal.open／close）：在任务目录起用户的登录 shell，
// 与 Agent 运行分离，不取得 Agent 业务身份；每个任务至多一个。
import { loginShell } from '../../launch-env';

export interface TerminalPtys {
  spawn(opts: { command: string; args: string[]; cwd: string; env: Record<string, string>; cols?: number; rows?: number }): string;
  has(id: string): boolean;
  kill(id: string): void;
  on(event: 'exit', listener: (id: string, code: number) => void): unknown;
}

export class AgentManualTerminals {
  private readonly byTask = new Map<string, string>();
  constructor(private readonly d: { ptys: TerminalPtys; taskCwd: (taskId: string) => string; baseEnv: () => Record<string, string> }) {
    d.ptys.on('exit', id => { for (const [t, p] of this.byTask) if (p === id) this.byTask.delete(t); });
  }
  activePty(taskId: string) { const id = this.byTask.get(taskId); return id && this.d.ptys.has(id) ? id : null; }
  open(taskId: string, size?: { cols: number; rows: number }) {
    const existing = this.activePty(taskId);
    if (existing) return { ptyId: existing };
    const cwd = this.d.taskCwd(taskId);
    const cols = Math.min(Math.max(size?.cols ?? 120, 20), 500), rows = Math.min(Math.max(size?.rows ?? 24, 5), 200);
    const ptyId = this.d.ptys.spawn({ command: loginShell(), args: ['-i'], cwd, env: { ...this.d.baseEnv(), TERM: 'xterm-256color' }, cols, rows });
    this.byTask.set(taskId, ptyId);
    return { ptyId };
  }
  close(taskId: string) { const id = this.activePty(taskId); if (id) this.d.ptys.kill(id); this.byTask.delete(taskId); }
  closeAll() { for (const t of [...this.byTask.keys()]) this.close(t); }
}
