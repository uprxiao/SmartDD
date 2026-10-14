export type Runner = 'claude' | 'codex';

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}
