export type AgentActivityStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface AgentRetryProgress {
  status: AgentActivityStatus;
  attempt?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface AgentActivityError {
  code?: string;
  message?: string;
  limited?: { kind: 'usage' | 'rate' | 'output' | 'context'; resetAt?: string };
}

/** A driver can report these facts without teaching the task view its protocol. */
export type AgentActivityUpdate =
  | { kind: 'compaction'; id: string; status: AgentActivityStatus; message?: string }
  | ({ kind: 'retry' } & AgentRetryProgress & AgentActivityError);
