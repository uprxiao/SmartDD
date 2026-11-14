import { verifiedPresetProtocol } from '@shared/ai-provider-presets';
import { CODEX_CATALOG_VERSION } from './codex-model-catalog';
import type { CodeAgentKind, ProviderModel } from '@shared/ai-agents';

export interface ProviderTarget {
  endpoints: { anthropic?: string; responses?: string; openai?: string };
  key: string;
  authType: 'bearer' | 'api-key';
  preset?: string | null;
}
export interface ProviderClientOptions { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }
export interface ModelCheckResult {
  status: 'available' | 'unavailable';
  attempts: number;
  durationMs: number;
  message: string;
  failures: { status: number | null; message: string }[];
}

// Verified default-permission Claude Code 2.1.322 profile, M13 T090 same-input observation (2026-11-13).
export const CLAUDE_PROTOCOL_VERSION = '2.1.322';
export const CLAUDE_PROTOCOL_BETAS = 'claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,thinking-display-updates-2026-08-18';
const PROBE_TOOL = 'wy_ping';

export class ProviderRequestError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly networkCode: 'ECONNREFUSED' | null = null) { super(message); }
}

function connectionRefused(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false;
  const cause = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (cause.code === 'ECONNREFUSED') return true;
  if (Array.isArray(cause.errors) && cause.errors.length) return cause.errors.every(item => connectionRefused(item, depth + 1));
  return connectionRefused(cause.cause, depth + 1);
}

const secretForms = (key: string) => new Set([key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]);
function containsCredential(value: string, key: string): boolean {
  return [...secretForms(key)].some((secret) => Boolean(secret) && value.includes(secret));
}
function redact(value: string, key: string): string {
  let text = value;
  for (const secret of secretForms(key)) if (secret) text = text.split(secret).join('[redacted]');
  return text.slice(0, 4096);
}

function serviceUrl(base: string, resource: string): string {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new ProviderRequestError('服务地址无效');
  url.pathname = `${url.pathname.replace(/\/(?:models|messages|responses)\/?$/, '').replace(/\/$/, '')}/${resource}`;
  return url.toString();
}

function auth(target: ProviderTarget, kind?: CodeAgentKind): Record<string, string> {
  return kind === 'claude' && target.authType === 'api-key' ? { 'x-api-key': target.key } : { Authorization: `Bearer ${target.key}` };
}

function protocolUrl(base: string, kind: CodeAgentKind): string {
  if (kind === 'codex') return serviceUrl(base, 'responses');
  const path = new URL(base).pathname;
  return serviceUrl(base, /\/(?:v1|messages)\/?$/.test(path) ? 'messages' : 'v1/messages');
}

async function request(target: ProviderTarget, url: string, init: RequestInit, options: ProviderClientOptions): Promise<{ status: number; text: string; media: string; leftOut:string|null }> {
  const timeoutMs = options.timeoutMs ?? 15000, maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new ProviderRequestError('请求预算无效');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new ProviderRequestError('服务不可达（请求超时）')), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abort: (() => void) | undefined;
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason instanceof ProviderRequestError ? signal.reason : new ProviderRequestError('请求已取消'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const response = await Promise.race([(options.fetch ?? fetch)(url, { ...init, redirect: 'error', signal }), canceled]);
    const media = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ProviderRequestError('服务响应超过大小限制', response.status);
    if (!response.body) return { status: response.status, text: '', media, leftOut:response.headers.get('x-magpie-left-out') };
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
    while (true) {
      const part = await Promise.race([reader.read(), canceled]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new ProviderRequestError('服务响应超过大小限制', response.status);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    if (declared !== null && bytes !== Number(declared)) throw new ProviderRequestError('服务响应未完整接收', response.status);
    return { status: response.status, text, media, leftOut:response.headers.get('x-magpie-left-out') };
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    if (signal.aborted) throw signal.reason instanceof ProviderRequestError ? signal.reason : new ProviderRequestError('请求已取消');
    throw new ProviderRequestError(redact(error instanceof Error ? error.message : '服务不可达', target.key), null, connectionRefused(error) ? 'ECONNREFUSED' : null);
  } finally {
    clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort);
    void reader?.cancel().catch(() => undefined);
  }
}

