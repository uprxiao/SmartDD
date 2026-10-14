export interface CodexRolloutMeta {
  id: string;
  cwd: string;
  timestampMs: number;
  originator: string;
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

// Codex writes the rollout only after the first user message, so the match is on
// realpath(cwd) + created after launch; ids already claimed by other sessions are skipped.
export function pickCodexSession(
  candidates: CodexRolloutMeta[],
  opts: { realCwd: string; launchedAtMs: number; claimedIds: Set<string>; skewMs?: number }
): CodexRolloutMeta | null {
  const skew = opts.skewMs ?? 2000;
  const hits = candidates
    .filter(
      (c) =>
        c.cwd === opts.realCwd &&
        c.timestampMs >= opts.launchedAtMs - skew &&
        !opts.claimedIds.has(c.id)
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return hits[0] ?? null;
}
