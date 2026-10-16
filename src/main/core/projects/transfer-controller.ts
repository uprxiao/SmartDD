import { BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { createScopedRPCController } from '@shared/ipc/rpc';
import { passphraseIssue, type TransferDraft, type TransferReply } from '@shared/project-transfer';
import { ProjectTransferService, transferFilename } from './transfer-service';
import { TransferError } from './transfer-format';

export function createTransferController(svc: ProjectTransferService) {
  const watches = new Set<number>();
  const exportedPaths = new Map<number, Set<string>>();
  const owner = (event: IpcMainInvokeEvent) => {
    if (event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) throw new TransferError('INVALID_DRAFT', '导入窗口已失效');
    const id = event.sender.id;
    if (!watches.has(id)) {
      watches.add(id);
      event.sender.once('destroyed', () => { svc.disposeOwner(id); exportedPaths.delete(id); watches.delete(id); });
      event.sender.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => { if (mainFrame) svc.disposeOwner(id); });
    }
    return id;
  };
  const run = async <T>(event: IpcMainInvokeEvent, fn: (id: number) => T | Promise<T>): Promise<TransferReply<T>> => {
    try { return { ok: true, value: await fn(owner(event)) }; }
    catch (e) { return e instanceof TransferError ? { ok: false, code: e.code, message: e.message } : { ok: false, code: 'INVALID_DRAFT', message: '无法完成项目迁移，请检查选择后重试' }; }
  };
  const open = (event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  };
  return createScopedRPCController({
    describeExport: (e, projectId: string, profileIds: string[]) => run(e, () => svc.describeExport(projectId, profileIds)),
    export: (e, input: { projectId: string; profileIds: string[]; emptyPasswordRefs: string[]; passphrase: string; confirmation: string }) => run(e, id => svc.exclusive(id, async () => {
      if (typeof input?.passphrase !== 'string' || typeof input?.confirmation !== 'string') throw new TransferError('INVALID_DRAFT', '请输入并确认导出口令');
      const issue = passphraseIssue(input.passphrase, input.confirmation); if (issue) throw new TransferError('INVALID_DRAFT', issue);
      const description = svc.describeExport(input.projectId, input.profileIds);
      const win = BrowserWindow.fromWebContents(e.sender);
      const options: Electron.SaveDialogOptions = { title: '导出项目', defaultPath: transferFilename(description.project.name), ...(process.platform === 'darwin' ? {} : { filters: [{ name: 'WillYou 项目', extensions: ['willyou'] }] }), properties: ['showOverwriteConfirmation', 'createDirectory'] };
      const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (chosen.canceled || !chosen.filePath) return null;
      if (e.sender.isDestroyed()) throw new TransferError('PREVIEW_EXPIRED', '导出窗口已关闭');
      const result = await svc.exportTo(chosen.filePath, input.projectId, input.profileIds, input.emptyPasswordRefs, input.passphrase);
      const paths = exportedPaths.get(id) ?? new Set<string>(); paths.add(result.path); exportedPaths.set(id, paths);
      return result;
    })),
    chooseImport: e => run(e, id => svc.exclusive(id, async () => {
      // macOS can disable Open for an unregistered custom extension. Accept a
      // regular file there, then authenticate the strict format in the service;
      // the filename/extension is never the trust boundary on any platform.
      const r = await open(e, { title: '导入项目', properties: ['openFile'], ...(process.platform === 'darwin' ? {} : { filters: [{ name: 'WillYou 项目', extensions: ['willyou'] }] }) });
      if (r.canceled || !r.filePaths[0]) return null;
      if (e.sender.isDestroyed()) throw new TransferError('PREVIEW_EXPIRED', '导入窗口已关闭');
      return svc.choose(id, r.filePaths[0]);
    })),
    unlock: (e, token: string, password: string) => run(e, id => svc.exclusive(id, () => svc.unlock(id, token, password))),
    pickDirectory: (e, token: string) => run(e, async id => {
      const r = await open(e, { title: '选择本机代码目录', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      svc.allowDirectory(id, token, r.filePaths[0]); return r.filePaths[0];
    }),
    pickRules: (e, token: string) => run(e, async id => {
      const r = await open(e, { title: '选择规则文件', properties: ['openFile', 'showHiddenFiles'] });
      if (r.canceled || !r.filePaths[0]) return null;
      svc.allowRules(id, token, r.filePaths[0]); return r.filePaths[0];
    }),
    validateDraft: (e, token: string, draft: TransferDraft) => run(e, id => svc.validateDraft(id, token, draft)),
    commit: (e, token: string, requestId: string, draft: TransferDraft) => run(e, id => svc.commit(id, token, requestId, draft)),
    getResult: (e, requestId: string) => run(e, () => svc.getResult(requestId)),
    dispose: (e, token: string) => run(e, id => svc.dispose(id, token)),
    revealExport: (e, path: string) => run(e, id => {
      if (!z.string().max(4096).safeParse(path).success || !exportedPaths.get(id)?.has(path)) throw new TransferError('INVALID_DRAFT', '请选择本次导出的文件');
      shell.showItemInFolder(path);
    }),
  });
}
