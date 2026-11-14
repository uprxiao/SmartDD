import { describe, expect, it, vi } from 'vitest';
import { fetchProviderModels, probeProviderProtocol, verifyProviderModel, type ProviderTarget } from './provider-client';

const target: ProviderTarget = { endpoints: { anthropic: 'https://synthetic.invalid/anthropic', responses: 'https://synthetic.invalid/v1' }, key: 'PUBLIC_TEST_PROVIDER_KEY', authType: 'bearer' };
const event = (type: string, value: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
function claudeStream() {
  return event('message_start', { message: { id: 'synthetic', role: 'assistant' } }) +
    event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'wy_ping', input: {} } }) +
    event('content_block_stop', { index: 0 }) + event('message_stop', {});
}
function codexStream() {
  const item = { type: 'function_call', call_id: 'call-probe', name: 'wy_ping', arguments: '{}' };
  return event('response.created', { response: { id: 'synthetic', status: 'in_progress' } }) +
    event('response.output_item.done', { item }) + event('response.completed', { response: { id: 'synthetic', status: 'completed', output: [item] } });
}
const streamed = (text: string) => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

it('SMG upstream errors retry once and preserve the final error without exposing the Key', async () => {
  const message = 'SMG synthetic upstream is temporarily unavailable';
  const fake = vi.fn(async () => json({ error: { message } }, 503));
  const result = await verifyProviderModel({ ...target, preset: 'smg' }, 'claude', 'deepseek-v4-pro-0813', { fetch: fake });
  expect(fake).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ status: 'unavailable', attempts: 2, message,
    failures: [{ status: 503, message }, { status: 503, message }] });
  expect(JSON.stringify(result)).not.toContain(target.key);
});

describe('Provider model list', () => {
  it('reads OpenAI/Anthropic and catalog forms, retaining metadata without guessing availability', async () => {
    const fake = vi.fn(async () => json({ data: [{ id: 'one', display_name: 'One', context_window: 12345 }, { id: 'one', name: 'Last name' }, { id: 'two' }, { id: '\ninvalid' }] }));
    const models = await fetchProviderModels({ ...target, endpoints: { responses: target.endpoints.responses } }, { fetch: fake });
    expect(models.map((model) => model.id)).toEqual(['one', 'two']);
    expect(models[0]).toMatchObject({ name: 'Last name', availability: { claude: 'untested', codex: 'untested' } });
    expect(fake.mock.calls).toHaveLength(1);
    const catalog = await fetchProviderModels(target, { fetch: async () => json({ models: [{ slug: 'catalog-id', display_name: 'Catalog', context_window: 200000 }] }) });
    expect(catalog[0]).toMatchObject({ id: 'catalog-id', contextWindow: 200000 });
  });

  it('tries root/models then root/v1/models, but never manufactures v1/v1/models', async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (url) => { seen.push(String(url)); return seen.length === 1 ? json({}, 404) : json({ data: [] }); };
    expect(await fetchProviderModels({ ...target, endpoints: { responses: 'https://synthetic.invalid' } }, { fetch: fake })).toEqual([]);
    expect(seen).toEqual(['https://synthetic.invalid/models', 'https://synthetic.invalid/v1/models']);
    seen.length = 0;
    await expect(fetchProviderModels({ ...target, endpoints: { responses: 'https://synthetic.invalid/v1' } }, { fetch: fake })).rejects.toMatchObject({ status: 404 });
    expect(seen).toEqual(['https://synthetic.invalid/v1/models']);
  });

  it('returns empty lists for manual entry and gives safe authentication/format errors', async () => {
    expect(await fetchProviderModels(target, { fetch: async () => json({ data: [] }) })).toEqual([]);
    await expect(fetchProviderModels(target, { fetch: async () => json({ error: { message: target.key } }, 401) })).rejects.toThrow('Key 可能无效');
    await expect(fetchProviderModels(target, { fetch: async () => json({ wrong: [] }) })).rejects.toThrow('格式无法识别');
  });
});

describe('Protocol candidates are separate from model/tool confirmation', () => {
  it('only recognizes structured validation errors as candidate evidence', async () => {
    expect(await probeProviderProtocol(target, 'claude', { fetch: async () => json({ type: 'error', error: { type: 'invalid_request_error' } }, 400) })).toMatchObject({ state: 'candidate' });
    expect(await probeProviderProtocol(target, 'codex', { fetch: async () => json({ error: { type: 'invalid_request_error' } }, 422) })).toMatchObject({ state: 'candidate' });
    expect(await probeProviderProtocol(target, 'codex', { fetch: async () => json({ ok: true }) })).toMatchObject({ state: 'unknown' });
    expect(await probeProviderProtocol(target, 'codex', { fetch: async () => json({}, 404) })).toMatchObject({ state: 'unsupported' });
  });
});

