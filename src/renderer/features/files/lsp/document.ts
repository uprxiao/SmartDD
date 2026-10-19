import type { EditorView } from '@codemirror/view';
import type { LspOpenResult, LspQuery, LspResult } from '@shared/file-lsp';
import { lspSupports } from '@shared/file-lsp';
import type { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
export type LanguageApi = Pick<typeof rpc.files, 'languageOpen' | 'languageChange' | 'languageQuery' | 'languageCancel' | 'languageClose'>;
export class LanguageDocument {
  readonly id = crypto.randomUUID();
  session: LspOpenResult | null = null;
  error = '';
  version = 1;
  closed = false;
  private text: string;
  private readonly pending = new Set<string>();
  private readonly opening: Promise<void>;
  private synchronizing: Promise<void> = Promise.resolve();
  constructor(readonly buffer: FileBuffer, readonly view: EditorView, private readonly api: LanguageApi, private readonly active: () => boolean, private readonly changed: () => void) {
    this.text = view.state.doc.toString();
    this.opening = api.languageOpen({ id: this.id, ref: buffer.file.ref, version: this.version, text: this.text }).then(session => {
      if (this.closed) { void api.languageClose(this.id).catch(() => undefined); return; }
      this.session = session; this.changed();
    }).catch(error => { if (!this.closed) { this.error = String(error instanceof Error ? error.message : error); this.changed(); } });
  }
  get available(): boolean { return !this.closed && this.active() && this.buffer.inputSettled && !this.view.composing && this.session?.state === 'ready' && !this.error; }
  supports(kind: LspQuery['kind']): boolean { return this.available && this.session?.state === 'ready' && lspSupports(this.session.capabilities, kind); }
  async sync(): Promise<void> {
    const text = this.view.state.doc.toString();
    if (text === this.text || this.closed) return this.synchronizing;
    this.text = text; this.version++; this.cancel(); const version = this.version;
    this.synchronizing = this.synchronizing.then(async () => {
      await this.opening;
      if (this.closed || this.session?.state !== 'ready' || version !== this.version) return;
      try { await this.api.languageChange({ id: this.id, version, text }); }
      catch (error) { if (!this.closed && version === this.version) { this.error = String(error instanceof Error ? error.message : error); this.changed(); } }
    });
    return this.synchronizing;
  }
  async query(kind: LspQuery['kind'], offset: number, signal?: AbortSignal): Promise<LspResult | null> {
    await this.sync(); await this.opening;
    if (!this.supports(kind) || signal?.aborted) return null;
    const doc = this.view.state.doc, version = this.version, requestId = crypto.randomUUID();
    const line = doc.lineAt(Math.min(Math.max(0, offset), doc.length));
    const current = () => !this.closed && this.pending.has(requestId) && this.active() && this.buffer.inputSettled && !this.view.composing && doc === this.view.state.doc && version === this.version && !signal?.aborted;
    const cancel = () => { void this.api.languageCancel(this.id, requestId).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true }); this.pending.add(requestId);
    try { const result = await this.api.languageQuery({ id: this.id, requestId, version, kind, position: { line: line.number - 1, character: offset - line.from } }); return current() ? result : null; }
    catch (error) { if (current()) { this.error = String(error instanceof Error ? error.message : error); this.changed(); } return null; }
    finally { signal?.removeEventListener('abort', cancel); this.pending.delete(requestId); }
  }
  cancel(): void { for (const id of this.pending) void this.api.languageCancel(this.id, id).catch(() => undefined); this.pending.clear(); }
  dispose(): void { if (this.closed) return; this.closed = true; this.cancel(); void this.api.languageClose(this.id).catch(() => undefined); }
}
