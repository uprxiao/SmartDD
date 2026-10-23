import { randomUUID } from 'node:crypto';

export type RecoveryCode = 'CONNECTED' | 'RECOVERY_UNSUPPORTED' | 'RECOVERY_EXHAUSTED' | 'RECOVERY_REVOKED' | 'STALE_GENERATION';
export interface RecoveryResult { code: RecoveryCode; generation: number; attempts: number }
export interface RecoveryAttempt { instanceId: string; generation: number; signal: AbortSignal }
/** Only host composition may register this authority. No renderer/bridge supplied identities. */
export interface BridgeRecoveryAuthority {
  capability: 'supported' | 'unsupported' | 'unverified';
  evidence?: string;
  /** Rechecks the original live run, fixed resources and current authorization. */
  validate(): Promise<void>;
  /** Resolves true only after a verified handshake; must obey cancellation and clean its tickets. */
  replace?(attempt: RecoveryAttempt): Promise<boolean>;
}
interface Entry {
  authority: BridgeRecoveryAuthority;
  generation: number;
  attempts: number;
  revoked: boolean;
  workerActive?: boolean;
  controller?: AbortController;
  pending?: Promise<RecoveryResult>;
  recoveryGeneration?: number;
  result?: RecoveryResult;
}
/** Host-only finite recovery coordination. Never restarts an Agent or replays business calls. */
export class BridgeSupervisor {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly random: () => number = Math.random) {}
  private key(runId: string, serverName: string): string { return JSON.stringify([runId, serverName]); }
  register(runId: string, serverName: string, authority: BridgeRecoveryAuthority): void {
    const key = this.key(runId, serverName);
    if (this.entries.has(key)) throw new Error('Bridge recovery authority already registered');
    this.entries.set(key, { authority, generation: 0, attempts: 0, revoked: false });
  }
  inspect(runId: string, serverName: string) {
    const entry = this.entries.get(this.key(runId, serverName));
    return entry ? { generation: entry.generation, attempts: entry.attempts, revoked: entry.revoked, recovering: !!entry.pending, workerActive: !!entry.workerActive, result: entry.result && { ...entry.result } } : undefined;
  }
  revoke(runId: string, serverName: string): void {
    const entry = this.entries.get(this.key(runId, serverName));
    if (!entry) return;
    entry.revoked = true;
    entry.controller?.abort();
  }
  /** Host calls only for a newly observed disconnection or explicit user retry/config repair. */
  beginRecovery(runId: string, serverName: string, expectedGeneration: number, reason: 'disconnected' | 'user-retry' | 'configuration-repaired'): boolean {
    const entry = this.entries.get(this.key(runId, serverName));
    if (!entry || entry.revoked || entry.pending || entry.workerActive || entry.generation !== expectedGeneration) return false;
    if (reason === 'disconnected' && entry.result?.code !== 'CONNECTED') return false;
    // Advance before a new episode so delayed callers cannot spend its budget.
    entry.generation++;
    entry.attempts = 0;
    entry.result = undefined;
    return true;
  }
  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(); return; }
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  prepareReplacement(runId: string, serverName: string, expectedGeneration: number, budgetMs = 10_000): Promise<RecoveryResult> {
    const entry = this.entries.get(this.key(runId, serverName));
    if (!entry) return Promise.resolve({ code: 'RECOVERY_REVOKED', generation: 0, attempts: 0 });
    const result = (code: RecoveryCode): RecoveryResult => ({ code, generation: entry.generation, attempts: entry.attempts });
    if (entry.revoked) return Promise.resolve(result('RECOVERY_REVOKED'));
    // Concurrent callers share ownership, even while a replacement advances the generation.
    if (entry.pending && (expectedGeneration === entry.generation || expectedGeneration === entry.recoveryGeneration)) return entry.pending;
    if (expectedGeneration !== entry.generation) return Promise.resolve(result('STALE_GENERATION'));
    if (entry.result) return Promise.resolve({ ...entry.result }); // Calls cannot reset an exhausted budget.
    if (entry.authority.capability !== 'supported' || !entry.authority.evidence || !entry.authority.replace) {
      entry.result = result('RECOVERY_UNSUPPORTED');
      return Promise.resolve({ ...entry.result });
    }
    entry.recoveryGeneration = expectedGeneration;
    const controller = new AbortController();
    entry.controller = controller;
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(30_000, Number.isFinite(budgetMs) ? budgetMs : 10_000)));
    const aborted = new Promise<RecoveryResult>(resolve => controller.signal.addEventListener('abort', () => resolve(result(entry.revoked ? 'RECOVERY_REVOKED' : 'RECOVERY_EXHAUSTED')), { once: true }));
    entry.workerActive = true;
    const work = async (): Promise<RecoveryResult> => {
      for (; entry.attempts < 3;) {
        if (entry.attempts > 0) await this.wait((entry.attempts === 1 ? 1000 : 3000) + Math.floor(Math.max(0, Math.min(1, this.random())) * 100), controller.signal);
        if (controller.signal.aborted) return result(entry.revoked ? 'RECOVERY_REVOKED' : 'RECOVERY_EXHAUSTED');
        try { await entry.authority.validate(); } catch { entry.revoked = true; controller.abort(); return result('RECOVERY_REVOKED'); }
        if (controller.signal.aborted) return result(entry.revoked ? 'RECOVERY_REVOKED' : 'RECOVERY_EXHAUSTED');
        entry.attempts++;
        const generation = ++entry.generation;
        let connected = false;
        try { connected = await entry.authority.replace!({ instanceId: randomUUID(), generation, signal: controller.signal }); } catch { /* Same finite budget; no business replay. */ }
        if (controller.signal.aborted) return result(entry.revoked ? 'RECOVERY_REVOKED' : 'RECOVERY_EXHAUSTED');
        try { await entry.authority.validate(); } catch { entry.revoked = true; controller.abort(); return result('RECOVERY_REVOKED'); }
        if (controller.signal.aborted) return result(entry.revoked ? 'RECOVERY_REVOKED' : 'RECOVERY_EXHAUSTED');
        if (connected && entry.generation === generation) return result('CONNECTED');
      }
      return result('RECOVERY_EXHAUSTED');
    };
    entry.pending = Promise.race([work().finally(() => { entry.workerActive = false; }), aborted]).then(value => { entry.result = value; return { ...value }; }).finally(() => { clearTimeout(timeout); entry.pending = undefined; entry.controller = undefined; });
    return entry.pending;
  }
}