function responseError(status: number, text: string, key: string): ProviderRequestError {
  if (status === 401) return new ProviderRequestError('Key 可能无效', status);
  if (status === 403) return new ProviderRequestError('服务拒绝访问', status);
  let message = text;
  try { const value = JSON.parse(text), candidate = value?.error?.message ?? value?.message; if (typeof candidate === 'string') message = candidate; } catch { /* Preserve bounded original text. */ }
  return new ProviderRequestError(redact(message || `服务返回 HTTP ${status}`, key), status);
}

function sse(text: string): { type: string; value: Record<string, unknown> }[] {
  const normalized = text.replaceAll('\r\n', '\n');
  if (normalized.trim() && !normalized.endsWith('\n\n')) throw new ProviderRequestError('流式响应被截断');
  const events: { type: string; value: Record<string, unknown> }[] = [];
  for (const block of normalized.split('\n\n')) {
    const lines = block.split('\n'), data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    let value: Record<string, unknown>;
    try { value = JSON.parse(data); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); }
    catch { throw new ProviderRequestError('流式事件 JSON 无效'); }
    const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || String(value.type ?? '');
    if (type === 'error' || type === 'response.failed' || type === 'response.error') {
      const failure = value.error as { message?: unknown } | undefined;
      const response = value.response as { error?: { message?: unknown } } | undefined;
      const message = failure?.message ?? response?.error?.message ?? value.message;
      throw new ProviderRequestError(typeof message === 'string' ? message : '流式服务返回错误事件');
    }
    events.push({ type, value });
  }
  return events;
}

function confirmsTool(kind: CodeAgentKind, text: string): boolean {
  const events = sse(text);
  if (kind === 'claude') {
    let started = false, finished = false; const toolIndexes = new Set<number>(), stopped = new Set<number>();
    const inputs = new Map<number, { initial: unknown; delta: string }>();
    for (const event of events) {
      if (event.type === 'message_start') started = true;
      if (event.type === 'content_block_start' && started) {
        const block = event.value.content_block as Record<string, unknown> | undefined;
        if (block?.type === 'tool_use' && block.name === PROBE_TOOL && typeof event.value.index === 'number') {
          toolIndexes.add(event.value.index); inputs.set(event.value.index, { initial: block.input, delta: '' });
        }
      }
      if (event.type === 'content_block_delta' && typeof event.value.index === 'number') {
        const input = inputs.get(event.value.index), delta = event.value.delta as { type?: string; partial_json?: string } | undefined;
        if (input && delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') input.delta += delta.partial_json;
      }
      if (event.type === 'content_block_stop' && typeof event.value.index === 'number' && toolIndexes.has(event.value.index)) stopped.add(event.value.index);
      if (event.type === 'message_stop' && started && toolIndexes.size === 1 && stopped.size === 1) finished = true;
    }
    return started && finished && toolIndexes.size === 1 && stopped.size === 1 && [...inputs.values()].every((input) => {
      try { const value = input.delta ? JSON.parse(input.delta) : input.initial; return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0; } catch { return false; }
    });
  }
  const calls = new Set<string>(); let started = false, completed = false;
  for (const event of events) {
    if (event.type === 'response.created') started = true;
    if (event.type === 'response.output_item.done' && started) {
      const item = event.value.item as Record<string, unknown> | undefined;
      if (item?.type === 'function_call' && item.name === PROBE_TOOL && typeof item.call_id === 'string' && typeof item.arguments === 'string') {
        try { const value = JSON.parse(item.arguments); if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) calls.add(item.call_id); } catch { /* Invalid arguments are not a callable tool. */ }
      }
    }
    if (event.type === 'response.completed' && started && calls.size === 1) {
      const response = event.value.response as { status?: string; output?: { type?: string; name?: string; call_id?: string }[] } | undefined;
      completed = response?.status === 'completed' && Array.isArray(response.output) && response.output.some((item) => item.type === 'function_call' && item.name === PROBE_TOOL && calls.has(item.call_id ?? ''));
    }
  }
  return started && completed && calls.size === 1;
}

