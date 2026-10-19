import type { LspOpen, LspChange, LspQuery } from '@shared/file-lsp';
import type { FileRecoveryInspectionInput } from '@shared/file-recovery';
import type { FileRootRetryInput } from '@shared/files';
import type { DirectoryListRequest } from '@shared/files';
import type { ViewerOpenInput, ViewerResourceInput, ViewerWriteInput } from '@shared/file-viewer';
import type { IpcMainInvokeEvent } from 'electron';
import { BrowserWindow, dialog, shell } from 'electron';
import { dirname, extname, join } from 'node:path';
import { FileError, fileScopeSchema, type FileCheckpointInput, type FileDraftResolution, type FileRef, type FileSaveInput, type FileScope, type FileOpenRequest, type RootRequest, type FileSearchRequest, type FileCloseReply, type FileDiagramRequest } from '@shared/files';
import { fileHtmlEvent, fileViewerUiEvent, fileSearchEvent, fileWatchEvent, fileWorkspaceEvent } from '@shared/events';
import { createScopedRPCController } from '@shared/ipc/rpc';
import type { FileService } from './file-service';
import type { FileRasterRequest } from '@shared/files';
import type { FileActionTarget, FileCopyInput, FileCopyReceipt, FileExternalOpen } from '@shared/files';
import type { GitBlameInput, GitStatusInput } from '@shared/file-git';
import type { MediaOpenInput } from '@shared/file-media';
import type { HtmlOpenInput, HtmlViewBounds } from '@shared/file-html';
import type { TexOpenInput } from '@shared/file-tex';
import type { OfficeOpenInput, OfficeWindowInput, OfficeCellInput, OfficeEditInput, OfficeHistoryInput, OfficeCheckpointInput, OfficeSaveInput, OfficeRestoreInput, OfficeRecalculateInput } from '@shared/file-office';
import type { FileWorkspacePersistence } from './workspace-persistence';
import { fileScopeKey, type SavedFileWorkspace } from '@shared/file-workspace';
import type { OfficeSheetInput,OfficeRangeInput,OfficeRangeReadInput } from '@shared/file-office';
import type { PptxEditInput,PptxHistoryInput,PptxCheckpointInput,PptxSaveInput,PptxRestoreInput,PptxVersionInput,PptxRenderInput } from '@shared/file-pptx';
import type { FileTerminalService } from './terminal-context';
import { discoverLanguageServers } from './lsp/discovery';
import type { TerminalBindingInput, TerminalPrepareInput, TerminalInsertionInput } from '@shared/file-terminal';

