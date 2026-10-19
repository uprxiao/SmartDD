import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view';
import type { GitBlameLine, GitRepositoryInfo } from '@shared/file-git';
import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from './file-buffer';

export interface BlameSelection { line: GitBlameLine; repository: GitRepositoryInfo; anchor: DOMRect; pinned: boolean }
type Select = (value: BlameSelection | null) => void;
export function gitBlameExtension(buffer: FileBuffer, status: (text: string) => void, select: Select) {
  const update = StateEffect.define<RangeSet<GutterMarker>>();
  const markers = StateField.define<RangeSet<GutterMarker>>({ create: () => RangeSet.empty, update(value, transaction) {
    if (transaction.docChanged) value = RangeSet.empty;
    for (const effect of transaction.effects) if (effect.is(update)) value = effect.value;
    return value;
  } });
  class AuthorMarker extends GutterMarker {
    constructor(readonly line: GitBlameLine, readonly repository: GitRepositoryInfo) { super(); }
    eq(other: AuthorMarker) { return this.line.line === other.line.line && this.line.commitId === other.line.commitId && this.repository.id === other.repository.id; }
    toDOM() {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fw-blame-author'; button.textContent = this.line.author || '未知作者'; button.setAttribute('aria-label', `第 ${this.line.line} 行归属：${this.line.author || '未知作者'}`);
      const show = (pinned = false) => select({ line: this.line, repository: this.repository, anchor: button.getBoundingClientRect(), pinned });
      button.addEventListener('mouseenter', () => show()); button.addEventListener('focus', () => show()); button.addEventListener('click', (event) => { event.stopPropagation(); show(true); });
      return button;
    }
  }
  const plugin = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | undefined; id: string | null = null; disposed = false; lastKey = '';
    constructor(readonly view: EditorView) {
      // CodeMirror's ordinary line-number gutters are aria-hidden. This gutter
      // contains actual focusable author controls and must be discoverable.
      view.requestMeasure({ read: () => view.dom.querySelector('.cm-gutters'), write: (gutters) => { if (!this.disposed) gutters?.setAttribute('aria-hidden', 'false'); } });
      this.schedule();
    }
    update(change: ViewUpdate) { if (change.docChanged || change.viewportChanged) { select(null); this.schedule(); } }
    schedule() {
      clearTimeout(this.timer); if (this.id) { void rpc.files.cancelGit(this.id).catch(() => undefined); this.id = null; }
      this.timer = setTimeout(() => void this.read(), 180);
    }
    async read() {
      const view = this.view, doc = view.state.doc;
      if (buffer.dirty || buffer.saving || buffer.conflict) { this.lastKey = ''; status('文件有未保存或冲突内容，行归属暂不可用。'); return; }
      if (doc.length === 0) { status('空文件没有行归属。'); return; }
      const actualLines = doc.lines - Number(doc.lines > 1 && doc.line(doc.lines).length === 0);
      const start = Math.max(1, doc.lineAt(view.viewport.from).number - 20), end = Math.min(actualLines, start + 399, doc.lineAt(view.viewport.to).number + 20), hash = buffer.file.revision.hash;
      if (end < start) return;
      const key = `${hash}:${start}:${end}`; if (key === this.lastKey) return;
      const id = crypto.randomUUID(); this.id = id; const version = buffer.version; status('正在读取行归属…');
      try {
        const result = await rpc.files.gitBlame({ id, ref: buffer.file.ref, baseHash: hash, lineStart: start, lineEnd: end });
        if (this.disposed || this.id !== id || buffer.dirty || buffer.version !== version || buffer.file.revision.hash !== hash || view.state.doc !== doc) return;
        this.lastKey = key;
        if (result.state === 'unavailable') { status(result.reason); view.dispatch({ effects: update.of(RangeSet.empty) }); return; }
        view.dispatch({ effects: update.of(RangeSet.of(result.lines.map((line) => new AuthorMarker(line, result.repository).range(doc.line(line.line).from)), true)) }); status('');
      } catch (error) { if (!this.disposed && this.id === id) status(error instanceof Error ? error.message : String(error)); }
      finally { if (this.id === id) this.id = null; }
    }
    destroy() { this.disposed = true; clearTimeout(this.timer); if (this.id) void rpc.files.cancelGit(this.id).catch(() => undefined); select(null); }
  });
  return [markers, plugin, gutter({ class: 'fw-blame-gutter', markers: (view) => view.state.field(markers) }), EditorView.theme({ '.fw-blame-gutter': { width: '10ch', maxWidth: '10ch' }, '.fw-blame-gutter .cm-gutterElement': { padding: '0 5px 0 0', overflow: 'hidden' } })];
}

export function BlameCard({ selection, onClose }: { selection: BlameSelection | null; onClose: () => void }) {
  const [error, setError] = useState('');
  useEffect(() => { setError(''); if (!selection) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; const scroll = () => onClose(); window.addEventListener('keydown', close); window.addEventListener('resize', scroll); return () => { window.removeEventListener('keydown', close); window.removeEventListener('resize', scroll); }; }, [selection]);
  if (!selection) return null;
  const { line, repository, anchor, pinned } = selection;
  const link = repository.webBase ? `${repository.webBase}/commit/${line.commitId}` : null;
  return createPortal(<div className="fw-blame-card" role={pinned ? 'dialog' : 'tooltip'} aria-label="行归属详情" style={{ left: Math.max(8, Math.min(anchor.left, window.innerWidth - Math.min(340, window.innerWidth * .42) - 8)), top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - 160)) }} onMouseLeave={() => { if (!pinned) onClose(); }}>
    <div><strong>{line.author || '未知作者'}</strong><button aria-label="关闭行归属详情" onClick={onClose}>×</button></div><p>{line.summary || '无提交说明'}</p>
    <small>{line.at === null ? '日期不可用' : new Date(line.at * 1000).toLocaleString()} · {line.commitId.slice(0, 7)}</small>
    {link && <button className="fw-blame-link" onClick={() => void rpc.files.openWebLink(link).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)))}>在 GitHub 查看提交</button>}{error && <p role="alert">{error}</p>}
  </div>, document.body);
}
