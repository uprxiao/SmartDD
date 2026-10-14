import { app, BrowserWindow, dialog, shell } from 'electron';
import type { AppSettingsKey } from '@shared/app-settings';
import { createRPCController, createRPCRouter } from '@shared/ipc/rpc';
import type { LaunchRequest } from '@shared/types';
import { createProjectControllers } from './core/projects/controller';
import type { ProjectService } from './core/projects/project-service';
import { createAppSettingsController } from './core/settings/controller';
import type { SettingsStore } from './core/settings/settings-service';
import type { DbClient } from './db/client';
import { listSessions } from './db/sessions-repo';
import { runProbes } from './probes';
import type { PtyManager } from './pty-manager';
import type { SessionService } from './sessions';

export interface RpcDeps {
  client: DbClient;
  dbFile: string;
  settings: SettingsStore;
  sessions: SessionService;
  projects: ProjectService;
  ptys: PtyManager;
  baseEnv: () => Record<string, string>;
  onSettingChanged: (key: AppSettingsKey) => void;
}

export function createRpcRouter(d: RpcDeps) {
  return createRPCRouter({
    app: createRPCController({
      getInfo: () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        userDataPath: app.getPath('userData'),
        dbFile: d.dbFile,
      }),
      revealDataDir: () => shell.openPath(app.getPath('userData')),
    }),
    appSettings: createAppSettingsController(d.settings, d.onSettingChanged),
    ...createProjectControllers(d.projects),
    dialog: createRPCController({
      /** Native folder picker; null when cancelled. */
      pickDirectory: async (defaultPath?: string) => {
        const win = BrowserWindow.getFocusedWindow();
        const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath };
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      pickFile: async (defaultPath?: string) => {
        const win = BrowserWindow.getFocusedWindow();
        const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'showHiddenFiles'], defaultPath };
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
    }),
    sessions: createRPCController({
      list: () => listSessions(d.client.db),
      launch: (req: LaunchRequest) => d.sessions.launch(req, d.baseEnv()),
    }),
    pty: createRPCController({
      kill: (ptyId: string) => d.ptys.kill(ptyId),
    }),
    probes: createRPCController({
      run: () => runProbes(d.client, d.dbFile, d.baseEnv()),
    }),
  });
}

export type RpcRouter = ReturnType<typeof createRpcRouter>;
