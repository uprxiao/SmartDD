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

it('checks a complete Gemini tool round trip and keeps a failed return unavailable per model', async () => {
  const gemini = { ...target, endpoints: { gemini: 'https://synthetic.invalid/api/v1beta' } };
  const tool = { functionCall: { name: 'wy_ping', id: 'probe-id', args: {} }, thoughtSignature: 'probe-signature' };
  const frame = (...parts: unknown[]) => streamed(`data: ${JSON.stringify({
    candidates: [{ index: 0, content: { role: 'model', parts }, finishReason: 'STOP' }],
  })}\n\n`);
  const fake = vi.fn(async (address: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(address));
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(gemini.key);
    expect(url.searchParams.get('alt')).toBe('sse');
    expect(url.pathname).toMatch(/^\/api\/v1beta\/models\/gemini-4-(?:carbon|argon):streamGenerateContent$/);
    const body = JSON.parse(String(init?.body));
    if (body.contents.length === 1) {
      expect(body.toolConfig.functionCallingConfig.mode).toBe('ANY');
      return frame({ thought: true, text: 'Synthetic intermediate reasoning' }, { text: 'Checking connectivity' }, tool);
    }
    // Match the gateway's tool continuation contract and preserve the call signature.
    if (body.toolConfig || JSON.stringify(body.contents[1]?.parts) !== JSON.stringify([tool])) {
      return json({ error: { message: 'Invalid tool continuation' } }, 400);
    }
    const result = body.contents.at(-1).parts[0].functionResponse;
    expect(result).toMatchObject({ name: 'wy_ping', id: 'probe-id' });
    return frame({ text: url.pathname.includes('-carbon') ? result.response.value : 'Basic text worked' });
  });
  await expect(verifyProviderModel(gemini, 'antigravity', 'gemini-4-carbon', { fetch: fake })).resolves.toMatchObject({ status: 'available', attempts: 1 });
  await expect(verifyProviderModel(gemini, 'antigravity', 'gemini-4-argon', { fetch: fake })).resolves.toMatchObject({ status: 'unavailable', attempts: 2, message: 'Gemini 未确认测试工具的回传结果' });
  expect(fake).toHaveBeenCalledTimes(6);
});

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
  it('reads reasoning levels declared by the Anthropic catalog without reusing Responses levels', async () => {
    const data = [
      { id: 'documented', capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: false }, high: { supported: true }, default_level: 'high' } }, supported_reasoning_levels: ['ultra'] },
      { id: 'responses-only', supported_reasoning_levels: ['medium', 'high'] },
    ];
    const models = await fetchProviderModels({ ...target, endpoints: { anthropic: target.endpoints.anthropic } }, { fetch: async () => json({ data }) });
    expect(models[0].claude).toEqual({ reasoningLevels: ['low', 'high'], defaultReasoning: 'high' });
    expect(models[1].claude).toBeUndefined();
    const otherRoute = await fetchProviderModels({ ...target, endpoints: { responses: target.endpoints.responses } }, { fetch: async () => json({ data }) });
    expect(otherRoute.every(model => model.claude === undefined)).toBe(true);
  });

  it('classifies mixed gateway catalogs without treating image input as image generation', async () => {
    const models = await fetchProviderModels(target, { fetch: async () => json({ data: [
      { id: 'glm-5.1', owned_by: '智谱' },
      { id: 'gemini-3.1-pro', owned_by: 'Gemini', input_modalities: ['text', 'image'] },
      { id: 'wan3.0-video', owned_by: '千问万相' },
      { id: 'gemini-nano-banana-2.1', model_type: 'LLM' },
      { id: 'claude-sonnet-4-6', owned_by: 'system' },
      { id: 'private-model', owned_by: 'openai-compatible' },
      { id: 'gpt-custom', owned_by: 'Anthropic' },
      { id: 'custom-image-tool', output_modalities: ['image'] },
      { id: 'custom-text-model', output_modalities: ['text', 'image'] },
      { id: 'custom-embedding', type: 'embedding' },
    ] }) });
    expect(models.map(({id,vendor,purpose})=>({id,vendor,purpose}))).toEqual([
      { id: 'glm-5.1', vendor: '智谱', purpose: 'conversation' },
      { id: 'gemini-3.1-pro', vendor: 'Google', purpose: 'conversation' },
      { id: 'wan3.0-video', vendor: '阿里云', purpose: 'video' },
      { id: 'gemini-nano-banana-2.1', vendor: 'Google', purpose: 'image' },
      { id: 'claude-sonnet-4-6', vendor: 'Anthropic', purpose: 'conversation' },
      { id: 'private-model', vendor: undefined, purpose: undefined },
      { id: 'gpt-custom', vendor: undefined, purpose: 'conversation' },
      { id: 'custom-image-tool', vendor: undefined, purpose: 'image' },
      { id: 'custom-text-model', vendor: undefined, purpose: 'conversation' },
      { id: 'custom-embedding', vendor: undefined, purpose: 'embedding' },
    ]);
  });

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
