import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInput } from '@shared/ai-agents';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AgentService } from './agent-service';
import { AiProfileService } from './ai-profile-service';
import { ProviderService } from './provider-service';
import { AgentRuntimeService } from './agent-runtime';
import { providerTargetForTool, type ProviderTarget } from './provider-client';
import { buildCodexModelCatalog, CODEX_CATALOG_BASE_INSTRUCTIONS } from './codex-model-catalog';

const BASE = process.env.WILLYOU_TEST_TMPDIR??tmpdir();
const endpoints = { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425' };
const codexPath = '/v1/codex/models', claudePath = '/v1/models';
const codexBody = () => ({ models: [
  { slug: 'codex-only', display_name: 'Codex only', context_window: 384000,
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], default_reasoning_level: 'high',
    input_modalities: ['text', 'image'], support_verbosity: true,
    base_instructions: 'P1_REMOTE_INSTRUCTIONS_MUST_NOT_BE_USED', model_messages: { instructions_template: 'P1_REMOTE_TEMPLATE_MUST_NOT_BE_USED' } },
  { slug: 'shared', display_name: 'Shared Codex metadata', context_window: 256000 },
] });
const claudeBody = () => ({ data: [{ id: 'claude-only', display_name: 'Claude only', context_length: 200000 }, { id: 'shared', display_name: 'Shared Claude metadata', context_length: 64000 }] });
const input = (changes: Partial<ProviderInput> = {}): ProviderInput => ({ name: 'P1 canonical Magpie', preset: 'magpie', endpoints,
  models: [{ id: 'old-retained', name: 'Old retained' }], ...changes });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function toolStream(kind: 'claude' | 'codex') {
  const event = (type: string, value: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
  const item = { type: 'function_call', name: 'wy_ping', call_id: 'P1_SYNTHETIC', arguments: '{}' };
  return new Response(kind === 'claude' ? event('message_start', {}) + event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'P1_SYNTHETIC', name: 'wy_ping', input: {} } }) + event('content_block_stop', { index: 0 }) + event('message_stop', {}) : event('response.created', {}) + event('response.output_item.done', { item }) + event('response.completed', { response: { status: 'completed', output: [item] } }), { headers: { 'content-type': 'text/event-stream' } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let sqlite: Database.Database, db: ReturnType<typeof drizzle<typeof schema>>, agents: AgentService, secrets: SecretsStore;
let service: ProviderService, fixtureRoot: string;
let seen: { url: URL; init?: RequestInit; headers: Headers }[];
let route: (url: URL, init?: RequestInit) => Response | Promise<Response>;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Uninjected network forbidden'); }));
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite); db = drizzle(sqlite, { schema });
  secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: value => Buffer.from(`P1:${[...value].reverse().join('')}`), decrypt: value => [...value.toString().slice(3)].reverse().join('') });
  agents = new AgentService(db, secrets);
  agents.recordTools(['codex', 'claude'].map(kind => ({ id: kind, kind, executable: '/P1_NEVER_EXECUTE/' + kind, version: 'P1 synthetic', installed: true, login: 'none' as const })));
  fixtureRoot = realpathSync(mkdtempSync(join(BASE, 'fixture-'))); seen = [];
  route = (url, init) => {
    if (init?.method === 'POST') return toolStream(url.pathname.endsWith('/messages') ? 'claude' : 'codex');
    if (url.pathname === codexPath) return json(codexBody());
    if (url.pathname === claudePath) return json(claudeBody());
    throw Error('Unexpected synthetic URL ' + url);
  };
  service = new ProviderService(db, secrets, agents, { fetch: async (url, init) => {
    const parsed = new URL(String(url)); seen.push({ url: parsed, init, headers: new Headers(init?.headers) }); return route(parsed, init);
  } });
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); sqlite.close(); rmSync(fixtureRoot, { recursive: true, force: true }); vi.unstubAllGlobals(); });
const rawProvider = (id: string) => sqlite.prepare('SELECT * FROM ai_providers WHERE id=?').get(id) as Record<string,unknown>;

