// M14 Driver 合同（技术方案 T1.5 §3）。Driver 定义是不可变注册项；每次 open 创建独立实例，
// 持有流式缓冲、原生关联、工具映射和待回应回调。任务／编排层不出现品牌配对枚举。
import type { DriverId } from './capabilities';
import type { Tier } from './permissions';

export interface DriverExecutable {
  /** 已核对的 realpath；不接受 Agent 或客户端提供的路径。 */
  path: string;
  version: string;
}

export interface DriverOpenOptions {
  executable: DriverExecutable;
  modelCache?: DriverModelCache;
  hostBusinessInstructions?: string;
  cwd: string;
  /** 宿主组装的环境；凭据由现有凭据服务解析后注入，不写入任何文件。 */
  env: Record<string, string>;
  model?: string;
  tier: Tier;
  /** 恢复已确认的原生会话；缺省新建。 */
  resumeNativeId?: string;
  /** 宿主追加给原生进程的参数（如 Codex 隔离 -c 配置）。 */
  extraArgs?: readonly string[];
  /** 已核验的宿主 CLI 命名权限，只允许访问本次运行的业务套接字。 */
  codexCliPermissions?: string;
  /** Claude settingSources；关闭“沿用我的扩展”时去掉 user。 */
  hostBusinessCli?:import('./host-cli-command').HostBusinessCli;
  claudeSettings?:Record<string,unknown>;
  settingSources?: readonly ('user' | 'project' | 'local')[];
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  browserMcp?: { serverName: string; toolNames: readonly string[]; alwaysLoad?: boolean };
  claudeMcp?: import('../capabilities/mcp-projection').ClaudeMcpProjection;
  skillRoots?: readonly { name: string; path: string }[];
  plugins?: { type: 'local'; path: string }[];
  /** Host lifecycle hook, never a model-supplied setting. */
  stopWhenWaiting?(): boolean;
  recoverGoals?: boolean;
  /** Host-enforced role, independent of permission tier. */
  readOnly?: boolean;
  requiredMcpServers?: readonly string[];
  assertStarting?(): void;
  startupSignal?: AbortSignal;
  beforeInitialize?(): Promise<void>;
  beforeThreadOpen?(): Promise<void>;
  signal?: AbortSignal;
}

export interface TurnInput {
  clientInputId: string;
  text: string;
  /** 已由宿主核对的图片附件（绝对路径）；非图片附件只在文字中注明。 */
  images?: readonly { path: string; mime: string }[];
  model?: string;
  effort?: string;
  tier: Tier;
}

export type TurnStatus = 'completed' | 'failed' | 'interrupted';
export type DriverRequestKind = 'command_approval' | 'file_approval' | 'permission_approval' | 'tool_approval' | 'user_input' | 'plan_approval' | 'elicitation' | 'other';

/** Native callbacks may omit schema constraints. Until we can verify the original request, only cancellation is supported. */
export function requireElicitationCancellation(result: unknown): void {
  if (!result || typeof result !== 'object' || !('action' in result) || result.action !== 'cancel' ||
      Object.keys(result).some(key => key !== 'action')) {
    throw new DriverError('REJECTED', '无法核验原始 MCP 请求，只能取消');
  }
}