/** Magpie loopback tokens are public gateway identities, not upstream keys.
 * Do not rewrite user-supplied private keys or noncanonical/LAN endpoints. */
export function providerTargetForTool(target:ProviderTarget,kind:CodeAgentKind):ProviderTarget {
  if(target.preset==='magpie'&&['magpie','magpie-codex','magpie-claude'].includes(target.key)){
    if(!verifiedPresetProtocol(target.preset,target.endpoints,kind))throw new ProviderRequestError('非本机 Magpie 地址需要单独填写 Key');
    return {...target,key:`magpie-${kind}`};
  }
  return target;
}
function decodeProviderModels(body:unknown,key:string):ProviderModel[]{
  const rows = (body as { data?: unknown; models?: unknown })?.data ?? (body as { models?: unknown })?.models;
  if (!Array.isArray(rows)) throw new ProviderRequestError('模型列表格式无法识别');
  const found = new Map<string, ProviderModel>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>, id = row.id ?? row.slug;
    if (typeof id !== 'string' || !id.trim() || id.trim() !== id || id.length > 256 || id.startsWith('-') || /[\x00-\x1f\x7f]/.test(id)) continue;
    if (containsCredential(id, key)) throw new ProviderRequestError('模型目录包含认证值，已拒绝保存');
    const context = row.context_window ?? row.context_length;
    const rawName = row.display_name ?? row.name ?? id;
    const name = typeof rawName === 'string' && rawName.trim() ? redact(rawName.trim(), key).slice(0, 256) : id;
    const effort = row.effort as { supported_levels?: unknown; default_level?: unknown } | undefined;
    const rawLevels = Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : Array.isArray(effort?.supported_levels) ? effort.supported_levels : [];
    const reasoningLevels = rawLevels.map((value) => typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { effort?: unknown }).effort : null)
      .filter((value): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value)).slice(0, 16);
    const defaultReasoning = row.default_reasoning_level ?? effort?.default_level;
    const inputModalities = Array.isArray(row.input_modalities) ? row.input_modalities.filter((value): value is 'text' | 'image' | 'audio' => ['text', 'image', 'audio'].includes(String(value))) : [];
    found.set(id, { id, name,
      contextWindow: typeof context === 'number' && Number.isSafeInteger(context) && context > 0 ? context : null,
      offline: false, availability: { claude: 'untested', codex: 'untested' },
      codex: { reasoningLevels, defaultReasoning: typeof defaultReasoning === 'string' && reasoningLevels.includes(defaultReasoning) ? defaultReasoning : null,
    inputModalities: inputModalities.length ? inputModalities : ['text'], supportVerbosity: row.support_verbosity === true } });
    if (found.size > 4096) throw new ProviderRequestError('模型数量超过本次目录预算');
  }
  const models = [...found.values()];
  if (containsCredential(JSON.stringify(models), key)) throw new ProviderRequestError('模型目录包含认证值，已拒绝保存');
  return models;
}
async function fetchMagpieModels(target:ProviderTarget,options:ProviderClientOptions):Promise<ProviderModel[]>{
  const indexes=new Map<CodeAgentKind,ProviderModel[]>();
  for(const kind of ['codex','claude'] as const){
    if(!verifiedPresetProtocol('magpie',target.endpoints,kind))continue;
    const scoped=providerTargetForTool(target,kind),base=kind==='codex'?target.endpoints.responses!:target.endpoints.anthropic!;
    const url=new URL(serviceUrl(base,kind==='codex'?'codex/models':'v1/models'));
    if(kind==='codex')url.searchParams.set('client_version',CODEX_CATALOG_VERSION);
    let response;
    try{response=await request(scoped,url.toString(),{headers:{...auth(scoped,kind),Accept:'application/json'}},{...options,maxBytes:options.maxBytes??8*1024*1024});}
    catch(error){
      if(error instanceof ProviderRequestError&&error.networkCode==='ECONNREFUSED')throw new ProviderRequestError('Magpie 未运行，请先启动本机 Magpie。',null,'ECONNREFUSED');
      throw error;
    }
    if(response.status<200||response.status>=300)throw responseError(response.status,response.text,scoped.key);
    if(response.leftOut!==null&&response.leftOut!=='0')throw new ProviderRequestError('Magpie 模型目录被截断，请升级网关或减少模型后重试');
    let body:unknown;try{body=JSON.parse(response.text);}catch{throw new ProviderRequestError('模型列表 JSON 无效');}
    indexes.set(kind,decodeProviderModels(body,scoped.key));
  }
  const merged=new Map<string,ProviderModel>();
  for(const [kind,models]of indexes)for(const model of models){
    const existing=merged.get(model.id);
    if(existing){existing.availability[kind]='untested';if(kind==='codex'){existing.codex=model.codex;existing.contextWindow=model.contextWindow??existing.contextWindow;}}
    else merged.set(model.id,{...model,availability:{claude:kind==='claude'?'untested':'unavailable',codex:kind==='codex'?'untested':'unavailable'}});
  }
  if(merged.size>4096)throw new ProviderRequestError('模型数量超过本次目录预算');
  return [...merged.values()];
}

