import { describe, expect, it } from 'vitest';
import { classifyClaudeLine, classifyCodexLine, classifyText, pickReason } from './health-classify';

// Fields as Claude Code 2.1.300 wrote them against a local fake endpoint (other fields dropped).
const claudeError = (error: string, status: number | undefined, text: string) => ({
  type: 'assistant',
  isApiErrorMessage: true,
  error,
  apiErrorStatus: status,
  message: { model: '<synthetic>', content: [{ type: 'text', text }] },
});

describe('classifyClaudeLine', () => {
  it('marks a real reply ok', () => {
    expect(classifyClaudeLine({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hi' }] } })).toEqual({ category: 'ok', message: '' });
  });

  it('classifies the reproduced API errors', () => {
    const cases: [ReturnType<typeof claudeError>, string][] = [
      [claudeError('authentication_failed', 401, 'Invalid API key · Fix external API key'), 'auth'],
      [claudeError('authentication_failed', 403, 'Failed to authenticate. API Error: 403 Your API key does not have permission'), 'auth'],
      [claudeError('unknown', 402, 'API Error: 402 Insufficient Balance'), 'billing'],
      [claudeError('billing_error', 400, 'Credit balance is too low'), 'billing'],
      [claudeError('model_not_found', 404, "There's an issue with the selected model (x)."), 'model'],
      [claudeError('rate_limit', 429, 'API Error: Request rejected (429) · rate limit'), 'rate_limit'],
      [claudeError('server_error', 529, 'API Error: Repeated 529 Overloaded errors.'), 'server'],
      [claudeError('server_error', 500, 'API Error: 500 Internal server error.'), 'server'],
      [claudeError('server_error', undefined, 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)'), 'network'],
    ];
    for (const [line, category] of cases) expect(classifyClaudeLine(line)?.category).toBe(category);
    expect(classifyClaudeLine(cases[0][0])?.message).toBe('Invalid API key · Fix external API key');
  });

  it('ignores lines that say nothing about the profile', () => {
    expect(classifyClaudeLine({ type: 'user', message: { content: 'x' } })).toBeNull();
    expect(classifyClaudeLine({ type: 'system', subtype: 'api_error', level: 'error', error: { status: 529 } })).toBeNull();
    expect(classifyClaudeLine({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } })).toBeNull();
    expect(classifyClaudeLine(claudeError('invalid_request', 400, 'Prompt is too long'))).toBeNull();
  });
});

const codexDone = (message: string, info: unknown) => ({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: null, error: { message, codex_error_info: info } } });

describe('classifyCodexLine', () => {
  it('marks an assistant message ok', () => {
    expect(classifyCodexLine({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } })?.category).toBe('ok');
    expect(classifyCodexLine({ type: 'response_item', payload: { type: 'message', role: 'user', content: [] } })).toBeNull();
    expect(classifyCodexLine({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'x' } })).toBeNull();
  });

  it('classifies the reproduced turn errors', () => {
    expect(classifyCodexLine(codexDone('unexpected status 401 Unauthorized: invalid x-api-key', { http_connection_failed: { http_status_code: 401 } }))?.category).toBe('auth');
    expect(classifyCodexLine(codexDone('unexpected status 402 Payment Required: Insufficient Balance', { http_connection_failed: { http_status_code: 402 } }))?.category).toBe('billing');
    expect(classifyCodexLine(codexDone('exceeded retry limit, last status: 429 Too Many Requests', { response_too_many_failed_attempts: { http_status_code: 429 } }))?.category).toBe('rate_limit');
    expect(classifyCodexLine(codexDone('We’re currently experiencing high demand', 'internal_server_error'))?.category).toBe('server');
    expect(classifyCodexLine(codexDone('unexpected status 502 Bad Gateway', { http_connection_failed: { http_status_code: 502 } }))?.category).toBe('server');
    expect(classifyCodexLine(codexDone('too long', 'context_window_exceeded'))).toBeNull();
  });
});

describe('classifyText / pickReason', () => {
  it('reads the CLI wording', () => {
    expect(classifyText('ERROR: unexpected status 401 Unauthorized')).toBe('auth');
    expect(classifyText('账户余额不足')).toBe('billing');
    expect(classifyText('Not logged in · Please run /login')).toBe('auth');
    expect(classifyText('listening on 18765')).toBeNull();
  });

  it('picks the line with the cause and skips the echoed prompt', () => {
    const stderr = 'session id: x\nuser\nReply with exactly SMARTDD-OK-1 and nothing else.\nERROR: unexpected status 402 Payment Required: Insufficient Balance';
    expect(pickReason('', stderr, 'SMARTDD-OK-1')).toBe('ERROR: unexpected status 402 Payment Required: Insufficient Balance');
    expect(pickReason('just text', '', 'X')).toBe('just text');
  });
});
