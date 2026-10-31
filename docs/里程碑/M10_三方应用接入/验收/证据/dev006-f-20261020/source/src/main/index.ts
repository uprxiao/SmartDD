import { voiceErrorsZh, voiceErrorsEn } from '@shared/voice-errors';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, globalShortcut, Notification } from 'electron';
import {
  aiProfilesChangedEvent,
  applicationsChangedEvent,
  menuOpenSettingsEvent,
  menuToggleLeftSidebarEvent,
  ptyDataEvent,
  ptyExitEvent,
  tasksChangedEvent,
  voiceStatusChangedEvent,
  voiceGlobalErrorEvent,
  fileCloseEvent,
} from '@shared/events';
import { createEventEmitter } from '@shared/ipc/events';
import { registerRPCRouter, rpcErrorMessage } from '@shared/ipc/rpc';
import { buildAppMenu } from './app/menu';
import { appIcon } from './app/icon';
import { applyNativeTheme, createMainWindow, getMainWindow, isMainRenderer, markAppQuitting } from './app/window';
import { AiProfileService } from './core/ai/ai-profile-service';
import { ProfileHealth } from './core/ai/profile-health';
import { CapabilityService } from './core/capabilities/capability-service';
import { ResourceStore } from './core/applications/resource-store';
import { AgentSupportService } from './core/applications/agent-support-service';
import { ApplicationService } from './core/applications/application-service';
import { ManagedTaskCapabilities } from './core/applications/task-capability-launcher';
import { ProjectService } from './core/projects/project-service';
import { SettingsStore } from './core/settings/settings-service';
import { TaskService } from './core/tasks/task-service';
import { openDbClient, type DbClient } from './db/client';
import { runBundledMigrations } from './db/migrations';
import { runProbes } from './probes';
import { PtyManager } from './pty-manager';
import { PtyAccess, registerPtyInput } from './pty-access';
import { createRpcRouter } from './rpc';
import { safeStorageCipher } from './safe-storage-cipher';
import { SecretsStore } from './secrets';
import { VoiceService } from './core/voice/voice-service';
import { TypelessAdapter } from './core/voice/typeless-adapter';
import { configureAppIdentity } from './app/identity';
import { ProjectTransferService } from './core/projects/transfer-service';
import { NativeFileBroker } from './core/files/native-broker';
import { FileSourceResolver } from './core/files/sources';
import { FileRootsService } from './core/files/roots';
import { FileRecoveryStore } from './core/files/recovery-store';
import { FileService } from './core/files/file-service';
import type { FileCloseRequest } from '@shared/files';
import { FileDiagramRenderer } from './core/files/diagram-renderer';
import { installMediaProtocol, installViewerAssets, registerViewerAssetScheme } from './core/files/viewer-assets';

// Preserve both the existing data root and Electron's safeStorage identity.
configureAppIdentity(app, process.env.SMARTDD_USER_DATA);
registerViewerAssetScheme();

const isProbeMode = process.env.SMARTDD_PROBE === '1';

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('ELECTRON_') && k !== 'SMARTDD_PROBE' && k !== 'SMARTDD_USER_DATA') env[k] = v;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

const events = createEventEmitter({
  emit: (channel, data) => {
    getMainWindow()?.webContents.send(channel, data);
  },
  on: (channel, cb) => {
    const listener = (_e: Electron.IpcMainEvent, data: unknown) => cb(data);
    ipcMain.on(channel, listener);
    return () => ipcMain.off(channel, listener);
  },
});

