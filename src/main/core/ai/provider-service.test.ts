import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderInput } from '@shared/ai-agents';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AgentService } from './agent-service';
import { ProviderService } from './provider-service';

let sqlite: Database.Database, agents: AgentService, db: ReturnType<typeof drizzle<typeof schema>>, secrets: SecretsStore;
beforeEach(() => {
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON'); runBundledMigrations(sqlite);
  db = drizzle(sqlite, { schema });
  secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (value) => Buffer.from(`encrypted:${value}`), decrypt: (value) => value.toString().slice(10) });
  agents = new AgentService(db, secrets, () => 1000);
  agents.recordTool({ id: 'codex', kind: 'codex', executable: '/synthetic/codex', installed: true, login: 'none', version: 'synthetic' });
});
afterEach(() => sqlite.close());
const input = (changes: Partial<ProviderInput> = {}): ProviderInput => ({ name: 'Synthetic', key: 'PUBLIC_PROVIDER_TEST',
  endpoints: { responses: 'https://synthetic.invalid/v1', anthropic: 'https://synthetic.invalid' },
  models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], ...changes });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function stream(kind: 'claude' | 'codex') {
  const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const item = { type: 'function_call', name: 'wy_ping', call_id: 'synthetic-call', arguments: '{}' };
  const body = kind === 'claude' ? event('message_start', {}) + event('content_block_start', { index: 0, content_block: { type: 'tool_use', name: 'wy_ping', id: 'synthetic-tool', input: {} } }) + event('content_block_stop', { index: 0 }) + event('message_stop', {}) :
    event('response.created', {}) + event('response.output_item.done', { item }) + event('response.completed', { response: { status: 'completed', output: [item] } });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

it('merges directory changes without losing per-tool checks or selected config identities', async () => {
  const old = agents.saveProvider(input({ models: [
    { id: 'a', name: 'A', availability: { claude: 'available', codex: 'unavailable' } },
    { id: 'b', name: 'B', availability: { claude: 'unavailable', codex: 'available' } },
  ] }));
  const service = new ProviderService(db, secrets, agents, { fetch: async () => json({ data: [{ id: 'a' }, { id: 'c' }] }) }, () => 2000);
  const refreshed = await service.refresh(old.id);
  expect(refreshed.identityRevision).toBe(old.identityRevision); expect(refreshed.refreshedAt).toBe(2000);
  expect(refreshed.models).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'a', offline: false, availability: { claude: 'available', codex: 'unavailable' } }),
    expect.objectContaining({ id: 'b', offline: true, availability: { claude: 'unavailable', codex: 'available' } }),
    expect.objectContaining({ id: 'c', offline: false, availability: { claude: 'untested', codex: 'untested' } }),
  ])); expect(agents.configs()).toEqual([]);
});

it.each(['name', 'key', 'endpoints'] as const)('discards a late refresh after %s editing, including a frozen clock', async (field) => {
  const wait = deferred<Response>(), entered = deferred<void>();
  const service = new ProviderService(db, secrets, agents, { fetch: async () => { entered.resolve(); return wait.promise; } }, () => 1000);
  const p = service.save(input()); const running = service.refresh(p.id); await entered.promise;
  const changes = field === 'name' ? { name: 'Edited' } : field === 'key' ? { key: 'NEW_PUBLIC_KEY' } : { endpoints: { responses: 'https://changed.invalid/v1' } };
  const saved = service.save(input({ key: undefined, ...changes }), p.id);
  wait.resolve(json({ data: [{ id: 'STALE' }] })); await expect(running).rejects.toThrow('已变更');
  expect(agents.providers()[0]).toEqual(saved);
});

it('does not revive a deleted Provider or overwrite a newly created same-name Provider', async () => {
  const wait = deferred<Response>(), entered = deferred<void>();
  const service = new ProviderService(db, secrets, agents, { fetch: async () => { entered.resolve(); return wait.promise; } });
  const p = service.save(input()), running = service.refresh(p.id); await entered.promise;
  service.delete(p.id); const fresh = service.save(input()); wait.resolve(json({ data: [{ id: 'STALE' }] }));
  await expect(running).rejects.toThrow('不存在'); expect(agents.providers()).toEqual([fresh]);
});

it('does not mistake an edit-then-revert for an unchanged request snapshot', async () => {
  const wait = deferred<Response>(), entered = deferred<void>();
  const service = new ProviderService(db, secrets, agents, { fetch: async () => { entered.resolve(); return wait.promise; } }, () => 1000);
  const p = service.save(input()), running = service.refresh(p.id); await entered.promise;
  service.save(input({ name: 'Temporary', key: undefined }), p.id); service.save(input({ key: undefined }), p.id);
  wait.resolve(json({ data: [] })); await expect(running).rejects.toThrow('已变更'); expect(agents.providers()[0].models).toHaveLength(2);
});

it('serializes same-Provider operations and preserves independent tool results and safe error history', async () => {
  const seen: { auth: string; kind: string }[] = [];
  const service = new ProviderService(db, secrets, agents, { fetch: async (_url, init) => {
    const headers = init!.headers as Record<string, string>, kind = headers['anthropic-beta'] ? 'claude' : 'codex';
    seen.push({ auth: headers.Authorization, kind }); return kind === 'claude' ? stream('claude') : json({ error: { message: 'failed PUBLIC_PROVIDER_TEST' } }, 404);
  } });
  const p = service.save(input()); await Promise.all([service.check(p.id, 'claude', 'a'), service.check(p.id, 'codex', 'a')]);
  const model = agents.providers()[0].models[0]; expect(model.availability).toEqual({ claude: 'available', codex: 'unavailable' });
  expect(model.checks?.codex).toMatchObject({ attempts: 1, message: 'failed [redacted]' });
  expect(seen).toEqual([{ auth: 'Bearer PUBLIC_PROVIDER_TEST', kind: 'claude' }, { auth: 'Bearer PUBLIC_PROVIDER_TEST', kind: 'codex' }]);
  expect(JSON.stringify(agents.providers())).not.toContain('PUBLIC_PROVIDER_TEST');
});