export function createFileController(service: FileService, trusted: (event: IpcMainInvokeEvent) => boolean, workspace?: FileWorkspacePersistence, terminal?: FileTerminalService) {
  const owners = new Map<number, Set<string>>();
  const workspaceReaders = new Map<string, { event: IpcMainInvokeEvent; scopes: Set<string> }>();
  const copying = new Set<string>();
  const owner = (event: IpcMainInvokeEvent): string => {
    if (!event?.sender || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !trusted(event)) throw new FileError('UNTRUSTED', '文件操作仅允许可信应用主界面调用');
    const key = `${event.sender.id}:${event.senderFrame.processId}:${event.senderFrame.routingId}`;
    let keys = owners.get(event.sender.id);
    if (!keys) {
      keys = new Set(); owners.set(event.sender.id, keys);
      const release = () => { for (const id of keys!) { workspaceReaders.delete(id); terminal?.closeOwner(id); service.closeOwner(id); } keys!.clear(); };
      event.sender.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) release(); });
      event.sender.on('render-process-gone', release);
      event.sender.once('destroyed', () => { release(); owners.delete(event.sender.id); });
    }
    keys.add(key); return key;
  };
  return createScopedRPCController({
    languageConfiguration: (event: IpcMainInvokeEvent) => { owner(event); return service.languages.configuration(); },
    languageDiscover: (event: IpcMainInvokeEvent) => { owner(event); return discoverLanguageServers(); },
    languageContext: async (event: IpcMainInvokeEvent, ref: FileRef) => { const source = await service.lspSource(owner(event), ref); return { projectId: source.projectId, language: source.language }; },
    configureLanguages: (event: IpcMainInvokeEvent, value: unknown) => { owner(event); return service.languages.configure(value); },
    languageOpen: (event: IpcMainInvokeEvent, input: LspOpen) => service.languages.open(owner(event), input),
    languageChange: (event: IpcMainInvokeEvent, input: LspChange) => service.languages.change(owner(event), input),
    languageQuery: (event: IpcMainInvokeEvent, input: LspQuery) => service.languages.query(owner(event), input),
    languageCancel: (event: IpcMainInvokeEvent, id: string, requestId: string) => service.languages.cancel(owner(event), id, requestId),
    languageClose: (event: IpcMainInvokeEvent, id: string) => service.languages.close(owner(event), id),
    terminalBind: (event: IpcMainInvokeEvent, input: TerminalBindingInput) => { const id = owner(event); if (!terminal) throw new FileError('UNSUPPORTED', '终端上下文尚未就绪'); return terminal.bind(event, id, input); },
    terminalRelease: (event: IpcMainInvokeEvent, bindingId: string) => terminal?.release(event, owner(event), bindingId),
    terminalPrepare: (event: IpcMainInvokeEvent, input: TerminalPrepareInput) => { const id = owner(event); if (!terminal) throw new FileError('UNSUPPORTED', '终端上下文尚未就绪'); return terminal.prepare(event, id, input); },
    terminalReferenceStatus: (event: IpcMainInvokeEvent, bindingId: string, ids: string[]) => { const id = owner(event); if (!terminal) throw new FileError('UNSUPPORTED', '终端上下文尚未就绪'); return terminal.status(event, id, bindingId, ids); },
    terminalInsert: (event: IpcMainInvokeEvent, input: TerminalInsertionInput) => { const id = owner(event); if (!terminal) throw new FileError('UNSUPPORTED', '终端上下文尚未就绪'); return terminal.insert(event, id, input); },
    workspace: (event: IpcMainInvokeEvent, scope: FileScope) => { owner(event); if (!workspace) throw new FileError('UNSUPPORTED', '文件标签存储尚未就绪'); return workspace.load(scope); },
    workspaceSnapshot: (event: IpcMainInvokeEvent, input: FileScope) => {
      const id = owner(event), scope = fileScopeSchema.parse(input);
      if (!workspace) throw new FileError('UNSUPPORTED', '文件标签存储尚未就绪');
      const reader = workspaceReaders.get(id) ?? { event, scopes: new Set<string>() };
      reader.scopes.add(fileScopeKey(scope)); workspaceReaders.set(id, reader);
      return workspace.snapshot(scope);
    },
    saveWorkspace: (event: IpcMainInvokeEvent, input: FileScope, state: SavedFileWorkspace, expectedRevision: number, mutationId: string) => {
      owner(event); const scope = fileScopeSchema.parse(input);
      if (!workspace) throw new FileError('UNSUPPORTED', '文件标签存储尚未就绪');
      if (typeof mutationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(mutationId)) throw new FileError('INVALID_INPUT', '标签状态操作编号无效');
      const result = workspace.commit(scope, state, expectedRevision);
      if (result.accepted && result.revision !== expectedRevision) for (const [id, reader] of workspaceReaders) {
        if (reader.scopes.has(fileScopeKey(scope)) && !reader.event.sender.isDestroyed() && reader.event.senderFrame === reader.event.sender.mainFrame && trusted(reader.event)) {
          try { reader.event.sender.send(fileWorkspaceEvent.name, { scope, state: result.state, revision: result.revision, mutationId }); }
          catch { workspaceReaders.delete(id); } // A closing receiver cannot undo a committed writer acknowledgement.
        }
      }
      return result;
    },
    viewerUiOpen: (event: IpcMainInvokeEvent, input: ViewerResourceInput) => {
      const id = owner(event), win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new FileError('UNTRUSTED', '文件窗口已关闭');
      return service.viewers.ui.open(id, input, win, value => { if (!event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame && trusted(event)) event.sender.send(fileViewerUiEvent.name, value); });
    },
    viewerUiBounds: (event: IpcMainInvokeEvent, input: HtmlViewBounds) => service.viewers.ui.bounds(owner(event), input),
    viewerUiSend: (event: IpcMainInvokeEvent, input: ViewerResourceInput, payload: unknown) => service.viewers.ui.send(owner(event), input, payload),
    viewerUiClose: (event: IpcMainInvokeEvent, id: string) => service.viewers.ui.close(owner(event), id),
    viewerConfiguration: (event: IpcMainInvokeEvent) => { owner(event); return service.viewers.configuration(); },
    configureViewers: (event: IpcMainInvokeEvent, value: unknown) => { owner(event); return service.viewers.configure(value); },
    selectViewer: (event: IpcMainInvokeEvent, ref: FileRef, explicit?: string | null) => service.viewers.select(owner(event), ref, explicit),
    openViewer: (event: IpcMainInvokeEvent, input: ViewerOpenInput) => service.viewers.open(owner(event), input),
    readViewer: (event: IpcMainInvokeEvent, input: ViewerResourceInput) => service.viewers.read(owner(event), input),
    writeViewer: (event: IpcMainInvokeEvent, input: ViewerWriteInput) => service.viewers.write(owner(event), input),
    viewerTool: (event: IpcMainInvokeEvent, input: ViewerResourceInput, name: string, args: unknown) => service.viewers.callTool(owner(event), input, name, args),
    viewerStatus: (event: IpcMainInvokeEvent, id: string) => service.viewers.status(owner(event), id),
    closeViewer: (event: IpcMainInvokeEvent, id: string) => service.viewers.close(owner(event), id),
    roots: (event: IpcMainInvokeEvent, scope: FileScope) => service.openScope(owner(event), scope),
    retryRoot: (event: IpcMainInvokeEvent, input: FileRootRetryInput) => service.roots.retry(owner(event), input),
    releaseRoot: (event: IpcMainInvokeEvent, input: RootRequest) => service.roots.release(owner(event), input),
    closeScope: (event: IpcMainInvokeEvent, input: FileScope) => { const id = owner(event), scope = fileScopeSchema.parse(input); workspaceReaders.get(id)?.scopes.delete(fileScopeKey(scope)); service.closeScope(id, scope); },
    list: (event: IpcMainInvokeEvent, request: DirectoryListRequest) => service.list(owner(event), request),
    watch: (event: IpcMainInvokeEvent, request: RootRequest, directories: string[], refs: FileRef[], id?: string) => service.watch(owner(event), request, directories, refs, (update) => { if (!event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame) event.sender.send(fileWatchEvent.name, update); }, id),
    stopWatch: (event: IpcMainInvokeEvent, id: string) => service.watcher.stop(owner(event), id),
    // A query owns one cancellable session ID. Updating a query cancels the old
    // session and starts another; progress and completion share that identity.
    startSearchSession: (event: IpcMainInvokeEvent, request: FileSearchRequest) => service.searcher.search(owner(event), request, (update) => { if (!event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame) event.sender.send(fileSearchEvent.name, update); }),
    search: (event: IpcMainInvokeEvent, request: FileSearchRequest) => service.searcher.search(owner(event), request, (update) => { if (!event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame) event.sender.send(fileSearchEvent.name, update); }),
    cancelSearch: (event: IpcMainInvokeEvent, id: string) => service.searcher.cancel(owner(event), id),
    answerClose: (event: IpcMainInvokeEvent, reply: FileCloseReply) => service.closer.answer(owner(event), reply),
    open: (event: IpcMainInvokeEvent, request: FileOpenRequest) => service.open(owner(event), request),
    openOfficePages: (event:IpcMainInvokeEvent,request:OfficeOpenInput)=>service.officePages.open(owner(event),request),
    officePagesChunk: (event:IpcMainInvokeEvent,id:string,offset:number,length:number)=>service.officePages.chunk(owner(event),id,offset,length),
    releaseOfficePages: (event:IpcMainInvokeEvent,id:string)=>service.officePages.release(owner(event),id),
    openPptx:(event:IpcMainInvokeEvent,input:OfficeOpenInput)=>service.pptx.open(owner(event),input),
    editPptx:(event:IpcMainInvokeEvent,input:PptxEditInput)=>service.pptx.edit(owner(event),input),
    pptxHistory:(event:IpcMainInvokeEvent,input:PptxHistoryInput)=>service.pptx.history(owner(event),input),
    checkpointPptx:(event:IpcMainInvokeEvent,input:PptxCheckpointInput)=>service.pptx.checkpoint(owner(event),input),
    savePptx:(event:IpcMainInvokeEvent,input:PptxSaveInput)=>service.pptx.save(owner(event),input),
    restorePptx:(event:IpcMainInvokeEvent,input:PptxRestoreInput)=>service.pptx.restore(owner(event),input),
    rebasePptx:(event:IpcMainInvokeEvent,input:PptxVersionInput)=>service.pptx.rebase(owner(event),input),
    renderPptx:(event:IpcMainInvokeEvent,input:PptxRenderInput)=>service.pptx.render(owner(event),input),
    pptxChunk:(event:IpcMainInvokeEvent,id:string,requestId:string,offset:number,length:number)=>service.pptx.chunk(owner(event),id,requestId,offset,length),
    cancelPptxRender:(event:IpcMainInvokeEvent,id:string,requestId:string)=>service.pptx.cancelRender(owner(event),id,requestId),
    closePptx:(event:IpcMainInvokeEvent,id:string)=>service.pptx.close(owner(event),id),
    openOffice: (event: IpcMainInvokeEvent, request: OfficeOpenInput) => service.office.open(owner(event), request),
    officeWindow: (event: IpcMainInvokeEvent, request: OfficeWindowInput) => service.office.window(owner(event), request),
    officeCell: (event: IpcMainInvokeEvent, request: OfficeCellInput) => service.office.cell(owner(event), request),
    editOffice: (event:IpcMainInvokeEvent, request:OfficeEditInput)=>service.office.edit(owner(event),request),
    officeSheet: (event:IpcMainInvokeEvent,request:OfficeSheetInput)=>service.office.sheetAction(owner(event),request),
    officeRange: (event:IpcMainInvokeEvent,request:OfficeRangeReadInput)=>service.office.range(owner(event),request),
    editOfficeRange: (event:IpcMainInvokeEvent,request:OfficeRangeInput)=>service.office.rangeAction(owner(event),request),
    officeHistory: (event:IpcMainInvokeEvent, request:OfficeHistoryInput)=>service.office.history(owner(event),request),
    checkpointOffice: (event:IpcMainInvokeEvent, request:OfficeCheckpointInput)=>service.office.checkpoint(owner(event),request),
    saveOffice: (event:IpcMainInvokeEvent, request:OfficeSaveInput)=>service.office.save(owner(event),request),
    restoreOffice: (event:IpcMainInvokeEvent, request:OfficeRestoreInput)=>service.office.restore(owner(event),request),
    recalculateOffice: (event:IpcMainInvokeEvent, request:OfficeRecalculateInput)=>service.office.recalculate(owner(event),request),
    rebaseOffice: (event:IpcMainInvokeEvent, request:OfficeRecalculateInput)=>service.office.rebase(owner(event),request),
    closeOffice: (event: IpcMainInvokeEvent, id: string) => service.office.close(owner(event), id),
    compileTex: (event: IpcMainInvokeEvent, request: TexOpenInput) => service.tex.open(owner(event), request),
    texChunk: (event: IpcMainInvokeEvent, id: string, offset: number, length: number) => service.tex.chunk(owner(event), id, offset, length),
    releaseTex: (event: IpcMainInvokeEvent, id: string) => service.tex.release(owner(event), id),
    openHtml: (event: IpcMainInvokeEvent, request: HtmlOpenInput) => {
      const id = owner(event), win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) throw new FileError('UNTRUSTED', '文件窗口已关闭');
      return service.html.open(id, request, win, (state) => { if (!event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame) event.sender.send(fileHtmlEvent.name, { id: request.id, ...state }); });
    },
    htmlBounds: (event: IpcMainInvokeEvent, request: HtmlViewBounds) => service.html.bounds(owner(event), request),
    closeHtml: (event: IpcMainInvokeEvent, id: string) => service.html.close(owner(event), id),
    openMedia: (event: IpcMainInvokeEvent, request: MediaOpenInput) => service.media.open(owner(event), request),
    mediaChunk: (event: IpcMainInvokeEvent, id: string, offset: number, length: number) => service.media.chunk(owner(event), id, offset, length),
    releaseMedia: (event: IpcMainInvokeEvent, id: string) => service.media.release(owner(event), id),
    gitStatus: (event: IpcMainInvokeEvent, request: GitStatusInput) => service.git.status(owner(event), request),
    gitBlame: (event: IpcMainInvokeEvent, request: GitBlameInput) => service.git.blame(owner(event), request),
    cancelGit: (event: IpcMainInvokeEvent, id: string) => service.git.cancel(owner(event), id),
    applications: (event: IpcMainInvokeEvent, target: FileActionTarget) => service.actions.applications(owner(event), target),
    openExternal: (event: IpcMainInvokeEvent, request: FileExternalOpen) => service.actions.open(owner(event), request),
    reveal: (event: IpcMainInvokeEvent, target: FileActionTarget) => service.actions.reveal(owner(event), target),
    saveCopy: async (event: IpcMainInvokeEvent, request: FileCopyInput): Promise<FileCopyReceipt> => {
      const id = owner(event); if (copying.has(id)) throw new FileError('CONFLICT', '请先完成当前另存对话框');
      copying.add(id);
      try {
        const selection = await service.actions.prepareCopy(id, request);
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) throw new FileError('UNTRUSTED', '另存窗口已关闭');
        const extension = extname(selection.name), stem = selection.name.slice(0, selection.name.length - extension.length);
        const defaultPath = join(selection.context.lease.canonicalPath, dirname(selection.context.relativePath), `${stem} 副本${extension}`);
        const chosen = await dialog.showSaveDialog(win, { title: '另存副本', buttonLabel: '保存副本', defaultPath, showsTagField: false, filters: [{ name: '所有文件', extensions: ['*'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
        if (chosen.canceled || !chosen.filePath) return { state: 'cancelled' };
        if (owner(event) !== id) throw new FileError('UNTRUSTED', '另存窗口已改变');
        return await service.actions.copyTo(id, selection, chosen.filePath);
      } finally { copying.delete(id); }
    },
    related: (event: IpcMainInvokeEvent, ref: FileRef, href: string) => service.related(owner(event), ref, href),
    diagram: (event: IpcMainInvokeEvent, ref: FileRef, request: FileDiagramRequest) => service.diagram(owner(event), ref, request),
    cancelDiagram: (event: IpcMainInvokeEvent, id: string) => service.cancelDiagram(owner(event), id),
    raster: (event: IpcMainInvokeEvent, ref: FileRef, request: FileRasterRequest) => service.raster(owner(event), ref, request),
    cancelRaster: (event: IpcMainInvokeEvent, id: string) => service.cancelRaster(owner(event), id),
    openWebLink: async (event: IpcMainInvokeEvent, href: string) => {
      owner(event);
      if (typeof href !== 'string' || href.length > 8192 || /[\u0000-\u001f\u007f]/.test(href)) throw new FileError('INVALID_INPUT', '链接格式无效');
      const url = new URL(href);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new FileError('INVALID_INPUT', '只允许打开不含凭据的 HTTP 或 HTTPS 链接');
      await shell.openExternal(url.href);
    },
    read: (event: IpcMainInvokeEvent, ref: FileRef) => service.read(owner(event), ref),
    refresh: (event: IpcMainInvokeEvent, ref: FileRef) => service.refresh(owner(event), ref),
    chunk: (event: IpcMainInvokeEvent, ref: FileRef, offset: number, length: number, expectedHash: string, requestId?: string) => service.chunk(owner(event), ref, offset, length, expectedHash, requestId),
    cancelResource: (event: IpcMainInvokeEvent, id: string) => service.cancelResource(owner(event), id),
    closeDocument: (event: IpcMainInvokeEvent, ref: FileRef) => service.closeDocument(owner(event), ref),
    save: async (event: IpcMainInvokeEvent, request: FileSaveInput) => { const id = owner(event); return await service.viewers.saveMatching(id, request) ?? service.save(id, request); },
    checkpoint: (event: IpcMainInvokeEvent, request: FileCheckpointInput) => service.checkpoint(owner(event), request),
    drafts: (event: IpcMainInvokeEvent, ref: FileRef) => service.drafts(owner(event), ref),
    readDraft: (event: IpcMainInvokeEvent, ref: FileRef, draftId: string) => service.readDraft(owner(event), ref, draftId),
    resolveDraft: (event: IpcMainInvokeEvent, request: FileDraftResolution) => service.resolveDraft(owner(event), request),
    recovery: async (event: IpcMainInvokeEvent) => { owner(event); await service.recovery.ready(); return service.recovery.items(); },
    inspectRecovery: (event: IpcMainInvokeEvent, input: FileRecoveryInspectionInput) => service.inspectRecovery(owner(event), input),
  });
}
