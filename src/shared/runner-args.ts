import type { Runner } from './types';

/**
 * - new:    first launch. Claude gets a caller-chosen id; Codex assigns its own (discovered later).
 * - resume: the CLI has a session file for this id.
 * - reopen: Claude never wrote a session file (no message was sent): start fresh under the same id.
 */
export type LaunchMode = 'new' | 'resume' | 'reopen';

export interface RunnerArgsOptions {
  mode: LaunchMode;
  /** Claude: required for every mode. Codex: required for resume. */
  sessionId?: string | null;
  cwd: string;
  /** Profile arguments, placed before SmartDD's own. */
  profileArgs?: string[];
  /** Session-scoped Skill/MCP arguments, never credentials. */
  runtimeArgs?: string[];
  /** Only on `new`; passed as one argv entry, never through a shell. */
  firstMessage?: string;
}

export function buildRunnerArgs(runner: Runner, o: RunnerArgsOptions): string[] {
  const args = [...(o.profileArgs ?? []), ...(o.runtimeArgs ?? [])];
  if (runner === 'claude') {
    if (!o.sessionId) throw new Error('Claude 任务缺少 session ID');
    args.push(o.mode === 'resume' ? '--resume' : '--session-id', o.sessionId);
  } else if (o.mode === 'resume') {
    if (!o.sessionId) throw new Error('Codex 任务缺少 session ID，无法恢复');
    // Without --cd Codex resumes in whatever directory it was started from.
    args.push('resume', '--cd', o.cwd, o.sessionId);
  }
  const msg = o.mode === 'new' ? (o.firstMessage ?? '').trim() : '';
  if (msg) {
    // A message starting with "-" would otherwise be read as an option.
    if (msg.startsWith('-')) args.push('--');
    args.push(msg);
  }
  return args;
}
