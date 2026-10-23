import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '@shared/applications';
import type { ApplicationConnection, ApplicationProvider, ConnectionConfig, ProjectApplicationSelectionInput } from '@shared/application-connections';
import * as schema from '../../../db/schema';
import { runBundledMigrations } from '../../../db/migrations';
import { SecretsStore } from '../../../secrets';
import { ApplicationConnectionService } from '../connection-service';
import { ResourceStore } from '../resource-store';
import { ApplicationSelectionService } from '../selection-service';
let root: string, sqlite: Database.Database, store: ResourceStore, connections: ApplicationConnectionService, service: ApplicationSelectionService;
let live: number, stop: ReturnType<typeof vi.fn<(projectId: string) => Promise<boolean>>>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'willyou-m10-selections-')); sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
  for (const id of ['p1', 'p2']) sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id, 'Same visible name');
  store = new ResourceStore(sqlite, root); const db = drizzle(sqlite, { schema });
  const secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: s => Buffer.from([...s].reverse().join('')), decrypt: b => [...b.toString()].reverse().join('') });
  connections = new ApplicationConnectionService(store, secrets, { verify: async config => ({ providerId: config.kind, serviceId: 'fixture-service', accountId: config.kind === 'foxmail' ? config.account : config.username, contractMajor: 1 }) });
  live = 0; stop = vi.fn(async () => { live = 0; return true; });
  service = new ApplicationSelectionService(store, connections, { requireProject: id => { if (!sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) throw new ApplicationError('NOT_FOUND', 'project fixture missing'); }, stopProjectRuns: stop, runningInProject: () => live });
});
afterEach(() => { sqlite.close(); rmSync(root, { recursive: true, force: true }); });
async function connection(provider: ApplicationProvider, suffix = 'a'): Promise<ApplicationConnection> {
  let config: ConnectionConfig;
  if (provider === 'zentao') config = { kind: 'zentao', baseUrl: 'https://zentao.example.test/biz/', username: suffix, authMode: 'token' };
  else if (provider === 'foxmail') config = { kind: 'foxmail', sourcePath: join(root, suffix), account: suffix, queryDays: 30 };
  else config = { kind: 'smtp', host: 'smtp.example.test', port: 587, username: suffix, fromAddress: suffix + '@example.test', authMode: 'password', mode: 'starttls' };
  return connections.save({ expectedRevision: 0, name: 'fixture-' + suffix, config, secret: provider === 'foxmail' ? undefined : 'fixture-secret-' + suffix });
}
const selectZen = (id: string | null, expectedRevision: number, enabled = true): ProjectApplicationSelectionInput => ({ projectId: 'p1', appId: 'zentao', enabled, expectedRevision, connections: { zentao: id } });

