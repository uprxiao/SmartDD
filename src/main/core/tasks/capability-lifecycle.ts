import type { IpcMainInvokeEvent } from 'electron';
import type { LaunchMode } from '@shared/runner-args';
import type { RuntimeSnapshot } from '@shared/capabilities';
import type { PreparedRuntime } from '../capabilities/capability-service';
import type { ResolvedProfile } from '../ai/ai-profile-service';
import type {ClaudeRestoreReceipt} from '../ai/agent-native-state';
import type {CapabilitySessionSnapshot,CapabilitySessionPointer} from '@shared/application-session';
export type TaskInputSender = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>;
/** Host-owned callbacks. No runtime identity or process receipt is accepted from RPC. */
export interface TaskCapabilityLaunch {
  /** Existing owned backend only; never accepts a renderer process receipt. */
  codexInitializer?():import('../applications/codex-initialization').CodexInitializerProcess;
  ptyId: string;
  runtime?: PreparedRuntime;
  args: string[];
  /** Host-verified per-run equivalent of profile argv; the stored profile stays unchanged. */
  profileArgs?: string[];
  env: Record<string,string>;
  command?: string;
  /** Host-only, before any fork window is armed. Never changes the fixed selection. */
  nativeOnly?(reason: 'managed_launch_payload_too_large'): Promise<TaskCapabilityLaunch>;
  /** Synchronous host policy check immediately before the OS fork. */
  assertBeforeFork?(): void;
  beforeSpawn(): Promise<void>;
  spawned(nativePid: number | null): Promise<void>;
  initialInput?(sender: TaskInputSender, text: string): void;
  /** Host-only receipt: OS spawn has not been attempted; never use after a spawn error. */
  cancelBeforeFork?(): Promise<void>;
  spawnFailed(): Promise<void>;
  exited(): Promise<void>;
  stop(reason: string): Promise<void>;
  bindNative?(sessionId: string): Promise<void>;
}
export interface TaskCapabilityLauncher {
  /** Independent history H gate; C remains short metadata-only coordination. */
  coordinateRestore?<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>;
  assertHistoryCopyAllowed?(input:{taskId:string;from:string;to:string;cwd:string;sessionId:string;home:string}):Promise<void>;
  prepare(input: {
    projectId: string;taskId: string;profile: ResolvedProfile;cwd: string;
    home: string;stateRoot: string;claudeConfigExplicit: boolean;
    mode: LaunchMode;sessionId: string | null;previous: RuntimeSnapshot | null;
    newTask: boolean;signal: AbortSignal;environment: Record<string,string>;
    nativeRestore?:ClaudeRestoreReceipt;
    commitSessionSnapshot?(before:{pointer:CapabilitySessionPointer;native:CapabilitySessionSnapshot['native']},after:{pointer:CapabilitySessionPointer;native:CapabilitySessionSnapshot['native']}):void;
  }): Promise<TaskCapabilityLaunch>;
  tombstone(taskId: string): Promise<void>;
  activeTaskIds?(projectId: string): ReadonlySet<string>;
  resumeAdvice?(taskId: string): import('@shared/tasks').TaskResumeAdvice | null;
}
