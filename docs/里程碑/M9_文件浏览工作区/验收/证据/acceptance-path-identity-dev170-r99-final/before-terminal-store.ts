import type { FileDocument, FileIdentity, FileRef, FileRoot, PathRequest } from '@shared/files';
import { formatTerminalReferences, TERMINAL_CONTEXT_LIMITS, type TerminalBinding, type TerminalDeliveryState, type TerminalInsertionReceipt, type TerminalReferenceInput, type TerminalTarget } from '@shared/file-terminal';
import { rpc } from '@renderer/lib/ipc';

export interface VisibleTerminal extends TerminalTarget { focus(): void }
let visibleTerminal: VisibleTerminal | null = null;
const targetListeners = new Set<() => void>();
export const currentFileTerminal = () => visibleTerminal;
export function registerFileTerminal(target: VisibleTerminal): () => void {
  visibleTerminal = target; targetListeners.forEach(listener => listener());
  return () => { if (visibleTerminal === target) { visibleTerminal = null; targetListeners.forEach(listener => listener()); } };
}
export interface SelectionContext { range: { startLine: number; endLine: number }; text: string; version: number; instance: string; selectedTextHash: string; current(): boolean; comment?: string }
export interface TrayReference { id: string; file: FileDocument; selection?: SelectionContext; state: 'fresh' | 'stale' | 'missing' }
export function textFingerprint(text: string): string { let hash = 2166136261; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }
type Api = Pick<typeof rpc.files, 'open' | 'refresh' | 'closeDocument' | 'terminalBind' | 'terminalRelease' | 'terminalPrepare' | 'terminalInsert'>;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export class FileTerminalContextStore {
  root: FileRoot | null = null;
  references: TrayReference[] = [];
  includeText = false;
  style: 'plain' | 'at' = 'plain';
  state: TerminalDeliveryState = 'idle';
  notice = '';
  private epoch = 0;
  private revision = 0;
  private delivery = 0;
  private binding: TerminalBinding | null = null;
  private bindingPromise: Promise<TerminalBinding> | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly api: Api = rpc.files) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private changed(): void { this.revision++; this.listeners.forEach(listener => listener()); }
  attach(): () => void {
    const changed = () => { this.invalidate(); this.changed(); };
    targetListeners.add(changed); return () => { targetListeners.delete(changed); this.clear(); this.root = null; };
  }
  setRoot(root: FileRoot | null): void {
    if (this.root?.lease === root?.lease && this.root?.generation === root?.generation) return;
    this.clear(); this.root = root; this.changed();
  }
  private invalidate(): void {
    this.epoch++; this.delivery++; const binding = this.binding; this.binding = null; this.bindingPromise = null;
    if (binding) void this.api.terminalRelease(binding.id).catch(() => undefined);
    if (this.state === 'inserting') { this.state = 'unknown'; this.notice = '文件或终端已切换；原投递结果未知，不会自动重发'; }
  }
  get target(): VisibleTerminal | null { return currentFileTerminal(); }
  get canInsert(): boolean { return Boolean(this.target && this.references.length && this.references.every(reference => reference.state !== 'missing') && this.state !== 'inserting' && this.state !== 'unknown'); }
  clear(): void {
    this.invalidate(); for (const reference of this.references) void this.api.closeDocument(reference.file.ref).catch(() => undefined);
    this.references = []; this.state = 'idle'; this.notice = ''; this.changed();
  }
  remove(id: string): void { const reference = this.references.find(value => value.id === id); if (reference) void this.api.closeDocument(reference.file.ref).catch(() => undefined); this.references = this.references.filter(value => value.id !== id); this.changed(); }
  options(includeText: boolean, style: 'plain' | 'at'): void { this.includeText = includeText; this.style = style; this.changed(); }
  async capture(path: PathRequest, identity?: FileIdentity): Promise<FileDocument> {
    const epoch = this.epoch, root = this.root;
    if (!root || path.lease !== root.lease || path.generation !== root.generation) throw new Error('请在当前文件目录中重新选择引用');
    const file = await this.api.open(path);
    if (epoch !== this.epoch || this.root !== root || identity && (file.revision.device !== identity.device || file.revision.inode !== identity.inode)) { void this.api.closeDocument(file.ref).catch(() => undefined); throw new Error('文件或目录已改变，请重新选择'); }
    return file;
  }
  async add(path: PathRequest, identity?: FileIdentity, selection?: SelectionContext): Promise<void> {
    try {
      if (selection && !selection.current()) throw new Error('选区内容已改变，请重新选择');
      const file = await this.capture(path, identity);
      if (selection && !selection.current()) { void this.api.closeDocument(file.ref).catch(() => undefined); throw new Error('选区内容已改变，请重新选择'); }
      const duplicate = this.references.some(reference => reference.file.relativePath === file.relativePath && JSON.stringify(reference.selection?.range) === JSON.stringify(selection?.range) && reference.selection?.selectedTextHash === selection?.selectedTextHash && reference.selection?.comment === selection?.comment);
      if (duplicate) { void this.api.closeDocument(file.ref).catch(() => undefined); return; }
      if (this.references.length >= 64) { void this.api.closeDocument(file.ref).catch(() => undefined); throw new Error('最多可保留 64 个文件引用'); }
      this.references.push({ id: crypto.randomUUID(), file, selection, state: 'fresh' }); this.notice = ''; this.changed();
    } catch (error) { this.notice = message(error); this.changed(); }
  }
  async refresh(): Promise<void> {
    const epoch = this.epoch;
    await Promise.all(this.references.map(async reference => {
      let state: TrayReference['state'];
      try {
        const latest = await this.api.refresh(reference.file.ref), original = reference.file.revision;
        state = latest.revision.device !== original.device || latest.revision.inode !== original.inode ? 'missing' : latest.revision.hash !== original.hash || reference.selection && !reference.selection.current() ? 'stale' : 'fresh';
      } catch { state = 'missing'; }
      if (epoch === this.epoch && this.references.includes(reference)) { reference.state = state; this.changed(); }
    }));
  }
  get preview(): { text: string; note: string } {
    try {
      const result = formatTerminalReferences(this.references.map(reference => ({ ...this.reference(reference, reference.id), relativePath: reference.file.relativePath })), { includeText: this.includeText, style: this.style });
      return { text: result.text, note: [result.removed ? `已移除 ${result.removed} 个控制字符` : '', result.replaced ? `已替换 ${result.replaced} 个无效字符` : '', result.truncated ? `${result.truncated} 处选区已截断` : ''].filter(Boolean).join('；') };
    } catch (error) { return { text: '', note: message(error) }; }
  }
  private reference(reference: TrayReference, sourceId: string): TerminalReferenceInput {
    return { sourceId, kind: reference.selection ? reference.selection.comment ? 'comment' : 'range' : 'file', ...(reference.selection ? { range: reference.selection.range, text: reference.selection.text, comment: reference.selection.comment } : {}) };
  }
  private async ensureBinding(): Promise<TerminalBinding> {
    const root = this.root, target = this.target, epoch = this.epoch;
    if (!root || !target) throw new Error('当前没有可用的任务终端；文件浏览仍可使用');
    if (this.binding) return this.binding;
    if (!this.bindingPromise) this.bindingPromise = this.api.terminalBind({ taskId: target.taskId, ptyId: target.ptyId, root: { lease: root.lease, generation: root.generation } }).then(binding => {
      if (epoch !== this.epoch || this.target !== target) { void this.api.terminalRelease(binding.id).catch(() => undefined); throw new Error('终端已切换，请重新投递'); }
      this.binding = binding; return binding;
    }).finally(() => { if (epoch === this.epoch) this.bindingPromise = null; });
    return this.bindingPromise;
  }
  private async prepared(binding: TerminalBinding, file: FileDocument): Promise<string> {
    const source = await this.api.terminalPrepare({ bindingId: binding.id, target: { kind: 'document', ref: file.ref }, identity: { device: file.revision.device, inode: file.revision.inode } }); return source.id;
  }
  async insert(): Promise<void> {
    if (!this.canInsert) return;
    const references = [...this.references], preview = this.preview, includeText = this.includeText, style = this.style;
    if (!preview.text) { this.notice = preview.note; this.changed(); return; }
    await this.deliver(async binding => {
      const inputs = await Promise.all(references.map(async reference => this.reference(reference, await this.prepared(binding, reference.file))));
      return { kind: 'context' as const, bindingId: binding.id, operationId: crypto.randomUUID(), references: inputs, includeText, style };
    }, () => { for (const reference of references) this.remove(reference.id); });
  }
  async insertPath(file: FileDocument, epoch: number, target: VisibleTerminal, notice?: (message: string) => void): Promise<void> {
    if (epoch !== this.epoch || this.target !== target) throw new Error('拖动来源或目标已改变，请重新拖动');
    await this.deliver(async binding => ({ kind: 'path' as const, bindingId: binding.id, operationId: crypto.randomUUID(), sourceId: await this.prepared(binding, file) }), () => undefined, notice);
  }
  private async deliver(build: (binding: TerminalBinding) => Promise<Parameters<Api['terminalInsert']>[0]>, inserted: () => void, notify?: (message: string) => void): Promise<void> {
    const epoch = this.epoch, target = this.target, delivery = ++this.delivery;
    const current = () => epoch === this.epoch && delivery === this.delivery && this.target === target;
    this.state = 'inserting'; this.notice = '正在插入终端输入…'; this.changed(); notify?.(this.notice);
    let timer: ReturnType<typeof setTimeout> | undefined, dispatched = false;
    try {
      const binding = await this.ensureBinding(), input = await build(binding);
      if (!current()) return;
      timer = setTimeout(() => { if (current()) { this.state = 'unknown'; this.notice = '插入结果未知；尚未收到确认，不会自动重发'; this.changed(); notify?.(this.notice); } }, TERMINAL_CONTEXT_LIMITS.acknowledgementMs);
      dispatched = true;
      const receipt: TerminalInsertionReceipt = await this.api.terminalInsert(input);
      if (!current()) return;
      if (receipt.operationId !== input.operationId) throw new Error('终端回执与本次投递不匹配');
      if (receipt.state !== 'inserted') { this.state = receipt.state; this.notice = receipt.message; this.changed(); notify?.(this.notice); return; }
      this.state = 'inserted'; this.notice = `已插入终端输入，尚未提交${receipt.removed || receipt.replaced ? `；已清理 ${receipt.removed + receipt.replaced} 个控制或无效字符` : ''}${receipt.truncated ? `；${receipt.truncated} 处选区已截断` : ''}`;
      inserted(); this.changed(); notify?.(this.notice); target?.focus();
    } catch (error) { if (current()) { this.state = dispatched ? 'unknown' : 'failed'; this.notice = dispatched ? `插入结果未知；${message(error)}，不会自动重发` : message(error); this.changed(); notify?.(this.notice); } }
    finally { clearTimeout(timer); }
  }
  startDrag(path: PathRequest, identity?: FileIdentity): { token: string; end(): void } | null {
    const target = this.target; if (!target) { this.notice = '当前没有可用的任务终端'; this.changed(); return null; }
    endFileDrag();
    const token = crypto.randomUUID(), epoch = this.epoch, file = this.capture(path, identity);
    // Capture errors are displayed only if the user actually drops this item.
    void file.catch(() => undefined);
    const drag = { token, target, owner: this, epoch, file, consumed: false }; activeDrag = drag;
    return { token, end: () => { if (activeDrag === drag) endFileDrag(); } };
  }
  releaseFile(file: FileDocument): void { void this.api.closeDocument(file.ref).catch(() => undefined); }
}
export const FILE_TERMINAL_DRAG_TYPE = 'application/x-willyou-terminal-file';
let activeDrag: { token: string; target: VisibleTerminal; owner: FileTerminalContextStore; epoch: number; file: Promise<FileDocument>; consumed: boolean } | null = null;
export function endFileDrag(): void { const drag = activeDrag; activeDrag = null; if (drag && !drag.consumed) void drag.file.then(file => drag.owner.releaseFile(file)).catch(() => undefined); }
export async function dropFileToTerminal(token: string, target: TerminalTarget, notice: (message: string) => void): Promise<void> {
  const drag = activeDrag;
  if (!drag || drag.token !== token || drag.consumed) return;
  activeDrag = null; drag.consumed = true;
  let file: FileDocument | undefined;
  try {
    if (drag.target !== currentFileTerminal() || target.taskId !== drag.target.taskId || target.ptyId !== drag.target.ptyId) throw new Error('拖动目标已改变，请重新拖动');
    file = await drag.file; await drag.owner.insertPath(file, drag.epoch, drag.target, notice);
  } catch (error) { notice(message(error)); }
  finally { if (file) drag.owner.releaseFile(file); }
}
