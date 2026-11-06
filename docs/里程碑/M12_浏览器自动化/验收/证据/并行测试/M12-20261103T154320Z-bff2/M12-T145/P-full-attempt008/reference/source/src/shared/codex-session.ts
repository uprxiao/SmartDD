export interface CodexRolloutMeta {
  id: string;
  cwd: string;
  timestampMs: number;
  originator: string;
  /** From Codex's state DB; the rollout's first line does not carry it. */
  firstUserMessage?: string;
}

export function parseCodexSessionMeta(firstLine: string): CodexRolloutMeta | null {
  try {
    const d = JSON.parse(firstLine);
    if (d?.type !== 'session_meta' || !d.payload?.id || !d.payload?.cwd) return null;
    const ts = Date.parse(d.payload.timestamp);
    return {
      id: String(d.payload.id),
      cwd: String(d.payload.cwd),
      timestampMs: Number.isNaN(ts) ? 0 : ts,
      originator: String(d.payload.originator ?? ''),
    };
  } catch {
    return null;
  }
}

/** A task still waiting for Codex to create its session. */
export interface CodexWaiter {
  taskId: string;
  realCwd: string;
  launchedAtMs: number;
  /** The prompt passed at launch; '' when the user types it in the terminal. */
  firstMessage: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Both known and different → not this task's session (Codex may truncate, so a prefix still counts). */
function messageConflicts(c: CodexRolloutMeta, w: CodexWaiter): boolean {
  const a = norm(c.firstUserMessage ?? '');
  const b = norm(w.firstMessage);
  if (!a || !b) return false;
  return !(a === b || a.startsWith(b) || b.startsWith(a));
}

/**
 * Which waiting task a new Codex session belongs to (after Yoda's bestFreshOwnerFor): same
 * realpath(cwd), created after that task's launch, first message not contradicting; among
 * several, the one launched closest to the session's creation, ties to the later launch.
 */
export function codexOwnerOf(c: CodexRolloutMeta, waiters: CodexWaiter[], skewMs = 2000): string | null {
  let best: CodexWaiter | null = null;
  for (const w of waiters) {
    if (c.cwd !== w.realCwd || c.timestampMs < w.launchedAtMs - skewMs || messageConflicts(c, w)) continue;
    if (!best) {
      best = w;
      continue;
    }
    const d = Math.abs(c.timestampMs - w.launchedAtMs);
    const bd = Math.abs(c.timestampMs - best.launchedAtMs);
    if (d < bd || (d === bd && w.launchedAtMs > best.launchedAtMs)) best = w;
  }
  return best?.taskId ?? null;
}

/** The earliest unclaimed session that belongs to `taskId` among the current waiters. */
export function pickCodexSession(
  candidates: CodexRolloutMeta[],
  opts: { taskId: string; waiters: CodexWaiter[]; claimedIds: Set<string>; skewMs?: number }
): CodexRolloutMeta | null {
  const hits = candidates
    .filter((c) => !opts.claimedIds.has(c.id) && codexOwnerOf(c, opts.waiters, opts.skewMs) === opts.taskId)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return hits[0] ?? null;
}
