import { McpViewerMenu, McpViewerSlot, McpViewerSettings } from './mcp/viewer';
import { FileLanguageProvider, LanguageSettingsMenu, LanguageResults } from './lsp/components';
import { FileOfficePagesPreview } from './office/pages-preview';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, Code2, Copy, Download, File, FileSearch, FolderOpen, GitBranch, Loader2, Maximize2, Minimize2, MoreHorizontal, PanelRight, Pin, Plus, RotateCcw, Save, Undo2, WrapText, X } from 'lucide-react';
import type { FileScope } from '@shared/files';
import { decodeFileText } from '@shared/file-text';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { bytesFromBase64, type FileBuffer } from './file-buffer';
import { ATTACHMENT_SESSION_NOTICE, fileScopeKey, fileWorkspaceFor } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';
import { FileBreadcrumb } from './breadcrumb';
import { FileOfficePreview } from './office/preview';
import { FileOpenButton, saveFileCopy } from './file-actions';
import { FileTreeIcon } from './file-icon';
import { FileChanges, useGitStatus } from './git-metadata';
import { FileTextEditor } from './text-editor';
import { readFileResource } from './resource';
import { FileContentSearch, FileNameFilter } from './search-panel';
import { FilePdfPreview } from './pdf/preview';
import { FileNotebookPreview } from './notebook/preview';
import { FileMediaPreview } from './media/preview';
import { FileCsvPreview } from './csv/preview';
import { FileHtmlPreview } from './html/preview';
import { FileTexPreview } from './tex/preview';
import { FileTerminalContextProvider, TerminalReferenceTray, useFileTerminalContext } from './terminal-context/context';
import { FILE_TERMINAL_DRAG_TYPE, endFileDrag } from './terminal-context/store';
import './workspace-baseline.css';
import './workspace.css';

