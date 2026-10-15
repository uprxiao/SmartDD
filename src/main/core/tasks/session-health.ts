import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { ProfileCheckCategory } from '@shared/ai-profiles';
import type { Runner } from '@shared/types';
import { classifyClaudeLine, classifyCodexLine, type HealthEvent } from '../ai/health-classify';

// Follows a running task's session file and reports what the API answered: a real reply means
// the profile works, an API error (auth, balance, model…) means it does not. Only the lines that
// can carry such a verdict are parsed; everything else is skipped by a substring check.

const CHUNK_MAX = 4 * 1024 * 1024;

// Substrings a verdict line must contain (checked before JSON.parse; some lines are ~70 KB).
const ERROR_HINTS: Record<Runner, string[]> = {
  claude: ['"isApiErrorMessage":true'],
  codex: ['"task_complete"', '"type":"error"'],
};
const OK_HINTS: Record<Runner, string[]> = {
  claude: ['"type":"assistant"'],
  codex: ['"role":"assistant"'],
};

export interface SessionTailOptions {
  runner: Runner;
  /** The session file once it exists; called on every poll until it returns a path. */
  locate: () => string | null;
  launchedAt: number;
  onEvent: (ev: HealthEvent) => void;
}

export class SessionTail {
  private file: string | null = null;
  private offset = 0;
  private rest = '';
  private last: ProfileCheckCategory | null = null;

  constructor(private readonly o: SessionTailOptions) {}

  /** Whether any verdict was seen (used to tell an early crash from a working session). */
  get sawEvent(): boolean {
    return this.last != null;
  }

  poll(): void {
    if (!this.file) {
      const f = this.o.locate();
      if (!f) return;
      this.file = f;
      // A file written before this launch (resume) holds old answers: start at its end.
      const st = statSync(f);
      this.offset = st.birthtimeMs >= this.o.launchedAt - 2000 ? 0 : st.size;
    }
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size < this.offset) {
      // Truncated or replaced: read it again from the start.
      this.offset = 0;
      this.rest = '';
    }
    if (size === this.offset) return;
    const len = Math.min(size - this.offset, CHUNK_MAX);
    const buf = Buffer.alloc(len);
    const fd = openSync(this.file, 'r');
    try {
      readSync(fd, buf, 0, len, this.offset);
    } finally {
      closeSync(fd);
    }
    this.offset += len;
    const text = this.rest + buf.toString('utf8');
    const nl = text.lastIndexOf('\n');
    // Keep an unfinished last line for the next poll.
    this.rest = nl === -1 ? text : text.slice(nl + 1);
    if (nl !== -1) for (const line of text.slice(0, nl).split('\n')) this.take(line);
  }

  private take(line: string): void {
    const { runner } = this.o;
    const isError = ERROR_HINTS[runner].some((h) => line.includes(h));
    // Once the last verdict was ok, further replies say nothing new.
    if (!isError && (this.last === 'ok' || !OK_HINTS[runner].some((h) => line.includes(h)))) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const ev = runner === 'claude' ? classifyClaudeLine(json) : classifyCodexLine(json);
    if (!ev) return;
    this.last = ev.category;
    this.o.onEvent(ev);
  }
}
