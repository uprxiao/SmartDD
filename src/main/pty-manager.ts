import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
}

const loginShell = () => process.env.SHELL || '/bin/zsh';

// Run through a login+interactive shell so PATH matches the user's terminal even when the
// app is launched from Finder. "$0" bypasses shell aliases/functions such as `claude`.
export function shellWrapped(command: string, args: string[]): { file: string; args: string[] } {
  return { file: loginShell(), args: ['-l', '-i', '-c', 'exec "$0" "$@"', command, ...args] };
}

export class PtyManager extends EventEmitter {
  private readonly ptys = new Map<string, pty.IPty>();

  spawn(opts: SpawnOptions): string {
    const id = randomUUID();
    const { file, args } = shellWrapped(opts.command, opts.args);
    const p = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 32,
      cwd: opts.cwd,
      env: opts.env,
    });
    this.ptys.set(id, p);
    p.onData((d) => this.emit('data', id, d));
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id);
      this.emit('exit', id, exitCode);
    });
    return id;
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data);
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
  }

  get count(): number {
    return this.ptys.size;
  }
}
