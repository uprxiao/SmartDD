import { Compartment, EditorState, type Transaction } from '@codemirror/state';
import { history } from '@codemirror/commands';
import { decodeFileText, encodeFileText, textOffsetMap, type DecodedFileText } from '@shared/file-text';
import type { FileCheckpointReceipt, FileDocument, FileRead, FileSaveReceipt } from '@shared/files';
import type { rpc } from '@renderer/lib/ipc';
import { createSourceField } from './editor-source';
import { classifyFile } from '@shared/file-classification';
import { fileTextPresentation } from '@shared/file-attachment.mjs';
import { OfficeBuffer } from './office/buffer';
import { PptxBuffer } from './office/pptx-buffer';

export type FileClient = typeof rpc.files;
type TextFileClient = Pick<FileClient, 'read' | 'refresh' | 'save' | 'checkpoint' | 'drafts' | 'readDraft' | 'resolveDraft' | 'closeDocument'>;
interface Snapshot { version: number; raw: string; bom: boolean; baseHash: string; base64: string }

export function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function bytesToBase64(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(pieces.join(''));
}
const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '') : String(error);
export { message as fileErrorMessage };

/** One physical document buffer per window. Views may mount/unmount without
 * discarding this EditorState, its undo history, pending saves or its draft. */
export class FileBuffer {
  readonly instance = crypto.randomUUID();
  readonly viewConfiguration = new Compartment();
  file: FileDocument;
  editor: EditorState | null = null;
  office: OfficeBuffer | null = null;
  pptx:PptxBuffer|null=null;
  source: ReturnType<typeof createSourceField> | null = null;
  decoded: DecodedFileText | null = null;
  loadState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  loadError = '';
  draftError = '';
  saveError = '';
  disk: FileRead | null = null;
  saveReceipt: FileSaveReceipt | null = null;
  draftOptions: Awaited<ReturnType<FileClient['drafts']>> = [];
  version = 0;
  savedVersion = 0;
  draftVersion = -1;
  draftId: string = crypto.randomUUID();
  baseHash: string;
  baseRaw = '';
  baseBom = false;
  bom = false;
  scrollTop = 0;
  pdfPosition = { page: 1, zoom: 100, initialized: false };
  notebookPosition = 0;
  mode: 'document' | 'source' = 'document';
  reveal: { from: number; to: number } | null = null;
  private disposed = false;
  private writeRequired = false;
  private loadSequence = 0;
  private refreshSequence = 0;
  private refreshAfterLoad = false;
  private refreshAfterSave = false;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<boolean> | null = null;
  private lastCheckpoint: { version: number; baseHash: string; promise: Promise<FileCheckpointReceipt> } | null = null;
  private lastDurableCheckpoint: FileCheckpointReceipt | null = null;
  inputInterrupted = false;
  private inputViews = new Map<symbol, { composing: boolean; pending: boolean; timer?: ReturnType<typeof setTimeout> }>();
  private inputWaiters = new Set<(ready: boolean) => void>();
  constructor(file: FileDocument, private readonly api: TextFileClient, private readonly changed: () => void, readonly ensureRecoveryRoute: () => Promise<void> = async () => undefined) {
    this.file = file; this.baseHash = file.revision.hash;
  }
  get raw(): string { return this.editor && this.source ? this.editor.field(this.source.field).raw : ''; }
  get dirty(): boolean { return this.pptx?.dirty ?? this.office?.dirty ?? (this.editor !== null && (this.inputInterrupted || this.inputPending || this.writeRequired || this.raw !== this.baseRaw || this.bom !== this.baseBom || this.disk !== null)); }
  get saving(): boolean { return this.inFlight !== null || Boolean(this.office?.saving||this.pptx?.saving); }
  get editable(): boolean { return this.pptx?.editable ?? this.office?.editable ?? (this.decoded?.kind === 'text' && this.decoded.editable && this.file.writable); }
  get content() {
    const extension = classifyFile(this.file.name, new Uint8Array());
    // A lower-layer image/content hint cannot enable a format whose viewer is
    // explicitly unsupported at the workspace boundary (notably TIFF).
    return extension.kind === 'unsupported' ? extension : this.file.content ?? extension;
  }
  get textPresentation() { return fileTextPresentation(this.file.name, this.file.attachment); }
  updatePdfPosition(patch: Partial<typeof this.pdfPosition>): void {
    if (this.disposed) return;
    const prior = this.pdfPosition;
    const page = patch.page !== undefined && Number.isFinite(patch.page) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(patch.page))) : prior.page;
    const zoom = patch.zoom !== undefined && Number.isFinite(patch.zoom) ? Math.max(30, Math.min(800, patch.zoom)) : prior.zoom;
    const initialized = patch.initialized ?? prior.initialized;
    if (page === prior.page && zoom === prior.zoom && initialized === prior.initialized) return;
    this.pdfPosition = { page, zoom, initialized }; this.changed();
  }
  private readsText(file = this.file): boolean {
    const content = file.content ?? classifyFile(file.name, new Uint8Array());
    return content.kind === 'text' || content.kind === 'image' && content.mime === 'image/svg+xml' && this.mode === 'source';
  }
  get recoveryBlocked(): boolean { return Boolean(this.saveReceipt?.recoveryId && this.saveReceipt.state !== 'saved'); }
  get conflict(): boolean { return this.disk !== null || Boolean(this.office?.disk||this.pptx?.disk) || this.saveReceipt?.state === 'conflict' || this.saveReceipt?.state === 'unknown'; }
  notify():void { this.changed(); }
  private get inputPending(): boolean { return [...this.inputViews.values()].some(input => input.pending || input.composing); }
  get inputSettled(): boolean { return !this.inputPending && !this.inputInterrupted; }
  private settleInput(ready = true): void {
    if (ready && this.inputPending) return;
    for (const resolve of this.inputWaiters) resolve(ready && !this.disposed);
    this.inputWaiters.clear();
  }
  private waitForInput(): Promise<boolean> {
    return new Promise(resolve => { this.inputWaiters.add(resolve); this.settleInput(); });
  }
  /** Bind potential DOM input to the actual view owner. The editor transaction
   * remains the sole source of text; this only gates snapshots while DOM input
   * has not reached it. Composition protection has no 550ms expiry. */
  attachInputView() {
    const owner = Symbol('file-editor-input'), input = { composing: false, pending: false, compositionChanged: false, recovering: false, compositionBase: '', timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.inputViews.set(owner, input);
    const current = () => !this.disposed && this.inputViews.get(owner) === input;
    const arm = () => {
      clearTimeout(input.timer); input.pending = true;
      input.timer = setTimeout(() => {
        if (!current()) return;
        input.pending = false;
        if (!input.composing) {
          if (input.recovering && input.compositionChanged && this.raw !== input.compositionBase) {
            this.inputInterrupted = false; if (!this.conflict) this.saveError = ''; this.schedule();
          }
          input.recovering = false; input.compositionChanged = false;
        }
        this.settleInput(); this.changed();
      }, 550);
    };
    return {
      beforeInput: () => { if (!current() || !this.editable) return; arm(); this.changed(); },
      compositionStart: () => {
        if (!current() || !this.editable) return;
        input.composing = true; input.compositionChanged = false; input.recovering = this.inputInterrupted; input.compositionBase = this.raw; this.changed();
      },
      compositionEnd: () => { if (!current()) return; input.composing = false; arm(); this.changed(); },
      acceptTransactions: (state: EditorState, transactions: readonly Transaction[]) => {
        if (!current()) return;
        if (transactions.some(transaction => transaction.docChanged)) {
          clearTimeout(input.timer); input.pending = false;
          if (input.composing) input.compositionChanged = true;
          else {
            const nextRaw = this.source ? state.field(this.source.field).raw : '';
            if (!input.recovering || nextRaw !== input.compositionBase) this.inputInterrupted = false;
            input.compositionChanged = false; input.recovering = false;
          }
        }
        this.acceptTransactions(state, transactions); this.settleInput();
      },
      dispose: () => {
        if (!current()) return;
        const interrupted = input.pending || input.composing;
        clearTimeout(input.timer); this.inputViews.delete(owner);
        if (interrupted && input.compositionChanged) {
          // CodeMirror may already contain an IME candidate. Preserve it and
          // its history, but never let an old timer/in-flight acknowledgement
          // turn removal of its view into confirmation of that candidate.
          this.inputInterrupted = true;
          this.saveError = '输入已中断，请返回编辑器继续输入或撤销后再保存';
          clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
        }
        // Interrupted requests must fail, not report a successful save of the
        // pre-input document after its view vanished. A later explicit save is
        // still allowed against the retained, confirmed EditorState.
        this.settleInput(!interrupted); this.changed();
      },
    };
  }
  getOffice():OfficeBuffer { return this.office ??= new OfficeBuffer(this); }
  getPptx():PptxBuffer{return this.pptx??=new PptxBuffer(this);}
  revealSourceRange(from: number, to: number): void {
    if (!this.editor) return;
    const map = textOffsetMap(this.raw);
    this.reveal = { from: map.rawToCm(from), to: map.rawToCm(to) }; this.changed();
  }

  private install(read: FileRead, preserveSelection = false): void {
    const bytes = bytesFromBase64(read.base64);
    read.document.content ??= classifyFile(read.document.name, bytes);
    const decoded = this.readsText(read.document) ? decodeFileText(bytes) : { kind: 'binary' as const, editable: false as const, reason: read.document.content.reason ?? '此文件不是可编辑文本；可使用外部应用打开或另存副本。' };
    const selection = preserveSelection ? this.editor?.selection.main.head : 0;
    this.file = read.document; this.baseHash = read.document.revision.hash; this.decoded = decoded;
    if (decoded.kind === 'text') {
      this.baseRaw = decoded.raw; this.baseBom = this.bom = decoded.bom;
      this.makeEditor(decoded.raw, selection);
    } else { this.source = null; this.editor = null; }
    this.disk = null; this.writeRequired = false; this.inputInterrupted = false; this.loadState = 'ready'; this.loadError = '';
  }
  private makeEditor(raw: string, selection = 0): void {
    this.source = createSourceField(raw);
    this.editor = EditorState.create({ doc: this.source.normalized, selection: { anchor: Math.min(selection ?? 0, this.source.normalized.length) }, extensions: [this.source.extensions, history(), this.viewConfiguration.of([])] });
  }
  async load(): Promise<void> {
    if (this.dirty) { await this.refresh(); return; }
    if(this.content.kind==='office'&&this.content.format==='pptx'){await this.getPptx().load();return;}
    if (this.content.kind === 'office' && ['xlsx','xlsm'].includes(this.content.format ?? '')) { await this.getOffice().load(); return; }
    if (!this.readsText()) { this.loadState = 'ready'; this.changed(); return; }
    const sequence = ++this.loadSequence;
    this.refreshSequence++; // A newer explicit load supersedes an older refresh.
    this.loadState = 'loading'; this.loadError = ''; this.changed();
    try {
      const read = await this.api.read(this.file.ref);
      if (this.disposed || sequence !== this.loadSequence) return;
      // A watch/refresh may arrive after this read captured its bytes but before
      // delivery. Do not install that stale base; re-read within this instance.
      if (this.refreshAfterLoad) { this.refreshAfterLoad = false; await this.load(); return; }
      this.install(read);
      const drafts = await this.api.drafts(this.file.ref);
      if (this.disposed || sequence !== this.loadSequence) return;
      this.draftOptions = drafts;
    } catch (error) { if (!this.disposed && sequence === this.loadSequence) { this.loadState = 'error'; this.loadError = message(error); } }
    if (!this.disposed && sequence === this.loadSequence) {
      // A delayed read error cannot consume a newer disk invalidation either.
      if (this.refreshAfterLoad) { this.refreshAfterLoad = false; await this.load(); return; }
      this.changed();
    }
  }
  acceptTransactions(state: EditorState, transactions: readonly Transaction[]): void {
    if (this.disposed) return;
    this.editor = state;
    if (transactions.some((transaction) => transaction.docChanged)) {
      this.version++;
      if (!this.conflict && !this.inputInterrupted) this.saveError = '';
      this.schedule();
    }
    this.changed();
  }
  private schedule(): void {
    clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
    if (this.disposed || this.inputInterrupted) return;
    if (!this.dirty) {
      const version = this.version;
      void this.discardCleanDraft(version).catch((error) => { if (!this.disposed && this.version === version && !this.dirty) { this.draftError = message(error); this.changed(); } });
      return;
    }
    this.checkpointTimer = setTimeout(() => { void this.checkpoint().catch(() => undefined); }, 500);
    if (!this.conflict) this.saveTimer = setTimeout(() => { void this.save(); }, 3000);
  }
  private snapshot(): Snapshot {
    if (!this.editor || this.decoded?.kind !== 'text' || !this.decoded.editable) throw new Error('当前文件没有可无损编码的文本内容');
    const raw = this.raw, bom = this.bom;
    return { version: this.version, raw, bom, baseHash: this.baseHash, base64: bytesToBase64(encodeFileText(raw, bom, 'checkpoint')) };
  }
  async checkpoint(): Promise<FileCheckpointReceipt | null> {
    if(this.pptx)return this.pptx.checkpoint();
    if (this.office) return this.office.checkpoint();
    while (this.inputPending) { if (!await this.waitForInput()) return null; }
    if (this.inputInterrupted) return null;
    if (!this.dirty || this.disposed) return null;
    try { return await this.checkpointSnapshot(this.snapshot()); }
    catch (error) { if (!this.disposed) { this.draftError = message(error); this.changed(); } throw error; }
  }
  private checkpointSnapshot(snapshot: Snapshot): Promise<FileCheckpointReceipt> {
    if (this.lastCheckpoint?.version === snapshot.version && this.lastCheckpoint.baseHash === snapshot.baseHash) return this.lastCheckpoint.promise;
    const promise = this.api.checkpoint({ ref: this.file.ref, draftId: this.draftId, bufferVersion: snapshot.version, baseHash: snapshot.baseHash, base64: snapshot.base64, encoding: 'utf-8', bom: snapshot.bom }).then(async (receipt) => {
      if (!this.lastDurableCheckpoint || receipt.bufferVersion >= this.lastDurableCheckpoint.bufferVersion) this.lastDurableCheckpoint = receipt;
      await this.ensureRecoveryRoute();
      if (!this.disposed) { this.draftVersion = Math.max(this.draftVersion, receipt.bufferVersion); this.draftError = ''; this.changed(); }
      return receipt;
    }).catch((error) => {
      if (this.lastCheckpoint?.promise === promise) this.lastCheckpoint = null;
      if (!this.disposed) { this.draftError = message(error); this.changed(); }
      throw error;
    });
    this.lastCheckpoint = { version: snapshot.version, baseHash: snapshot.baseHash, promise };
    return promise;
  }
  async save(): Promise<boolean> {
    if(this.pptx)return this.pptx.save();
    if (this.office) return this.office.save();
    while (this.inputPending) { if (!await this.waitForInput()) return false; }
    if (this.inputInterrupted) return false;
    if (this.disposed) return false;
    if (this.inFlight) { await this.inFlight; return !this.dirty && !this.conflict; }
    if (!this.dirty) return true;
    if (!this.editable || this.conflict) return false;
    clearTimeout(this.saveTimer); clearTimeout(this.checkpointTimer);
    let snapshot: Snapshot;
    try { snapshot = this.snapshot(); }
    catch (error) { this.saveError = message(error); this.changed(); return false; }
    this.refreshSequence++;
    const opId = crypto.randomUUID();
    this.saveError = '';
    const operation = async () => {
      try {
        await this.checkpointSnapshot(snapshot);
        if (this.disposed) return false;
        // Editing can grow an initially editable document past its save limit.
        // Preserve its independent checkpoint before refusing the disk write.
        encodeFileText(snapshot.raw, snapshot.bom);
        const receipt = await this.api.save({ ref: this.file.ref, opId, bufferVersion: snapshot.version, baseHash: snapshot.baseHash, base64: snapshot.base64 });
        if (this.disposed) return false;
        this.saveReceipt = receipt;
        if (receipt.state !== 'saved' || !receipt.revision) {
          this.saveError = receipt.message ?? '文件未保存；修改仍保留';
          if (receipt.state === 'conflict') await this.readConflict();
          return false;
        }
        this.file = { ...this.file, revision: receipt.revision, documentKey: `local:${receipt.revision.device}:${receipt.revision.inode}` };
        this.baseRaw = snapshot.raw; this.baseBom = snapshot.bom; this.baseHash = receipt.revision.hash; this.savedVersion = snapshot.version; this.writeRequired = false;
        // Newer input may already have a durable checkpoint against the old
        // base. Rebasing that input is a new draft state even when its bytes
        // stay the same; never reuse its version with a different baseHash.
        if (this.version !== snapshot.version && this.dirty) this.version++;
        // A newer editor transaction stays dirty. Only the acknowledged snapshot
        // is eligible to resolve its independent checkpoint.
        try { await this.api.resolveDraft({ ref: this.file.ref, draftId: this.draftId, bufferVersion: snapshot.version, hash: receipt.revision.hash, action: 'saved', saveOpId: opId }); }
        catch (error) { this.draftError = `文件已保存，草稿记录仍保留：${message(error)}`; }
        return !this.dirty;
      } catch (error) { if (!this.disposed) this.saveError = message(error); return false; }
      finally { if (!this.disposed) this.changed(); }
    };
    this.inFlight = operation(); this.changed();
    try { return await this.inFlight; }
    finally {
      this.inFlight = null;
      if (!this.disposed) {
        if (this.version !== snapshot.version) this.schedule();
        this.changed();
        if (this.refreshAfterSave) { this.refreshAfterSave = false; void this.refresh(); }
      }
    }
  }
  private async readConflict(): Promise<void> {
    try { const read = await this.api.read(this.file.ref); if (!this.disposed) this.disk = read; }
    catch (error) { if (!this.disposed) this.loadError = message(error); }
  }
  async refresh(): Promise<void> {
    if(this.pptx)return this.pptx.refresh();
    if (this.office) return this.office.refresh();
    if (this.disposed) return;
    if (this.saving) { this.refreshAfterSave = true; return; }
    if (this.loadState === 'loading') { this.refreshAfterLoad = true; return; }
    if (this.loadState !== 'ready' && !this.editor) { await this.load(); return; }
    const sequence = ++this.refreshSequence;
    try {
      if (this.loadState === 'error') {
        // The file may be loaded even when recovery metadata failed. Recover
        // metadata without reinstalling source over subsequent manual edits.
        const drafts = await this.api.drafts(this.file.ref);
        if (this.disposed || sequence !== this.refreshSequence) return;
        this.draftOptions = drafts; this.loadState = 'ready';
      }
      const stat = await this.api.refresh(this.file.ref);
      if (this.disposed || sequence !== this.refreshSequence) return;
      const sameIdentity = stat.revision.device === this.file.revision.device && stat.revision.inode === this.file.revision.inode;
      if (stat.revision.hash === this.baseHash && (!this.dirty || sameIdentity)) { this.file = stat; this.loadError = ''; this.changed(); return; }
      if (!this.dirty && !this.recoveryBlocked && !this.readsText(stat)) { this.file = stat; this.baseHash = stat.revision.hash; this.editor = null; this.source = null; this.decoded = null; this.loadError = ''; this.changed(); return; }
      const version = this.version, read = await this.api.read(this.file.ref);
      if (this.disposed || sequence !== this.refreshSequence) return;
      this.loadError = '';
      const protectedReceipt = this.recoveryBlocked || this.saveReceipt?.state === 'unknown';
      const decoded = this.editor && !protectedReceipt && !this.saving && !this.inputPending && !this.inputInterrupted && this.version === version
        ? decodeFileText(bytesFromBase64(read.base64)) : null;
      if (decoded?.kind === 'text' && decoded.raw === this.raw && decoded.bom === this.bom) {
        // An independent writer can persist these exact local bytes. Adopt its
        // authoritative revision without replacing EditorState/undo/selection.
        // This is not a save acknowledgement and cannot resolve a transaction
        // with unknown/displaced recovery material.
        this.file = read.document; this.decoded = decoded; this.baseHash = read.document.revision.hash;
        this.baseRaw = decoded.raw; this.baseBom = decoded.bom; this.savedVersion = this.version;
        this.disk = null; this.writeRequired = false; this.saveReceipt = null; this.saveError = ''; this.loadError = '';
        this.schedule();
      }
      else if (this.dirty || protectedReceipt) { this.disk = read; if (!protectedReceipt || !this.saveError) this.saveError = '磁盘内容已改变，本地修改仍保留'; clearTimeout(this.saveTimer); }
      else this.install(read, true);
      this.changed();
    } catch (error) { if (!this.disposed && sequence === this.refreshSequence) { this.loadError = message(error); this.changed(); } }
  }
  async keepLocal(): Promise<boolean> {
    if(this.pptx)return this.pptx.keepLocal();
    if (this.office) return this.office.keepLocal();
    if (this.recoveryBlocked || this.disposed || this.saving || this.inputInterrupted || this.inputPending) return false;
    // Always obtain a fresh revision. The broker will compare it again; this
    // action never opts out of compare-before-save protection.
    try {
      const latest = await this.api.read(this.file.ref);
      // Input may begin while the fresh disk revision is being read. Refusing
      // that save must also preserve the conflict and original save baseline.
      if (this.recoveryBlocked || this.disposed || this.saving || this.inputInterrupted || this.inputPending) return false;
      this.baseHash = latest.document.revision.hash; this.disk = null; this.saveReceipt = null; this.writeRequired = true;
      this.version++; this.lastCheckpoint = null;
      return await this.save();
    } catch (error) { this.saveError = message(error); this.changed(); return false; }
  }
  async useDisk(): Promise<boolean> {
    if(this.pptx)return this.pptx.useDisk();
    if (this.office) return this.office.useDisk();
    try {
      const read = await this.api.read(this.file.ref);
      if (this.disposed) return false;
      await this.discardDraft();
      if (this.disposed) return false;
      this.install(read); this.version++; this.savedVersion = this.version; this.saveReceipt = null; this.saveError = ''; this.changed(); return true;
    } catch (error) { if (!this.disposed) { this.loadError = message(error); this.changed(); } return false; }
  }
  async restoreDraft(id: string): Promise<void> {
    if(this.pptx)return this.pptx.restoreDraft(id);
    if (this.office) return this.office.restoreDraft(id);
    const recovered = await this.api.readDraft(this.file.ref, id);
    if (this.disposed) return;
    const decoded = decodeFileText(bytesFromBase64(recovered.base64));
    if (decoded.kind !== 'text') throw new Error('恢复草稿不具备无损编辑条件');
    this.draftId = id; this.bom = decoded.bom; this.writeRequired = true;
    this.makeEditor(decoded.raw); this.version = recovered.bufferVersion + 1; this.draftVersion = recovered.bufferVersion;
    if (recovered.baseHash !== this.file.revision.hash) { await this.readConflict(); this.saveError = '草稿基线与当前磁盘不同，请选择保留的版本'; }
    this.baseHash = recovered.baseHash; this.draftOptions = [];
    this.lastCheckpoint = { version: recovered.bufferVersion, baseHash: recovered.baseHash, promise: Promise.resolve({ draftId: id, bufferVersion: recovered.bufferVersion, hash: recovered.hash }) };
    this.lastDurableCheckpoint = { draftId: id, bufferVersion: recovered.bufferVersion, hash: recovered.hash };
    this.schedule(); this.changed();
  }
  private async discardCleanDraft(version: number): Promise<void> {
    const draftId = this.draftId, checkpoint = this.lastCheckpoint;
    let receipt = this.lastDurableCheckpoint;
    if (checkpoint) {
      const completed = await checkpoint.promise.catch(() => undefined);
      if (completed && (!receipt || completed.bufferVersion >= receipt.bufferVersion)) receipt = completed;
    }
    // Undo-to-clean cleanup belongs to this exact editor state. A delayed
    // checkpoint must never let it resolve a later edit's recovery material.
    if (this.disposed || this.version !== version || this.draftId !== draftId || this.dirty || !receipt) return;
    const result = await this.api.resolveDraft({ ref: this.file.ref, draftId, bufferVersion: receipt.bufferVersion, hash: receipt.hash, action: 'discard' });
    if (!result.resolved) throw new Error('草稿已有更新，未放弃新版本；请重新核对后关闭');
  }
  async discardDraft(): Promise<void> {
    if(this.pptx)return this.pptx.discardDraft();
    if (this.office) return this.office.discardDraft();
    clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
    if (this.lastCheckpoint) await this.lastCheckpoint.promise.catch(() => undefined);
    if (this.lastDurableCheckpoint) {
      const receipt = this.lastDurableCheckpoint;
      const result = await this.api.resolveDraft({ ref: this.file.ref, draftId: this.draftId, bufferVersion: receipt.bufferVersion, hash: receipt.hash, action: 'discard' });
      if (!result.resolved) throw new Error('草稿已有更新，未放弃新版本；请重新核对后关闭');
    }
    // Deliberately retain any save operation's displaced/current recovery
    // material. Discard here only resolves this editor checkpoint.
  }
  async prepareClose(action: 'save' | 'discard'): Promise<boolean> {
    if(this.pptx)return this.pptx.prepareClose(action);
    if (this.office) return this.office.prepareClose(action);
    clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
    try {
      if (this.inFlight) await this.inFlight;
      if (action === 'discard') { await this.discardDraft(); return true; }
      return await this.save() && !this.dirty && !this.recoveryBlocked;
    } finally { clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.loadSequence++; this.refreshSequence++;
    for (const input of this.inputViews.values()) clearTimeout(input.timer);
    this.inputViews.clear(); this.settleInput(false);
    this.office?.close();
    this.pptx?.close();
    clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
    void this.api.closeDocument(this.file.ref).catch(() => undefined);
  }
}