export async function fetchProviderModels(target: ProviderTarget, options: ProviderClientOptions = {}): Promise<ProviderModel[]> {
  if(target.preset==='magpie'&&(['codex','claude'] as const).some(kind=>verifiedPresetProtocol('magpie',target.endpoints,kind)))return fetchMagpieModels(target,options);
  const endpoints = Object.entries(target.endpoints).filter((entry): entry is [string, string] => Boolean(entry[1]));
  let last: ProviderRequestError | undefined;
  for (const [protocol, base] of endpoints) {
    const first = serviceUrl(base, 'models');
    const paths = /\/v1\/models$/.test(new URL(first).pathname) ? [first] : [...new Set([first, serviceUrl(base, 'v1/models')])];
    for (const url of paths) {
      const response = await request(target, url, { headers: { ...auth(target, protocol === 'anthropic' ? 'claude' : 'codex'), Accept: 'application/json', 'anthropic-version': '2023-06-01' } }, options);
      if (response.status === 404) { last = responseError(404, response.text, target.key); continue; }
      if (response.status < 200 || response.status >= 300) throw responseError(response.status, response.text, target.key);
      let body: unknown; try { body = JSON.parse(response.text); } catch { throw new ProviderRequestError('模型列表 JSON 无效'); }
      const found=new Map(decodeProviderModels(body,target.key).map(model=>[model.id,model])),cursors=new Set<string>();
      let page=1;
      while((body as {has_more?:unknown})?.has_more===true){
        const cursor=(body as {last_id?:unknown}).last_id;
        if(page++>=16||typeof cursor!=='string'||!found.has(cursor)||cursors.has(cursor))throw new ProviderRequestError('模型目录分页不完整，未保存部分结果');
        cursors.add(cursor);const next=new URL(url);next.searchParams.set('after_id',cursor);
        const result=await request(target,next.toString(),{headers:{...auth(target,protocol==='anthropic'?'claude':'codex'),Accept:'application/json','anthropic-version':'2023-06-01'}},options);
        if(result.status<200||result.status>=300)throw responseError(result.status,result.text,target.key);
        try{body=JSON.parse(result.text);}catch{throw new ProviderRequestError('模型列表 JSON 无效');}
        for(const model of decodeProviderModels(body,target.key))found.set(model.id,model);
        if(found.size>4096)throw new ProviderRequestError('模型数量超过本次目录预算');
      }
      return [...found.values()];
    }
  }
  throw last ?? new ProviderRequestError('没有可读取模型列表的服务地址');
}

