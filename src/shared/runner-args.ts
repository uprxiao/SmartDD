import type { Runner } from './types';

// Claude accepts a caller-chosen id; Codex assigns its own and must be discovered afterwards.
export function buildRunnerArgs(
  runner: Runner,
  opts: { newSessionId?: string; resumeSessionId?: string }
): string[] {
  if (runner === 'claude') {
    if (opts.resumeSessionId) return ['--resume', opts.resumeSessionId];
    if (opts.newSessionId) return ['--session-id', opts.newSessionId];
    return [];
  }
  if (opts.resumeSessionId) return ['resume', opts.resumeSessionId];
  return [];
}
