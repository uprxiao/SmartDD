import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import {
  menuOpenSettingsEvent,
  menuToggleLeftSidebarEvent,
  ptyDataEvent,
  ptyExitEvent,
  ptyInputEvent,
  ptyResizeEvent,
  sessionUpdatedEvent,
} from '@shared/events';
import { createEventEmitter } from '@shared/ipc/events';
import { registerRPCRouter, rpcErrorMessage } from '@shared/ipc/rpc';
import { buildAppMenu } from './app/menu';
import { applyNativeTheme, createMainWindow, getMainWindow, markAppQuitting } from './app/window';
import { SettingsStore } from './core/settings/settings-service';
import { openDbClient, type DbClient } from './db/client';
import { runBundledMigrations } from './db/migrations';
import { runProbes } from './probes';
import { PtyManager } from './pty-manager';
import { createRpcRouter } from './rpc';
import { SessionService } from './sessions';

app.setName('SmartDD');

const isProbeMode = process.env.SMARTDD_PROBE === '1';

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('ELECTRON_') && k !== 'SMARTDD_PROBE') env[k] = v;
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
  const dbFile = join(app.getPath('userData'), 'smartdd.db');
  let client: DbClient;
  try {
    client = openDatabase(dbFile);
  } catch (e) {
    const message = rpcErrorMessage(e);
    if (isProbeMode) process.stderr.write(`${message}\n`);
    else dialog.showErrorBox('SmartDD 无法启动', message);
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
  const ptys = new PtyManager();
  const sessions = new SessionService(client.db, ptys, (s) => events.emit(sessionUpdatedEvent, s));

  ptys.on('data', (ptyId: string, data: string) => events.emit(ptyDataEvent, { ptyId, data }));
  ptys.on('exit', (ptyId: string, code: number) => events.emit(ptyExitEvent, { ptyId, code }));
  events.on(ptyInputEvent, ({ ptyId, data }) => ptys.write(ptyId, data));
  events.on(ptyResizeEvent, ({ ptyId, cols, rows }) => ptys.resize(ptyId, cols, rows));

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
      client,
      dbFile,
      settings,
      sessions,
      ptys,
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
        message: `有 ${ptys.count} 个终端会话正在运行`,
        detail: '退出 SmartDD 会结束这些终端进程。之后可在会话列表中恢复（resume）。',
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
    sessions.dispose();
    ptys.killAll();
    client.close();
  });
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