/** A database we cannot migrate is fatal: running on a half-known schema risks the data. */
function openDatabase(dbFile: string): DbClient {
  const client = openDbClient(dbFile);
  try {
    const applied = runBundledMigrations(client.sqlite);
    if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
    return client;
  } catch (e) {
    client.close();
    throw new Error(`数据库迁移失败（${dbFile}）：${rpcErrorMessage(e)}`);
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  installViewerAssets(join(app.getAppPath(), 'out/renderer/pdf-assets'));
  // Publish our own Chromium AX tree before first focus. This does not grant
  // macOS Accessibility permission; it lets the voice bridge see empty inputs
  // without waiting for an external screen reader to activate the tree.
  if (process.platform === 'darwin') app.setAccessibilitySupportEnabled(true);
  // Packaged macOS apps use the bundle's ICNS; dev runs otherwise show Electron's icon.
  if (!app.isPackaged) app.dock?.setIcon(appIcon);
  const dbFile = join(app.getPath('userData'), 'smartdd.db');
  let client: DbClient;
  try {
    client = openDatabase(dbFile);
  } catch (e) {
    const message = rpcErrorMessage(e);
    if (isProbeMode) process.stderr.write(`${message}\n`);
    else dialog.showErrorBox('WillYou 无法启动', message);
    app.exit(1);
    return;
  }

  if (isProbeMode) {
    const results = await runProbes(client, dbFile, baseEnv());
    process.stdout.write(`${JSON.stringify({ app: app.getVersion(), electron: process.versions.electron, results }, null, 2)}\n`);
    client.close();
    app.exit(results.every((r) => r.ok) ? 0 : 1);
    return;
  }

  const settings = new SettingsStore(client.db);
  const secrets = new SecretsStore(client.db, safeStorageCipher);
  const projects = new ProjectService(client.db, secrets, Date.now, () => projectTransfer.keys.cleanup());
  const aiProfiles = new AiProfileService(client.db, secrets);
  const projectTransfer = new ProjectTransferService({ db: client.db, secrets, projects, profiles: aiProfiles, userData: app.getPath('userData'), appVersion: app.getVersion(), env: baseEnv });
  try { projectTransfer.recover(); }
  catch { console.warn('[project-transfer] recovery pending: check managed-key storage before importing'); }
  const capabilities = new CapabilityService({ db: client.db, projects, secrets, userData: app.getPath('userData') });
  let agentSupport: AgentSupportService | undefined;
  try {
    agentSupport = new AgentSupportService(new ResourceStore(client.sqlite,app.getPath('userData')),capabilities,app.isPackaged ? join(process.resourcesPath,'capability-bundles') : join(app.getAppPath(),'out/capability-bundles'));
    await agentSupport.initialize();
  } catch { console.warn('[applications] Local capability resources unavailable; ordinary task launch remains available'); }
  const health = new ProfileHealth({
    profiles: aiProfiles,
    baseEnv,
    onChanged: (change) => events.emit(aiProfilesChangedEvent, change),
  });
  const ptys = new PtyManager();
  const tasks = new TaskService({
    db: client.db,
    ptys,
    profiles: aiProfiles,
    projects,
    baseEnv,
    health,
    capabilities,
    onChanged: () => events.emit(tasksChangedEvent, undefined),
  });

  const fileBroker = new NativeFileBroker(app.isPackaged ? join(process.resourcesPath, 'native/willyou-files') : join(app.getAppPath(), 'out/native/willyou-files'));
  const fileSources = new FileSourceResolver(client.db);
  const diagrams = new FileDiagramRenderer(join(app.getAppPath(), 'out/renderer'), process.env.ELECTRON_RENDERER_URL);
  const engineConfiguration = (engine: 'tex' | 'office' | 'libreoffice') => process.platform === 'darwin' ? { directory: app.isPackaged ? join(process.resourcesPath, 'native', engine) : join(app.getAppPath(), 'out/native', engine), userData: app.getPath('userData'), packagePath: app.isPackaged ? join(process.resourcesPath, '../..') : undefined } : undefined;
  const files = new FileService(new FileRootsService(fileSources, fileBroker), fileBroker, new FileRecoveryStore(fileBroker, app.getPath('userData'), fileSources), diagrams, { get: () => settings.get('fileOpener'), set: (value) => settings.update('fileOpener', value) }, engineConfiguration('tex'), engineConfiguration('office'), undefined, engineConfiguration('libreoffice'), undefined, undefined, { get: () => settings.get('fileViewers'), set: value => settings.update('fileViewers', value) }, { get: () => settings.get('fileLanguages'), set: value => settings.update('fileLanguages', value) });
  void files.tex.recover().catch((error) => console.warn('[files/tex] Temporary compilation cleanup pending:', error));
  void files.office.recover().catch((error) => console.warn('[files/office] Temporary calculation cleanup pending:', error));
  // Isolated acceptance may exercise the bounded binary branch with the same
  // packaged code. This changes transport only, never its file authorization.
  if (process.env.SMARTDD_USER_DATA && process.env.SMARTDD_M9_MEDIA_BINARY === '1') console.info('[files] Isolated media acceptance: binary transport');
  installMediaProtocol(files.media, files.resources, Boolean(process.env.SMARTDD_USER_DATA && process.env.SMARTDD_M9_MEDIA_BINARY === '1'));

  ptys.on('data', (ptyId: string, data: string) => events.emit(ptyDataEvent, { ptyId, data }));
  ptys.on('exit', (ptyId: string, code: number) => events.emit(ptyExitEvent, { ptyId, code }));
  const ptyAccess = new PtyAccess({
    trusted: isMainRenderer,
    activePty: (id) => tasks.activePty(id),
    alive: (id) => ptys.has(id),
    write: (id, data) => ptys.write(id, data),
    resize: (id, cols, rows) => ptys.resize(id, cols, rows),
    killTask: (id) => tasks.kill(id),
    observedInput:(event,target,data)=>applications?.observeInput(event,target,data),
  });
  registerPtyInput(ipcMain, ptyAccess);

  let applications:ApplicationService|undefined;
  let managedTasks:ManagedTaskCapabilities|undefined;
  try {
    if(agentSupport){
      applications=new ApplicationService(agentSupport.store,{secrets,projects,tasks,workspaceFiles:files,activePty:id=>tasks.activePty(id),requireSender:event=>ptyAccess.requireSender(event),mailWorker:join(app.getAppPath(),'out/main/m10-mail-reader.js'),foxmailNative:app.isPackaged?join(process.resourcesPath,'native/willyou-foxmail'):join(app.getAppPath(),'out/native/willyou-foxmail'),changed:()=>events.emit(applicationsChangedEvent,undefined)});
      await applications.recover();
      if(process.platform==='darwin'&&process.arch==='arm64'&&['ready','partial'].includes(agentSupport.status().state)){
        managedTasks=await ManagedTaskCapabilities.open(agentSupport,capabilities,applications,{helper:app.isPackaged?join(process.resourcesPath,'native/willyou-process-identity'):join(app.getAppPath(),'out/native/willyou-process-identity'),stopPty:id=>ptys.kill(id)});
        tasks.attachManagedCapabilities(managedTasks);
      }
    }
  } catch {console.warn('[applications] Local business recovery pending; check application diagnostics');}

  const voice = new VoiceService({
    adapter: new TypelessAdapter(app.isPackaged ? join(process.resourcesPath, 'native/smartdd-voice') : join(app.getAppPath(), 'out/native/smartdd-voice')),
    settings: { get: () => settings.get('voice'), save: (value) => settings.update('voice', value) },
    shortcuts: globalShortcut,
    focused: () => Boolean(getMainWindow()?.isFocused()),
    ptyAlive: (id) => ptys.has(id),
    changed: () => events.emit(voiceStatusChangedEvent, undefined),
    globalError: (error) => {
      events.emit(voiceGlobalErrorEvent, error);
      if (getMainWindow()?.isFocused()) return;
      const chinese = settings.get('general').language === 'zh-CN';
      const notification = new Notification({ title: chinese ? 'WillYou 语音输入' : 'WillYou Voice Input', body: chinese ? voiceErrorsZh[error] : voiceErrorsEn[error] });
      notification.show();
    },
  });
  await voice.start();

  const showWindow = async () => {
    const win = getMainWindow() ?? (await createMainWindow());
    win.show();
    return win;
  };
  const rebuildMenu = () =>
    buildAppMenu(settings.get('general').language, {
      openSettings: () => void showWindow().then(() => events.emit(menuOpenSettingsEvent, undefined)),
      toggleLeftSidebar: () => events.emit(menuToggleLeftSidebarEvent, undefined),
    });

  registerRPCRouter(
    createRpcRouter({
      files,
      trustedRenderer: isMainRenderer,
      projectTransfer,
      voice,
      client,
      dbFile,
      settings,
      projects,
      aiProfiles,
      health,
      tasks,
      capabilities,
      agentSupport,
      applications,
      ptys,
      ptyAccess,
      baseEnv,
      onSettingChanged: (key) => {
        if (key === 'theme') applyNativeTheme(settings.get('theme'));
        if (key === 'general') rebuildMenu();
      },
    }),
    ipcMain
  );

  applyNativeTheme(settings.get('theme'));
  rebuildMenu();
  await createMainWindow();

  app.on('activate', () => void showWindow());

  let quitConfirmed = false, quitPending = false;
  app.on('before-quit', (event) => {
    if (quitConfirmed) return;
    event.preventDefault();
    if (quitPending) return;
    if (ptys.count > 0) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['退出', '取消'],
        defaultId: 1,
        cancelId: 1,
        message: `有 ${ptys.count} 个任务正在运行`,
        detail: '退出 WillYou 会结束这些终端进程。重新打开后可在侧栏中点任务恢复（resume）。',
      });
      if (choice !== 0) {
        return;
      }
    }
    quitPending = true;
    void (async () => {
      const win = getMainWindow();
      if (win) {
        const contents = win.webContents, frame = contents.mainFrame;
        const owner = `${contents.id}:${frame.processId}:${frame.routingId}`;
        const send = (request: FileCloseRequest) => {
          if (contents.isDestroyed() || contents.mainFrame !== frame) throw new Error('原文件界面已经关闭');
          contents.send(fileCloseEvent.name, request);
        };
        const resume = () => { try { send({ id: '', action: 'resume' }); } catch { /* Original renderer is gone. */ } };
        let reply = await files.closer.request(owner, 'save', send);
        if (!reply.ready) {
          const choice = await dialog.showMessageBox(win, {
            type: 'warning', buttons: ['继续查看', '放弃修改并退出'], defaultId: 0, cancelId: 0,
            message: '部分文件尚未保存',
            detail: `${reply.failures.slice(0, 8).map((failure) => `${failure.name}\n${failure.message}`).join('\n\n')}\n\n放弃只结束当前编辑；存在版本冲突的恢复材料会保留。`,
          });
          if (choice.response !== 1) { resume(); return; }
          reply = await files.closer.request(owner, 'discard', send);
          if (!reply.ready) {
            await dialog.showMessageBox(win, { type: 'warning', buttons: ['继续查看'], message: '未能确认放弃修改', detail: reply.failures.slice(0, 8).map((failure) => failure.message).join('\n') });
            resume(); return;
          }
        }
        // Await the renderer's unload permission, too. Sending without an ack
        // can race Chromium's beforeunload and strand a confirmed quit.
        const commit = await files.closer.request(owner, 'commit', send);
        if (!commit.ready) { resume(); return; }
      }
      tasks.dispose();
      ptys.killAll();
      await applications?.dispose();
      await managedTasks?.dispose();
      quitConfirmed = true; markAppQuitting(); app.quit();
    })().catch((error) => {
      const win = getMainWindow();
      if (win) win.webContents.send(fileCloseEvent.name, { id: '', action: 'resume' });
      dialog.showErrorBox('文件保存确认未完成', rpcErrorMessage(error));
    }).finally(() => { quitPending = false; });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => {
    files.tex.dispose();
    files.office.dispose();
    files.pptx.dispose();
    files.officePages.dispose();
    diagrams.dispose();
    files.searcher.dispose();
    void files.watcher.dispose();
    fileBroker.dispose();
    projectTransfer.disposeAll();
    voice.dispose();
    tasks.dispose();
    ptys.killAll();
    capabilities.dispose();
    client.close();
  });
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
