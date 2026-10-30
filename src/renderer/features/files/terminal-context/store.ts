import type { FileDocument, FileIdentity, FileRef, FileRoot, PathRequest } from '@shared/files';
import { formatTerminalReferences, terminalPptxContextSchema, terminalDocxContextSchema, terminalPdfContextSchema, TERMINAL_CONTEXT_LIMITS, type TerminalBinding, type TerminalDeliveryState, type TerminalInsertionReceipt, type TerminalReferenceInput, type TerminalTarget, type TerminalPdfContext, type TerminalDocxContext, type TerminalPptxContext } from '@shared/file-terminal';
import { rpc } from '@renderer/lib/ipc';

export interface VisibleTerminal extends TerminalTarget { focus(): void }
let visibleTerminal: VisibleTerminal | null = null;
const targetListeners = new Set<() => void>();
export const currentFileTerminal = () => visibleTerminal;
export function registerFileTerminal(target: VisibleTerminal): () => void {
  visibleTerminal = target; targetListeners.forEach(listener => listener());
  return () => { if (visibleTerminal === target) { visibleTerminal = null; targetListeners.forEach(listener => listener()); } };
}
export interface SelectionContext { range?: { startLine: number; endLine: number }; pdf?: TerminalPdfContext; docx?: TerminalDocxContext; pptx?: TerminalPptxContext; text: string; version: number; instance: string; selectedTextHash: string; current(): boolean; comment?: string }
export interface TrayReference { id: string; file: FileDocument; selection?: SelectionContext; state: 'fresh' | 'stale' | 'missing' }
export function textFingerprint(text: string): string { let hash = 2166136261; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }
type Api = Pick<typeof rpc.files, 'open' | 'related' | 'refresh' | 'closeDocument' | 'terminalBind' | 'terminalRelease' | 'terminalPrepare' | 'terminalInsert'> & Partial<Pick<typeof rpc.files, 'terminalImageCapability'>>;
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
  private additions: Promise<unknown> = Promise.resolve();
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
    if (this.root?.lease === root?.lease && this.root?.generation === root?.generation) {
      const changed = JSON.stringify(this.root?.capabilities) !== JSON.stringify(root?.capabilities);
      this.root = root; if (changed) this.changed(); return;
    }
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
  async capture(path: PathRequest, identity?: FileIdentity, source?: FileDocument): Promise<FileDocument> {
    const epoch = this.epoch, root = this.root;
    if (!root || path.lease !== root.lease || path.generation !== root.generation) throw new Error('请在当前文件目录中重新选择引用');
    // Resolve the same leaf through the original document's main-owned grant.
    // In particular, a readonly attachment must not become an ordinary source.
    const file = source ? await this.api.related(source.ref, encodeURIComponent(source.name)) : await this.api.open(path);
    if (epoch !== this.epoch || this.root !== root || identity && (file.revision.device !== identity.device || file.revision.inode !== identity.inode)
      || source && (file.relativePath !== source.relativePath || file.ref.lease !== source.ref.lease || file.ref.generation !== source.ref.generation || file.revision.hash !== source.revision.hash)) {
      void this.api.closeDocument(file.ref).catch(() => undefined); throw new Error('文件或目录已改变，请重新选择');
    }
    return file;
  }
  async add(path: PathRequest, identity?: FileIdentity, selection?: SelectionContext): Promise<boolean> {
    return this.addMany(path, identity, [selection]);
  }
  addMany(path: PathRequest, identity: FileIdentity | undefined, selections: (SelectionContext | undefined)[]): Promise<boolean> {
    return this.queue(path, identity, selections);
  }
  addDocx(file: FileDocument, selection: SelectionContext & { docx: TerminalDocxContext }): Promise<boolean> {
    if (file.content?.kind !== 'office' || file.content.format !== 'docx') return Promise.resolve(false);
    return this.queue({ lease: file.ref.lease, generation: file.ref.generation, relativePath: file.relativePath }, file.revision, [selection], file);
  }
  addPptx(file: FileDocument, selection: SelectionContext & { pptx: TerminalPptxContext }): Promise<boolean> {
    if (file.content?.kind !== 'office' || file.content.format !== 'pptx' || file.sourceReadOnly) return Promise.resolve(false);
    return this.queue({ lease: file.ref.lease, generation: file.ref.generation, relativePath: file.relativePath }, file.revision, [selection], file);
  }
  private queue(path: PathRequest, identity: FileIdentity | undefined, selections: (SelectionContext | undefined)[], source?: FileDocument): Promise<boolean> {
    const epoch = this.epoch;
    const snapshot = selections.map(selection => selection ? { ...selection, ...(selection.range ? { range: { ...selection.range } } : {}), ...(selection.pdf ? { pdf: { page: selection.pdf.page, anchor: { ...selection.pdf.anchor } } } : {}), ...(selection.docx ? { docx: { ...selection.docx } } : {}), ...(selection.pptx ? { pptx: { ...selection.pptx } } : {}) } : undefined);
    const operation = this.additions.then(() => this.appendMany(path, identity, snapshot, epoch, source));
    this.additions = operation.catch(() => undefined); return operation;
  }
  private async appendMany(path: PathRequest, identity: FileIdentity | undefined, selections: (SelectionContext | undefined)[], epoch: number, source?: FileDocument): Promise<boolean> {
    const pending: TrayReference[] = [];
    try {
      if (epoch !== this.epoch) return false;
      if (!selections.length || selections.length > 64) throw new Error('每次可加入 1–64 个文件引用');
      for (const selection of selections) {
        if (selection && (!selection.current() || [selection.range, selection.pdf, selection.docx, selection.pptx].filter(Boolean).length !== 1)) throw new Error('选区内容已改变或位置无效，请重新选择');
        if (selection?.pdf) { terminalPdfContextSchema.parse(selection.pdf); if (!selection.comment?.trim()) throw new Error('PDF 评论不能为空'); }
        if (selection?.docx) { terminalDocxContextSchema.parse(selection.docx); if (!selection.text.trim() || !selection.comment?.trim() || !source) throw new Error('DOCX 需要原文件、真实选区和修改指令'); }
        if (selection?.pptx) { terminalPptxContextSchema.parse(selection.pptx); if (!selection.comment?.trim() || !source || source.sourceReadOnly || source.content?.kind !== 'office' || source.content.format !== 'pptx') throw new Error('PPTX 需要有效原文件、幻灯片位置和修改指令'); }
        const file = await this.capture(path, identity, source);
        if (selection?.pptx && file.sourceReadOnly) { void this.api.closeDocument(file.ref).catch(() => undefined); throw new Error('文件来源已改为强只读，评论草稿未投递'); }
        const duplicate = [...this.references, ...pending].some(reference => reference.file.relativePath === file.relativePath && reference.file.revision.device === file.revision.device && reference.file.revision.inode === file.revision.inode && reference.file.revision.hash === file.revision.hash && JSON.stringify(reference.selection?.range) === JSON.stringify(selection?.range) && JSON.stringify(reference.selection?.pdf) === JSON.stringify(selection?.pdf) && JSON.stringify(reference.selection?.docx) === JSON.stringify(selection?.docx) && JSON.stringify(reference.selection?.pptx) === JSON.stringify(selection?.pptx) && reference.selection?.selectedTextHash === selection?.selectedTextHash && reference.selection?.comment === selection?.comment);
        if (duplicate) { void this.api.closeDocument(file.ref).catch(() => undefined); continue; }
        pending.push({ id: crypto.randomUUID(), file, selection, state: 'fresh' });
        if (this.references.length + pending.length > 64) throw new Error('最多可保留 64 个文件引用');
        if (epoch !== this.epoch || selection && !selection.current()) throw new Error('文件或选区内容已改变，请重新选择');
      }
      if (epoch !== this.epoch || pending.some(reference => reference.selection && !reference.selection.current())) throw new Error('文件或选区内容已改变，请重新选择');
      this.references.push(...pending); if (pending.some(reference => reference.selection?.docx || reference.selection?.pptx && reference.selection.text)) this.includeText = true;
      this.notice = ''; this.changed(); return true;
    } catch (error) {
      for (const reference of pending) void this.api.closeDocument(reference.file.ref).catch(() => undefined);
      if (epoch === this.epoch) { this.notice = message(error); this.changed(); }
      return false;
    }
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
    const selection = reference.selection;
    return { sourceId, kind: selection?.pptx ? 'pptx-comment' : selection?.docx ? 'docx-comment' : selection?.pdf ? 'pdf-comment' : selection ? selection.comment ? 'comment' : 'range' : 'file', ...(selection ? { ...(selection.pptx ? { pptx: selection.pptx } : selection.docx ? { docx: selection.docx } : selection.pdf ? { pdf: selection.pdf } : { range: selection.range }), text: selection.text, comment: selection.comment } : {}) };
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
  imageInput(signal: AbortSignal): (file: FileDocument, baseHash: string, notify: (message: string) => void) => Promise<void> {
    const epoch = this.epoch, target = this.target;
    if (!target || !this.root) throw new Error('当前没有可用的任务终端，未附加图片');
    return async (file, baseHash, notify) => {
      signal.throwIfAborted();
      if (epoch !== this.epoch || this.target !== target) throw new Error('图片来源或任务终端已切换，未附加图片');
      if (this.state === 'inserting' || this.state === 'unknown') throw new Error('请先检查上一笔终端投递结果，图片不会自动重发');
      const abort = () => {
        if (epoch !== this.epoch || this.target !== target || this.state !== 'inserting') return;
        // Revoke only the pending delivery binding. Existing references and the
        // terminal's own draft/attachments remain untouched.
        this.invalidate(); this.changed(); notify('图片来源已关闭；请检查原终端输入，图片不会自动重发。');
      };
      signal.addEventListener('abort', abort, { once: true });
      try { await this.deliver(async binding => {
        if (!this.api.terminalImageCapability) throw new Error('当前图片输入适配器尚未就绪');
        const capability = await this.api.terminalImageCapability(binding.id);
        signal.throwIfAborted();
        if (epoch !== this.epoch || this.target !== target) throw new Error('图片目标已改变，未附加图片');
        if (capability.state !== 'supported') throw new Error(capability.reason);
        if (!capability.acceptedMimeTypes.includes(file.content?.kind === 'image' ? file.content.mime ?? '' : '')) throw new Error('当前图片输入适配器仅验证过静态 PNG，请选择 PNG 原图');
        return { kind: 'image' as const, bindingId: binding.id, operationId: crypto.randomUUID(), ref: file.ref, baseHash };
      }, () => undefined, notify); }
      finally { signal.removeEventListener('abort', abort); }
    };
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
      this.state = 'inserted'; this.notice = receipt.image && receipt.confirmation === 'pty-write' ? '图片已投递到终端输入，请在终端检查图片草稿；尚未提交。' : `已插入终端输入，尚未提交${receipt.removed || receipt.replaced ? `；已清理 ${receipt.removed + receipt.replaced} 个控制或无效字符` : ''}${receipt.truncated ? `；${receipt.truncated} 处选区已截断` : ''}`;
      inserted(); this.changed(); notify?.(this.notice); target?.focus();
    } catch (error) { if (current()) { this.state = dispatched ? 'unknown' : 'failed'; this.notice = dispatched ? `插入结果未知；${message(error)}，不会自动重发` : message(error); this.changed(); notify?.(this.notice); } }
    finally { clearTimeout(timer); }
  }
  startDrag(path: PathRequest, identity?: FileIdentity): { token: string; end(): void } | null {
    const target = this.target; if (!target) { this.notice = '当前没有可用的任务终端'; this.changed(); return null; }
    endFileDrag(); cancelledDragToken = null;
    const token = crypto.randomUUID(), epoch = this.epoch, file = this.capture(path, identity);
    // Capture errors are displayed only if the user actually drops this item.
    void file.catch(() => undefined);
    const drag = { token, target, owner: this, epoch, file, consumed: false }; activeDrag = drag;
    return { token, end: () => { if (activeDrag === drag) endFileDrag(); } };
  }
  releaseFile(file: FileDocument): void { void this.api.closeDocument(file.ref).catch(() => undefined); }
}
export const FILE_TERMINAL_DRAG_TYPE = 'application/x-willyou-terminal-file';
let cancelledDragToken: string | null = null;
let activeDrag: { token: string; target: VisibleTerminal; owner: FileTerminalContextStore; epoch: number; file: Promise<FileDocument>; consumed: boolean } | null = null;
export function endFileDrag(): void { const drag = activeDrag; activeDrag = null; if (drag && !drag.consumed) { cancelledDragToken = drag.token; void drag.file.then(file => drag.owner.releaseFile(file)).catch(() => undefined); } }
export async function dropFileToTerminal(token: string, target: TerminalTarget, notice: (message: string) => void): Promise<void> {
  const drag = activeDrag;
  if (!drag || drag.token !== token || drag.consumed) {
    if (!drag && cancelledDragToken === token) { cancelledDragToken = null; notice('拖动来源或目标已改变，请重新拖动'); }
    return;
  }
  activeDrag = null; drag.consumed = true;
  let file: FileDocument | undefined;
  try {
    if (drag.target !== currentFileTerminal() || target.taskId !== drag.target.taskId || target.ptyId !== drag.target.ptyId) throw new Error('拖动目标已改变，请重新拖动');
    file = await drag.file; await drag.owner.insertPath(file, drag.epoch, drag.target, notice);
  } catch (error) { notice(message(error)); }
  finally { if (file) drag.owner.releaseFile(file); }
}
