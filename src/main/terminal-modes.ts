import { Terminal } from '@xterm/xterm';

/** Observe native output with the same locked parser as the visible terminal.
 * No DOM is opened and no generated onData/onBinary response is wired to PTY.
 * Public write callbacks form a barrier before controlled paste is written.
 */
export class TerminalModes {
  private readonly terminal = new Terminal({ cols: 256, rows: 1, scrollback: 0, logLevel: 'off' });
  private pending = Promise.resolve();
  private disposed = false;
  private failure: unknown = null;
  private cancel!: () => void;
  private readonly cancelled = new Promise<void>(resolve => { this.cancel = resolve; });
  feed(data: string): void {
    if (this.disposed || this.failure) return;
    try {
      const parsed = new Promise<void>(resolve => this.terminal.write(data, resolve));
      this.pending = Promise.all([this.pending, parsed]).then(() => undefined);
    } catch (error) { this.failure = error; }
  }
  async bracketedPaste(): Promise<boolean> {
    for (;;) {
      if (this.disposed || this.failure) throw new Error('终端输入模式当前不可用');
      const pending = this.pending; await Promise.race([pending, this.cancelled]);
      if (this.disposed || this.failure) throw new Error('终端输入模式当前不可用');
      if (pending === this.pending) return this.terminal.modes.bracketedPasteMode;
    }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.cancel(); this.terminal.dispose(); }
}
