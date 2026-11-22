import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { SubscriptionCatalogs, subscriptionCatalogScope } from './subscription-catalog';
import type { CatalogObserver, CodexCatalogResult } from './drivers/codex-catalog';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProfileLaunch } from './profile-launch';
import type { CodeAgentTool } from '@shared/ai-agents';

it('shares ordinary projects and isolates changed login, profile, binary and project configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'willyou-directory-'));
  try {
    const stateRoot = join(root, '.codex'), command = join(root, 'codex');
    const one = join(root, 'one'), two = join(root, 'two');
    for (const dir of [stateRoot, one, two]) mkdirSync(dir);
    writeFileSync(command, 'fixture');
    const launch = { stateRoot, command, compatibility:{}, extraArgs:[], env:{HOME:root} } as unknown as ProfileLaunch;
    const tool = { login:'subscription', version:'test' } as CodeAgentTool;
    const scope = (dir:string, profile='A') => subscriptionCatalogScope(profile, launch, tool, dir);
    expect(scope(one).localLoginBound).toBe(false);
    writeFileSync(join(stateRoot,'auth.json'), 'synthetic account A');
    const first = scope(one);
    expect(first.localLoginBound).toBe(true);
    expect(scope(two)).toEqual(first);
    expect(scope(one, 'B').key).not.toBe(first.key);
    mkdirSync(join(two,'.codex')); writeFileSync(join(two,'.codex','config.toml'), 'model="custom"');
    expect(scope(two).key).not.toBe(first.key);
    writeFileSync(command, 'updated fixture');
    const updated = scope(one);
    expect(updated.key).not.toBe(first.key);
    writeFileSync(join(stateRoot,'auth.json'), 'synthetic different login');
    expect(scope(one).key).not.toBe(updated.key);
    writeFileSync(join(stateRoot,'config.toml'), 'cli_auth_credentials_store = "keyring"');
    expect(scope(one).localLoginBound).toBe(false);
  } finally { rmSync(root, {recursive:true, force:true}); }
});

it('opens a fresh on-disk directory without a native request and displays stale rows during a refresh', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const models = [{ id: 'sol', name: 'Sol', efforts: ['medium'] }];
  const detected = async (observer: CatalogObserver) => { observer.account?.('verified-account'); return { models, confirmed: true }; };
  await new SubscriptionCatalogs(db).read('bound-scope', detected, 'wait', true);
  const probe = vi.fn(() => new Promise<CodexCatalogResult>(() => {}));
  expect(await new SubscriptionCatalogs(db).read('bound-scope', probe, 'peek', true)).toEqual({ status: 'ready', models });
  expect(probe).not.toHaveBeenCalled();
  expect((await new SubscriptionCatalogs(db).read('changed-login-file', probe, 'peek', true)).models).toEqual([]);
  expect((await new SubscriptionCatalogs(db).read('bound-scope', probe, 'peek', false)).models).toEqual([]);
  db.prepare("UPDATE app_settings SET updated_at=? WHERE key GLOB 'codexModelCatalog.v1.*'").run(Date.now() - 6 * 60000);
  const cold = new SubscriptionCatalogs(db);
  expect(await cold.read('bound-scope', probe, 'peek', true)).toEqual({ status: 'refreshing', models });
  const refresh = vi.fn();
  expect(await cold.modelsForRun('bound-scope', 'verified-account', refresh)).toEqual(models);
  expect(await cold.modelsForRun('changed-login-file', 'verified-account')).toBeUndefined();
  expect(refresh).toHaveBeenCalledOnce();
  db.close();
});

it('shares cold probes, serves partial rows, then restores only a verified matching account on restart', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const partial = [{ id: 'builtin', name: 'Built in', efforts: ['low'] }];
  const full = [{ id: 'sol', name: 'Sol', efforts: ['medium', 'high'] }];
  const deferred = () => {
    let resolve!: (value: CodexCatalogResult) => void;
    const promise = new Promise<CodexCatalogResult>(r => { resolve = r; });
    let observer!: CatalogObserver;
    return { load: vi.fn(async (o: CatalogObserver) => { observer = o; return promise; }), observe: () => observer, resolve };
  };
  const probe = deferred();
  const cache = new SubscriptionCatalogs(db);
  expect(await cache.read('scope', probe.load)).toEqual({ status: 'loading', models: [] });
  probe.observe().account?.('account-A');
  expect(await cache.modelsForRun('scope', 'account-A')).toBeUndefined();
  expect(await cache.modelsForRun('scope', 'account-B')).toBeUndefined();
  probe.observe().fallback?.(partial);
  expect(await cache.read('scope', probe.load)).toEqual({ status: 'refreshing', models: partial });
  probe.resolve({ models: full, confirmed: true });
  expect(await cache.read('scope', probe.load, 'wait')).toEqual({ status: 'ready', models: full });
  expect(await cache.modelsForRun('scope', 'account-A')).toEqual(full);
  expect((await cache.read('scope', probe.load)).models).toEqual(full);
  expect(probe.load).toHaveBeenCalledTimes(1);

  const restarted = new SubscriptionCatalogs(db), offline = deferred();
  expect((await restarted.read('scope', offline.load)).models).toEqual([]);
  const earlySubmit = restarted.read('scope', offline.load, 'wait');
  offline.observe().account?.('account-A');
  expect(await earlySubmit).toEqual({ status: 'refreshing', models: full });
  expect(await restarted.read('scope', offline.load)).toEqual({ status: 'refreshing', models: full });
  offline.observe().fallback?.(partial);
  expect((await restarted.read('scope', offline.load)).models).toEqual(full);
  offline.resolve({ models: partial, confirmed: false });
  await new Promise(resolve => setImmediate(resolve));
  expect(await restarted.read('scope', offline.load)).toEqual({ status: 'unavailable', models: full });
  const other = deferred();
  await restarted.read('scope', other.load, 'retry');
  other.observe().account?.('account-B');
  expect((await restarted.read('scope', other.load)).models).toEqual([]);
  other.resolve({ models: partial, confirmed: true });
  expect((await restarted.read('scope', other.load, 'wait')).models).toEqual(partial);
  const removed = deferred();
  await restarted.read('scope', removed.load, 'retry');
  removed.observe().account?.('account-B');
  removed.resolve({ models: [], confirmed: true });
  await new Promise(resolve => setImmediate(resolve));
  expect(await restarted.read('scope', removed.load)).toEqual({ status: 'ready', models: [] });
  db.close();
});
