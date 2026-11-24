import { createAgentTransferController } from './core/ai/agent-transfer-controller';
import { createProviderSetupController } from './core/ai/provider-setup-controller';
import type { AgentTransferService } from './core/ai/agent-transfer';
import { createVoiceController } from './core/voice/controller';
import type { VoiceService } from './core/voice/voice-service';
import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppSettingsKey } from '@shared/app-settings';
import { createRPCController, createRPCRouter, createScopedRPCController } from '@shared/ipc/rpc';
import { createAiProfileController } from './core/ai/controller';
import type { AiProfileService } from './core/ai/ai-profile-service';
import { createAgentController } from './core/ai/agent-controller';
import type { AgentService } from './core/ai/agent-service';
import type { AgentToolService } from './core/ai/agent-tools';
import type { ProviderService } from './core/ai/provider-service';
import type { ProfileHealth } from './core/ai/profile-health';
import { codexConfigNotices } from './core/ai/codex-config-notices';
import { createCapabilityController } from './core/capabilities/controller';
import type { CapabilityService } from './core/capabilities/capability-service';
import type { CapabilityRegistryService } from './core/capabilities/capability-registry';
import { createProjectControllers } from './core/projects/controller';
import type { ProjectService } from './core/projects/project-service';
import { createAppSettingsController } from './core/settings/controller';
import type { SettingsStore } from './core/settings/settings-service';
import type { AgentSupportService } from './core/applications/agent-support-service';
import { createApplicationController } from './core/applications/controller';
import type { ApplicationService } from './core/applications/application-service';
import type { AgentSupportState } from '@shared/capability-bundles';
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
import {createBrowserController} from './core/browser/controller';
import type {BrowserService} from './core/browser/service';
import { createAgentTaskController } from './core/agent/controller';
import type { AgentWorkspace } from './core/agent/wiring';

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
  agents: AgentService;
  agentTransfer: AgentTransferService;
  agentTools: AgentToolService;
  providers: ProviderService;
  health: ProfileHealth;
  capabilities: CapabilityService;
  capabilityRegistry?:CapabilityRegistryService;
  onCapabilityChanged?:()=>void;
  agentSupport?: AgentSupportService;
  applications?: ApplicationService;
  browser?:BrowserService;
  agentWorkspace?: AgentWorkspace;
  onProjectDeleted?:()=>void;
  ptys: PtyManager;
  ptyAccess: PtyAccess;
  baseEnv: () => Record<string, string>;
  onSettingChanged: (key: AppSettingsKey) => void;
}

export function createRpcRouter(d: RpcDeps) {
  const notices = codexConfigNotices(d.client.db);
  const agentTasks = d.agentWorkspace?.tasks;
  return createRPCRouter({
    files: createFileController(d.files, d.trustedRenderer, new FileWorkspacePersistence(d.client.db), new FileTerminalService({
      access: d.ptyAccess, roots: d.files.roots, taskProject: (terminalKey) => d.agentWorkspace?.terminals?.project(terminalKey) ?? null,
      source: (owner, target, identity) => d.files.terminalSource(owner, target, identity),
      bracketedPaste: (ptyId) => d.ptys.bracketedPaste(ptyId), write: (ptyId, data) => d.ptys.writeControlled(ptyId, data),
    }), agentTasks ? ({ taskId, turnId, index }) => agentTasks.messageAttachmentFile(taskId, turnId, index) : undefined),
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
    agentSupport: createScopedRPCController({ status: (event) => { d.ptyAccess.requireSender(event); return d.agentSupport?.status() ?? { state: 'unavailable',errorCode: 'CAPABILITY_UNAVAILABLE',legacyResourceCount: 0,runtimeHash: null,adapters: [],applications: [] } as AgentSupportState; } }),
    applications: createApplicationController(d.applications,event=>d.ptyAccess.requireSender(event)),
    browser:createBrowserController(d.browser,d.trustedRenderer),
    voice: createVoiceController(d.voice),
    projectTransfer: createTransferController(d.projectTransfer),
    appSettings: createAppSettingsController(d.settings, d.onSettingChanged, d.voice),
    ...createProjectControllers(d.projects, { agentTasks: d.agentWorkspace?.projectResources, deleted: () => d.onProjectDeleted?.() }),
    ...createAiProfileController(d.aiProfiles, d.health, d.baseEnv),
    ...createAgentController(d.agents, d.agentTools, d.providers,d.aiProfiles),
    codexConfig: createScopedRPCController({
      notices: event => { d.ptyAccess.requireSender(event); return notices.list(); },
      dismissNotice: (event, id: string) => { d.ptyAccess.requireSender(event); notices.dismiss(id); },
      open: (event, id: string) => { d.ptyAccess.requireSender(event); return shell.openPath(notices.path(id)); },
    }),
    agentTransfer: createAgentTransferController(d.agentTransfer),
    providerSetup: createProviderSetupController(d.providers),
    ...createAgentTaskController(d.agentWorkspace, (event) => d.ptyAccess.requireSender(event), d.files),
    ...createCapabilityController(d.capabilities, d.aiProfiles, d.baseEnv,d.capabilityRegistry,d.onCapabilityChanged),
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