describe('Magpie exact canonical tool identity and full service/client integration', () => {
  it('always checks the canonical local Magpie catalog even if a draft marks its models manual',async()=>{
    const p=service.save(input({models:[{id:'shared',name:'Shared',catalogSource:'manual'}]}));
    await service.refreshForLaunch(p.id,'claude');
    expect(seen.map(x=>x.url.pathname)).toEqual([codexPath,claudePath]);
    expect(seen.every(x=>x.init?.method!=='POST')).toBe(true);
  });
  it.each(['direct', 'aggregate'] as const)('explains a stopped local Magpie for a %s connection refusal before launch', async shape => {
    const p = service.save(input());
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3425'), { code: 'ECONNREFUSED' });
    route = () => { throw new TypeError('fetch failed', { cause: shape === 'direct' ? refused : new AggregateError([refused]) }); };
    await expect(service.refresh(p.id)).rejects.toThrow('Magpie 未运行');
    expect(seen).toHaveLength(1);
    expect(seen[0].url.pathname).toBe(codexPath);
  });
  it('preserves gateway authentication failures and does not call a remote provider a stopped Magpie', async () => {
    const local = service.save(input());
    route = () => json({ error: { message: 'denied' } }, 401);
    await expect(service.refresh(local.id)).rejects.toThrow('Key 可能无效');
    const remote = service.save(input({ name: 'Remote', preset: null, endpoints: { responses: 'https://provider.invalid/v1' }, key: 'PUBLIC_REMOTE_KEY' }));
    route = () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }); };
    await expect(service.refresh(remote.id)).rejects.toThrow('fetch failed');
  });
  it.each(['magpie', 'magpie-codex', 'magpie-claude'])('selects public token by kind from %s without mutating the original target', key => {
    const target: ProviderTarget = { endpoints, key, authType: 'bearer', preset: 'magpie' };
    expect(providerTargetForTool(target, 'codex').key).toBe('magpie-codex');
    expect(providerTargetForTool(target, 'claude').key).toBe('magpie-claude'); expect(target.key).toBe(key);
  });
  it('keeps a user-owned private gateway key unchanged for both tools', () => {
    const target: ProviderTarget = { endpoints, key: 'P1_PRIVATE_GATEWAY_KEY', authType: 'bearer', preset: 'magpie' };
    expect(providerTargetForTool(target, 'codex').key).toBe(target.key); expect(providerTargetForTool(target, 'claude').key).toBe(target.key);
  });
  it('fetches distinct scoped catalogs with exact public auth, unions models and keeps Codex metadata instead of remote instructions', async () => {
    const p = service.save(input()), refreshed = await service.refresh(p.id);
    expect(seen.map(item => item.url.pathname)).toEqual([codexPath, claudePath]);
    expect(seen[0].url.searchParams.get('client_version')).toBe('0.167.1'); expect(seen[1].url.search).toBe('');
    expect(seen.map(item => item.headers.get('Authorization'))).toEqual(['Bearer magpie-codex', 'Bearer magpie-claude']);
    expect(seen.every(item => item.init?.redirect === 'error')).toBe(true);
    const codex = refreshed.models.find(model => model.id === 'codex-only')!, claude = refreshed.models.find(model => model.id === 'claude-only')!, shared = refreshed.models.find(model => model.id === 'shared')!;
    expect(codex.availability).toEqual({ codex: 'untested', claude: 'unavailable' }); expect(claude.availability).toEqual({ codex: 'unavailable', claude: 'untested' });
    expect(shared.availability).toEqual({ codex: 'untested', claude: 'untested' }); expect(shared.contextWindow).toBe(256000);
    expect(codex.codex).toEqual({ reasoningLevels: ['low', 'high'], defaultReasoning: 'high', inputModalities: ['text', 'image'], supportVerbosity: true });
    const nativeCatalog = buildCodexModelCatalog(refreshed.models, ['codex-only']);
    expect(nativeCatalog.models[0].base_instructions).toBe(CODEX_CATALOG_BASE_INSTRUCTIONS); expect(JSON.stringify(refreshed)).not.toContain('P1_REMOTE_');
    expect(JSON.stringify(nativeCatalog)).not.toContain('P1_REMOTE_'); expect(agents.configs()).toEqual([]);
  });
  it('allows the Magpie-only 8MiB default budget to receive a catalog larger than the generic 2MiB cap', async () => {
    route = url => url.pathname === codexPath ? json({ ...codexBody(), ignored_padding: 'P'.repeat(2 * 1024 * 1024 + 100) }) : json(claudeBody());
    const p = service.save(input()); expect((await service.refresh(p.id)).models.some(model => model.id === 'codex-only')).toBe(true);
  });
  it('rejects declared response larger than 8MiB and preserves the committed old directory', async () => {
    const p = service.save(input()), old = rawProvider(p.id);
    route = () => json(codexBody(), 200, { 'content-length': String(8 * 1024 * 1024 + 1) });
    await expect(service.refresh(p.id)).rejects.toThrow('超过大小限制'); expect(rawProvider(p.id)).toEqual(old);
  });
  it.each(['1', '7', 'invalid'])('rejects X-Magpie-Left-Out=%s and preserves old directory', async leftOut => {
    const p = service.save(input()), old = rawProvider(p.id);
    route = () => json(codexBody(), 200, { 'X-Magpie-Left-Out': leftOut });
    await expect(service.refresh(p.id)).rejects.toThrow('截断'); expect(rawProvider(p.id)).toEqual(old);
  });
  it('accepts an explicit zero left-out header without downgrading the scoped union', async () => {
    const p = service.save(input()); route = url => json(url.pathname === codexPath ? codexBody() : claudeBody(), 200, { 'X-Magpie-Left-Out': '0' });
    expect((await service.refresh(p.id)).models.filter(model => !model.offline).map(model => model.id).sort()).toEqual(['claude-only', 'codex-only', 'shared']);
  });
  it.each([401, 404])('does not commit the first scoped catalog when the second catalog returns %i', async status => {
    const p = service.save(input()), old = rawProvider(p.id);
    route = url => url.pathname === codexPath ? json(codexBody()) : json({ error: { message: 'P1 scoped catalog unavailable' } }, status);
    await expect(service.refresh(p.id)).rejects.toThrow(); expect(rawProvider(p.id)).toEqual(old); expect(seen).toHaveLength(2);
  });
  // T052: a successful empty directory is different from failed I/O.
  // The earlier preparation's stronger empty-refresh rejection was corrected
  // against the requirement; its original red evidence remains archived.
  it('marks missing models offline after successful empty scopes while retaining their metadata and Provider identity', async () => {
    const p=service.save(input()),old=rawProvider(p.id);
    route=url=>json(url.pathname===codexPath?{models:[]}:{data:[]});
    const refreshed=await service.refresh(p.id),after=rawProvider(p.id);
    expect(refreshed.models).toEqual(p.models.map(m=>({...m,offline:true})));
    expect({...after,models:old.models,refreshed_at:old.refreshed_at,updated_at:old.updated_at}).toEqual(old);
  });
  it('discards a late scoped union after credential identity editing and preserves the newly saved state', async () => {
    const p = service.save(input()), entered = deferred<void>(), release = deferred<Response>();
    route = url => { if (url.pathname === codexPath) { entered.resolve(); return release.promise; } return json(claudeBody()); };
    const running = service.refresh(p.id); const rejected = expect(running).rejects.toThrow('已变更'); await entered.promise;
    service.save(input({ key: 'P1_NEW_GATEWAY_KEY', models: [{ id: 'edited', name: 'Edited retained' }] }), p.id); const changed = rawProvider(p.id);
    release.resolve(json(codexBody())); await rejected; expect(rawProvider(p.id)).toEqual(changed);
  });
  it('removes a vanished tool scope and its successful check, then returns a reappearing scope as untested', async () => {
    const p = service.save(input()); await service.refresh(p.id); await service.check(p.id, 'codex', 'shared'); await service.check(p.id, 'claude', 'shared');
    expect(agents.providers()[0].models.find(model => model.id === 'shared')!.availability).toEqual({ codex: 'available', claude: 'available' });
    route = (url, init) => init?.method === 'POST' ? toolStream('claude') : url.pathname === codexPath ? json({ models: [codexBody().models[0]] }) : json(claudeBody());
    const gone = (await service.refresh(p.id)).models.find(model => model.id === 'shared')!;
    expect(gone.availability).toEqual({ codex: 'unavailable', claude: 'available' }); expect(gone.checks?.codex).toBeUndefined(); expect(gone.checks?.claude?.status).toBe('available');
    expect(() => buildCodexModelCatalog([gone], ['shared'])).toThrow('不可用');
    route = url => json(url.pathname === codexPath ? codexBody() : claudeBody());
    const back = (await service.refresh(p.id)).models.find(model => model.id === 'shared')!;
    expect(back.availability.codex).toBe('untested'); expect(back.checks?.codex).toBeUndefined();
  });
  it.each(['codex', 'claude'] as const)('hands the exact public %s token through runtimeConnection into a real generated Agent plan', async kind => {
    const p = service.save(input()); await service.refresh(p.id);
    const model = kind === 'codex' ? 'codex-only' : 'claude-only';
    const config = agents.saveConfig({ name: 'P1 Magpie ' + kind, toolId: kind, source: 'provider', providerId: p.id, models: [model], defaultModel: model });
    const connection = service.runtimeConnection(p.id, kind); expect(connection.target.preset).toBe('magpie'); expect(connection.target.key).toBe('magpie-' + kind);
    const userData = join(fixtureRoot, 'userdata'), cwd = join(fixtureRoot, 'project'); mkdirSync(userData); mkdirSync(cwd);
    const runtime = new AgentRuntimeService({ db, agents, providers: service, profiles: new AiProfileService(db, secrets), tools: { refresh: async () => [] }, userData, baseEnv: () => ({ HOME: fixtureRoot }) });
    const prepared = await runtime.prepare({ profileId: config.id, cwd, permission: 'ask', signal: new AbortController().signal });
    expect(prepared?.profile.env[kind === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_AUTH_TOKEN']).toBe('magpie-' + kind); prepared?.assertCurrent();
    const rows = sqlite.prepare('SELECT * FROM app_secrets').all(); expect(rows).toEqual([]);
  });
  it.each(['http://192.0.2.1:3425', 'http://localhost:3425', 'http://127.0.0.1:9999'])('does not invent a public fallback for noncanonical endpoint %s', async base => {
    const p = service.save(input({ endpoints: { responses: base + '/v1', anthropic: base } }));
    expect(p.hasKey).toBe(false); await expect(service.refresh(p.id)).rejects.toThrow('填写 Key'); expect(seen).toEqual([]);
    expect(() => service.runtimeConnection(p.id, 'claude')).toThrow('填写 Key');
  });
  it('refuses public-token remapping for the remote half of a mixed canonical/remote Provider', async () => {
    const p = service.save(input({ endpoints: { responses: endpoints.responses, anthropic: 'http://192.0.2.1:3425' } }));
    expect(service.runtimeConnection(p.id, 'codex').target.key).toBe('magpie-codex');
    expect(() => service.runtimeConnection(p.id, 'claude')).toThrow('非本机');
    await service.refresh(p.id); expect(seen).toHaveLength(1); expect(seen[0].url.hostname).toBe('127.0.0.1');
  });
  it('keeps explicit remote private-key auth without substituting public tokens', async () => {
    const p = service.save(input({ key: 'P1_REMOTE_PRIVATE_KEY', endpoints: { responses: 'http://192.0.2.1:3425/v1' } }));
    route = () => json({ data: [{ id: 'remote-model' }] }); await service.refresh(p.id);
    expect(seen[0].headers.get('Authorization')).toBe('Bearer P1_REMOTE_PRIVATE_KEY'); expect(service.runtimeConnection(p.id, 'codex').target.key).toBe('P1_REMOTE_PRIVATE_KEY');
  });
});
