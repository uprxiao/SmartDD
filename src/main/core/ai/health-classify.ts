// What a profile's CLI said about the API, from a test's output or a task's session file.
// The shapes below were reproduced against a local fake endpoint (Claude Code 2.1.300,
// codex-cli 0.162.1); only the error/role fields are read, never the conversation itself.

import type { ProfileCheckCategory } from '@shared/ai-profiles';

export interface HealthEvent {
  category: ProfileCheckCategory;
  message: string;
}

const MESSAGE_MAX = 500;
const clip = (s: string) => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX)}…` : s);

// Order matters: billing before auth (402 vs 401), specific causes before the generic 5xx/network.
const TEXT_RULES: [ProfileCheckCategory, RegExp][] = [
  ['billing', /\b402\b|insufficient[ _](balance|quota|funds)|credit balance|balance is too low|payment required|billing|余额不足|欠费|usage limit|exceeded your current quota/i],
  ['auth', /\b40[13]\b|invalid (api|x-api)[ -]key|failed to authenticate|authentication|unauthori[sz]ed|not logged in|\/login|token (has )?expired|forbidden|permission_error/i],
  ['model', /issue with the selected model|model[_ ]not[_ ]found|model .{0,60}(does not exist|not exist)|unknown model|invalid model/i],
  ['rate_limit', /\b429\b|rate[ _]limit|too many requests/i],
  ['network', /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|connection refused|connection error|socket hang up|getaddrinfo|certificate/i],
  ['server', /\b5\d\d\b|overloaded|server-side issue|high demand|internal server error|bad gateway|service unavailable/i],
];

export function classifyText(text: string): ProfileCheckCategory | null {
  for (const [category, re] of TEXT_RULES) if (re.test(text)) return category;
  return null;
}

export function categoryOfStatus(status: number | null | undefined): ProfileCheckCategory | null {
  if (!status) return null;
  if (status === 402) return 'billing';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return null;
}

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
        .join(' ')
        .trim()
    : typeof content === 'string'
      ? content
      : '';

const CLAUDE_ERRORS: Record<string, ProfileCheckCategory> = {
  authentication_failed: 'auth',
  billing_error: 'billing',
  model_not_found: 'model',
  rate_limit: 'rate_limit',
};

/**
 * One line of `<root>/projects/<cwd>/<id>.jsonl`. A real reply is ok; a synthetic assistant
 * message with isApiErrorMessage carries the final error (retries are separate system lines and
 * are ignored). Errors that say nothing about the profile (prompt too long, ...) return null.
 */
export function classifyClaudeLine(line: unknown): HealthEvent | null {
  const j = line as {
    type?: string;
    isApiErrorMessage?: boolean;
    error?: unknown;
    apiErrorStatus?: number;
    message?: { model?: string; content?: unknown };
  };
  if (!j || j.type !== 'assistant') return null;
  const text = clip(textOf(j.message?.content));
  if (!j.isApiErrorMessage) return j.message?.model === '<synthetic>' ? null : { category: 'ok', message: '' };
  const code = typeof j.error === 'string' ? j.error : '';
  // A refused connection is also reported as server_error, without a status.
  const category =
    code === 'server_error'
      ? classifyText(text) === 'network'
        ? 'network'
        : 'server'
      : (CLAUDE_ERRORS[code] ?? categoryOfStatus(j.apiErrorStatus) ?? classifyText(text));
  return category ? { category, message: text || code } : null;
}

function codexStatus(info: unknown): number | null {
  if (!info || typeof info !== 'object') return null;
  for (const v of Object.values(info)) {
    if (v && typeof v === 'object' && typeof (v as { http_status_code?: unknown }).http_status_code === 'number') {
      return (v as { http_status_code: number }).http_status_code;
    }
  }
  return null;
}

const CODEX_ERRORS: Record<string, ProfileCheckCategory> = {
  unauthorized: 'auth',
  usage_limit_exceeded: 'billing',
  internal_server_error: 'server',
  server_overloaded: 'server',
};

/** One line of a Codex rollout: an assistant message is ok, a turn that ended in an error is classified. */
export function classifyCodexLine(line: unknown): HealthEvent | null {
  const j = line as { type?: string; payload?: { type?: string; role?: string; error?: unknown; message?: unknown } };
  if (!j?.payload) return null;
  if (j.type === 'response_item' && j.payload.type === 'message' && j.payload.role === 'assistant') return { category: 'ok', message: '' };
  if (j.type !== 'event_msg') return null;
  if (j.payload.type === 'task_complete' && j.payload.error && typeof j.payload.error === 'object') {
    const err = j.payload.error as { message?: unknown; codex_error_info?: unknown };
    const text = clip(typeof err.message === 'string' ? err.message : '');
    const info = err.codex_error_info;
    if (info === 'context_window_exceeded') return null;
    const category = (typeof info === 'string' ? CODEX_ERRORS[info] : undefined) ?? categoryOfStatus(codexStatus(info)) ?? classifyText(text);
    return category ? { category, message: text } : null;
  }
  if (j.payload.type === 'error' && typeof j.payload.message === 'string') {
    const category = classifyText(j.payload.message);
    return category ? { category, message: clip(j.payload.message) } : null;
  }
  return null;
}

/** The line of CLI output that best says what went wrong. */
export function pickReason(stdout: string, stderr: string, exclude: string): string {
  const lines = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)].map((l) => l.trim()).filter((l) => l && !l.includes(exclude));
  const hit = lines.find((l) => classifyText(l)) ?? lines.find((l) => /error|failed|invalid|denied|not found|refused/i.test(l));
  return clip(hit ?? lines[lines.length - 1] ?? '');
}
