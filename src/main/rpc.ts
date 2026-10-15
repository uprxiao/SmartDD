import { app, BrowserWindow, dialog, shell } from 'electron';
import type { AppSettingsKey } from '@shared/app-settings';
import { createRPCController, createRPCRouter } from '@shared/ipc/rpc';
import { createAiProfileController } from './core/ai/controller';
import type { AiProfileService } from './core/ai/ai-profile-service';
import type { ProfileHealth } from './core/ai/profile-health';
import { createProjectControllers } from './core/projects/controller';
import type { ProjectService } from './core/projects/project-service';
import { createAppSettingsController } from './core/settings/controller';
import type { SettingsStore } from './core/settings/settings-service';
import { createTaskController } from './core/tasks/controller';
import type { TaskService } from './core/tasks/task-service';
import type { DbClient } from './db/client';
import { runProbes } from './probes';
import type { PtyManager } from './pty-manager';

export interface RpcDeps {
  client: DbClient;
  dbFile: string;
  settings: SettingsStore;
  projects: ProjectService;
  aiProfiles: AiProfileService;
  health: ProfileHealth;
  tasks: TaskService;
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
      /** Links clicked in a terminal; anything but http(s) is refused. */
      openExternal: async (url: string) => {
        if (!/^https?:\/\//i.test(url)) throw new Error(`Refusing to open ${url.slice(0, 40)}`);
        await shell.openExternal(url);
      },
    }),
    appSettings: createAppSettingsController(d.settings, d.onSettingChanged),
    ...createProjectControllers(d.projects, { runningTasks: (id) => d.tasks.runningInProject(id) }),
    ...createAiProfileController(d.aiProfiles, d.health, d.baseEnv),
    ...createTaskController(d.tasks),
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
    pty: createRPCController({
      kill: (ptyId: string) => d.ptys.kill(ptyId),
    }),
    probes: createRPCController({
      run: () => runProbes(d.client, d.dbFile, d.baseEnv()),
    }),
  });
}

export type RpcRouter = ReturnType<typeof createRpcRouter>;
