export type Runner = 'claude' | 'codex';

export interface SessionRecord {
  id: string;
  runner: Runner;
  cwd: string;
  nativeSessionId: string | null;
  title: string;
  createdAt: number;
}

export interface LaunchRequest {
  runner: Runner;
  cwd: string;
  resumeSessionId?: string;
  env?: Record<string, string>;
}

export interface LaunchResult {
  ptyId: string;
  session: SessionRecord;
}

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}