export async function verifyProviderModel(target: ProviderTarget, kind: CodeAgentKind, model: string, options: ProviderClientOptions = {}): Promise<ModelCheckResult> {
  target=providerTargetForTool(target,kind);
  const started = Date.now(), failures: ModelCheckResult['failures'] = [];
  const base = kind === 'claude' ? target.endpoints.anthropic : target.endpoints.responses;
  if (!base) return { status: 'unavailable', attempts: 0, durationMs: 0, message: '该供应商没有所需协议', failures: [] };
  if (!model.trim() || model.length > 256 || /^[\s-]/.test(model) || /[\x00-\x1f\x7f]/.test(model)) throw new ProviderRequestError('模型 ID 无效');
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (options.signal?.aborted) throw new ProviderRequestError('请求已取消');
      const body = kind === 'claude' ? { model, max_tokens: 4096, stream: true, thinking: { type: 'adaptive', display: 'updates' },
        messages: [{ role: 'user', content: `Call the ${PROBE_TOOL} tool exactly once.` }],
        tools: [{ name: PROBE_TOOL, description: 'Synthetic connectivity check.', input_schema: { type: 'object', properties: {}, additionalProperties: false } }], tool_choice: { type: 'auto' } } :
        { model, stream: true, input: `Call the ${PROBE_TOOL} tool exactly once.`, tools: [{ type: 'function', name: PROBE_TOOL, description: 'Synthetic connectivity check.', parameters: { type: 'object', properties: {}, additionalProperties: false }, strict: true }], tool_choice: 'auto' };
      const url = protocolUrl(base, kind);
      const response = await request(target, url, { method: 'POST', headers: { ...auth(target, kind), 'Content-Type': 'application/json', Accept: 'text/event-stream',
        ...(kind === 'claude' ? { 'anthropic-version': '2023-06-01', 'anthropic-beta': CLAUDE_PROTOCOL_BETAS } : {}) }, body: JSON.stringify(body) }, { ...options, timeoutMs: options.timeoutMs ?? 60000 });
      if (response.status < 200 || response.status >= 300) throw responseError(response.status, response.text, target.key);
      if (response.media !== 'text/event-stream' || !confirmsTool(kind, response.text)) throw new ProviderRequestError('模型没有完成所需的流式工具调用');
      return { status: 'available', attempts: attempt, durationMs: Date.now() - started, message: '流式工具调用验证通过', failures };
    } catch (error) {
      const failure = error instanceof ProviderRequestError ? error : new ProviderRequestError('服务请求失败');
      failures.push({ status: failure.status, message: redact(failure.message, target.key) });
      if (options.signal?.aborted || [401, 403, 404, 405].includes(failure.status ?? 0)) break;
    }
  }
  return { status: 'unavailable', attempts: failures.length, durationMs: Date.now() - started, message: failures.at(-1)?.message ?? '验证失败', failures };
}

/** Empty probes identify candidates only. A successful model-tool check is still required. */
export async function probeProviderProtocol(target: ProviderTarget, kind: CodeAgentKind, options: ProviderClientOptions = {}): Promise<{ state: 'candidate' | 'unsupported' | 'unknown'; status: number; message: string }> {
  target=providerTargetForTool(target,kind);
  const base = kind === 'claude' ? target.endpoints.anthropic : target.endpoints.responses;
  if (!base) return { state: 'unsupported', status: 0, message: '未填写该协议地址' };
  const url = protocolUrl(base, kind);
  const response = await request(target, url, { method: 'POST', headers: { ...auth(target, kind), 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }, body: '{}' }, options);
  if (response.status === 401 || response.status === 403) throw responseError(response.status, response.text, target.key);
  if ([404, 405].includes(response.status)) return { state: 'unsupported', status: response.status, message: '接口不存在' };
  let body: { type?: string; error?: { type?: string } } = {};
  try { body = JSON.parse(response.text); } catch { /* Unknown response is not a protocol confirmation. */ }
  const signature = kind === 'claude' ? body?.type === 'error' && typeof body.error?.type === 'string' : typeof body?.error?.type === 'string';
  return signature && [400, 422].includes(response.status) ? { state: 'candidate', status: response.status, message: '候选协议，需验证模型工具调用' } : { state: 'unknown', status: response.status, message: '不能据此确认协议' };
}
