import type { EditorView } from '@codemirror/view';
import type { LspKind, LspLocation, LspPosition, LspRange } from '@shared/file-lsp';
import type { RootRequest } from '@shared/files';
import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import type { FileWorkspaceStore } from '../workspace-store';
import { LanguageDocument, type LanguageApi } from './document';
import { LanguageHistory, LanguageHover } from './model';
export const LANGUAGE_LABELS: Record<LspKind, string> = { definition: '定义', typeDefinition: '类型定义', implementation: '实现', references: '引用' };
interface Destination { root: RootRequest; path: string; range: LspRange }
export function languageOffset(text: string, position: LspPosition): number {
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)];
  const line = lines[position.line]; if (!line) throw new Error('语言服务返回的行号超出当前文件');
  const content = line[0].replace(/\r\n$|[\r\n]$/, '');
  if (position.character > content.length) throw new Error('语言服务返回的列号超出当前文件');
  return (line.index ?? 0) + position.character;
}
export class LanguageWorkspace {
  current: LanguageDocument | null = null;
  hover: { text: string; x: number; y: number } | null = null;
  results: { kind: LspKind; locations: LspLocation[]; root: RootRequest; from: Destination } | null = null;
  message = '';
  busy = false;
  settings = false;
  readonly history = new LanguageHistory<Destination>((a, b) => a.root.lease === b.root.lease && a.root.generation === b.root.generation && a.path === b.path && a.range.start.line === b.range.start.line && a.range.start.character === b.range.start.character);
  private revision = 0;
  private sequence = 0;
  private cleanup: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly hovering = new LanguageHover(value => { this.hover = value; this.emit(); });
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly snapshot = () => this.revision;
  readonly emit = () => { this.revision++; for (const listener of this.listeners) listener(); };
  constructor(readonly workspace: FileWorkspaceStore, private readonly api: LanguageApi = rpc.files) {}
  setSettings(open: boolean): void { this.settings = open; this.emit(); }
  attach(buffer: FileBuffer, view: EditorView): () => void {
    this.cleanup?.(); this.results = null; this.message = ''; this.busy = false; this.hovering.cancel();
    const document: LanguageDocument = new LanguageDocument(buffer, view, this.api, (): boolean => this.current === document && this.workspace.active?.buffer === buffer, this.emit);
    this.current = document; let lastDoc = view.state.doc;
    const token = (event: MouseEvent) => {
      if (!view.contentDOM.contains(event.target as Node)) return null;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      return position === null ? null : view.state.wordAt(position);
    };
    const move = (event: MouseEvent) => {
      const range = token(event);
      if (!range || !document.supports('hover')) { this.hovering.leave(); return; }
      const doc = view.state.doc;
      this.hovering.enter(`${document.id}:${document.version}:${range.from}:${range.to}`, event.clientX, event.clientY + 18, async signal => {
        const result = await document.query('hover', range.from, signal); return result?.kind === 'hover' ? result.text : null;
      }, () => this.current === document && document.supports('hover') && doc === view.state.doc);
    };
    const leave = () => this.hovering.leave();
    const down = (event: MouseEvent) => { if (!(event.ctrlKey || event.metaKey) || event.button !== 0 || !document.supports('definition')) return; const range = token(event); if (!range) return; event.preventDefault(); event.stopPropagation(); void this.request('definition', range.from); };
    const key = (event: KeyboardEvent) => { if (event.isComposing || view.composing || !view.hasFocus || this.current !== document || this.workspace.active?.buffer !== buffer || !event.altKey || event.metaKey || event.ctrlKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const direction = event.key === 'ArrowLeft' ? -1 : 1; if (!this.history.target(direction)) return; event.preventDefault(); event.stopPropagation(); void this.travel(direction); };
    view.dom.addEventListener('mousemove', move); view.dom.addEventListener('mouseleave', leave); view.dom.addEventListener('mousedown', down, true); view.dom.addEventListener('keydown', key, true);
    const sync = () => { if (!buffer.inputSettled || view.composing) this.hovering.cancel(); if (view.state.doc !== lastDoc) { lastDoc = view.state.doc; this.hovering.cancel(); this.sequence++; this.busy = false; this.results = null; } void document.sync(); this.emit(); };
    this.observe = (candidate, editor) => { if (candidate === buffer && editor === view) sync(); };
    this.cleanup = () => { view.dom.removeEventListener('mousemove', move); view.dom.removeEventListener('mouseleave', leave); view.dom.removeEventListener('mousedown', down, true); view.dom.removeEventListener('keydown', key, true); document.dispose(); this.hovering.cancel(); if (this.current === document) this.current = null; this.results = null; this.busy = false; this.cleanup = null; this.emit(); };
    this.emit();
    return () => { if (this.current?.view === view) this.cleanup?.(); };
  }
  observe: (buffer: FileBuffer, view: EditorView) => void = () => undefined;
  retry(): void { if (this.current) { const { buffer, view } = this.current; this.attach(buffer, view); } }
  private destination(document: LanguageDocument, offset: number): Destination | null {
    if (document.session?.state !== 'ready') return null;
    const line = document.view.state.doc.lineAt(offset), position = { line: line.number - 1, character: offset - line.from };
    return { root: document.session.root, path: document.buffer.file.relativePath, range: { start: position, end: position } };
  }
  async request(kind: LspKind, offset = this.current?.view.state.selection.main.head ?? 0): Promise<void> {
    const document = this.current; if (!document?.supports(kind)) return;
    const from = this.destination(document, offset); if (!from) return;
    this.hovering.cancel(); const sequence = ++this.sequence; this.busy = true; this.message = ''; this.emit();
    const result = await document.query(kind, offset);
    if (sequence !== this.sequence || this.current !== document) return;
    this.busy = false;
    if (result && result.kind !== 'hover') {
      this.results = { kind, locations: result.locations, root: from.root, from };
      if (!result.locations.length) this.message = `未找到${LANGUAGE_LABELS[kind]}`;
      else if (result.locations.length === 1 && !result.locations[0].outsideRoot) await this.select(result.locations[0]);
    }
    this.emit();
  }
  async select(location: LspLocation): Promise<void> {
    const results = this.results; if (!results) return;
    if (location.outsideRoot || !location.relativePath) { this.message = '此位置位于已授权目录外；仅显示位置，不自动授予文件访问权限。'; this.emit(); return; }
    const destination = { root: results.root, path: location.relativePath, range: location.range };
    if (await this.navigate(destination)) this.history.record(results.from, destination);
    this.emit();
  }
  async travel(direction: -1 | 1): Promise<void> { const destination = this.history.target(direction); if (!destination) return; if (await this.navigate(destination)) this.history.commit(direction); this.emit(); }
  private async navigate(destination: Destination): Promise<boolean> {
    const sequence = ++this.sequence;
    try {
      const root = this.workspace.roots.roots.find(root => root.lease === destination.root.lease && root.generation === destination.root.generation);
      if (!root) throw new Error('语言服务导航的目录授权已失效');
      await this.workspace.open(root, destination.path, true);
      const buffer = this.workspace.active?.buffer;
      if (sequence !== this.sequence || !buffer || buffer.file.ref.lease !== root.lease || buffer.file.relativePath !== destination.path) return false;
      if (!buffer.editor) throw new Error('此位置无法在源码编辑器中打开');
      const from = languageOffset(buffer.raw, destination.range.start), to = languageOffset(buffer.raw, destination.range.end);
      buffer.revealSourceRange(from, to); this.results = null; this.message = ''; return true;
    } catch (error) { if (sequence === this.sequence) this.message = String(error instanceof Error ? error.message : error); return false; }
  }
  closeResults(): void { this.results = null; this.message = ''; this.emit(); }
  dispose(): void { this.sequence++; this.cleanup?.(); this.results = null; this.busy = false; }
}
