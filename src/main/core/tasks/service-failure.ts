import type { Runner } from '@shared/types';
import { classifyClaudeLine, classifyCodexLine } from '../ai/health-classify';

export type ServiceEvent = { kind: 'failure' | 'success'; id?: string } |
  { kind: 'request'; id: string; signature: string; at: number };

/** Read trusted Native records, never error-looking user/tool/assistant text. */
export function serviceEvent(runner: Runner, value: unknown): ServiceEvent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.isSidechain === true) return null;
  const id = typeof row.uuid === 'string' ? row.uuid : undefined;
  // Interactive Claude does not persist api_error on retries. Four identical
  // main-thread requests without an answer indicate repeated attempts, not a
  // verified HTTP error. Keep only opaque hashes, never the body or terminal text.
  if (runner === 'claude' && row.type === 'api-request') {
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    if (row.querySource !== 'repl_main_thread' || typeof row.id !== 'string' || !row.id ||
      typeof row.sessionId !== 'string' || !row.sessionId || !Number.isFinite(at) ||
      typeof row.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.requestDigest) ||
      typeof row.shapeHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.shapeHash)) return null;
    return { kind: 'request', id: `request:${row.id}`, signature: `${row.sessionId}:${row.shapeHash}:${row.requestDigest}`, at };
  }
  // Claude 2.1.322 Native JSONL; print's api_retry has a different shape.
  if (runner === 'claude' && row.type === 'system' && row.subtype === 'api_error') {
    const error = row.error as Record<string, unknown> | null;
    if (row.source !== 'request_retry' || row.level !== 'error' || !id ||
      !Number.isSafeInteger(row.retryAttempt) || (row.retryAttempt as number) < 1 ||
      !error || typeof error !== 'object') return null;
    const status = error.status;
    return (typeof status === 'number' && status >= 500 && status <= 599) ||
      error.isNetworkDown === true || error.noResponse === true
      ? { kind: 'failure', id } : null;
  }
  const event = runner === 'claude' ? classifyClaudeLine(value) : runner === 'codex' ? classifyCodexLine(value) : null;
  if (!event) return null;
  return { kind: event.category === 'ok' ? 'success' : 'failure', id };
}

/** Ephemeral per-run state. No callback can stop a CLI or resend a request. */
export class ServiceFailureStreak {
  private failures = 0;
  private since = 0;
  private readonly seen = new Set<string>();
  private repeated: { signature: string; count: number; firstAt: number } | null = null;

  get notice(): { consecutiveFailures: number; since: number } | null {
    return this.failures >= 3 ? { consecutiveFailures: this.failures, since: this.since } : null;
  }

  take(event: ServiceEvent, now: number): boolean {
    if (event.id && this.seen.has(event.id)) return false;
    if (event.id) { this.seen.add(event.id); if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!); }
    const before = Boolean(this.notice);
    if (event.kind === 'request') {
      if (!this.repeated || this.repeated.signature !== event.signature || now < this.repeated.firstAt || now - this.repeated.firstAt > 120_000) {
        this.repeated = { signature: event.signature, count: 1, firstAt: now };
      } else this.repeated.count = Math.min(4, this.repeated.count + 1);
      if (this.repeated.count === 4) {
        if (!this.failures) this.since = this.repeated.firstAt;
        this.failures = 3;
      }
    }
    else if (event.kind === 'success') { this.failures = 0; this.since = 0; this.repeated = null; }
    else { if (this.failures === 0) this.since = now; this.failures = Math.min(3, this.failures + 1); }
    return before !== Boolean(this.notice);
  }
}
