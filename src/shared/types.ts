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

export interface SmartddApi {
  listSessions(): Promise<SessionRecord[]>;
  launch(req: LaunchRequest): Promise<LaunchResult>;
  write(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  kill(ptyId: string): void;
  runProbes(): Promise<ProbeResult[]>;
  onData(cb: (ptyId: string, data: string) => void): () => void;
  onExit(cb: (ptyId: string, code: number) => void): () => void;
  onSessionUpdated(cb: (session: SessionRecord) => void): () => void;
}
