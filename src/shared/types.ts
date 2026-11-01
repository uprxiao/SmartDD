/** Concrete implementations are registered at host startup, never inferred from an unknown id. */
export type Runner = string;

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}
