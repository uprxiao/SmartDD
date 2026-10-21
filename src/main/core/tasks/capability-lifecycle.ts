import type { IpcMainInvokeEvent } from 'electron';
import type { LaunchMode } from '@shared/runner-args';
import type { RuntimeSnapshot } from '@shared/capabilities';
import type { PreparedRuntime } from '../capabilities/capability-service';
import type { ResolvedProfile } from '../ai/ai-profile-service';
export type TaskInputSender = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>;
/** Host-owned callbacks. No runtime identity or process receipt is accepted from RPC. */
export interface TaskCapabilityLaunch {
  ptyId: string;
  runtime?: PreparedRuntime;
  args: string[];
  env: Record<string,string>;
  command?: string;
  /** Host-only, before any fork window is armed. Never changes the fixed selection. */
  nativeOnly?(reason: 'managed_launch_payload_too_large'): Promise<TaskCapabilityLaunch>;
  beforeSpawn(): Promise<void>;
  spawned(nativePid: number | null): Promise<void>;
  initialInput?(sender: TaskInputSender, text: string): void;
  spawnFailed(): Promise<void>;
  exited(): Promise<void>;
  stop(reason: string): Promise<void>;
  bindNative?(sessionId: string): Promise<void>;
}
export interface TaskCapabilityLauncher {
  prepare(input: {
    projectId: string;taskId: string;profile: ResolvedProfile;cwd: string;
    home: string;stateRoot: string;claudeConfigExplicit: boolean;
    mode: LaunchMode;sessionId: string | null;previous: RuntimeSnapshot | null;
    newTask: boolean;signal: AbortSignal;environment: Record<string,string>;
  }): Promise<TaskCapabilityLaunch>;
  tombstone(taskId: string): Promise<void>;
  activeTaskIds?(projectId: string): ReadonlySet<string>;
}
