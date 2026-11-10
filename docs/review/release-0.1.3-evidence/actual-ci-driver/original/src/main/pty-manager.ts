import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import { shellWrapped } from './launch-env';
export { loginShell, shellWrapped } from './launch-env';
import { TerminalModes } from './terminal-modes';

export interface SpawnOptions {
  /** Optional identity reserved by the host before forking; never accepted from renderer input. */
  id?: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** From planLaunchEnv; applied after the rc files. */
  scriptArgs?: string[];
  cols?: number;
  rows?: number;
}

export class PtyManager extends EventEmitter {
  private readonly ptys = new Map<string, pty.IPty>();
  private readonly modes = new Map<string, TerminalModes>();

  spawn(opts: SpawnOptions): string {
    const id = opts.id ?? randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) || this.ptys.has(id)) throw new Error('PTY_IDENTITY_CONFLICT');
    const { file, args } = shellWrapped(opts.command, opts.args, opts.scriptArgs);
    const p = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 32,
      cwd: opts.cwd,
      env: opts.env,
    });
    this.ptys.set(id, p);
    const modes = new TerminalModes(); this.modes.set(id, modes);
    p.onData((d) => { modes.feed(d); this.emit('data', id, d); });
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id);
      modes.dispose(); this.modes.delete(id);
      this.emit('exit', id, exitCode);
    });
    return id;
  }

  has(id: string): boolean { return this.ptys.has(id); }

  /** Native handle receipt, main-process only. Never infer a PID from terminal output. */
  nativePid(id: string): number | null { return this.ptys.get(id)?.pid ?? null; }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data);
  }

  /** Acknowledges only a write accepted by the live native PTY instance. */
  writeControlled(id: string, data: string): void {
    const pty = this.ptys.get(id);
    if (!pty) throw new Error('TERMINAL_TARGET_DENIED');
    pty.write(data);
  }

  async bracketedPaste(id: string): Promise<boolean> {
    const modes = this.modes.get(id);
    if (!modes || !this.ptys.has(id)) throw new Error('TERMINAL_TARGET_DENIED');
    return modes.bracketedPaste();
  }

  resize(id: string, cols: number, rows: number): void {
    this.ptys.get(id)?.resize(cols, rows);
  }

  kill(id: string): void {
    this.ptys.get(id)?.kill();
  }

  killAll(): void {
    for (const p of this.ptys.values()) p.kill();
    this.ptys.clear();
    for (const modes of this.modes.values()) modes.dispose();
    this.modes.clear();
  }

  get count(): number {
    return this.ptys.size;
  }
  processId(id: string): number | null { return this.ptys.get(id)?.pid ?? null; }
}