describe('explicit project application slots and stop-before-switch', () => {
  it('starts new/imported projects unselected and never matches by project or account display name', async () => {
    await connection('zentao'); await service.setAdded('zentao', true, 0);
    expect(service.projectSettings('p1', 'zentao')).toMatchObject({ enabled: false, revision: 0, connections: { zentao: null } });
    expect(service.projectSettings('p2', 'zentao')).toMatchObject({ enabled: false, revision: 0, connections: { zentao: null } });
  });
  it('keeps independent nullable mail source and sender slots while draft use remains enabled', async () => {
    await service.setAdded('mail', true, 0); const source = await connection('foxmail'), sender = await connection('smtp');
    const selected = await service.select({ projectId: 'p1', appId: 'mail', expectedRevision: 0, enabled: true, connections: { foxmail: source.id, smtp: sender.id } });
    const cleared = await service.select({ projectId: selected.projectId, appId: selected.appId, enabled: selected.enabled, expectedRevision: selected.revision, connections: { foxmail: null, smtp: null } });
    expect(cleared).toMatchObject({ enabled: true, connections: { foxmail: null, smtp: null } });
    expect(service.requireEnabled('p1', 'mail').enabled).toBe(true); expect(stop).not.toHaveBeenCalled();
    expect(service.projectSettings('p2', 'mail').enabled).toBe(false);
  });
  it('rejects multiple/ambiguous slots and wrong provider roles in service and database', async () => {
    await service.setAdded('mail', true, 0); const sender = await connection('smtp');
    await expect(service.select({ projectId: 'p1', appId: 'mail', expectedRevision: 0, enabled: true, connections: { foxmail: [sender.id], smtp: null } } as unknown as ProjectApplicationSelectionInput)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.select({ projectId: 'p1', appId: 'mail', expectedRevision: 0, enabled: true, connections: { foxmail: sender.id, smtp: null } })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await service.select({ projectId: 'p1', appId: 'mail', expectedRevision: 0, enabled: true, connections: { foxmail: null, smtp: null } });
    expect(() => sqlite.prepare('INSERT INTO application_project_bindings VALUES(?,?,?,?,?)').run('p1', 'mail', 'foxmail', sender.id, 1)).toThrow(/FOREIGN KEY/);
    await expect(service.select({ projectId: 'p1', appId: 'mail', expectedRevision: 1, enabled: true, connections: { foxmail: null } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('stores exactly one source per slot and rejects a stale project revision', async () => {
    await service.setAdded('zentao', true, 0); const a = await connection('zentao'), selected = await service.select(selectZen(a.id, 0));
    await expect(service.select(selectZen(null, 0))).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(service.projectSettings('p1', 'zentao')).toEqual(selected);
    expect(() => sqlite.prepare('INSERT INTO application_project_bindings VALUES(?,?,?,?,?)').run('p1', 'zentao', 'zentao', a.id, 1)).toThrow(/UNIQUE/);
  });
  it('rejects mail multi-selection in either slot and atomically chooses one concurrent revision',async()=>{
    await service.setAdded('mail',true,0);const a=await connection('foxmail','source-a'),b=await connection('foxmail','source-b'),x=await connection('smtp','sender-a'),y=await connection('smtp','sender-b');
    const original=await service.select({projectId:'p1',appId:'mail',expectedRevision:0,enabled:true,connections:{foxmail:a.id,smtp:x.id}});
    for(const connections of [{foxmail:[a.id,b.id],smtp:x.id},{foxmail:a.id,smtp:[x.id,y.id]}])await expect(service.select({projectId:'p1',appId:'mail',expectedRevision:original.revision,enabled:true,connections} as unknown as ProjectApplicationSelectionInput)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(service.projectSettings('p1','mail')).toEqual(original);
    for(const [slot,id] of [['foxmail',b.id],['smtp',y.id]])expect(()=>sqlite.prepare('INSERT INTO application_project_bindings VALUES(?,?,?,?,?)').run('p1','mail',slot,id,1)).toThrow(/UNIQUE/);
    const choices=[{foxmail:b.id,smtp:x.id},{foxmail:a.id,smtp:y.id}];
    const results=await Promise.allSettled(choices.map(connections=>service.select({projectId:'p1',appId:'mail',expectedRevision:original.revision,enabled:true,connections})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'REVISION_CONFLICT'}});
    const winner=results.findIndex(r=>r.status==='fulfilled');expect(service.projectSettings('p1','mail').connections).toEqual(choices[winner]);expect(service.projectSettings('p2','mail').enabled).toBe(false);expect(stop).not.toHaveBeenCalled();
  });
  it('stops project runs before committing another ZenTao source', async () => {
    await service.setAdded('zentao', true, 0); const a = await connection('zentao'), b = await connection('zentao', 'b');
    const selected = await service.select(selectZen(a.id, 0)); expect(stop).not.toHaveBeenCalled(); live = 1;
    const changed = await service.select(selectZen(b.id, selected.revision));
    expect(stop).toHaveBeenCalledExactlyOnceWith('p1'); expect(changed.connections.zentao).toBe(b.id); expect(changed.revision).toBe(selected.revision + 1); expect(changed.pendingOperationId).toBeNull();
  });
  it.each([false, true])('preserves the prior connection when stopped=%s does not prove all runs exited', async stopped => {
    await service.setAdded('zentao', true, 0); const a = await connection('zentao'), b = await connection('zentao', 'b');
    const old = await service.select(selectZen(a.id, 0)); live = 1; stop.mockImplementationOnce(async () => stopped);
    await expect(service.select(selectZen(b.id, old.revision))).rejects.toMatchObject({ code: 'RUN_STOP_FAILED' });
    expect(service.projectSettings('p1', 'zentao')).toEqual(old);
  });
  it('holds a pending switch gate and rejects a competing selection without borrowing a later result', async () => {
    await service.setAdded('zentao', true, 0); const a = await connection('zentao'), b = await connection('zentao', 'b'), old = await service.select(selectZen(a.id, 0));
    let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; }); live = 1;
    stop.mockImplementationOnce(async () => { await gate; live = 0; return true; });
    const switching = service.select(selectZen(b.id, old.revision));
    await vi.waitFor(() => expect(service.projectSettings('p1', 'zentao').pendingOperationId).not.toBeNull());
    expect(() => service.requireEnabled('p1', 'zentao')).toThrow(/变更中/);
    await expect(service.select(selectZen(null, old.revision))).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    expect(service.projectSettings('p1', 'zentao').connections.zentao).toBe(a.id);
    finish(); expect((await switching).connections.zentao).toBe(b.id);
  });
  it('keeps connection configuration and history while removal disables project use and re-add does not enable it', async () => {
    const catalog = await service.setAdded('zentao', true, 0), a = await connection('zentao'); await service.select(selectZen(a.id, 0));
    const removed = await service.setAdded('zentao', false, catalog.revision);
    expect(service.projectSettings('p1', 'zentao')).toMatchObject({ enabled: false, connections: { zentao: a.id } }); expect(connections.get(a.id)).toEqual(a);
    await service.setAdded('zentao', true, removed.revision);
    expect(() => service.requireEnabled('p1', 'zentao')).toThrow(/未启用/); expect(service.projectSettings('p2', 'zentao').enabled).toBe(false);
  });
  it('does not commit a pending switch after removal changed the app authorization', async () => {
    const catalog = await service.setAdded('zentao', true, 0), a = await connection('zentao'), b = await connection('zentao', 'b'), old = await service.select(selectZen(a.id, 0));
    let finish!: () => void; const gate = new Promise<void>(r => { finish = r; }); live = 1;
    stop.mockImplementationOnce(async () => { await gate; live = 0; return true; });
    const pending = service.select(selectZen(b.id, old.revision)); const observed = expect(pending).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await vi.waitFor(() => expect(service.projectSettings('p1', 'zentao').pendingOperationId).not.toBeNull());
    await service.setAdded('zentao', false, catalog.revision); finish(); await observed;
    expect(service.projectSettings('p1', 'zentao')).toMatchObject({ enabled: false, connections: { zentao: a.id }, pendingOperationId: null });
  });
  it('keeps selected identity separate from current connection health and disablement', async () => {
    await service.setAdded('zentao', true, 0); const a = await connection('zentao'), selected = await service.select(selectZen(a.id, 0));
    await connections.setEnabled(a.id, false, a.revision);
    expect(service.projectSettings('p1', 'zentao')).toEqual(selected);
    const disabled = connections.get(a.id);
    expect(() => connections.authentication(a.id, disabled)).toThrow(/授权/);
  });
});
