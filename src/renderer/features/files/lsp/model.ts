/** Hover cadence shared by real editor events and deterministic timer tests. */
export class LanguageHover {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | null = null;
  private epoch = 0;
  private key = '';
  constructor(private readonly show: (value: { text: string; x: number; y: number } | null) => void) {}
  enter(key: string, x: number, y: number, request: (signal: AbortSignal) => Promise<string | null>, valid: () => boolean): void {
    clearTimeout(this.closeTimer);
    if (key === this.key) return;
    this.cancel(); this.key = key; const epoch = this.epoch;
    const attempt = async (retries: number) => {
      if (epoch !== this.epoch || !valid()) return;
      const abort = new AbortController(); this.abort = abort;
      try {
        const text = await request(abort.signal);
        if (epoch !== this.epoch || abort.signal.aborted || !valid()) return;
        if (text !== null) this.show({ text, x, y });
        else if (retries < 2) this.timer = setTimeout(() => void attempt(retries + 1), 500);
      } catch { /* request owner renders explicit service failures */ }
    };
    this.timer = setTimeout(() => void attempt(0), 300);
  }
  leave(): void { this.cancel(false); this.closeTimer = setTimeout(() => this.show(null), 100); }
  cancel(clear = true): void { this.epoch++; this.key = ''; clearTimeout(this.timer); clearTimeout(this.closeTimer); this.abort?.abort(); this.abort = null; if (clear) this.show(null); }
}
export class LanguageHistory<T> {
  entries: T[] = [];
  index = -1;
  constructor(private readonly same: (a: T, b: T) => boolean) {}
  get canBack(): boolean { return this.index > 0; }
  get canForward(): boolean { return this.index >= 0 && this.index < this.entries.length - 1; }
  record(from: T, to: T): void {
    if (this.same(from, to)) return;
    const entries = this.entries.slice(0, this.index + 1);
    if (!entries.length || !this.same(entries[entries.length - 1], from)) entries.push(from);
    if (!this.same(entries[entries.length - 1], to)) entries.push(to);
    this.entries = entries; this.index = entries.length - 1;
  }
  target(direction: -1 | 1): T | null { const next = this.index + direction; return next < 0 || next >= this.entries.length ? null : this.entries[next]; }
  commit(direction: -1 | 1): void { if (this.target(direction)) this.index += direction; }
}