function Tool({ label, children, active, disabled, preserveEditorFocus = false, onClick }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; preserveEditorFocus?: boolean; onClick: () => void }) {
  return <button type="button" className={`fw-icon ${active ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => {
    // A mode switch may have to save first. Keep the editor's focus/selection
    // during that attempt, without refocusing over a later user choice.
    if (event.button === 0 && preserveEditorFocus && document.activeElement?.closest('.cm-editor')) event.preventDefault();
  }} onClick={onClick}>{children}</button>;
}
export function FileWorkspacePanel({ scope, onClose }: { scope: FileScope; onClose: () => void }) {
  const key = fileScopeKey(scope), store = useMemo(() => fileWorkspaceFor(scope), [key]);
  useSyncExternalStore(store.subscribe, store.snapshot);
  return <FileTerminalContextProvider workspace={store}><FileLanguageProvider workspace={store}><WorkspaceContents store={store} onClose={onClose} /></FileLanguageProvider></FileTerminalContextProvider>;
}
function WorkspaceContents({ store, onClose }: { store: ReturnType<typeof fileWorkspaceFor>; onClose: () => void }) {
  useSyncExternalStore(store.subscribe, store.snapshot);
  const terminal = useFileTerminalContext();
  const panel = useRef<HTMLElement>(null), [full, setFull] = useState(false), [wrap, setWrap] = useState(false), [closePrompt, setClosePrompt] = useState<{ id: string; instance?: string } | null>(null);
  const [width, setWidth] = useState(800), [treeVisible, setTreeVisible] = useState(true), [actionError, setActionError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false), [changesOnly, setChangesOnly] = useState(false), [blame, setBlame] = useState(false);
  const treeGit = useGitStatus(store.treeRoot, store.metadataRevisions.get(store.treeRoot?.lease ?? '') ?? 0);
  const activeGit = useGitStatus(store.activeRoot === store.treeRoot ? null : store.activeRoot, store.metadataRevisions.get(store.activeRoot?.lease ?? '') ?? 0);
  const fileGit = store.activeRoot === store.treeRoot ? treeGit : activeGit;
  const gitEntries = useMemo(() => new Map(treeGit.data?.state === 'ready' ? treeGit.data.entries.map((entry) => [entry.relativePath, entry]) : []), [treeGit.data]);
  const [actionNotice, setActionNotice] = useState('');
  useEffect(() => { void store.initialize(); }, [store]);
  useEffect(() => store.attach(), [store]);
  useEffect(() => {
    const node = panel.current; if (!node) return;
    const resize = new ResizeObserver(() => setWidth(node.clientWidth)); resize.observe(node); return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const refresh = () => { void store.refresh(); };
    window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh);
  }, [store]);
  const active = store.active, buffer = active?.buffer, file = buffer?.file;
  const treeWidth = Math.max(Math.min(200, width * 0.6), Math.min(store.treeWidth || 250, width * 0.6));
  const close = async (id: string, trigger?: HTMLButtonElement) => {
    const tab = store.tabs.find((item) => item.id === id), instance = tab?.buffer?.instance;
    const previousFocus = document.activeElement;
    const restoreFocus = trigger === previousFocus || Boolean(panel.current?.contains(previousFocus));
    const result = await store.close(id);
    if (result === 'blocked' && store.tabs.some((item) => item === tab)) setClosePrompt({ id, instance });
    else if (result === 'closed' && restoreFocus) requestAnimationFrame(() => {
      if (previousFocus?.isConnected && previousFocus !== trigger) return;
      if (document.activeElement !== document.body && document.activeElement !== trigger) return;
      (panel.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]') ?? panel.current?.querySelector<HTMLButtonElement>('[aria-label="查找并打开文件"]'))?.focus();
    });
  };
  const action = (run: () => Promise<unknown>) => {
    setActionError(''); setActionNotice('');
    void run().then((result) => {
      if (!result || typeof result !== 'object' || !('state' in result)) return;
      if (result.state === 'saved' && 'path' in result) setActionNotice(`副本已保存到 ${result.path}`);
      else if (result.state === 'opened' && 'name' in result) setActionNotice(`已交给 ${result.name} 打开`);
      else if (result.state === 'dispatched') setActionNotice('已请求在 Finder 中显示');
    }).catch((error) => setActionError(error instanceof Error ? error.message : String(error)));
  };
  const discard = async () => {
    if (!closePrompt) return;
    const tab = store.tabs.find((item) => item.id === closePrompt.id);
    if (tab?.buffer?.instance === closePrompt.instance) await store.close(closePrompt.id, true);
    setClosePrompt(null);
  };
  // A local file downloads as an exact native save-copy. Attachments retain
  // their source owner's callback; missing host capabilities stay absent.
  const download = active?.attachment
    ? active.attachment.onDownload ? () => store.downloadAttachment(active.id) : undefined
    : buffer ? async () => {
      setActionError(''); setActionNotice('');
      const result = await saveFileCopy({ kind: 'document', ref: buffer.file.ref }, buffer);
      if (result.state === 'saved') setActionNotice(`副本已保存到 ${result.path}`);
    } : undefined;
  return <aside ref={panel} className={`file-workspace fw-production ${full ? 'fw-full' : ''}`} aria-label="文件工作区" data-testid="file-workspace">
    <div className="fw-tabs" role="tablist" aria-label="文件标签">
      {store.tabs.map((tab) => <div key={tab.id} className={`fw-tab ${tab.id === store.activeId ? 'selected' : ''} ${tab.pinned ? '' : 'preview'}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-willyou-file-tab', tab.id); const file = tab.buffer?.file; const drag = file && terminal?.startDrag({ lease: file.ref.lease, generation: file.ref.generation, relativePath: file.relativePath }, file.revision); if (drag) event.dataTransfer.setData(FILE_TERMINAL_DRAG_TYPE, drag.token); event.dataTransfer.effectAllowed = 'copyMove'; }} onDragEnd={() => endFileDrag()} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-willyou-file-tab')) event.preventDefault(); }} onDrop={(event) => { const from = event.dataTransfer.getData('application/x-willyou-file-tab'); if (from) { event.preventDefault(); store.reorder(from, tab.id); } }}>
        <button role="tab" aria-selected={tab.id === store.activeId} title={`${tab.route.sourcePath}/${tab.route.relativePath}`} onClick={() => store.activate(tab.id)} onDoubleClick={() => store.pin(tab.id)}><FileTreeIcon path={tab.route.relativePath} /><span>{tab.route.relativePath.split('/').at(-1)}</span>{tab.buffer?.dirty && <i className="fw-dirty" aria-label="未保存" />}</button><button className="fw-tab-close" aria-label={`关闭 ${tab.route.relativePath.split('/').at(-1)}`} onMouseDown={(event) => { if (event.button === 0) event.preventDefault(); }} onClick={(event) => void close(tab.id, event.currentTarget)}><X size={13} /></button>
      </div>)}
      <Tool label="查找并打开文件" onClick={() => { setTreeVisible(true); requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('[aria-label="筛选文件"]')?.focus()); }}><Plus size={16} /></Tool><span className="fw-push" /><Tool label={full ? '退出文件全屏' : '文件全屏'} onClick={() => setFull((value) => !value)}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</Tool><Tool label="隐藏文件区域" onClick={onClose}><PanelRight size={16} /></Tool>
    </div>
    <div className="fw-toolbar"><FileBreadcrumb store={store} run={action} repository={fileGit.data?.state === 'ready' ? fileGit.data.repository : undefined} /><div className="fw-tools">
      <Tool label="在文件中搜索" active={searchOpen} disabled={!store.treeRoot} onClick={() => setSearchOpen(true)}><FileSearch size={16} /></Tool>
      {buffer?.editor && buffer.textPresentation !== 'source' && <Tool preserveEditorFocus label={buffer.mode === 'document' ? '查看源码' : buffer.textPresentation === 'csv' ? '查看表格' : buffer.textPresentation === 'tex' ? '编译并查看 PDF' : '查看文档'} active={buffer.mode === 'source'} onClick={() => action(() => store.setMode(buffer, buffer.mode === 'document' ? 'source' : 'document'))}><Code2 size={16} /></Tool>}
      {buffer?.content.mime === 'image/svg+xml' && <Tool preserveEditorFocus label={buffer.mode === 'document' ? '查看源码' : '查看图像'} active={buffer.mode === 'source'} onClick={() => action(() => store.setMode(buffer, buffer.mode === 'document' ? 'source' : 'document'))}><Code2 size={16} /></Tool>}
      <DropdownMenu><DropdownMenuTrigger className="fw-icon" aria-label="文件菜单"><MoreHorizontal size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="fw-file-menu">
        {buffer?.editor && <DropdownMenuItem onClick={() => setWrap((value) => !value)}><WrapText />{wrap ? '关闭自动换行' : '自动换行'}</DropdownMenuItem>}
        {(buffer?.editor || buffer?.office || buffer?.pptx) && <DropdownMenuItem disabled={!buffer.editable || !buffer.dirty || buffer.saving || buffer.conflict || buffer.inputInterrupted} onClick={() => void buffer.save()}><Save />保存文件</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => void store.refresh()}><RotateCcw />刷新文件和目录</DropdownMenuItem>
        {buffer?.editor && <DropdownMenuItem disabled={fileGit.data?.state !== 'ready'} title={fileGit.error || (fileGit.data?.state === 'unavailable' ? fileGit.data.reason : fileGit.loading ? '正在读取仓库信息' : '')} onClick={() => { setBlame((value) => !value); if (buffer.mode === 'document' && buffer.textPresentation === 'markdown') action(() => store.setMode(buffer, 'source')); }}><GitBranch />{blame ? '隐藏行归属' : '显示 Git 行归属'}</DropdownMenuItem>}
        <DropdownMenuItem disabled={!store.treeRoot} onClick={() => { setChangesOnly((value) => !value); setTreeVisible(true); }}><GitBranch />{changesOnly ? '显示全部文件' : '查看变化文件'}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {file && <DropdownMenuItem onClick={() => action(() => saveFileCopy({ kind: 'document', ref: file.ref }, buffer))}><Download />另存副本…</DropdownMenuItem>}
        {active?.attachment?.onDownload && <DropdownMenuItem onClick={() => action(() => store.downloadAttachment(active.id))}><Download />下载附件</DropdownMenuItem>}
        {file && <DropdownMenuItem onClick={() => action(() => rpc.files.reveal({ kind: 'document', ref: file.ref }))}><FolderOpen />在 Finder 中显示</DropdownMenuItem>}
        {buffer?.editor && <DropdownMenuItem onClick={() => action(() => navigator.clipboard.writeText(buffer.raw))}><Copy />复制文件内容</DropdownMenuItem>}
        <DropdownMenuItem disabled={!file} onClick={() => file && action(() => navigator.clipboard.writeText(file.absolutePath))}><Copy />复制完整路径</DropdownMenuItem>
        <DropdownMenuItem disabled={!file} onClick={() => file && action(() => navigator.clipboard.writeText(file.relativePath))}><Copy />复制相对路径</DropdownMenuItem>
        <DropdownMenuItem disabled={!active || active.pinned} onClick={() => active && store.pin(active.id)}><Pin />固定标签</DropdownMenuItem>
        <LanguageSettingsMenu /><McpViewerMenu buffer={buffer ?? undefined} source={active?.route.source} /><DropdownMenuSeparator /><DropdownMenuItem disabled={!store.canRestoreClosed} onClick={() => void store.restoreClosed()}><Undo2 />重新打开关闭的文件</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTreeVisible((value) => !value)}><PanelRight />{treeVisible ? '隐藏目录树' : '显示目录树'}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <Tool label={treeVisible ? '隐藏目录树' : '显示目录树'} active={treeVisible} onClick={() => setTreeVisible((value) => !value)}><FolderOpen size={16} /></Tool>
      {file && <FileOpenButton key={`${file.ref.id}:${file.revision.inode}:${file.revision.hash}`} target={{ kind: 'document', ref: file.ref }} run={action} />}
    </div></div>
    {(actionError || store.error) && <div role="alert" className="fw-save-strip"><AlertCircle size={15} />{actionError || store.error}</div>}
    {store.persistenceError && <div role="alert" className="fw-save-strip"><AlertCircle size={15} /><span>{store.persistenceError}</span><button onClick={() => action(() => store.retryPersistence())}>{store.persistenceConflict ? '保存当前窗口标签' : '重新保存标签'}</button>{store.persistenceConflict && <button disabled={store.hasProtectedBuffers} onClick={() => action(() => store.reloadPersistence())}>读取最新标签</button>}</div>}
    {actionNotice && <div role="status" className="fw-save-strip"><Check size={15} /><span>{actionNotice}</span><button aria-label="关闭文件操作提示" onClick={() => setActionNotice('')}><X size={14} /></button></div>}
    {[...store.watchStates.values()].filter((state) => state.message).map((state) => <div key={state.lease} role="status" className="fw-save-strip">{state.message}</div>)}
    <div className="fw-body"><div className="fw-content" role="tabpanel">
      <LanguageResults />
      {buffer && <>
        {active?.attachment && <div className="fw-save-strip" role="status">{ATTACHMENT_SESSION_NOTICE}</div>}
        {buffer.draftOptions.length > 0 && <div className="fw-save-strip" role="status"><span>有未解决的本机草稿</span>{buffer.draftOptions.map((draft) => <button key={draft.id} onClick={() => action(() => buffer.restoreDraft(draft.id))}>恢复草稿</button>)}</div>}
        {(buffer.saveError || buffer.draftError || buffer.loadError) && <div className="fw-save-strip" role="alert"><AlertCircle size={15} /><span>{buffer.saveError || buffer.draftError || buffer.loadError}</span></div>}
        {buffer.conflict && <div className="fw-conflict-strip"><span>{buffer.recoveryBlocked ? '保存结果需要核对，恢复材料已保留。' : '磁盘版本和我的修改均已保留。'}</span><button disabled={buffer.recoveryBlocked || buffer.inputInterrupted} onClick={() => void buffer.keepLocal()}>保留我的修改</button><button onClick={() => void buffer.useDisk()}>使用磁盘版本</button><button onClick={() => panel.current?.querySelector<HTMLElement>('.cm-content, textarea[aria-label="公式栏"]')?.focus()}>继续编辑</button></div>}
        {buffer.disk && <DiskPreview base64={buffer.disk.base64} />}
        <McpViewerSlot buffer={buffer} source={active!.route.source}><FileContent key={buffer.instance} buffer={buffer} wrap={wrap} blame={blame} onDownload={download} metadataRevision={store.metadataRevisions.get(buffer.file.ref.lease) ?? 0} onLink={(href) => action(async () => {
          if (/^https?:\/\//i.test(href)) { await rpc.files.openWebLink(href); return; }
          if (href.startsWith('#')) {
            const fragment = decodeURIComponent(href.slice(1)).toLowerCase();
            const heading = [...buffer.raw.matchAll(/^#{1,6}[ \t]+(.+)$/gm)].find((match) => match[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') === fragment);
            if (!heading) throw new Error('未找到文档中的标题');
            buffer.revealSourceRange(heading.index, heading.index); return;
          }
          await store.openRelated(buffer, href);
        })} /></McpViewerSlot>
      </>}
      {!buffer && active && <div className="fw-empty" role={active.error ? 'alert' : 'status'}>{active.loading ? <Loader2 className="animate-spin" size={20} /> : <AlertCircle size={20} />}<p>{active.error || '正在打开文件…'}</p>{active.error && !active.loading && <button className="fw-pill" onClick={() => void store.retryTab(active.id)}><RotateCcw size={15} />重试</button>}</div>}
      {!active && <div className="fw-empty"><FolderOpen size={28} /><p>{store.loading ? '正在读取项目目录…' : store.roots.roots.length ? '从右侧目录选择文件' : '没有可用的本机目录'}</p>{store.roots.unavailable.map((root) => <p key={root.sourceId}>{root.label}：{root.reason}</p>)}{store.error && <button onClick={() => void store.initialize()}>重试</button>}</div>}
    </div>
    {treeVisible && <><div className="fw-tree-resizer" role="separator" tabIndex={0} aria-label="调整目录树宽度" aria-orientation="vertical" aria-valuenow={Math.round(treeWidth)} aria-valuemin={Math.min(200, width * 0.6)} aria-valuemax={Math.floor(width * 0.6)} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const next = (panel.current?.getBoundingClientRect().right ?? 0) - event.clientX;
      if (next < 100) { event.currentTarget.releasePointerCapture(event.pointerId); setTreeVisible(false); } else store.setTreeWidth(next);
    }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); store.setTreeWidth(treeWidth + (event.key === 'ArrowLeft' ? 10 : -10)); } }} />
      <div className="fw-tree" style={{ width: treeWidth }}>{store.roots.roots.length > 1 && <div className="fw-root"><DropdownMenu><DropdownMenuTrigger className="fw-root-trigger" aria-label="文件目录来源" title={store.treeRoot?.path}><span>{store.treeRoot?.path.split('/').filter(Boolean).at(-1)} · {store.treeRoot?.label}</span><ChevronDown size={13} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="fw-file-menu">{store.roots.roots.map((root) => <DropdownMenuItem key={root.lease} title={root.path} onClick={() => store.selectRoot(root)}><FolderOpen size={14} /><span>{root.path.split('/').filter(Boolean).at(-1)} · {root.label}</span>{store.treeRoot === root && <Check size={14} />}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>}{changesOnly ? <FileChanges store={store} state={treeGit} onBack={() => setChangesOnly(false)} run={action} /> : <FileNameFilter store={store}><WorkspaceTree store={store} run={action} git={gitEntries} /></FileNameFilter>}</div></>}
    </div>
    <TerminalReferenceTray />
    <footer className="fw-footer"><span>{file ? `${(file.revision.size / 1024).toFixed(1)} KiB` : '本机文件'}</span><span>{buffer?.decoded?.kind === 'text' ? `UTF-8${buffer.bom ? ' BOM' : ''}` : ''}</span><span className="fw-push" /><span role="status">{buffer?.saving ? '正在保存…' : buffer?.dirty ? '有未保存修改' : buffer?.saveReceipt?.state === 'saved' ? '已保存' : ''}</span>{buffer?.saveReceipt?.state === 'saved' && !buffer.dirty && <Check size={13} />}</footer>
    <McpViewerSettings />
    <Dialog open={closePrompt !== null} onOpenChange={(open) => { if (!open) setClosePrompt(null); }}><DialogContent><DialogHeader><DialogTitle>文件尚未保存</DialogTitle></DialogHeader><DialogDescription className="px-6 pb-6">可以继续查看并处理保存问题，或放弃当前编辑。已有保存冲突的恢复材料会继续保留。</DialogDescription><DialogFooter><Button variant="outline" onClick={() => setClosePrompt(null)}>继续查看</Button><Button onClick={() => void discard()}>放弃修改并关闭</Button></DialogFooter></DialogContent></Dialog>
    {searchOpen && <FileContentSearch store={store} onClose={() => { setSearchOpen(false); requestAnimationFrame(() => { if (document.activeElement === document.body) panel.current?.querySelector<HTMLButtonElement>('[aria-label="在文件中搜索"]')?.focus(); }); }} />}
  </aside>;
}

