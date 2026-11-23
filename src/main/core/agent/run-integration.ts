import type { DriverOpenOptions } from './driver';
import type { ApplicationEntry } from '@shared/application-capabilities';
import type { PreparedRuntime } from '../capabilities/capability-service';
/** Host-minted lifecycle closure. No process or scope receipt comes from RPC/MCP arguments. */
export interface RunIntegrationContext {
  runId: string;
  bindingId: string;
  generation: number;
  nativeId?: string;
  /** Stops during opening invalidate the startup authorization of this exact run. */
  startupCancelled(): boolean;
}

interface ApplicationRunLifecycle {
  beforeFork(): Promise<void>;
  attached(pid: number): Promise<void>;
  exited(): Promise<void>;
  cancelBeforeFork(): Promise<void>;
}

export interface RunIntegration extends Partial<ApplicationRunLifecycle> {
  browserEntry?: ApplicationEntry;
  browserMcp?: DriverOpenOptions['browserMcp'];
  projectContextMcp?: DriverOpenOptions['projectContextMcp'];
  projectRuntime?: Pick<PreparedRuntime, 'release'>;
  hostBusinessCli?:DriverOpenOptions['hostBusinessCli'];
  codexCliPermissions?:DriverOpenOptions['codexCliPermissions'];
  claudeSettings?:Record<string,unknown>;extraArgs?: string[]; env?: Record<string, string>; mcpServers?: DriverOpenOptions['mcpServers'];
  claudeMcp?: DriverOpenOptions['claudeMcp'];
  skillRoots?: DriverOpenOptions['skillRoots']; plugins?: DriverOpenOptions['plugins'];
  beforeThreadOpen?(): Promise<void>;
  assertCurrent?(): void;
}

export type ApplicationRunIntegration = RunIntegration & ApplicationRunLifecycle;

export function browserInstructions(entry: ApplicationEntry | undefined, readOnly: boolean) {
  const taskBrowser = '用户未指定外部浏览器时，优先使用本任务的 WillYou 内置浏览器。若任务没有可用的内置浏览器入口，说明当前状态，征询用户是否改用外部窗口。';
  if (readOnly) return taskBrowser + '本任务为只读角色，仅使用实际提供的页面观察能力。';
  if (!entry) return taskBrowser;
  const workflow = '同一页面继续使用原 pageId，开页和导航后读取页面快照，核对实际加载结果。';
  const show = '用户明确要求打开浏览器或展示网页时，在本任务右侧显示已有标签。仅为查资料而浏览时保持后台。';
  if (entry === 'mcp') {
    return taskBrowser + '在本轮工具列表调用 smartdd_browser_tab_create_v2 开页、smartdd_browser_nav_goto_v2 导航、smartdd_browser_nav_snapshot_v2 读页。' + workflow
      + show + '使用 smartdd_browser_tab_switch_v2，传入同一页的 pageId 作为 page，并设置 focus: true。';
  }
  return taskBrowser + '通过宿主 willyou-app browser 开页、导航和读取快照。可查阅 willyou-browser-browser Skill。' + workflow
    + show + '使用 willyou-app browser tab switch --page <pageId> --focus true 显示同一页。';
}
