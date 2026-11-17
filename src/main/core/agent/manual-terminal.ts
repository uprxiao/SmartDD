// 新任务的手动终端（需求 R01、技术方案 §3 terminal.open／close）：在任务目录起用户的登录 shell，
// 与 Agent 运行分离，不取得 Agent 业务身份；每个任务至多一个。
import { loginShell } from '../../launch-env';

export interface TerminalPtys {
  spawn(opts: { command: string; args: string[]; cwd: string; env: Record<string, string>; cols?: number; rows?: number }): string;
  has(id: string): boolean;
  kill(id: string): void;
  writeControlled?(id: string, data: string): void;
  bracketedPaste?(id: string): Promise<boolean>;
  on(event: 'exit', listener: (id: string, code: number) => void): unknown;
}

export class AgentManualTerminals {
  private readonly byTask = new Map<string, string>();
  constructor(private readonly d: { ptys: TerminalPtys; taskCwd: (taskId: string) => string; baseEnv: () => Record<string, string> }) {
    d.ptys.on('exit', id => { for (const [t, p] of this.byTask) if (p === id) this.byTask.delete(t); });
  }
  activePty(taskId: string) { const id = this.byTask.get(taskId); return id && this.d.ptys.has(id) ? id : null; }
  open(taskId: string, size?: { cols: number; rows: number }) {
    return this.openAt(taskId,this.d.taskCwd(taskId),size);
  }
  /** Host-only named shell (e.g. a selected registered home directory), not an Agent identity. */
  openAt(taskId:string,cwd:string,size?:{cols:number;rows:number}){
    const existing = this.activePty(taskId);
    if (existing) return { ptyId: existing };
    const cols = Math.min(Math.max(size?.cols ?? 120, 20), 500), rows = Math.min(Math.max(size?.rows ?? 24, 5), 200);
    const ptyId = this.d.ptys.spawn({ command: loginShell(), args: ['-i'], cwd, env: { ...this.d.baseEnv(), TERM: 'xterm-256color' }, cols, rows });
    this.byTask.set(taskId, ptyId);
    return { ptyId };
  }
  /**
   * 代码块“在终端运行”：把完整命令送入本任务终端的输入行、不自动执行（用例 A52）。
   * 多行命令只在 shell 开启括号粘贴模式时送入（整段作为一次粘贴，不会逐行执行）；否则拒绝并说明。
   */
  async paste(taskId: string, text: string) {
    const ptyId = this.activePty(taskId) ?? this.open(taskId).ptyId;
    const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!body || Buffer.byteLength(body) > 256 * 1024) throw new Error('命令为空或过长');
    if (!this.d.ptys.writeControlled) throw new Error('终端不可写');
    const multi = body.includes('\n');
    // 刚打开的 shell 需要时间开启括号粘贴模式；等待有界。
    let bracketed = false;
    for (let i = 0; i < 20 && !(bracketed = !!(await this.d.ptys.bracketedPaste?.(ptyId))); i++) await new Promise(r => setTimeout(r, 100));
    if (multi && !bracketed) throw new Error('当前 shell 未开启括号粘贴，多行命令不能安全送入（会逐行执行）');
    // 控制字符只保留换行与制表，防止命令文本自带回车或结束粘贴的序列。
    const safe = body.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    this.d.ptys.writeControlled(ptyId, bracketed ? `\x1b[200~${safe}\x1b[201~` : safe);
    return { ptyId };
  }

  close(taskId: string) { const id = this.activePty(taskId); if (id) this.d.ptys.kill(id); this.byTask.delete(taskId); }
  closeAll() { for (const t of [...this.byTask.keys()]) this.close(t); }
}
