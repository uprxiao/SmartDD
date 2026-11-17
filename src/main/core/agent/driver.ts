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
  cwd: string;
  /** 宿主组装的环境；凭据由现有凭据服务解析后注入，不写入任何文件。 */
  env: Record<string, string>;
  model?: string;
  tier: Tier;
  /** 恢复已确认的原生会话；缺省新建。 */
  resumeNativeId?: string;
  /** 宿主追加给原生进程的参数（如 Codex 隔离 -c 配置）。 */
  extraArgs?: readonly string[];
  /** Claude settingSources；关闭“沿用我的扩展”时去掉 user。 */
  settingSources?: readonly ('user' | 'project' | 'local')[];
  signal?: AbortSignal;
}

export interface TurnInput {
  clientInputId: string;
  text: string;
  /** 已由宿主核对的图片附件（绝对路径）；非图片附件只在文字中注明。 */
  images?: readonly { path: string; mime: string }[];
  model?: string;
  tier: Tier;
}

export type TurnStatus = 'completed' | 'failed' | 'interrupted';
export type DriverRequestKind = 'command_approval' | 'file_approval' | 'permission_approval' | 'tool_approval' | 'user_input' | 'plan_approval' | 'elicitation' | 'other';

export type DriverEvent =
  | { type: 'process'; pid: number }
  | { type: 'session'; nativeId: string }
  /** clientInputId 为空表示原生自行开始的回合（如 Codex 目标自动续跑）。 */
  | { type: 'turn.started'; nativeTurnId: string; clientInputId: string }
  | { type: 'goal'; objective: string | null; status: 'active' | 'paused' | 'complete' | 'cleared' | 'limited'; timeUsedSeconds?: number }
  | { type: 'steer.accepted'; clientInputId: string; nativeTurnId: string }
  | { type: 'message.delta'; nativeItemId: string; text: string }
  | { type: 'item.completed'; nativeItemId: string; itemType: string; payload: unknown }
  | { type: 'request'; requestKey: string; kind: DriverRequestKind; payload: unknown }
  | { type: 'request.resolved'; requestKey: string }
  | { type: 'turn.completed'; nativeTurnId: string; status: TurnStatus; error?: string }
  /** 所有原生通知原样保留，供时间线（阶段 2）与诊断使用；不在此处解释。 */
  | { type: 'native'; name: string; payload: unknown }
  | { type: 'diagnostic'; message: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export type DriverListener = (event: DriverEvent) => void;

export interface DriverInstance {
  readonly driverId: DriverId;
  /**
   * 打开或恢复原生会话。confirmed=false 表示宿主预分配的 ID（如 Claude 新会话），
   * 须等原生 session 事件确认后才能写入绑定的 native_confirmed_at（技术方案 §2：预分配 ID 不等于已确认）。
   */
  open(options: DriverOpenOptions): Promise<{ nativeId: string; confirmed: boolean }>;
  /** 等原生开始信号后才 resolve。 */
  startTurn(input: TurnInput): Promise<{ nativeTurnId: string }>;
  /** 原样回传原生选项或结构化回答，不压成布尔值。 */
  respond(requestKey: string, result: unknown): Promise<void>;
  interrupt(): Promise<void>;
  /** 插话：按能力探测与真实接受证据启用；不支持时抛 UNSUPPORTED，调用方改为排队。 */
  steer?(input: TurnInput): Promise<void>;
  /** 目标：Codex 用 thread/goal/*；不支持暂停的执行器对 pause/resume 抛 UNSUPPORTED。 */
  goal?(op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }): Promise<void>;
  close(): Promise<void>;
  on(listener: DriverListener): () => void;
}

export interface AgentDriver {
  readonly id: DriverId;
  /** 执行器默认命令名（M13 发现服务按登录 shell PATH 查找）。 */
  readonly command: string;
  create(): DriverInstance;
}

export class DriverError extends Error {
  constructor(readonly code: 'PROTOCOL' | 'TIMEOUT' | 'EXITED' | 'REJECTED' | 'UNSUPPORTED' | 'STATE', message: string) { super(message); }
}

/** 简单的同步事件分发，单个监听器出错不影响其他监听器。 */
export class Emitter {
  private listeners = new Set<DriverListener>();
  on(listener: DriverListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(event: DriverEvent) { for (const l of [...this.listeners]) { try { l(event); } catch { /* 监听器自身负责记录 */ } } }
}
