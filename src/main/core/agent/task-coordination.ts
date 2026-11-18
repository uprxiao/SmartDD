import type { RunHandle } from './agent-run-service';
export interface TaskCoordination {
  beforeDispatch(taskId: string): Promise<boolean>;
  opened(taskId: string, run: RunHandle): void;
  settleClosedRun(taskId: string, runId: string): Promise<void>;
  blocked(taskId: string): boolean;
  waitingChildren(taskId: string): boolean;
  userContinued(taskId: string): void;
  userStopped(taskId: string, subtree: boolean): Promise<void>;
  hasUnfinishedChildren(taskId: string): boolean;
  needsAttention?(taskId: string): boolean;
  readOnly?(taskId: string): boolean;
  dispatchContext?(taskId: string): string | undefined;
}
