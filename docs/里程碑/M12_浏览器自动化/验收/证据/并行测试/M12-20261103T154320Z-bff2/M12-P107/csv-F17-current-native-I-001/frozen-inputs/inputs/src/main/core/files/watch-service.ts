import { randomUUID } from 'node:crypto';
import { subscribe, type AsyncSubscription, type SubscribeCallback } from '@parcel/watcher';
import { FileError, type FileEntry, type FileWatchUpdate } from '@shared/files';
import { FileRootsService, identityKey, type RootLease } from './roots';
import type { NativeFileBroker } from './native-broker';
import type { FileRecoveryStore } from './recovery-store';
import { fileWatchBudget as budget, watchScanCooldown, watchScanCostMessage } from './watch-budget';

type Subscribe = (path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>;
interface Consumer {
  id: string; owner: string; lease: RootLease; directories: string[]; files: string[];
  emit: (update: FileWatchUpdate) => void; previous: string | null; sequence: number; version: number; dispose: () => void;
}
interface SharedWatch {
  key: string; path: string; consumers: Map<string, Consumer>; coverage: FileWatchUpdate['coverage'];
  message?: string; baseMessage?: string; costMessage?: string; permissionProblem?: string;
  native: AsyncSubscription | null; pending: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null; running: boolean; again: boolean; closed: boolean;
  interval: number; retryAt: number; hints: number; abort: AbortController; due: number;
  connection: number; nextAllowedAt: number;
}
interface Snapshot { value: string; permission?: string }

/** Native events are invalidation hints only. Every visible result is derived
 * from a fresh broker snapshot, including fallback polling and atomic swaps. */
export class FileWatchService {
  private readonly shared = new Map<string, SharedWatch>();
  private readonly consumers = new Map<string, { watch: SharedWatch; consumer: Consumer }>();
  private readonly stops = new Set<Promise<void>>();
  private readonly starts = new Set<Promise<void>>();
  private readonly scans = new Set<Promise<void>>();
  constructor(private readonly roots: FileRootsService, private readonly broker: NativeFileBroker, private readonly recovery: FileRecoveryStore,
    private readonly nativeSubscribe: Subscribe = (path, callback) => subscribe(path, callback, process.platform === 'darwin' ? { backend: 'fs-events' } : {})) {}

  get resourceCounts() { return { roots: this.shared.size, consumers: this.consumers.size, timers: [...this.shared.values()].filter((item) => item.timer).length, stopping: this.stops.size }; }
  start(owner: string, lease: RootLease, directories: string[], files: string[], emit: Consumer['emit']): FileWatchUpdate {
    const key = `${lease.canonicalPath}:${identityKey(lease.identity)}`;
    let watch = this.shared.get(key);
    if (!watch) { watch = { key, path: lease.canonicalPath, consumers: new Map(), coverage: 'none', native: null, pending: null, timer: null, running: false, again: false, closed: false, interval: budget.minPollIntervalMs, retryAt: 0, hints: 0, abort: new AbortController(), due: 0, connection: 0, nextAllowedAt: 0 }; this.shared.set(key, watch); }
    const id = randomUUID(), consumer: Consumer = { id, owner, lease, directories, files, emit, previous: null, sequence: 0, version: 0, dispose: () => this.stop(owner, id) };
    this.consumers.set(id, { watch, consumer }); watch.consumers.set(id, consumer);
    consumer.dispose = () => { consumer.emit({ ...this.update(watch!, consumer, false, true), coverage: 'none', rootInvalidated: true, message: lease.abort.signal.reason instanceof FileError ? lease.abort.signal.reason.message : '目录来源已失效，监听已停止；已有编辑仍保留，请重新关联原目录' }); this.stop(owner, id); };
    lease.abort.signal.addEventListener('abort', consumer.dispose, { once: true });
    this.connect(watch); this.schedule(watch, 0);
    return this.update(watch, consumer, false, true);
  }
  configure(owner: string, id: string, lease: RootLease, directories: string[], files: string[]): void {
    const { watch, consumer } = this.require(owner, id);
    if (consumer.lease !== lease) throw new FileError('UNTRUSTED', '监听引用不属于此目录来源');
    consumer.version++; consumer.directories = directories; consumer.files = files; consumer.previous = null; this.schedule(watch, 0);
    consumer.emit(this.update(watch, consumer, false, true));
  }
  stop(owner: string, id: string): void {
    const item = this.consumers.get(id); if (!item || item.consumer.owner !== owner) return;
    const { watch, consumer } = item;
    consumer.lease.abort.signal.removeEventListener('abort', consumer.dispose); this.consumers.delete(id); watch.consumers.delete(id);
    if (watch.consumers.size) return;
    watch.closed = true; watch.abort.abort(); if (watch.timer) clearTimeout(watch.timer); watch.timer = null; this.shared.delete(watch.key);
    if (watch.native) { this.unsubscribe(watch.native); watch.native = null; }
  }
  private require(owner: string, id: string) {
    const item = this.consumers.get(id); if (!item || item.consumer.owner !== owner) throw new FileError('UNTRUSTED', '监听引用已失效或不属于当前窗口');
    this.roots.require(owner, item.consumer.lease); return item;
  }
  private unsubscribe(native: AsyncSubscription): void {
    const work = native.unsubscribe().catch((error) => { console.error('[files:watch] unsubscribe failed', error); }).finally(() => this.stops.delete(work));
    this.stops.add(work);
  }
  private update(watch: SharedWatch, consumer: Consumer, changed: boolean, resyncRequired: boolean): FileWatchUpdate {
    return { id: consumer.id, lease: consumer.lease.lease, generation: consumer.lease.generation, sequence: ++consumer.sequence, coverage: watch.coverage, resyncRequired, changed, message: watch.message };
  }
  private publish(watch: SharedWatch, changed = false, resync = true): void {
    if (watch.closed) return;
    for (const consumer of watch.consumers.values()) consumer.emit(this.update(watch, consumer, changed, resync));
  }
  private connect(watch: SharedWatch): void {
    if (watch.closed || watch.pending || watch.native || watch.permissionProblem || Date.now() < watch.retryAt) return;
    const connection = ++watch.connection;
    watch.pending = this.nativeSubscribe(watch.path, (error, events) => {
      if (watch.closed || watch.connection !== connection) return;
      if (error) { this.fallback(watch, error.message); return; }
      watch.hints += events.length;
      if (watch.hints > 2000) { this.fallback(watch, '目录事件较多，已合并通知并降级补扫'); return; }
      this.schedule(watch, budget.eventDebounceMs);
    }).then((native) => {
      if (watch.closed || watch.connection !== connection) { this.unsubscribe(native); return; }
      watch.native = native; watch.coverage = 'native'; watch.baseMessage = undefined; this.message(watch); watch.interval = budget.minPollIntervalMs;
      this.publish(watch); this.schedule(watch, 0);
    }).catch((error) => { if (!watch.closed && watch.connection === connection) this.fallback(watch, error instanceof Error ? error.message : String(error)); }).finally(() => { if (watch.pending) this.starts.delete(watch.pending); watch.pending = null; });
    this.starts.add(watch.pending);
  }
  private fallback(watch: SharedWatch, message: string): void {
    if (watch.closed) return;
    watch.connection++;
    if (watch.native) { this.unsubscribe(watch.native); watch.native = null; }
    watch.coverage = 'poll'; watch.baseMessage = `原生监听不可用，正在补扫已展开目录和打开文件：${message}`; this.message(watch);
    watch.retryAt = Date.now() + budget.nativeReconnectBackoffMs; watch.interval = budget.minPollIntervalMs;
    this.publish(watch); this.schedule(watch, 0);
  }
  private schedule(watch: SharedWatch, delay: number): void {
    if (watch.closed) return;
    if (watch.running) { watch.again = true; return; }
    const now = Date.now(), due = Math.max(now + delay, watch.nextAllowedAt);
    if (watch.timer && watch.due <= due) return;
    if (watch.timer) clearTimeout(watch.timer);
    watch.due = due;
    watch.timer = setTimeout(() => { watch.timer = null; const work = this.scan(watch).finally(() => this.scans.delete(work)); this.scans.add(work); }, Math.max(0, due - now));
  }
  private async scan(watch: SharedWatch): Promise<void> {
    if (watch.closed || watch.running) return;
    watch.running = true; watch.again = false; watch.hints = 0;
    const started = Date.now(), snapshots = new Map<string, Promise<Snapshot>>(); let anyChange = false;
    const completed: { consumer: Consumer; version: number; values: Snapshot[] }[] = [];
    try {
      for (const consumer of [...watch.consumers.values()]) {
        if (watch.closed || !watch.consumers.has(consumer.id)) continue;
        try {
          this.roots.require(consumer.owner, consumer.lease);
          const version = consumer.version;
          const values = await Promise.all([
            ...consumer.directories.map((path) => this.snapshot(consumer.lease, 'list', path, snapshots, watch.abort.signal)),
            ...consumer.files.map((path) => this.snapshot(consumer.lease, 'metadata', path, snapshots, watch.abort.signal)),
          ]);
          this.roots.require(consumer.owner, consumer.lease);
          if (watch.closed || !watch.consumers.has(consumer.id) || version !== consumer.version) continue;
          completed.push({ consumer, version, values });
        } catch (error) {
          if (watch.closed || !watch.consumers.has(consumer.id)) continue;
          consumer.emit({ ...this.update(watch, consumer, false, true), coverage: 'none', message: error instanceof Error ? error.message : String(error) });
        }
      }
      if (watch.closed) return;
      const current = completed.filter(({ consumer, version }) => watch.consumers.has(consumer.id) && consumer.version === version);
      const permission = current.flatMap(({ values }) => values.flatMap(value => value.permission ? [value.permission] : [])).sort().join('; ');
      if (permission && permission !== watch.permissionProblem) {
        watch.permissionProblem = permission; this.fallback(watch, `读取权限发生变化：${permission}`);
      } else if (!permission && watch.permissionProblem && current.length === watch.consumers.size) {
        watch.permissionProblem = undefined; watch.baseMessage = '读取权限已恢复，正在补扫已展开目录和打开文件，等待原生监听重连'; this.message(watch); this.publish(watch);
      }
      for (const { consumer, values } of current) {
        const next = JSON.stringify(values.map(value => value.value)), changed = consumer.previous !== null && consumer.previous !== next;
        consumer.previous = next; anyChange ||= changed; consumer.emit(this.update(watch, consumer, changed, false));
      }
    } finally {
      watch.running = false;
      if (!watch.closed) {
        const elapsed = Math.max(0, Date.now() - started), previousMessage = watch.message;
        watch.costMessage = watchScanCostMessage(elapsed); this.message(watch); watch.nextAllowedAt = Date.now() + watchScanCooldown(elapsed);
        if (watch.message !== previousMessage) this.publish(watch, false, false);
        this.connect(watch); watch.interval = anyChange ? budget.minPollIntervalMs : Math.min(budget.maxPollIntervalMs, watch.interval * 2);
        this.schedule(watch, watch.again ? budget.eventDebounceMs : watch.coverage === 'native' ? budget.nativeReconcileIntervalMs : watch.interval);
      }
    }
  }
  private message(watch: SharedWatch): void { watch.message = [watch.baseMessage, watch.costMessage].filter(Boolean).join('；') || undefined; }
  private snapshot(lease: RootLease, operation: 'list' | 'metadata', relativePath: string, cache: Map<string, Promise<Snapshot>>, signal: AbortSignal): Promise<Snapshot> {
    const key = `${operation}:${relativePath}`;
    const existing = cache.get(key); if (existing) return existing;
    const result = this.broker.request<{ entries?: FileEntry[] }>({ operation, root: lease.descriptor, relativePath, protected: this.recovery.protectedIdentities() }, { signal: AbortSignal.any([lease.abort.signal, signal]) }).then((value) => {
      if (value.entries) value.entries.sort((a, b) => a.name.localeCompare(b.name));
      return { value: JSON.stringify(value) };
    }).catch(async (error) => {
      await this.roots.observeFailure(lease, error); if (lease.abort.signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return { value: JSON.stringify({ error: message }), permission: error instanceof FileError && error.code === 'PERMISSION' ? `${relativePath || '.'}：${message}` : undefined };
    });
    cache.set(key, result); return result;
  }
  async dispose(): Promise<void> {
    for (const { consumer } of [...this.consumers.values()]) this.stop(consumer.owner, consumer.id);
    await Promise.allSettled([...this.starts]); await Promise.allSettled([...this.scans]); await Promise.allSettled([...this.stops]);
  }
}