describe('Model availability requires complete streaming tool evidence', () => {
  it.each(['claude', 'codex'] as const)('validates a real protocol-shaped %s stream with a callable tool', async (kind) => {
    const fake = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => streamed(kind === 'claude' ? claudeStream() : codexStream()));
    const result = await verifyProviderModel(target, kind, 'synthetic-model', { fetch: fake });
    expect(result).toMatchObject({ status: 'available', attempts: 1, failures: [] });
    const init = fake.mock.calls[0][1]!, request = JSON.parse(init.body as string);
    expect(request.stream).toBe(true); expect(request.tool_choice).toEqual(kind === 'claude' ? { type: 'auto' } : 'auto');
    if (kind === 'claude') {
      expect((init.headers as Record<string, string>)['anthropic-beta']).toBe('claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,thinking-display-updates-2026-08-18');
      expect(request.thinking).toEqual({ type: 'adaptive', display: 'updates' });
    }
    expect(init.redirect).toBe('error'); expect(JSON.stringify(result)).not.toContain(target.key);
  });

  it('retries a transient failure once and preserves its redacted original message', async () => {
    let attempt = 0;
    const result = await verifyProviderModel(target, 'codex', 'm', { fetch: async () => ++attempt === 1 ? json({ error: { message: `temporary ${target.key}` } }, 503) : streamed(codexStream()) });
    expect(result).toMatchObject({ status: 'available', attempts: 2, failures: [{ status: 503, message: 'temporary [redacted]' }] });
  });

  it('accepts a full Anthropic endpoint without duplicating v1 and uses exactly its selected auth mode', async () => {
    const fake = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => streamed(claudeStream()));
    expect((await verifyProviderModel({ ...target, authType: 'api-key', endpoints: { anthropic: 'https://synthetic.invalid/v1/messages' } }, 'claude', 'm', { fetch: fake })).status).toBe('available');
    expect(String(fake.mock.calls[0][0])).toBe('https://synthetic.invalid/v1/messages');
    expect(fake.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': target.key });
    expect(fake.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });

  it.each([401, 403, 404, 405])('does not repeat deterministic HTTP %s failures', async (status) => {
    const fake = vi.fn(async () => json({ error: { message: target.key } }, status));
    const result = await verifyProviderModel(target, 'codex', 'm', { fetch: fake });
    expect(result.status).toBe('unavailable'); expect(result.attempts).toBe(1); expect(fake.mock.calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(target.key);
  });

  it.each([
    claudeStream().replace(event('content_block_stop', { index: 0 }), ''),
    claudeStream().replace('tool_use', 'text'),
    claudeStream().slice(0, -1),
    claudeStream() + event('error', { error: { message: 'specific synthetic error' } }),
  ])('rejects incomplete, textual, truncated or failed Claude streams', async (text) => {
    const result = await verifyProviderModel(target, 'claude', 'm', { fetch: async () => streamed(text) });
    expect(result).toMatchObject({ status: 'unavailable', attempts: 2 });
  });

  it('does not accept missing/invalid Responses arguments or completion from another call', async () => {
    for (const text of [codexStream().replaceAll('"arguments":"{}"', '"arguments":"broken"'), codexStream().replace('"status":"completed"', '"status":"failed"')]) {
      expect((await verifyProviderModel(target, 'codex', 'm', { fetch: async () => streamed(text) })).status).toBe('unavailable');
    }
  });

  it('bounds both header wait and stalled body reads, and cancels oversized output', async () => {
    const stalledHeaders: typeof fetch = () => new Promise(() => undefined);
    const first = await verifyProviderModel(target, 'codex', 'm', { fetch: stalledHeaders, timeoutMs: 10 });
    expect(first).toMatchObject({ status: 'unavailable', attempts: 2, message: '服务不可达（请求超时）' });
    const cancel = vi.fn();
    const stalledBody: typeof fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: partial')); }, cancel }), { headers: { 'content-type': 'text/event-stream' } });
    expect((await verifyProviderModel(target, 'codex', 'm', { fetch: stalledBody, timeoutMs: 10 })).status).toBe('unavailable');
    expect(cancel).toHaveBeenCalled();
    expect((await verifyProviderModel(target, 'codex', 'm', { fetch: async () => streamed(codexStream()), maxBytes: 20 })).message).toBe('服务响应超过大小限制');
  });
});
