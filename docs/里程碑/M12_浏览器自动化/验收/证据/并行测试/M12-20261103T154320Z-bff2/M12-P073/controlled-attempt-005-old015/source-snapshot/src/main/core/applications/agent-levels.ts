import type { AgentLevel } from '@shared/agent-adapters';

export interface EffectiveLevels {
  /** Levels the host may rely on for this CLI version. */
  readonly levels: readonly AgentLevel[];
  /** False when the version is not declared: levels are best-effort and diagnostics must say "unverified". */
  readonly verified: boolean;
  /** Whether native user-message evidence may authorize a send. Otherwise sending falls back to a page click. */
  readonly nativeSendEvidence: boolean;
}

/** Design §15.4. Fail closed: an undeclared version never gets CLI delivery, L2 or L3. */
export function effectiveLevels(declared: readonly AgentLevel[]): EffectiveLevels {
  if (declared.length === 0) return { levels: ['L0.skill', 'L0.mcp'], verified: false, nativeSendEvidence: false };
  return { levels: declared, verified: true, nativeSendEvidence: declared.includes('L2') && declared.includes('L3') };
}

/** Local self-check may raise a version to at most L2 (and only with L0.cli proven). L3 needs published fixtures. */
export function raiseBySelfCheck(current: EffectiveLevels, proven: readonly AgentLevel[]): EffectiveLevels {
  const allowed = proven.filter((l) => l !== 'L3');
  const levels = [...new Set([...current.levels, ...allowed])] as AgentLevel[];
  return { levels, verified: current.verified, nativeSendEvidence: false };
}
