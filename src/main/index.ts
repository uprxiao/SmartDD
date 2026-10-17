import { voiceErrorsZh, voiceErrorsEn } from '@shared/voice-errors';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, globalShortcut, Notification } from 'electron';
import {
  aiProfilesChangedEvent,
  menuOpenSettingsEvent,
  menuToggleLeftSidebarEvent,
  ptyDataEvent,
  ptyExitEvent,
  tasksChangedEvent,
  voiceStatusChangedEvent,
  voiceGlobalErrorEvent,
} from '@shared/events';
import { createEventEmitter } from '@shared/ipc/events';
import { registerRPCRouter, rpcErrorMessage } from '@shared/ipc/rpc';
import { buildAppMenu } from './app/menu';
import { appIcon } from './app/icon';
import { applyNativeTheme, createMainWindow, getMainWindow, isMainRenderer, markAppQuitting } from './app/window';
import { AiProfileService } from './core/ai/ai-profile-service';
import { ProfileHealth } from './core/ai/profile-health';
import { CapabilityService } from './core/capabilities/capability-service';
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

// Preserve both the existing data root and Electron's safeStorage identity.
configureAppIdentity(app, process.env.SMARTDD_USER_DATA);

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
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, data);
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

  ptys.on('data', (ptyId: string, data: string) => events.emit(ptyDataEvent, { ptyId, data }));
  ptys.on('exit', (ptyId: string, code: number) => events.emit(ptyExitEvent, { ptyId, code }));
  const ptyAccess = new PtyAccess({
    trusted: isMainRenderer,
    activePty: (id) => tasks.activePty(id),
    alive: (id) => ptys.has(id),
    write: (id, data) => ptys.write(id, data),
    resize: (id, cols, rows) => ptys.resize(id, cols, rows),
    killTask: (id) => tasks.kill(id),
  });
  registerPtyInput(ipcMain, ptyAccess);

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

  let quitConfirmed = false;
  app.on('before-quit', (event) => {
    if (!quitConfirmed && ptys.count > 0) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['退出', '取消'],
        defaultId: 1,
        cancelId: 1,
        message: `有 ${ptys.count} 个任务正在运行`,
        detail: '退出 WillYou 会结束这些终端进程。重新打开后可在侧栏中点任务恢复（resume）。',
      });
      if (choice !== 0) {
        event.preventDefault();
        return;
      }
    }
    quitConfirmed = true;
    markAppQuitting();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => {
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
