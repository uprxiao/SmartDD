import { createVoiceController } from './core/voice/controller';
import type { VoiceService } from './core/voice/voice-service';
import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppSettingsKey } from '@shared/app-settings';
import { createRPCController, createRPCRouter } from '@shared/ipc/rpc';
import { createAiProfileController } from './core/ai/controller';
import type { AiProfileService } from './core/ai/ai-profile-service';
import type { ProfileHealth } from './core/ai/profile-health';
import { createCapabilityController } from './core/capabilities/controller';
import type { CapabilityService } from './core/capabilities/capability-service';
import { createProjectControllers } from './core/projects/controller';
import type { ProjectService } from './core/projects/project-service';
import { createAppSettingsController } from './core/settings/controller';
import type { SettingsStore } from './core/settings/settings-service';
import { createTaskController } from './core/tasks/controller';
import type { TaskService } from './core/tasks/task-service';
import type { DbClient } from './db/client';
import { runProbes } from './probes';
import type { PtyManager } from './pty-manager';
import { createPtyController, type PtyAccess } from './pty-access';
import { createTransferController } from './core/projects/transfer-controller';
import type { ProjectTransferService } from './core/projects/transfer-service';
import { createFileController } from './core/files/controller';
import type { FileService } from './core/files/file-service';
import { FileWorkspacePersistence } from './core/files/workspace-persistence';
import { FileTerminalService } from './core/files/terminal-context';

export interface RpcDeps {
  files: FileService;
  trustedRenderer: (event: IpcMainInvokeEvent) => boolean;
  projectTransfer: ProjectTransferService;
  voice: VoiceService;
  client: DbClient;
  dbFile: string;
  settings: SettingsStore;
  projects: ProjectService;
  aiProfiles: AiProfileService;
  health: ProfileHealth;
  tasks: TaskService;
  capabilities: CapabilityService;
  ptys: PtyManager;
  ptyAccess: PtyAccess;
  baseEnv: () => Record<string, string>;
  onSettingChanged: (key: AppSettingsKey) => void;
}

export function createRpcRouter(d: RpcDeps) {
  return createRPCRouter({
    files: createFileController(d.files, d.trustedRenderer, new FileWorkspacePersistence(d.client.db), new FileTerminalService({
      access: d.ptyAccess, roots: d.files.roots, taskProject: (taskId) => d.tasks.get(taskId).projectId,
      source: (owner, target, identity) => d.files.terminalSource(owner, target, identity),
      bracketedPaste: (ptyId) => d.ptys.bracketedPaste(ptyId), write: (ptyId, data) => d.ptys.writeControlled(ptyId, data),
    })),
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
    voice: createVoiceController(d.voice),
    projectTransfer: createTransferController(d.projectTransfer),
    appSettings: createAppSettingsController(d.settings, d.onSettingChanged, d.voice),
    ...createProjectControllers(d.projects, { runningTasks: (id) => d.tasks.runningInProject(id) }),
    ...createAiProfileController(d.aiProfiles, d.health, d.baseEnv),
    ...createTaskController(d.tasks, (event) => d.ptyAccess.requireSender(event)),
    ...createCapabilityController(d.capabilities, d.aiProfiles, d.baseEnv),
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
    pty: createPtyController(d.ptyAccess),
    probes: createRPCController({
      run: () => runProbes(d.client, d.dbFile, d.baseEnv()),
    }),
  });
}

export type RpcRouter = ReturnType<typeof createRpcRouter>;