it('rejects forged availability and requires a real check for a custom protocol', async () => {
  const service = new ProviderService(db, secrets, agents, { fetch: async () => stream('codex') });
  const p = service.save(input({ models: [{ id: 'a', name: 'A', availability: { claude: 'available', codex: 'available' } }] }));
  expect(p.models[0].availability).toEqual({ claude: 'untested', codex: 'untested' });
  const rc = { name: 'Codex custom', toolId: 'codex', source: 'provider' as const, providerId: p.id, models: ['a'] };
  expect(() => agents.saveConfig(rc)).toThrow('先验证'); await service.check(p.id, 'codex', 'a');
  expect(agents.saveConfig(rc).models).toEqual(['a']);
});

it('does not use protocol candidates as compatibility confirmation or retry another Provider key', async () => {
  const fake = vi.fn(async () => json({ error: { type: 'invalid_request_error' } }, 400));
  const service = new ProviderService(db, secrets, agents, { fetch: fake });
  const p = service.save(input()); expect(await service.probe(p.id, 'codex')).toMatchObject({ state: 'candidate' });
  expect(agents.providers()[0].models[0].availability.codex).toBe('untested'); expect(fake).toHaveBeenCalledTimes(1);
});

it('retains the last directory when unreachable or unauthorized and never decrypts views', async () => {
  const service = new ProviderService(db, secrets, agents, { fetch: async () => json({ error: { message: 'PUBLIC_PROVIDER_TEST' } }, 401) });
  const p = service.save(input()); const before = agents.providers()[0];
  await expect(service.refresh(p.id)).rejects.toThrow('Key 可能无效'); expect(agents.providers()[0]).toEqual(before);
  const noKey = service.save(input({ name: 'No key', key: undefined })); await expect(service.refresh(noKey.id)).rejects.toThrow('填写 Key');
});

it('resets compatibility on identity change and ignores a canceled model check', async () => {
  const controller = new AbortController();
  const service = new ProviderService(db, secrets, agents, { fetch: async () => stream('codex'), signal: controller.signal });
  const p = service.save(input()); await service.check(p.id, 'codex', 'a');
  const changed = service.save(input({ key: 'REPLACEMENT_PUBLIC_KEY' }), p.id);
  expect(changed.identityRevision).toBe(2); expect(changed.models[0].availability.codex).toBe('untested'); expect(changed.models[0].checks).toBeUndefined();
  controller.abort(); await expect(service.check(p.id, 'codex', 'a')).rejects.toThrow('已取消');
  expect(agents.providers()[0]).toEqual(changed);
});

it.each(['forged', 'deepseek'])('does not accept the %s preset label as proof for an arbitrary custom endpoint', (preset) => {
  const service = new ProviderService(db, secrets, agents);
  const p = service.save(input({ preset }));
  expect(() => agents.saveConfig({ name: 'Forged', toolId: 'codex', source: 'provider', providerId: p.id, models: ['a'] })).toThrow('先验证');
});

it('cancels requests queued before a credential edit instead of sending them to the new source', async () => {
  const wait = deferred<Response>(), entered = deferred<void>();
  const fake = vi.fn(async () => { entered.resolve(); return wait.promise; });
  const service = new ProviderService(db, secrets, agents, { fetch: fake });
  const p = service.save(input()), first = service.refresh(p.id); await entered.promise;
  const queued = service.check(p.id, 'codex', 'a');
  service.save(input({ key: 'NEW_PUBLIC_KEY', endpoints: { responses: 'https://new.invalid/v1' } }), p.id);
  wait.resolve(json({ data: [{ id: 'a' }] }));
  await expect(first).rejects.toThrow('已变更'); await expect(queued).rejects.toThrow('排队请求已取消');
  expect(fake).toHaveBeenCalledTimes(1); expect(agents.providers()[0].models[0].availability.codex).toBe('untested');
});

it('normalizes empty remote display names before committing and keeps the Provider readable', async () => {
  const service = new ProviderService(db, secrets, agents, { fetch: async () => json({ data: [{ id: 'a', display_name: '' }, { id: 'b', display_name: '   ' }] }) });
  const p = service.save(input()); const result = await service.refresh(p.id);
  expect(result.models.map((model) => model.name)).toEqual(['a', 'b']); expect(() => agents.providers()).not.toThrow();
});

it('redacts credentials in successful display metadata and rejects credential-bearing model identities without modifying the old directory', async () => {
  const queue = [json({ data: [{ id: 'a', display_name: 'echo PUBLIC_PROVIDER_TEST' }] }), json({ data: [{ id: 'PUBLIC_PROVIDER_TEST' }] })];
  const service = new ProviderService(db, secrets, agents, { fetch: async () => queue.shift()! });
  const p = service.save(input()); const safe = await service.refresh(p.id);
  expect(safe.models[0].name).toBe('echo [redacted]');
  await expect(service.refresh(p.id)).rejects.toThrow('包含认证值'); expect(agents.providers()[0]).toEqual(safe);
  expect(sqlite.prepare('SELECT models FROM ai_providers').get()).not.toEqual(expect.objectContaining({ models: expect.stringContaining('PUBLIC_PROVIDER_TEST') }));
});
