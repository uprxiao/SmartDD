import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { FileWorkspaceStore } from '../workspace-store';
import { FileTerminalContextStore } from './store';
import { formatPdfReferenceLocation, formatPptxReferenceLocation } from '@shared/file-terminal';

const Context = createContext<FileTerminalContextStore | null>(null);
export const useFileTerminalContext = () => useContext(Context);
export function FileTerminalContextProvider({ workspace, children }: { workspace: FileWorkspaceStore; children: ReactNode }) {
  const store = useMemo(() => new FileTerminalContextStore(), [workspace]);
  const workspaceRevision = workspace.snapshot();
  useLayoutEffect(() => { store.setRoot(workspace.treeRoot ?? null); }, [store, workspace.treeRoot?.lease, workspace.treeRoot?.generation, workspace.treeRoot?.capabilities?.pdfAnnotations, workspace.treeRoot?.capabilities?.pdfAnnotationBatching]);
  useEffect(() => store.attach(), [store]);
  useEffect(() => { const timer = setTimeout(() => { void store.refresh(); }, 250); return () => clearTimeout(timer); }, [store, workspaceRevision]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function TerminalReferenceTray() {
  const store = useFileTerminalContext();
  return store ? <Tray store={store} /> : null;
}
function Tray({ store }: { store: FileTerminalContextStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot);
  const preview = store.preview;
  if (!store.references.length) return store.notice ? <div className="fw-save-strip" role="status">{store.notice}</div> : null;
  return <section className="fw-refs" aria-label="终端引用">
    <header><strong>终端引用（{store.references.length}）</strong><label><input type="checkbox" checked={store.includeText} onChange={event => store.options(event.target.checked, store.style)} />包含选中文本</label><label>引用样式<select aria-label="终端引用样式" value={store.style} onChange={event => store.options(store.includeText, event.target.value as 'plain' | 'at')}><option value="plain">路径与行号</option><option value="at">@路径</option></select></label></header>
    <ul>{store.references.map(reference => <li key={reference.id} title={`revision ${reference.file.revision.hash}${reference.selection ? ` · 选区 ${reference.selection.selectedTextHash}` : ''}`}><span>{reference.file.relativePath}{reference.selection?.pptx ? ` · ${formatPptxReferenceLocation(reference.selection.pptx)}` : reference.selection?.docx?.page ? ` · 第 ${reference.selection.docx.page} 页` : reference.selection?.pdf ? ` · ${formatPdfReferenceLocation(reference.selection.pdf)}` : reference.selection?.range ? `:L${reference.selection.range.startLine}-${reference.selection.range.endLine}` : ''}</span>{reference.state !== 'fresh' && <em>{reference.state === 'missing' ? '缺失' : '已变化'}</em>}<button type="button" aria-label={`移除引用 ${reference.file.relativePath}`} onClick={() => store.remove(reference.id)}><X size={12} /></button></li>)}</ul>
    <details className="fw-refs-preview"><summary>查看将插入的文本</summary><pre>{preview.text}</pre></details>
    {preview.note && <div role="status">{preview.note}</div>}
    {!store.target && <div role="status">当前没有可用的任务终端；文件浏览仍可使用。</div>}
    <div className="fw-refs-actions"><button type="button" disabled={!store.canInsert || !preview.text} onClick={() => void store.insert()}>插入到终端输入</button><button type="button" onClick={() => store.clear()}>清空</button><span role="status">{store.notice || '仅插入文本，不自动回车'}</span></div>
  </section>;
}
