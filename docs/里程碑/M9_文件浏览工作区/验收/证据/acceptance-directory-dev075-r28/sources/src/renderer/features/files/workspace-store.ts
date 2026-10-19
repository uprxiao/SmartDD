import type { FileEntry, FileRoot, FileRoots, FileScope, FileWatchUpdate, FileSearchRow } from '@shared/files';
import { fileScopeKey, fileWorkspaceSchema, workspaceSnapshotSchema, workspaceUpdateSchema, type FileRoute, type SavedFileWorkspace, type WorkspacePersistence, type WorkspaceSnapshot, type WorkspaceUpdate } from '@shared/file-workspace';
import { fileWatchEvent, fileWorkspaceEvent } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';
import { FileBuffer, type FileClient } from './file-buffer';
import { isNonLocalFileSource, NONLOCAL_WORKSPACE_MESSAGE } from '@shared/file-source-boundary.mjs';
import { fileAttachmentHintSchema, type FileAttachmentHint } from '@shared/files';

export type { FileRoute } from '@shared/file-workspace';
export { fileScopeKey } from '@shared/file-workspace';
/** Host callbacks belong to this window only. An attachment is deliberately not
 * a durable route: reopening requires its originating host to supply callbacks. */
export interface LocalAttachment extends FileAttachmentHint { key: string; onDownload?: () => void | Promise<void>; onClose?: () => void | Promise<void> }
export const ATTACHMENT_SESSION_NOTICE = '本机附件为只读，仅在当前会话保留；关闭或重启后请从原来源重新打开。';
export interface FileTab { id: string; route: FileRoute; buffer: FileBuffer | null; pinned: boolean; error: string; loading: boolean; attachment?: Readonly<LocalAttachment>; loadSequence?: number }
export type DirectoryState = { state: 'loading' } | { state: 'ready'; entries: FileEntry[] } | { state: 'error'; message: string };
interface DirectoryRequest { id: string; root: FileRoot; path: string; previous?: Extract<DirectoryState, { state: 'ready' }>; promise: Promise<void> }
const sourceKey = (root: Pick<FileRoot, 'source' | 'sourceId' | 'path'>) => `${root.source}:${root.sourceId}:${root.path}`;
const routeKey = (route: FileRoute) => JSON.stringify([route.hostId ?? 'local', route.remotePath ?? null, route.source, route.sourceId, route.sourcePath, route.relativePath]);
const durableRoute = (tab: FileTab): FileRoute => {
  const position = tab.buffer?.pdfPosition;
  const pdf = tab.buffer ? tab.buffer.content.kind === 'pdf' && position?.initialized ? { page: position.page, zoom: position.zoom } : undefined : tab.route.pdf;
  return { source: tab.route.source, sourceId: tab.route.sourceId, sourcePath: tab.route.sourcePath, relativePath: tab.route.relativePath, mode: tab.buffer?.mode ?? tab.route.mode, ...(pdf ? { pdf } : {}), ...(tab.route.hostId !== undefined ? { hostId: tab.route.hostId } : {}), ...(tab.route.remotePath !== undefined ? { remotePath: tab.route.remotePath } : {}) };
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
// RPC namespaces are proxies created on property access; retain one identity for
// the production default rather than comparing separate rpc.files proxies.
const defaultFileApi = rpc.files;

/** Session state outlives React panels, just as task PTYs outlive their views.
 * Only stable routes/layout are serialized. No leases, bytes, EditorState or
 * resource URLs are persisted. Browser storage is a legacy migration source;
 * production writes are acknowledged by the main process database. */
export class FileWorkspaceStore {
  roots: FileRoots = { roots: [], unavailable: [] };
  treeRoot: FileRoot | null = null;
  loading = false;
  error = '';
  persistenceError = '';
  tabs: FileTab[] = [];
  activeId: string | null = null;
  expanded: Record<string, string[]> = {};
  collapsedRoots: string[] = [];
  filters: Record<string, string> = {};
  directories = new Map<string, DirectoryState>();
  treeWidth = 250;
  readonly scroll = new Map<string, number>();
  /** Session-only selection/focus, scoped to the issued root capability. */
  readonly treeViews = new Map<string, { focused: string; selected: string[] }>();
  readonly watchStates = new Map<string, FileWatchUpdate>();
  readonly metadataRevisions = new Map<string, number>();
  private readonly watches = new Map<string, { signature: string; id: string | null; token: number }>();
  private views = 0;
  private readonly viewFlushes = new Map<FileBuffer, Promise<boolean>>();
  readonly retryingRoots = new Set<string>();
  private readonly rootRetries = new Map<string, Promise<void>>();
  private watchToken = 0;
  private unlistenWatch: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly closed: FileRoute[] = [];
  private readonly pendingDirectories = new Map<string, DirectoryRequest>();
  private revision = 0;
  private initialized = false;
  private disposed = false;
  private epoch = 0;
  private intent = 0;
  private modeIntent = 0;
  private readonly storageKey: string;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private queuedState: string | null = null;
  private committedState: string | null = null;
  private workspaceRevision = 0;
  private workspaceWrites = 0;
  private applyingWorkspace = false;
  private unlistenWorkspace: (() => void) | null = null;
  private pendingWorkspace: WorkspaceSnapshot | null = null;
  private conflictingWorkspace: WorkspaceSnapshot | null = null;
  private readonly workspaceMutations = new Set<string>();
  constructor(readonly scope: FileScope, private readonly api: FileClient = defaultFileApi, private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
    private readonly persistence: WorkspacePersistence | null = api === defaultFileApi ? {
      load: (scope) => api.workspace(scope), snapshot: (scope) => api.workspaceSnapshot(scope),
      commit: (scope, state, revision, mutationId) => api.saveWorkspace(scope, state, revision, mutationId),
      subscribe: (listener) => events.on(fileWorkspaceEvent, listener),
    } : null) {
    this.storageKey = `willyou-files-v1:${fileScopeKey(scope)}`;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = () => this.revision;
  get active(): FileTab | null { return this.tabs.find((tab) => tab.id === this.activeId) ?? null; }
  get currentExpanded(): string[] { return this.treeRoot ? this.expanded[sourceKey(this.treeRoot)] ?? [] : []; }
  get rootExpanded(): boolean { return !this.treeRoot || !this.collapsedRoots.includes(sourceKey(this.treeRoot)); }
  toggleRoot(): void {
    if (!this.treeRoot) return;
    const key = sourceKey(this.treeRoot), collapse = this.rootExpanded;
    this.collapsedRoots = collapse ? [...this.collapsedRoots, key].slice(-200) : this.collapsedRoots.filter((item) => item !== key);
    if (collapse) for (const [id, request] of this.pendingDirectories) if (request.root.lease === this.treeRoot.lease) this.cancelDirectory(id);
    this.changed();
  }
  get activeRoot(): FileRoot | undefined { return this.active ? this.rootFor(this.active.route) : undefined; }
  get canRestoreClosed(): boolean { return this.closed.length > 0; }
  get filter(): string { return this.treeRoot ? this.filters[sourceKey(this.treeRoot)] ?? '' : ''; }
  setFilter(value: string): void { if (!this.treeRoot) return; this.filters[sourceKey(this.treeRoot)] = value.slice(0, 256); this.changed(); }
  attach(): () => void {
    this.views++;
    if (this.views === 1) for (const tab of this.tabs) if (tab.buffer && !this.viewFlushes.has(tab.buffer)) tab.buffer.resumeAutosave();
    if (!this.unlistenWatch) this.unlistenWatch = events.on(fileWatchEvent, (update) => this.receiveWatch(update));
    this.syncWatches();
    let attached = true;
    return () => {
      if (!attached) return; attached = false;
      this.views--;
      if (this.views > 0) return;
      for (const key of this.pendingDirectories.keys()) this.cancelDirectory(key);
      this.unlistenWatch?.(); this.unlistenWatch = null; this.watchToken++;
      for (const watch of this.watches.values()) if (watch.id) void this.api.stopWatch(watch.id).catch(() => undefined);
      this.watches.clear(); this.watchStates.clear();
      for (const tab of this.tabs) {
        const buffer = tab.buffer; if (!buffer) continue;
        buffer.pauseAutosave();
        if (this.viewFlushes.has(buffer)) continue;
        const flush = buffer.prepareClose('save').catch(error => {
          if (!this.disposed) { this.error = `文件保存未完成：${errorMessage(error)}`; this.changed(); }
          return false;
        });
        this.viewFlushes.set(buffer, flush);
        void flush.finally(() => {
          if (this.viewFlushes.get(buffer) !== flush) return;
          this.viewFlushes.delete(buffer);
          // Reattaching while this flush awaits IO must not let its final
          // timer cleanup swallow newer input's autosave.
          if (!this.disposed && this.views > 0) buffer.resumeAutosave();
        });
      }
    };
  }
  async flushDetachedViews(): Promise<void> { await Promise.allSettled([...this.viewFlushes.values()]); }
  private receiveWatch(update: FileWatchUpdate): void {
    const watch = this.watches.get(update.lease), previous = this.watchStates.get(update.lease);
    if (!this.views || watch?.id !== update.id || previous && update.sequence <= previous.sequence) return;
    this.watchStates.set(update.lease, update); this.changed();
    if (update.changed || update.resyncRequired) {
      const root = this.roots.roots.find((item) => item.lease === update.lease && item.generation === update.generation);
      if (root) void this.refreshRoot(root);
    }
  }
  private syncWatches(): void {
    if (!this.views || this.disposed) return;
    for (const root of this.roots.roots) {
      const directories = this.treeRoot === root ? ['', ...(this.expanded[sourceKey(root)] ?? [])] : [];
      const refs = this.tabs.flatMap((tab) => tab.buffer?.file.ref.lease === root.lease ? [tab.buffer.file.ref] : []);
      const signature = JSON.stringify({ directories, refs }), current = this.watches.get(root.lease);
      if (!directories.length && !refs.length) { if (current?.id) void this.api.stopWatch(current.id).catch(() => undefined); this.watches.delete(root.lease); this.watchStates.delete(root.lease); continue; }
      if (current?.signature === signature) continue;
      // Pending subscriptions reconcile their latest membership after start.
      if (current && !current.id) continue;
      const watch = { signature, id: current?.id ?? null, token: ++this.watchToken };
      this.watches.set(root.lease, watch);
      void this.api.watch(root, directories, refs, watch.id ?? undefined).then((update) => {
        if (this.disposed || !this.views || this.watches.get(root.lease) !== watch) { if (update) void this.api.stopWatch(update.id).catch(() => undefined); return; }
        if (update) { watch.id = update.id; this.receiveWatch(update); }
        this.syncWatches();
      }).catch((error) => {
        if (!this.disposed && this.views && this.watches.get(root.lease) === watch) {
          this.watchStates.set(root.lease, { id: watch.id ?? '', lease: root.lease, generation: root.generation, sequence: 0, coverage: 'none', resyncRequired: true, changed: false, message: errorMessage(error) });
          this.revision++; for (const listener of this.listeners) listener();
        }
      });
    }
  }
  private changed = () => {
    if (this.disposed) return;
    for (const tab of this.tabs) if (tab.buffer?.dirty) tab.pinned = true;
    this.revision++; void this.persist().catch(() => undefined); this.syncWatches(); for (const listener of this.listeners) listener();
  };
  private async saved(): Promise<SavedFileWorkspace | null> {
    let persisted: SavedFileWorkspace | null | undefined;
    if (this.persistence?.snapshot) {
      const snapshot = workspaceSnapshotSchema.parse(await this.persistence.snapshot(this.scope));
      this.workspaceRevision = snapshot.revision; persisted = snapshot.state;
    } else persisted = await this.persistence?.load(this.scope);
    if (persisted) return fileWorkspaceSchema.parse(persisted);
    // Never use a stale browser copy after a main-process read error.
    try { return fileWorkspaceSchema.parse(JSON.parse(this.storage?.getItem(this.storageKey) ?? 'null')); } catch { return null; }
  }
  private workspaceState(): SavedFileWorkspace {
    return { schemaVersion: 1, routes: this.tabs.filter((tab) => tab.pinned && !tab.attachment).map(durableRoute), active: this.active && !this.active.attachment ? durableRoute(this.active) : null, treeSource: this.treeRoot ? sourceKey(this.treeRoot) : null, expanded: this.expanded, collapsedRoots: this.collapsedRoots, filters: this.filters, treeWidth: this.treeWidth };
  }
  get persistenceConflict(): boolean { return this.conflictingWorkspace !== null; }
  get hasProtectedBuffers(): boolean { return this.tabs.some(tab => tab.buffer && (tab.buffer.dirty || tab.buffer.saving || tab.buffer.recoveryBlocked || tab.buffer.draftOptions.length > 0)); }
  private workspaceConflict(snapshot: WorkspaceSnapshot): void {
    if (!this.conflictingWorkspace || snapshot.revision > this.conflictingWorkspace.revision) this.conflictingWorkspace = snapshot;
    this.persistenceError = '另一窗口更新了标签；当前标签、选择与草稿已保留。保存当前窗口标签会采用此窗口的布局。';
    this.revision++; for (const listener of this.listeners) listener();
  }
  private receiveWorkspace = (input: WorkspaceUpdate): void => {
    const parsed = workspaceUpdateSchema.safeParse(input); if (!parsed.success || this.disposed) return;
    const update = parsed.data;
    if (fileScopeKey(update.scope) !== fileScopeKey(this.scope) || update.revision <= this.workspaceRevision) return;
    if (this.workspaceMutations.has(update.mutationId)) { this.workspaceRevision = update.revision; return; }
    if (!this.pendingWorkspace || update.revision > this.pendingWorkspace.revision) this.pendingWorkspace = update;
    this.drainWorkspace();
  };
  private drainWorkspace(): void {
    if (this.disposed || !this.initialized || this.loading || this.workspaceWrites || this.applyingWorkspace) return;
    const snapshot = this.pendingWorkspace; if (!snapshot) return;
    this.pendingWorkspace = null;
    if (snapshot.revision <= this.workspaceRevision) return;
    const current = JSON.stringify(this.workspaceState());
    const removesSelection = this.intent > 0 && this.active?.pinned && !this.active.attachment && !snapshot.state?.routes.some(route => routeKey(route) === routeKey(this.active!.route));
    if (this.conflictingWorkspace || this.hasProtectedBuffers || this.committedState !== current || removesSelection) { this.workspaceConflict(snapshot); return; }
    this.applyWorkspace(snapshot);
  }
  private applyWorkspace(snapshot: WorkspaceSnapshot): void {
    const saved = snapshot.state;
    this.applyingWorkspace = true;
    const previous = this.tabs, active = this.active, added: FileTab[] = [], sourceLoads: FileBuffer[] = [];
    const seen = new Set<string>();
    const routes = (saved?.routes ?? []).filter(route => { const key = routeKey(route); if (seen.has(key)) return false; seen.add(key); return true; });
    this.tabs = routes.map(route => {
      const existing = previous.find(tab => !tab.attachment && routeKey(tab.route) === routeKey(route));
      if (existing) {
        existing.pinned = true; existing.route = route;
        if (existing.buffer) {
          existing.buffer.mode = route.mode;
          if (route.mode === 'source' && !existing.buffer.editor && existing.buffer.content.mime === 'image/svg+xml') sourceLoads.push(existing.buffer);
        }
        return existing;
      }
      const tab: FileTab = { id: crypto.randomUUID(), route, buffer: null, pinned: true, error: '', loading: true }; added.push(tab); return tab;
    });
    for (const tab of previous) {
      if (this.tabs.includes(tab)) continue;
      if (!tab.pinned || tab.attachment) this.tabs.push(tab); else tab.buffer?.dispose();
    }
    this.activeId = active && this.intent > 0 && this.tabs.includes(active) ? active.id : this.tabs.find(tab => saved?.active && routeKey(tab.route) === routeKey(saved.active))?.id ?? this.tabs[0]?.id ?? null;
    this.expanded = saved?.expanded ?? {}; this.collapsedRoots = saved?.collapsedRoots ?? []; this.filters = saved?.filters ?? {}; this.treeWidth = saved?.treeWidth ?? 250;
    this.treeRoot = this.roots.roots.find(root => sourceKey(root) === saved?.treeSource) ?? this.roots.roots[0] ?? null;
    for (const [key, request] of this.pendingDirectories) if (request.root.lease !== this.treeRoot?.lease) this.cancelDirectory(key);
    this.workspaceRevision = snapshot.revision; this.conflictingWorkspace = null; this.persistenceError = '';
    // The local active/preview may intentionally differ. Treat this projection
    // as acknowledged, so receiving a remote snapshot never echoes a write.
    this.queuedState = this.committedState = JSON.stringify(this.workspaceState());
    this.applyingWorkspace = false; this.revision++; this.syncWatches(); for (const listener of this.listeners) listener();
    for (const tab of added) void this.loadTab(tab);
    for (const buffer of sourceLoads) void buffer.load();
    if (this.treeRoot) void this.list(this.treeRoot, '');
  }
  async reloadPersistence(): Promise<void> {
    if (!this.persistence?.snapshot || this.disposed) return;
    if (this.hasProtectedBuffers) throw new Error('请先处理当前未保存或恢复中的文件；标签与草稿已保留');
    await this.persistenceQueue.catch(() => undefined);
    const before = JSON.stringify(this.workspaceState()), intent = this.intent;
    const snapshot = workspaceSnapshotSchema.parse(await this.persistence.snapshot(this.scope));
    if (this.disposed) return;
    if (this.hasProtectedBuffers || before !== JSON.stringify(this.workspaceState()) || intent !== this.intent) throw new Error('读取期间当前标签已改变；请重试，当前内容已保留');
    this.pendingWorkspace = null; this.applyWorkspace(snapshot);
  }
  async retryPersistence(): Promise<void> {
    if (!this.persistence?.snapshot || !this.conflictingWorkspace) { await this.flushPersistence(); return; }
    await this.persistenceQueue.catch(() => undefined);
    const snapshot = workspaceSnapshotSchema.parse(await this.persistence.snapshot(this.scope));
    if (this.disposed) return;
    // Explicit user action: adopt only the current revision, then CAS the
    // current window layout. No automatic route merge or buffer replacement.
    this.workspaceRevision = snapshot.revision; this.conflictingWorkspace = null; this.pendingWorkspace = null; this.queuedState = null;
    await this.flushPersistence();
  }
  private persist(): Promise<void> {
    if (!this.initialized || this.disposed || this.applyingWorkspace) return this.persistenceQueue;
    if (this.conflictingWorkspace) return Promise.reject(new Error(this.persistenceError));
    const serialized = JSON.stringify(this.workspaceState());
    if (serialized === this.queuedState) return this.persistenceQueue;
    this.queuedState = serialized;
    this.workspaceWrites++;
    // Capture the serialized snapshot: later filter/expanded changes must not
    // mutate an earlier queued write. Failed writes do not poison later retries.
    const operation = this.persistenceQueue.catch(() => undefined).then(async () => {
      if (this.conflictingWorkspace) throw new Error(this.persistenceError);
      if (this.persistence?.commit) {
        const mutationId = crypto.randomUUID(); this.workspaceMutations.add(mutationId);
        try {
          const result = await this.persistence.commit(this.scope, JSON.parse(serialized), this.workspaceRevision, mutationId);
          const snapshot = workspaceSnapshotSchema.parse({ state: result.state, revision: result.revision });
          if (!result.accepted) { this.workspaceConflict(snapshot); throw new Error(this.persistenceError); }
          this.workspaceRevision = Math.max(this.workspaceRevision, snapshot.revision);
        } finally { this.workspaceMutations.delete(mutationId); }
      } else if (this.persistence?.save) await this.persistence.save(this.scope, JSON.parse(serialized));
      else this.storage?.setItem(this.storageKey, serialized);
      this.committedState = serialized;
    });
    this.persistenceQueue = operation;
    void operation.then(() => {
      if (this.queuedState === serialized) this.persistenceError = '';
      if (!this.disposed) { this.revision++; for (const listener of this.listeners) listener(); }
    }, (error) => {
      if (this.queuedState === serialized) this.queuedState = null;
      if (!this.conflictingWorkspace) this.persistenceError = `标签状态尚未保存：${errorMessage(error)}`;
      if (!this.disposed) { this.revision++; for (const listener of this.listeners) listener(); }
    }).finally(() => { this.workspaceWrites--; this.drainWorkspace(); });
    return operation;
  }
  flushPersistence = async (): Promise<void> => { await this.persist(); };
  async initialize(): Promise<void> {
    if (this.initialized || this.loading) return;
    const own = ++this.epoch, restoreIntent = this.intent;
    this.unlistenWorkspace ??= this.persistence?.subscribe?.(this.receiveWorkspace) ?? null;
    this.loading = true; this.error = ''; this.changed();
    try {
      const saved = await this.saved();
      const roots = await this.api.roots(this.scope);
      if (this.disposed || own !== this.epoch) return;
      this.roots = roots; this.expanded = saved?.expanded ?? {}; this.collapsedRoots = saved?.collapsedRoots ?? []; this.filters = saved?.filters ?? {}; this.treeWidth = saved?.treeWidth ?? 250;
      this.treeRoot = roots.roots.find((root) => sourceKey(root) === saved?.treeSource) ?? roots.roots[0] ?? null;
      this.initialized = true;
      this.tabs = (saved?.routes ?? []).map((route) => ({ id: crypto.randomUUID(), route, buffer: null, pinned: true, error: '', loading: true }));
      this.activeId = this.tabs.find((tab) => saved?.active && routeKey(tab.route) === routeKey(saved.active))?.id ?? this.tabs[0]?.id ?? null;
      this.changed();
      const listing = this.treeRoot ? this.list(this.treeRoot, '') : Promise.resolve();
      const restoring = [...this.tabs];
      for (let offset = 0; offset < restoring.length && !this.disposed && own === this.epoch; offset += 4) await Promise.all(restoring.slice(offset, offset + 4).map((tab) => this.loadTab(tab, own, restoreIntent)));
      await listing;
    } catch (error) { if (!this.disposed && own === this.epoch) this.error = errorMessage(error); }
    finally { if (!this.disposed && own === this.epoch) { this.loading = false; this.changed(); this.drainWorkspace(); } }
  }
  private rootFor(route: FileRoute): FileRoot | undefined {
    if (isNonLocalFileSource(route)) return undefined;
    // A stable source ID alone is insufficient: a changed project path must
    // produce an unavailable route, not point old tabs into another directory.
    return this.roots.roots.find((root) => root.source === route.source && root.sourceId === route.sourceId && root.path === route.sourcePath);
  }
  private async loadTab(tab: FileTab, own = this.epoch, _restoreIntent?: number): Promise<void> {
    const sequence = tab.loadSequence = (tab.loadSequence ?? 0) + 1;
    try {
      if (isNonLocalFileSource(tab.route)) throw new Error(NONLOCAL_WORKSPACE_MESSAGE);
      const root = this.rootFor(tab.route);
      if (!root) throw new Error('原目录来源当前不可用；此标签保留原路径，未切换到新目录');
      const file = await this.api.open({ lease: root.lease, generation: root.generation, relativePath: tab.route.relativePath, ...(tab.attachment ? { readOnly: true, attachment: { ...(tab.attachment.mimeType !== undefined ? { mimeType: tab.attachment.mimeType } : {}) } } : {}) });
      if (this.disposed || own !== this.epoch || sequence !== tab.loadSequence || !this.tabs.includes(tab)) { void this.api.closeDocument(file.ref).catch(() => undefined); return; }
      const existing = this.tabs.find((other) => other !== tab && !other.attachment && !tab.attachment && other.buffer?.file.documentKey === file.documentKey);
      if (existing) {
        existing.pinned ||= tab.pinned;
        this.tabs = this.tabs.filter((other) => other !== tab);
        if (this.activeId === tab.id) this.activeId = existing.id;
        void this.api.closeDocument(file.ref).catch(() => undefined); this.changed(); return;
      }
      tab.buffer = new FileBuffer(file, this.api, this.changed, this.flushPersistence); tab.buffer.mode = tab.route.mode;
      if (tab.route.pdf && tab.buffer.content.kind === 'pdf') tab.buffer.updatePdfPosition({ ...tab.route.pdf, initialized: true });
      tab.loading = false; tab.error = ''; this.changed();
      await tab.buffer.load();
    } catch (error) { if (!this.disposed && own === this.epoch && sequence === tab.loadSequence && this.tabs.includes(tab)) { tab.error = errorMessage(error); tab.loading = false; this.changed(); } }
  }
  async open(root: FileRoot, relativePath: string, pin = false): Promise<void> {
    const route: FileRoute = { source: root.source, sourceId: root.sourceId, sourcePath: root.path, relativePath, mode: /\.(?:csv|tsv|html?|tex)$/i.test(relativePath) ? 'source' : 'document' };
    await this.openRoute(route, pin);
  }
  private async openRoute(route: FileRoute, pin: boolean): Promise<void> {
    this.intent++;
    const existing = this.tabs.find((tab) => !tab.attachment && routeKey(tab.route) === routeKey(route));
    if (existing) { existing.pinned ||= pin; this.activeId = existing.id; this.changed(); await this.retryTab(existing.id); return; }
    const preview = this.tabs.find((tab) => !tab.pinned && !tab.buffer?.dirty);
    if (preview) this.remove(preview, false);
    const tab: FileTab = { id: crypto.randomUUID(), route, buffer: null, pinned: pin, loading: true, error: '' };
    this.tabs.push(tab); this.activeId = tab.id; this.changed();
    await this.loadTab(tab);
  }
  async openAttachment(root: FileRoot, relativePath: string, callbacks: LocalAttachment): Promise<void> {
    if (this.disposed) throw new Error('文件工作区已经关闭');
    if (!this.roots.roots.some(item => item.lease === root.lease && item.generation === root.generation && sourceKey(item) === sourceKey(root))) throw new Error('附件必须映射到当前可信本机目录');
    if (!callbacks.key || callbacks.key.length > 256 || [callbacks.onDownload, callbacks.onClose].some(value => value !== undefined && typeof value !== 'function')) throw new Error('附件来源或回调无效');
    const route = fileWorkspaceSchema.shape.routes.element.parse({ source: root.source, sourceId: root.sourceId, sourcePath: root.path, relativePath, mode: 'document' });
    const hint = fileAttachmentHintSchema.parse(callbacks.mimeType === undefined ? {} : { mimeType: callbacks.mimeType });
    const attachment = Object.freeze({ key: callbacks.key, onDownload: callbacks.onDownload, onClose: callbacks.onClose, ...hint });
    this.intent++;
    const existing = this.tabs.find(tab => tab.attachment?.key === attachment.key && routeKey(tab.route) === routeKey(route));
    if (existing) {
      const changedHint = existing.attachment?.mimeType !== attachment.mimeType;
      existing.attachment = attachment; this.activeId = existing.id;
      if (changedHint) { existing.buffer?.dispose(); existing.buffer = null; existing.loading = true; existing.error = ''; this.changed(); await this.loadTab(existing); }
      else { this.changed(); void existing.buffer?.refresh(); }
      return;
    }
    const tab: FileTab = { id: crypto.randomUUID(), route, buffer: null, pinned: true, loading: true, error: '', attachment };
    this.tabs.push(tab); this.activeId = tab.id; this.changed(); await this.loadTab(tab);
  }
  async downloadAttachment(id: string): Promise<void> {
    const tab = this.tabs.find(item => item.id === id);
    if (this.disposed || !tab?.attachment?.onDownload) throw new Error('附件下载回调已失效，请从原来源重新打开');
    await tab.attachment.onDownload();
  }
  activate(id: string): void {
    this.intent++; const tab = this.tabs.find((item) => item.id === id); if (!tab) return;
    this.activeId = id; this.changed(); void this.retryTab(id);
  }
  async retryTab(id: string): Promise<void> {
    const tab = this.tabs.find(item => item.id === id); if (!tab || this.disposed) return;
    if (tab.buffer) { await tab.buffer.refresh(); return; }
    if (tab.loading) return;
    tab.loading = true; tab.error = ''; this.changed();
    await this.loadTab(tab);
  }
  async openRelated(buffer: FileBuffer, href: string): Promise<void> {
    const tab = this.tabs.find((entry) => entry.buffer === buffer);
    if (!tab) return;
    const root = this.rootFor(tab.route); if (!root) throw new Error('文档来源已失效');
    const document = await this.api.related(buffer.file.ref, href);
    try { if (this.tabs.includes(tab) && tab.buffer === buffer) {
      if (tab.attachment) await this.openAttachment(root, document.relativePath, { key: `${tab.attachment.key}:related` });
      else await this.open(root, document.relativePath);
    } }
    finally { await this.api.closeDocument(document.ref).catch(() => undefined); }
  }
  async setMode(buffer: FileBuffer, mode: 'document' | 'source'): Promise<void> {
    // Even an explicit request to keep the current mode supersedes an older
    // switch that is still waiting for its save to finish.
    const request = ++this.modeIntent;
    const tab = this.tabs.find((entry) => entry.buffer === buffer);
    if (!tab || this.disposed || buffer.mode === mode) return;
    const intent = this.intent, activeId = this.activeId, previousMode = buffer.mode, version = buffer.version;
    const current = () => !this.disposed && this.modeIntent === request && this.intent === intent
      && this.activeId === activeId && this.tabs.includes(tab) && tab.buffer === buffer
      && buffer.mode === previousMode && buffer.version === version;
    if (buffer.dirty || buffer.saving) {
      let saved: boolean;
      try { saved = await buffer.save(); }
      catch (error) { if (current()) throw error; return; }
      // A started write still completes, but its obsolete success/error must
      // not change the newly selected file, mode or replacement save.
      if (!current() || buffer.saving) return;
      if (!saved) throw new Error(buffer.saveError || '文件尚未保存，保留当前模式');
    }
    if (!current() || buffer.dirty || buffer.saving) return;
    buffer.mode = mode; tab.route.mode = mode; this.changed();
    if (mode === 'source' && !buffer.editor && buffer.content.mime === 'image/svg+xml') await buffer.load();
  }
  async openSearchRow(root: FileRoot, row: FileSearchRow): Promise<void> {
    const work = this.open(root, row.relativePath); const intent = this.intent;
    await work;
    if (this.disposed || this.intent !== intent) return;
    const buffer = this.active?.buffer;
    if (!buffer?.editor) throw new Error('此搜索结果当前无法作为文本定位');
    if (buffer.dirty || buffer.file.revision.hash !== row.revision.hash || buffer.file.revision.device !== row.revision.device || buffer.file.revision.inode !== row.revision.inode) throw new Error('文件在搜索后已改变，已打开当前内容；请重新搜索后定位');
    const range = row.ranges[0]; if (range) buffer.revealSourceRange(row.rawOffset + range.from, row.rawOffset + range.to);
  }
  pin(id: string): void { const tab = this.tabs.find((item) => item.id === id); if (tab) { tab.pinned = true; this.changed(); } }
  reorder(from: string, before: string): void {
    const item = this.tabs.find((tab) => tab.id === from), at = this.tabs.findIndex((tab) => tab.id === before);
    if (!item || at < 0 || from === before) return;
    this.tabs = this.tabs.filter((tab) => tab !== item); this.tabs.splice(this.tabs.findIndex((tab) => tab.id === before), 0, item); this.changed();
  }
  async close(id: string, discard = false): Promise<'closed' | 'blocked' | 'stale'> {
    const tab = this.tabs.find((item) => item.id === id); if (!tab) return 'stale';
    const instance = tab.buffer?.instance;
    if (tab.buffer?.dirty || tab.buffer?.recoveryBlocked) {
      try { if (!await tab.buffer.prepareClose(discard ? 'discard' : 'save')) return 'blocked'; }
      catch (error) { tab.error = errorMessage(error); this.changed(); return 'blocked'; }
    }
    if (!this.tabs.includes(tab) || tab.buffer?.instance !== instance) return 'stale';
    if (!discard && tab.buffer?.dirty) return 'blocked';
    this.remove(tab, true); this.changed();
    try { await tab.attachment?.onClose?.(); }
    catch (error) { if (!this.disposed) { this.error = `附件已关闭，但来源回调失败：${errorMessage(error)}`; this.changed(); } }
    return 'closed';
  }
  private remove(tab: FileTab, remember: boolean): void {
    const index = this.tabs.indexOf(tab); if (index < 0) return;
    if (remember && !tab.attachment) { this.closed.unshift(durableRoute(tab)); this.closed.splice(25); }
    this.tabs.splice(index, 1); tab.buffer?.dispose();
    if (this.activeId === tab.id) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null;
  }
  async restoreClosed(): Promise<void> {
    const route = this.closed.shift(); if (!route) return;
    const root = this.rootFor(route);
    if (root) await this.openRoute(route, true);
    else { const tab = { id: crypto.randomUUID(), route, pinned: true, loading: false, error: '原目录来源当前不可用', buffer: null }; this.tabs.push(tab); this.activeId = tab.id; this.changed(); }
  }
  selectRoot(root: FileRoot): void {
    for (const [key, request] of this.pendingDirectories) if (request.root.lease !== root.lease) this.cancelDirectory(key);
    this.treeRoot = root; this.changed(); void this.list(root, '');
  }
  retryUnavailableRoot(sourceId: string, sourceKind?: FileRoot['source']): Promise<void> {
    const failed = this.roots.unavailable.find(root => root.sourceId === sourceId && (!sourceKind || root.source === sourceKind));
    if (!failed || this.disposed) return Promise.resolve();
    const source = failed.source ?? (this.scope.kind === 'task' && sourceId === this.scope.taskId ? 'task-cwd' : 'project-directory'), key = `${source}:${sourceId}`;
    const previous = this.rootRetries.get(key); if (previous) return previous;
    const own = this.epoch; this.retryingRoots.add(key); this.changed();
    const current = () => !this.disposed && own === this.epoch && this.roots.unavailable.includes(failed);
    const operation = this.api.retryRoot({ scope: this.scope, source, sourceId }).then(async result => {
      if (!current()) { for (const root of result.roots) void this.api.releaseRoot({ lease: root.lease, generation: root.generation }).catch(() => undefined); return; }
      if (!result.roots.length) {
        this.roots = { ...this.roots, unavailable: this.roots.unavailable.map(root => root === failed ? result.unavailable[0] ?? failed : root) }; return;
      }
      const root = result.roots[0];
      this.roots = { roots: [...this.roots.roots.filter(other => other.source !== root.source || other.sourceId !== root.sourceId), root], unavailable: this.roots.unavailable.filter(other => other !== failed) };
      if (!this.treeRoot) this.treeRoot = root;
      // Existing healthy leases and buffers remain intact. Only failed routes
      // belonging to this recovered source may acquire a fresh document.
      await Promise.all([this.list(root, ''), ...this.tabs.filter(tab => !tab.buffer && this.rootFor(tab.route) === root).map(tab => this.retryTab(tab.id))]);
    }).catch(error => {
      if (current()) this.roots = { ...this.roots, unavailable: this.roots.unavailable.map(root => root === failed ? { ...root, reason: errorMessage(error) } : root) };
    }).finally(() => {
      if (this.rootRetries.get(key) === operation) this.rootRetries.delete(key);
      this.retryingRoots.delete(key); if (!this.disposed) this.changed();
    });
    this.rootRetries.set(key, operation); return operation;
  }
  setTreeWidth(width: number): void { this.treeWidth = Math.max(0, Math.min(1600, width)); this.changed(); }
  toggleDirectory(path: string): void {
    const root = this.treeRoot; if (!root) return;
    const key = sourceKey(root), expanded = this.currentExpanded;
    this.expanded[key] = expanded.includes(path) ? expanded.filter((item) => item !== path) : [...expanded, path];
    if (expanded.includes(path)) for (const [id, request] of this.pendingDirectories) if (request.root.lease === root.lease && (request.path === path || request.path.startsWith(path + '/'))) this.cancelDirectory(id);
    this.changed(); if (this.expanded[key].includes(path)) void this.list(root, path);
  }
  directoryKey(root: FileRoot, path: string): string { return `${root.lease}/${path}`; }
  private cancelDirectory(key: string): void {
    const request = this.pendingDirectories.get(key); if (!request) return;
    this.pendingDirectories.delete(key);
    if (request.previous) this.directories.set(key, request.previous); else this.directories.delete(key);
    void this.api.cancelResource?.(request.id).catch(() => undefined);
  }
  list(root: FileRoot, path: string, refresh = false): Promise<void> {
    const key = this.directoryKey(root, path), pending = this.pendingDirectories.get(key), own = this.epoch;
    if (this.disposed) return Promise.resolve();
    if (pending && !refresh) return pending.promise;
    if (!refresh && this.directories.get(key)?.state === 'ready') return Promise.resolve();
    const state = this.directories.get(key), previous = pending?.previous ?? (state?.state === 'ready' ? state : undefined);
    if (pending) this.cancelDirectory(key);
    let request!: DirectoryRequest;
    const accepts = () => !this.disposed && own === this.epoch && this.pendingDirectories.get(key) === request && this.roots.roots.some(current => current.lease === root.lease && current.generation === root.generation);
    const work = Promise.resolve().then(() => accepts() ? this.api.list({ lease: root.lease, generation: root.generation, relativePath: path, requestId: request.id }) : null).then((entries) => {
      if (entries && accepts()) this.directories.set(key, { state: 'ready', entries });
    }).catch((error) => {
      if (accepts()) this.directories.set(key, { state: 'error', message: errorMessage(error) });
    }).finally(() => { if (this.pendingDirectories.get(key) === request) { this.pendingDirectories.delete(key); if (!this.disposed && own === this.epoch) this.changed(); } });
    request = { id: crypto.randomUUID(), root, path, previous, promise: work };
    this.pendingDirectories.set(key, request); this.directories.set(key, { state: 'loading' }); this.changed(); return work;
  }
  async refresh(): Promise<void> {
    const root = this.treeRoot;
    if (root) this.metadataRevisions.set(root.lease, (this.metadataRevisions.get(root.lease) ?? 0) + 1);
    if (root) await Promise.all(['', ...this.currentExpanded].map((path) => this.list(root, path, true)));
    if (this.activeId) await this.retryTab(this.activeId);
  }
  private async refreshRoot(root: FileRoot): Promise<void> {
    this.metadataRevisions.set(root.lease, (this.metadataRevisions.get(root.lease) ?? 0) + 1);
    await Promise.all([
      ...(this.treeRoot === root ? ['', ...(this.expanded[sourceKey(root)] ?? [])].map((path) => this.list(root, path, true)) : []),
      ...this.tabs.flatMap((tab) => tab.buffer?.file.ref.lease === root.lease || !tab.buffer && this.rootFor(tab.route) === root ? [this.retryTab(tab.id)] : []),
    ]);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.epoch++;
    for (const key of this.pendingDirectories.keys()) this.cancelDirectory(key);
    this.unlistenWorkspace?.(); this.unlistenWorkspace = null;
    this.unlistenWatch?.(); this.unlistenWatch = null;
    for (const watch of this.watches.values()) if (watch.id) void this.api.stopWatch(watch.id).catch(() => undefined);
    this.watches.clear(); this.watchStates.clear();
    this.treeViews.clear(); this.scroll.clear();
    for (const tab of this.tabs) tab.buffer?.dispose();
    this.listeners.clear(); void this.api.closeScope(this.scope).catch(() => undefined);
  }
}

const workspaces = new Map<string, FileWorkspaceStore>();
export function fileWorkspaceFor(scope: FileScope): FileWorkspaceStore {
  const key = fileScopeKey(scope);
  let store = workspaces.get(key);
  if (!store) { store = new FileWorkspaceStore(scope); workspaces.set(key, store); }
  return store;
}
export function openFileBuffers(): FileBuffer[] { return [...new Set([...workspaces.values()].flatMap((store) => store.tabs.flatMap((tab) => tab.buffer ? [tab.buffer] : [])))]; }