export type DriverEvent =
  | { type: 'process'; pid: number }
  | { type: 'session'; nativeId: string }
  | { type: 'model_cache'; result: 'hit' | 'miss' | 'read_failed' | 'account_unavailable' | 'account_timeout' | 'account_failed'; elapsedMs: number }
  /** clientInputId 为空表示原生自行开始的回合（如 Codex 目标自动续跑）。 */
  | { type: 'turn.started'; nativeTurnId: string; clientInputId: string }
  | { type: 'goal'; objective: string | null; status: 'active' | 'paused' | 'complete' | 'cleared' | 'limited'; timeUsedSeconds?: number; nativeCreatedAt?: number; nativeUpdatedAt?: number }
  | { type: 'steer.accepted'; clientInputId: string; nativeTurnId: string }
  /** 执行器公布的命令与 Skill（输入框 /命令、$Skill 只列这些）。 */
  | { type: 'catalog'; commands: string[]; skills: { name: string; description?: string }[] }
  | { type: 'message.delta'; nativeItemId: string; text: string }
  | { type: 'item.completed'; nativeItemId: string; itemType: string; payload: unknown }
  | { type: 'request'; requestKey: string; kind: DriverRequestKind; payload: unknown; nodeId?: string }
  | { type: 'node.message'; nodeId: string; key: string; payload: unknown }
  | { type: 'node.state'; nodeId: string; state: 'running' | 'completed' | 'failed' | 'interrupted'; nativeRunId?: string }
  | { type: 'request.resolved'; requestKey: string }
  | { type: 'turn.completed'; nativeTurnId: string; status: TurnStatus; error?: string }
  /** 所有原生通知原样保留，供时间线（阶段 2）与诊断使用；不在此处解释。 */
  | { type: 'native'; name: string; payload: unknown }
  | { type: 'diagnostic'; message: string }
  /** 实例已不可再用（如 SDK 流异常结束）：宿主把运行退役，下次提交恢复会话。 */
  | { type: 'unusable'; reason: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export type DriverListener = (event: DriverEvent) => void;

export interface DriverInstance {
  readonly driverId: DriverId;
  /**
   * 打开或恢复原生会话。confirmed=false 表示宿主预分配的 ID（如 Claude 新会话），
   * 须等原生 session 事件确认后才能写入绑定的 native_confirmed_at（技术方案 §2：预分配 ID 不等于已确认）。
   */
  /** 解析执行器自己的默认模型（Codex：配置与模型目录）。 */
  defaultModel?(): Promise<string | undefined>;
  /** 在线刷新失败时，原生执行器可能先返回当下可用的内置目录。 */
  modelCatalog?(onFallback?: (models: DriverModel[]) => void): Promise<DriverModel[]>;
  /** 只追加模型可见历史，不触发新回合；不改变真人输入的命令文本。 */
  injectHistory?(text: string): Promise<void>;
  open(options: DriverOpenOptions): Promise<{
    nativeId: string;
    confirmed: boolean;
    defaultModel?: string;
    hostBusinessInstructionsInstalled?: boolean;
    browserMcpReady?: boolean;
    nativeSelection?: { model: string; effort: string };
  }>;
  /** 等原生开始信号后才 resolve。 */
  startTurn(input: TurnInput): Promise<{ nativeTurnId: string }>;
  /** 原样回传原生选项或结构化回答，不压成布尔值。 */
  respond(requestKey: string, result: unknown): Promise<void>;
  interrupt(): Promise<void>;
  /** 插话：按能力探测与真实接受证据启用；不支持时抛 UNSUPPORTED，调用方改为排队。 */
  steer?(input: TurnInput): Promise<void>;
  /** 目标：Codex 用 thread/goal/*；不支持暂停的执行器对 pause/resume 抛 UNSUPPORTED。 */
  goal?(op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }): Promise<void>;
  goalState?(): Promise<{ objective: string; status: string; createdAt: number; updatedAt: number } | null>;
  nativeChildHistory?(nodeId: string): Promise<{ key: string; payload: unknown }[]>;
  /** 原生命令（Codex compact／review 走协议；其余由调用方作为文字输入发送）。 */
  command?(name: 'compact' | 'review'): Promise<void>;
  close(): Promise<void>;
  on(listener: DriverListener): () => void;
}

export type DriverModel = import('@shared/agent-model-choice').AgentModelOption;
export interface DriverModelCache {
  read(account: string): DriverModel[] | undefined | Promise<DriverModel[] | undefined>;
  write(account: string, models: DriverModel[]): void;
}

export interface AgentDriver {
  readonly id: DriverId;
  /** 执行器默认命令名（M13 发现服务按登录 shell PATH 查找）。 */
  readonly command: string;
  create(): DriverInstance;
}

export class DriverError extends Error {
  constructor(readonly code: 'PROTOCOL' | 'TIMEOUT' | 'EXITED' | 'REJECTED' | 'UNSUPPORTED' | 'STATE', message: string, readonly nativeCode?: number) { super(message); }
}

/** 简单的同步事件分发，单个监听器出错不影响其他监听器。 */
export class Emitter {
  private listeners = new Set<DriverListener>();
  on(listener: DriverListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(event: DriverEvent) { for (const l of [...this.listeners]) { try { l(event); } catch { /* 监听器自身负责记录 */ } } }
}