function FileContent({ buffer, wrap, onLink, onDownload, blame, metadataRevision }: { buffer: FileBuffer; wrap: boolean; onLink: (href: string) => void; onDownload?: () => Promise<void>; blame: boolean; metadataRevision: number }) {
  const content = buffer.content;
  if (content.kind === 'pdf') return <FilePdfPreview buffer={buffer} onDownload={onDownload} />;
  if (content.kind === 'notebook') return <FileNotebookPreview buffer={buffer} onDownload={onDownload} />;
  if (content.kind === 'audio' || content.kind === 'video') return <FileMediaPreview buffer={buffer} />;
  if (content.kind === 'office' && ['docx','pptx'].includes(content.format ?? '')) return <FileOfficePagesPreview buffer={buffer} />;
  if (content.kind === 'office' && ['xlsx', 'xlsm'].includes(content.format ?? '')) return <FileOfficePreview buffer={buffer} />;
  if (content.kind === 'image' && !(content.mime === 'image/svg+xml' && buffer.mode === 'source')) return <FileImage buffer={buffer} />;
  if (['archive', 'unsupported', 'binary', 'office'].includes(content.kind)) return <div className="fw-empty fw-unsupported" role="status"><File size={26} /><strong>{buffer.file.name}</strong><p>{content.reason ?? (content.kind === 'archive' ? '归档文件暂不提供内置预览；可使用外部应用打开或另存副本。' : content.kind === 'office' ? `当前无法预览此 ${content.format?.toUpperCase() ?? 'Office'} 文件；可使用外部应用打开或另存副本。` : '二进制文件不支持文本编辑；可使用外部应用打开或另存副本。')}</p><span>{buffer.file.revision.size.toLocaleString()} 字节</span><span className="fw-unsupported-path" title={buffer.file.absolutePath}>{buffer.file.absolutePath}</span></div>;
  if (buffer.loadState === 'loading') return <div className="fw-empty" role="status"><Loader2 size={20} className="animate-spin" />正在读取文件…</div>;
  if (buffer.editor && buffer.mode === 'document' && buffer.textPresentation === 'csv') return <FileCsvPreview buffer={buffer} />;
  if (buffer.editor && buffer.mode === 'document' && buffer.textPresentation === 'html') return <FileHtmlPreview buffer={buffer} />;
  if (buffer.editor && buffer.mode === 'document' && buffer.textPresentation === 'tex') return <FileTexPreview buffer={buffer} />;
  if (buffer.editor) return <>{!buffer.editable && <div className="fw-save-strip">{buffer.decoded?.kind === 'text' ? buffer.decoded.reason ?? '此文件为只读' : '只读文件'}</div>}<FileTextEditor buffer={buffer} wrap={wrap} blame={blame} metadataRevision={metadataRevision} markdown={buffer.mode === 'document' && buffer.textPresentation === 'markdown'} onLink={onLink} /></>;
  return <div className="fw-empty" role="status"><File size={26} /><p>{buffer.decoded?.kind !== 'text' ? buffer.decoded?.reason ?? buffer.loadError : buffer.loadError}</p><button onClick={() => void buffer.load()}>重新读取</button></div>;
}
function DiskPreview({ base64 }: { base64: string }) {
  const decoded = useMemo(() => decodeFileText(bytesFromBase64(base64)), [base64]);
  return <details className="fw-disk-preview"><summary>查看磁盘版本</summary>{decoded.kind === 'text' ? <><pre>{decoded.raw.slice(0, 262144)}</pre>{decoded.raw.length > 262144 && <p>此处显示前 262144 个字符；完整磁盘版本仍保留。</p>}</> : <p>{decoded.reason}</p>}</details>;
}
function FileImage({ buffer }: { buffer: FileBuffer }) {
  const terminal = useFileTerminalContext();
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let objectUrl = '';
    setUrl(''); setError('');
    const mime = buffer.content.mime;
    void readFileResource(buffer.file, rpc.files, abort.signal).then((bytes) => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime })); setUrl(objectUrl);
    }).catch((failure) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [buffer, buffer.file.revision.hash, attempt]);
  return <div className="fw-image fw-ordinary-image">{error ? <div role="alert">{error}<button onClick={() => setAttempt((value) => value + 1)}>重新加载</button></div> : url ? <img src={url} alt={buffer.file.name} draggable onDragStart={event => { const file = buffer.file; const drag = terminal?.startDrag({ lease: file.ref.lease, generation: file.ref.generation, relativePath: file.relativePath }, file.revision); if (!drag) { event.preventDefault(); return; } event.dataTransfer.clearData(); event.dataTransfer.setData(FILE_TERMINAL_DRAG_TYPE, drag.token); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => endFileDrag()} onError={() => setError('无法解码此图像文件')} /> : <Loader2 size={20} className="animate-spin" />}</div>;
}
