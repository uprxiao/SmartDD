import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { handleLargeTextInput } from './large-input';
import { defaultKeymap, historyKeymap, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { ChevronDown, ChevronUp, Redo2, Undo2, X } from 'lucide-react';
import { bytesFromBase64, type FileBuffer } from './file-buffer';
import { decodeFileText } from '@shared/file-text';
import { fileInlineDiffPolicy } from '@shared/file-inline-diff.mjs';
import { fileConflictDiffGuard, syncFileConflictDiff } from './conflict-diff';
import { fileFindCurrent, fileFindQuery, fileFindState } from './text-find-state';
import { GoToLineButton, GoToLinePanel } from './go-to-line';
import { LinePreviewSession } from './line-navigation';
import { rememberEditorScroll, restoredEditorScroll } from './editor-scroll';
import { markdownEditor } from './markdown/editor';
import { loadMarkdownImage } from './markdown/images';
import { loadMarkdownDiagram } from './markdown/diagrams';
import { codeHighlight } from './code/editor';
import { BlameCard, gitBlameExtension, type BlameSelection } from './git-blame';
import { FileSelectionActions } from './terminal-context/selection';
import { LanguageEditorTools, useFileLanguage } from './lsp/components';
import '../../../../prototypes/m6-codex/src/file-code-theme.css';
import 'katex/dist/katex.min.css';
import './markdown/style.css';

export function FileTextEditor({ buffer, wrap, markdown = false, onLink, blame = false, metadataRevision = 0 }: { buffer: FileBuffer; wrap: boolean; markdown?: boolean; onLink?: (href: string) => void; blame?: boolean; metadataRevision?: number }) {
  const language = useFileLanguage();
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const diffSlot = useMemo(() => new Compartment(), [buffer]);
  const diskText = useMemo(() => buffer.disk ? decodeFileText(bytesFromBase64(buffer.disk.base64)) : null, [buffer, buffer.disk]);
  const original = diskText?.kind === 'text' ? diskText.raw : null;
  const diffPolicy = fileInlineDiffPolicy(original, buffer.raw), richDocument = markdown && !buffer.conflict;
  const pendingInput = useRef<Extension>([]);
  const [finding, setFinding] = useState(false), [query, setQuery] = useState('');
  const findInput = useRef<HTMLInputElement>(null);
  const lineSession = useRef<LinePreviewSession | null>(null);
  const [lineNavigation, setLineNavigation] = useState<{ session: LinePreviewSession; instance: string } | null>(null);
  const [previewStatus, setPreviewStatus] = useState(''), link = useRef(onLink); link.current = onLink;
  const [codeStatus, setCodeStatus] = useState('');
  const [blameStatus, setBlameStatus] = useState(''), [blameSelection, setBlameSelection] = useState<BlameSelection | null>(null);
  const attribution = useMemo(() => blame && !markdown ? gitBlameExtension(buffer, setBlameStatus, setBlameSelection) : [], [buffer, blame, markdown, metadataRevision, buffer.file.revision.hash, buffer.dirty, buffer.saving]);
  const syntax = useMemo(() => codeHighlight(buffer.file.name, setCodeStatus), [buffer.file.name]);
  const rich = useMemo(() => richDocument && buffer.source ? markdownEditor(buffer, {
    status: setPreviewStatus, link: (href) => link.current?.(href), image: (element, href, signal) => loadMarkdownImage(buffer, element, href, signal),
    diagram: (element, source, signal) => loadMarkdownDiagram(buffer, element, source, signal),
  }) : [], [buffer, buffer.source, richDocument]);
  const search = buffer.editor?.field(fileFindState, false), matches = finding && search?.query === query ? search.matches : [], match = Math.min(search?.current ?? 0, Math.max(0, matches.length - 1));
  const extension = () => [
    pendingInput.current,
    diffSlot.of([]), ...(buffer.source ? [fileConflictDiffGuard(diffSlot, buffer.source)] : []),
    fileFindState,
    ...(!richDocument ? [lineNumbers(), syntax, attribution] : []), drawSelection(), highlightSpecialChars(), rich,
    keymap.of([{ key: 'Mod-s', run: (editor) => { if (editor.composing) return false; void buffer.save(); return true; } }, ...historyKeymap, ...defaultKeymap]),
    EditorState.readOnly.of(!buffer.editable), EditorView.editable.of(buffer.editable), ...(wrap ? [EditorView.lineWrapping] : []),
    EditorView.contentAttributes.of({ 'aria-label': `${buffer.file.name} 内容`, spellcheck: 'false' }),
    EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fw-code-text)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--fw-code-font)', fontSize: 'var(--fw-code-size)', lineHeight: 'var(--fw-code-line)' }, '.cm-content': { padding: '0 0 24px' }, '.cm-line': { padding: '0 12px' }, '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fw-code-comment)', border: 'none' }, '.cm-lineNumbers .cm-gutterElement': { minWidth: '28px', boxSizing: 'border-box', padding: '0 4px 0 8px' }, '.cm-cursor': { borderLeftColor: 'var(--text)' }, '&.cm-focused': { outline: 'none' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--selected)' } }),
  ];
  useLayoutEffect(() => {
    if (!host.current || !buffer.editor) return;
    const input = buffer.attachInputView();
    const editor = new EditorView({ parent: host.current, state: buffer.editor, scrollTo: restoredEditorScroll(buffer, buffer.editor), dispatchTransactions(transactions, current) { current.update(transactions); input.acceptTransactions(current.state, transactions); language?.observe(buffer, current); } });
    view.current = editor;
    pendingInput.current = [EditorView.domEventObservers({
      beforeinput: event => { if (/^(insert|delete|history)/.test(event.inputType)) { input.beforeInput(); language?.observe(buffer, editor); } },
      compositionstart: () => { input.compositionStart(); language?.observe(buffer, editor); }, compositionend: () => { input.compositionEnd(); language?.observe(buffer, editor); },
    }), EditorView.domEventHandlers({ beforeinput: (event, current) => handleLargeTextInput(event, current) })];
    editor.dispatch({ effects: [buffer.viewConfiguration.reconfigure(extension()), fileFindQuery.of('')] });
    editor.scrollDOM.scrollTop = buffer.scrollTop;
    const scrolled = () => { buffer.scrollTop = editor.scrollDOM.scrollTop; };
    editor.scrollDOM.addEventListener('scroll', scrolled);
    return () => { lineSession.current?.cancel(false); lineSession.current = null; rememberEditorScroll(buffer, editor); scrolled(); editor.scrollDOM.removeEventListener('scroll', scrolled); editor.destroy(); input.dispose(); view.current = null; };
  }, [buffer]); // the EditorState lives in buffer across view switches
  useLayoutEffect(() => {
    const editor=view.current;
    // An explicit disk choice can install a new authoritative EditorState.
    // Wait for the existing view synchronization before dispatching display
    // effects, or an old view could write its stale state back to the buffer.
    if(editor&&editor.state===buffer.editor)syncFileConflictDiff(editor,diffSlot,original,buffer.raw);
  });
  useEffect(() => { if (!markdown && view.current) return language?.attach(buffer, view.current); }, [buffer, markdown, language]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || !buffer.editor) return;
    if (editor.state !== buffer.editor) { const scroll = editor.scrollDOM.scrollTop; editor.setState(buffer.editor); editor.dispatch({ effects: buffer.viewConfiguration.reconfigure(extension()) }); editor.scrollDOM.scrollTop = scroll; language?.observe(buffer, editor); }
  }, [buffer, buffer.editor]);
  useEffect(() => { setPreviewStatus(''); view.current?.dispatch({ effects: buffer.viewConfiguration.reconfigure(extension()) }); }, [buffer, wrap, buffer.editable, rich, attribution]);
  useEffect(() => { if (finding) findInput.current?.focus(); }, [finding]);
  useLayoutEffect(() => {
    if (lineNavigation && (lineNavigation.instance !== buffer.instance || !lineNavigation.session.isCurrent())) {
      lineNavigation.session.cancel(false);
      if (lineSession.current === lineNavigation.session) lineSession.current = null;
      setLineNavigation(null);
    }
  }, [buffer, buffer.editor, buffer.inputSettled, lineNavigation]);
  useLayoutEffect(() => {
    const editor = view.current; if (!editor) return;
    editor.dispatch({ effects: fileFindQuery.of(finding ? query : '') });
    const first = editor.state.field(fileFindState).matches[0];
    if (finding && first) editor.dispatch({ selection: EditorSelection.single(first.from, first.to), effects: EditorView.scrollIntoView(first.from, { y: 'center' }) });
  }, [buffer, finding, query]);
  useEffect(() => { const range = buffer.reveal, editor = view.current; if (!range || !editor) return; editor.dispatch({ selection: EditorSelection.single(range.from, range.to), effects: EditorView.scrollIntoView(range.from, { y: 'center' }) }); buffer.reveal = null; }, [buffer, buffer.reveal]);
  const locate = (index: number) => {
    if (!matches.length || !view.current) return;
    const next = (index + matches.length) % matches.length, { from, to } = matches[next];
    view.current.dispatch({ selection: EditorSelection.single(from, to), effects: [fileFindCurrent.of(next), EditorView.scrollIntoView(from, { y: 'center' })] });
  };
  const history = (direction: 'undo' | 'redo') => {
    const editor = view.current;
    if (!editor || !buffer.editable || editor.composing) return;
    (direction === 'undo' ? undo : redo)(editor); editor.focus();
  };
  const openLineNavigation = () => {
    const editor = view.current;
    if (!editor || editor.composing || !buffer.inputSettled) return;
    if (lineSession.current?.isCurrent()) { const input = host.current?.parentElement?.querySelector<HTMLInputElement>('.fw-line-navigation input'); input?.focus(); input?.select(); return; }
    lineSession.current?.cancel(false);
    const ref = buffer.file.ref, instance = buffer.instance;
    const session = new LinePreviewSession(editor, () => view.current === editor && buffer.instance === instance && buffer.inputSettled && buffer.file.ref.id === ref.id && buffer.file.ref.lease === ref.lease && buffer.file.ref.generation === ref.generation);
    lineSession.current = session; setFinding(false); setLineNavigation({ session, instance });
  };
  return <FileSelectionActions buffer={buffer} editor={() => view.current}><div className={`fw-editor-host ${richDocument ? 'fw-markdown-editable' : ''}`} data-inline-diff-state={diffPolicy.state} onKeyDownCapture={(event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); lineSession.current?.cancel(false); lineSession.current = null; setLineNavigation(null); setFinding(true); }
  }}>
    {lineNavigation?.instance === buffer.instance && <GoToLinePanel navigator={lineNavigation.session} onClose={() => { if (lineSession.current === lineNavigation.session) lineSession.current = null; setLineNavigation(null); }} />}
    {finding && <div className="fw-find"><input ref={findInput} aria-label="在文件中查找" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); setFinding(false); view.current?.focus(); }
      if (event.key === 'Enter') { event.preventDefault(); locate(match + (event.shiftKey ? -1 : 1)); }
    }} /><span role="status" aria-label="文件内匹配计数" title={query && !matches.length ? '未找到匹配' : search?.limited ? '仅显示前 999 个匹配，仍有更多结果' : `${matches.length} 个匹配`}>{matches.length ? `${match + 1}/${matches.length}${search?.limited ? '+' : ''}` : '0/0'}</span><button aria-label="上一个匹配" disabled={!matches.length} onClick={() => locate(match - 1)}><ChevronUp size={15} /></button><button aria-label="下一个匹配" disabled={!matches.length} onClick={() => locate(match + 1)}><ChevronDown size={15} /></button><button aria-label="关闭查找" onClick={() => { setFinding(false); view.current?.focus(); }}><X size={15} /></button></div>}
    <div className="fw-editor-tools" role="toolbar" aria-label="文本编辑">
      <button type="button" className="fw-icon" title="撤销" aria-label="撤销" disabled={!buffer.editable || !buffer.editor || undoDepth(buffer.editor) === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => history('undo')}><Undo2 size={17} strokeWidth={1.65} /></button>
      <button type="button" className="fw-icon" title="重做" aria-label="重做" disabled={!buffer.editable || !buffer.editor || redoDepth(buffer.editor) === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => history('redo')}><Redo2 size={17} strokeWidth={1.65} /></button>
      <GoToLineButton disabled={!buffer.editor || !buffer.inputSettled} onOpen={openLineNavigation} />
      {!markdown && <LanguageEditorTools />}
    </div>
    {diffPolicy.state === 'enabled' && <div className="fw-save-strip" role="status">差异对比：磁盘版本 → 我的修改</div>}
    {diffPolicy.reason && <div className="fw-save-strip" role="status">{diffPolicy.reason}</div>}
    {diskText && diskText.kind !== 'text' && <div className="fw-save-strip" role="status">磁盘版本无法按无损文本比较；本地修改仍保留。</div>}
    {richDocument && previewStatus && <div role="status" className="fw-save-strip">{previewStatus}</div>}
    {!richDocument && codeStatus && <div role="status" className="fw-save-strip">{codeStatus}</div>}
    {blame && !markdown && blameStatus && <div role="status" className="fw-save-strip">{blameStatus}</div>}
    <div ref={host} className="fw-codemirror" />
    {blame && !markdown && <BlameCard selection={blameSelection} onClose={() => setBlameSelection(null)} />}
  </div></FileSelectionActions>;
}
