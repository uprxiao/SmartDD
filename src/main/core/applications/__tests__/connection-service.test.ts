import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '@shared/applications';
import type { ConnectionConfig, SaveApplicationConnection, VerifiedConnectionIdentity } from '@shared/application-connections';
import * as schema from '../../../db/schema';
import { runBundledMigrations } from '../../../db/migrations';
import { SecretsStore } from '../../../secrets';
import { ApplicationConnectionService, type ConnectionVerifier } from '../connection-service';
import { PackageRegistry } from '../package-registry';
import { canonicalJson,digest } from '../manifest';
import { ResourceStore } from '../resource-store';
import { RuntimeRegistry } from '../runtime-registry';
import { fixtureBundle } from './fixtures';
import {builtinConfigViews} from '../config-view-registry';
let root: string, sqlite: Database.Database, secrets: SecretsStore, store: ResourceStore, service: ApplicationConnectionService;
let available: boolean, verify: ReturnType<typeof vi.fn<ConnectionVerifier['verify']>>;
const config = (): ConnectionConfig => ({ kind: 'zentao', baseUrl: 'https://zentao.example.test/biz/', username: 'tester', authMode: 'token' });
const input = (over: Partial<SaveApplicationConnection> = {}): SaveApplicationConnection => ({ expectedRevision: 0, name: 'Isolated ZenTao', config: config(), secret: 'fixture-secret-first', ...over });
const identity = (c: ConnectionConfig): VerifiedConnectionIdentity => ({ providerId: c.kind, serviceId: 'fixture-service', accountId: 'fixture-account', contractMajor: 1 });
const authVersion = (c: { identityRevision: number; configRevision: number; secretRevision: number; policyRevision: number }) => ({ identityRevision: c.identityRevision, configRevision: c.configRevision, secretRevision: c.secretRevision, policyRevision: c.policyRevision });
const secretCount = () => (sqlite.prepare('SELECT count(*) AS n FROM app_secrets').get() as { n: number }).n;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'willyou-m10-connections-')); sqlite = new Database(join(root,'connections.sqlite')); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema }); available = true;
  // Fake cipher exercises the storage boundary; this does not claim native safeStorage acceptance.
  secrets = new SecretsStore(db, { isAvailable: () => available, encrypt: s => Buffer.from([...s].reverse().join('')), decrypt: b => [...b.toString()].reverse().join('') });
  store = new ResourceStore(sqlite, root); verify = vi.fn(async c => identity(c)); service = new ApplicationConnectionService(store, secrets, { verify });
});
afterEach(() => { vi.restoreAllMocks(); sqlite.close(); rmSync(root, { recursive: true, force: true }); });
async function activateTokenPackage() {
  const runtime = await new RuntimeRegistry(store).install({ id: 'applications', protocolMajor: 1, bridgeEntry: 'bridge.cjs', files: { 'bridge.cjs': Buffer.from('module.exports = {};') } });
  const source = fixtureBundle(); source.manifest.runtime.hash = runtime.contentHash;
  source.files['schemas/connection.json']=Buffer.from(JSON.stringify({type:'object',properties:{kind:{const:'zentao'},baseUrl:{type:'string'},username:{type:'string'},authMode:{enum:['token']}},required:['kind','baseUrl','username','authMode'],additionalProperties:false}));
  Object.assign(source.manifest.files.find(f=>f.path==='schemas/connection.json')!,{size:source.files['schemas/connection.json'].length,sha256:digest(source.files['schemas/connection.json'])});
  const registry = new PackageRegistry(store, 'fixture'); const installed = await registry.install(source); await registry.activate(installed.packageHash, 0); return installed;
}

describe('current connection revisions, tested candidates and encrypted secret changes', () => {
  it.each(['smtp.example.test?account=fixture','smtp.example.test#fragment'])('RC rejects URL delimiters in an SMTP host before staging a secret: %s',async host=>{
    const secretWrite=vi.spyOn(secrets,'set');const config:ConnectionConfig={kind:'smtp',host,port:465,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password',mode:'implicit-tls'};await expect(service.testCandidate(input({config}))).rejects.toMatchObject({code:'INVALID_INPUT'});expect(secretWrite).not.toHaveBeenCalled();expect(verify).not.toHaveBeenCalled();expect(secretCount()).toBe(0);expect(sqlite.prepare('SELECT * FROM application_secret_changes').all()).toHaveLength(0);
  });
  it('keeps a tested candidate separate from saved state and exposes no credential references or values', async () => {
    const candidate = await service.testCandidate(input());
    expect(service.list()).toEqual([]); expect(secretCount()).toBe(1);
    const connection = await service.commitCandidate(candidate.operationId, candidate.candidateHash);
    expect(connection).toMatchObject({ revision: 1, configRevision: 1, identityRevision: 1, secretRevision: 1, policyRevision: 1, authorization: 'connected', health: 'healthy', hasSecret: true });
    const exposed = JSON.stringify(candidate) + JSON.stringify(connection) + JSON.stringify(sqlite.prepare('SELECT * FROM application_secret_changes').all()) + JSON.stringify(sqlite.prepare('SELECT * FROM app_secrets').all());
    expect(exposed).not.toContain('fixture-secret-first'); expect(JSON.stringify(connection)).not.toContain('secret_ref');
    expect(service.authentication(connection.id, authVersion(connection)).secret).toBe('fixture-secret-first');
    await expect(service.commitCandidate(candidate.operationId, candidate.candidateHash)).rejects.toMatchObject({ code: 'CONFIG_PLAN_STALE' }); expect(service.list()).toHaveLength(1);
  });
  it('rejects invalid config and unsafe URL fields without calling the provider', async () => {
    await expect(service.testCandidate(input({ config: { ...config(), baseUrl: 'https://user:password@example.test/' } as ConnectionConfig }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.testCandidate({ ...input(), config: { ...config(), password: 'hidden-in-config' } } as unknown as SaveApplicationConnection)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(verify).not.toHaveBeenCalled(); expect(secretCount()).toBe(0);
  });
  it('refuses unavailable encryption before verification without persisting plaintext or partial state', async () => {
    available = false; await expect(service.save(input())).rejects.toThrow(/安全存储/);
    expect(verify).not.toHaveBeenCalled(); expect(service.list()).toHaveLength(0); expect(secretCount()).toBe(0);
    expect(sqlite.prepare('SELECT * FROM application_secret_changes').all()).toHaveLength(0);
  });
  it.each(['{invalid-json', JSON.stringify({kind:'zentao',authMode:'unknown'})])('preserves unreadable saved configuration and refuses credential access: %s', async bytes => {
    const connection=await service.save(input());
    const original=sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(connection.id);
    sqlite.prepare('UPDATE application_connections SET config_json=? WHERE id=?').run(bytes,connection.id);
    const damaged=sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(connection.id);
    const secretRead=vi.spyOn(secrets,'get');
    expect(()=>service.get(connection.id)).toThrow(expect.objectContaining({code:'CONFIG_INCOMPATIBLE'}));
    expect(()=>service.authentication(connection.id,authVersion(connection))).toThrow(expect.objectContaining({code:'CONFIG_INCOMPATIBLE'}));
    expect(secretRead).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(connection.id)).toEqual(damaged);
    sqlite.prepare('UPDATE application_connections SET config_json=? WHERE id=?').run((original as {config_json:string}).config_json,connection.id);
    expect(service.get(connection.id)).toEqual(connection);
    expect(service.authentication(connection.id,authVersion(connection)).secret).toBe('fixture-secret-first');
  });
  it('keeps the old credential and configuration when a rotation fails, and sanitizes provider error text', async () => {
    const old = await service.save(input()); verify.mockRejectedValueOnce(new ApplicationError('AUTH_FAILED', 'server echoed fixture-secret-invalid'));
    const failed = service.save(input({ id: old.id, expectedRevision: old.revision, secret: 'fixture-secret-invalid' }));
    await expect(failed).rejects.toMatchObject({ code: 'AUTH_FAILED', message: '账号认证失败，请核对当前凭据' });
    const current = service.get(old.id); expect(current).toEqual(old); expect(secretCount()).toBe(1);
    expect(service.authentication(old.id, authVersion(current)).secret).toBe('fixture-secret-first');
  });
  it('preserves the old reference when staging a new secret fails before provider verification',async()=>{
    const old=await service.save(input()),rows=sqlite.prepare('SELECT * FROM application_connections').all(),journal=sqlite.prepare('SELECT * FROM application_secret_changes').all();verify.mockClear();
    vi.spyOn(secrets,'set').mockImplementationOnce(()=>{throw new Error('controlled secret-store write failure');});
    await expect(service.save(input({id:old.id,expectedRevision:old.revision,secret:'rotation-staging-failure'}))).rejects.toThrow('controlled secret-store write failure');
    expect(verify).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT * FROM application_connections').all()).toEqual(rows);expect(sqlite.prepare('SELECT * FROM application_secret_changes').all()).toEqual(journal);expect(secretCount()).toBe(1);
    expect(service.authentication(old.id,authVersion(old)).secret).toBe('fixture-secret-first');
  });
  it('discards only the staged rotation when verification identifies a different account',async()=>{
    const old=await service.save(input()),row=sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(old.id);
    verify.mockImplementationOnce(async c=>({...identity(c),accountId:'different-fixture-account'}));
    await expect(service.save(input({id:old.id,expectedRevision:old.revision,secret:'wrong-identity-rotation'}))).rejects.toMatchObject({code:'IDENTITY_CHANGE_REQUIRES_SELECTION'});
    expect(sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(old.id)).toEqual(row);expect(secretCount()).toBe(1);expect(service.authentication(old.id,authVersion(old)).secret).toBe('fixture-secret-first');
    expect(sqlite.prepare("SELECT state,error_code FROM application_secret_changes WHERE expected_revision=?").get(old.revision)).toEqual({state:'failed',error_code:'IDENTITY_CHANGE_REQUIRES_SELECTION'});
  });
  it('rolls back a failed connection commit and removes only its validated candidate secret',async()=>{
    const old=await service.save(input()),candidate=await service.testCandidate(input({id:old.id,expectedRevision:old.revision,secret:'rotation-transaction-failure'})),row=sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(old.id);
    expect(secretCount()).toBe(2);sqlite.exec("CREATE TEMP TRIGGER fail_rotation_commit BEFORE UPDATE ON application_connections BEGIN SELECT RAISE(ABORT,'controlled rotation commit failure'); END");
    try{await expect(service.commitCandidate(candidate.operationId,candidate.candidateHash)).rejects.toThrow('controlled rotation commit failure');}finally{sqlite.exec('DROP TRIGGER fail_rotation_commit');}
    expect(sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(old.id)).toEqual(row);expect(secretCount()).toBe(1);expect(service.authentication(old.id,authVersion(old)).secret).toBe('fixture-secret-first');
    expect(sqlite.prepare('SELECT state,error_code FROM application_secret_changes WHERE operation_id=?').get(candidate.operationId)).toEqual({state:'failed',error_code:'CONNECTION_UNAVAILABLE'});
  });
  it('recovers obsolete-secret cleanup from disk after a newer rotation without reverting or deleting the current credential',async()=>{
    const old=await service.save(input()),candidate=await service.testCandidate(input({id:old.id,expectedRevision:old.revision,secret:'rotation-second'}));
    const deletion=vi.spyOn(secrets,'delete').mockImplementationOnce(()=>{throw new Error('controlled old-secret cleanup failure');});
    const second=await service.commitCandidate(candidate.operationId,candidate.candidateHash);deletion.mockRestore();
    expect(second).toMatchObject({identityRevision:old.identityRevision,configRevision:old.configRevision,secretRevision:2,cleanupPending:true});expect(service.authentication(old.id,authVersion(second)).secret).toBe('rotation-second');expect(secretCount()).toBe(2);
    const latest=await service.save(input({id:old.id,expectedRevision:second.revision,secret:'rotation-third'}));expect(latest.cleanupPending).toBe(true);expect(latest.secretRevision).toBe(3);expect(secretCount()).toBe(2);
    await service.discardCandidate(candidate.operationId);expect(service.authentication(old.id,authVersion(latest)).secret).toBe('rotation-third');
    const row=sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(old.id),pending=sqlite.prepare("SELECT state FROM application_secret_changes WHERE operation_id=?").get(candidate.operationId);expect(pending).toEqual({state:'cleanup-pending'});
    sqlite.close();sqlite=new Database(join(root,'connections.sqlite'));sqlite.pragma('foreign_keys=ON');
    secrets=new SecretsStore(drizzle(sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from([...s].reverse().join('')),decrypt:b=>[...b.toString()].reverse().join('')});store=new ResourceStore(sqlite,root);service=new ApplicationConnectionService(store,secrets,{verify});
    expect(sqlite.prepare('SELECT * FROM application_connections WHERE id=?').get(old.id)).toEqual(row);expect(sqlite.prepare('SELECT state FROM application_secret_changes WHERE operation_id=?').get(candidate.operationId)).toEqual(pending);
    await service.recoverSecretChanges();expect(service.get(old.id)).toEqual({...latest,cleanupPending:false});expect(service.authentication(old.id,authVersion(latest)).secret).toBe('rotation-third');expect(secretCount()).toBe(1);
    expect(()=>service.authentication(old.id,authVersion(second))).toThrow(/修订/);expect(sqlite.prepare('SELECT state FROM application_secret_changes WHERE operation_id=?').get(candidate.operationId)).toEqual({state:'cleaned'});expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('uses CAS for concurrent rotations and only cleans the losing operation secret', async () => {
    const old = await service.save(input());
    const a = await service.testCandidate(input({ id: old.id, expectedRevision: old.revision, secret: 'rotation-a' }));
    const b = await service.testCandidate(input({ id: old.id, expectedRevision: old.revision, secret: 'rotation-b' }));
    expect(secretCount()).toBe(3);
    const next = await service.commitCandidate(a.operationId, a.candidateHash);
    await expect(service.commitCandidate(b.operationId, b.candidateHash)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(next.identityRevision).toBe(1); expect(next.configRevision).toBe(old.configRevision); expect(next.secretRevision).toBe(2); expect(secretCount()).toBe(1);
    expect(service.authentication(next.id, authVersion(next)).secret).toBe('rotation-a');
    expect(() => service.authentication(next.id, authVersion(old))).toThrow(/修订/);
  });
  it('rejects a tested plan after a concurrent same-identity config edit without overwriting the winning configuration', async () => {
    const saved = await service.save(input());
    const candidate = await service.testCandidate(input({ id: saved.id, expectedRevision: saved.revision, secret: 'losing-staged-secret' }));
    const changedConfig = { ...config(), baseUrl: 'https://zentao.example.test/compatible-deployment-route/' };
    const winner = await service.save(input({ id: saved.id, expectedRevision: saved.revision, config: changedConfig, secret: undefined }));
    expect(winner.configRevision).toBe(saved.configRevision + 1); expect(winner.identityRevision).toBe(saved.identityRevision); expect(winner.secretRevision).toBe(saved.secretRevision);
    await expect(service.commitCandidate(candidate.operationId, candidate.candidateHash)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(service.get(saved.id)).toEqual(winner); expect(winner.config).toEqual(changedConfig); expect(secretCount()).toBe(1);
    expect(service.authentication(saved.id, authVersion(winner)).secret).toBe('fixture-secret-first');
    expect(sqlite.prepare('SELECT state FROM application_secret_changes WHERE operation_id=?').get(candidate.operationId)).toEqual({ state: 'failed' });
  });
  it.each(['accountId','serviceId'] as const)('requires a new connection for a verified %s identity change', async field => {
    const old = await service.save(input()); verify.mockImplementationOnce(async c => ({ ...identity(c), [field]: 'different-identity' }));
    await expect(service.save(input({ id: old.id, expectedRevision: old.revision, secret: 'different-account-secret' }))).rejects.toMatchObject({ code: 'IDENTITY_CHANGE_REQUIRES_SELECTION' });
    expect(service.get(old.id)).toEqual(old); expect(secretCount()).toBe(1);
  });
  it('stores Foxmail without an SMTP secret and refuses replacing the source path in place', async () => {
    const source: ConnectionConfig = { kind: 'foxmail', sourcePath: join(root, 'source-fixture'), account: 'fixture-mailbox', queryDays: 30 };
    const connection = await service.save(input({ config: source, secret: undefined }));
    expect(connection).toMatchObject({ appId: 'mail', providerId: 'foxmail', hasSecret: false, secretRevision: 0 });
    await expect(service.save(input({ id: connection.id, expectedRevision: connection.revision, config: { ...source, sourcePath: join(root, 'another-source') }, secret: undefined }))).rejects.toMatchObject({ code: 'IDENTITY_CHANGE_REQUIRES_SELECTION' });
    expect(secretCount()).toBe(0);
  });
  it('keeps SMTP mode and port explicit and separate from source configuration', async () => {
    const smtp: ConnectionConfig = { kind: 'smtp', host: 'smtp.example.test', port: 587, username: 'tester@example.test', fromAddress: 'tester@example.test', authMode: 'password', mode: 'starttls' };
    const saved = await service.save(input({ config: smtp })); expect(saved.config).toEqual(smtp); expect(saved.providerId).toBe('smtp');
    await expect(service.save(input({ config: { ...smtp, port: 0 } }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('PA retains a legacy shared credential until the last authorized connection is disconnected,including recovery',async()=>{
    const c=await service.save(input({name:'shared C'})),d=await service.save(input({name:'shared D',secret:'fixture-secret-second'}));const key=(sqlite.prepare('SELECT secret_ref FROM application_connections WHERE id=?').get(c.id) as {secret_ref:string}).secret_ref,oldD=(sqlite.prepare('SELECT secret_ref FROM application_connections WHERE id=?').get(d.id) as {secret_ref:string}).secret_ref;sqlite.prepare('UPDATE application_connections SET secret_ref=? WHERE id=?').run(key,d.id);secrets.delete(oldD);const beforeD=service.get(d.id),deletion=vi.spyOn(secrets,'delete');const disconnected=await service.disconnect(c.id,c.revision);expect(disconnected).toMatchObject({authorization:'disconnected',hasSecret:false,cleanupPending:false});expect(deletion).not.toHaveBeenCalled();expect(secretCount()).toBe(1);expect(service.get(d.id)).toEqual(beforeD);expect(service.authentication(d.id,authVersion(beforeD)).secret).toBe('fixture-secret-first');expect(()=>service.authentication(c.id,authVersion(disconnected))).toThrow(/授权/);service=new ApplicationConnectionService(store,secrets,{verify});await service.recoverSecretChanges();expect(service.get(d.id)).toEqual(beforeD);expect(secretCount()).toBe(1);const closedD=await service.disconnect(d.id,beforeD.revision);expect(closedD).toMatchObject({authorization:'disconnected',hasSecret:false,cleanupPending:false});expect(deletion).toHaveBeenCalledExactlyOnceWith(key);expect(secretCount()).toBe(0);expect(service.get(c.id)).toEqual(disconnected);await service.recoverSecretChanges();expect(deletion).toHaveBeenCalledTimes(1);
  });
  it('PA keeps both shared-reference connections revoked when deleting the final reference fails,then recovers once',async()=>{
    const c=await service.save(input({name:'shared C'})),d=await service.save(input({name:'shared D',secret:'fixture-secret-second'}));const key=(sqlite.prepare('SELECT secret_ref FROM application_connections WHERE id=?').get(c.id) as {secret_ref:string}).secret_ref,oldD=(sqlite.prepare('SELECT secret_ref FROM application_connections WHERE id=?').get(d.id) as {secret_ref:string}).secret_ref;sqlite.prepare('UPDATE application_connections SET secret_ref=? WHERE id=?').run(key,d.id);secrets.delete(oldD);await service.disconnect(c.id,c.revision);const deletion=vi.spyOn(secrets,'delete').mockImplementationOnce(()=>{throw Error('controlled last-reference deletion failure');});const closed=await service.disconnect(d.id,d.revision);expect(closed).toMatchObject({authorization:'disconnected',hasSecret:false,cleanupPending:true});expect(secretCount()).toBe(1);for(const id of[c.id,d.id])expect(()=>service.authentication(id,authVersion(service.get(id)))).toThrow(/授权/);deletion.mockRestore();service=new ApplicationConnectionService(store,secrets,{verify});await service.recoverSecretChanges();expect(secretCount()).toBe(0);for(const id of[c.id,d.id])expect(service.get(id)).toMatchObject({authorization:'disconnected',cleanupPending:false});
  });
  it('revokes before secret cleanup, then recovers cleanup without restoring authorization', async () => {
    const saved = await service.save(input()); const deletion = vi.spyOn(secrets, 'delete').mockImplementationOnce(() => { throw new Error('fixture deletion unavailable'); });
    const disconnected = await service.disconnect(saved.id, saved.revision);
    expect(disconnected).toMatchObject({ authorization: 'disconnected', hasSecret: false, cleanupPending: true }); expect(secretCount()).toBe(1);
    expect(() => service.authentication(saved.id, authVersion(disconnected))).toThrow(/授权/);
    deletion.mockRestore(); await service.recoverSecretChanges();
    expect(service.get(saved.id)).toMatchObject({ authorization: 'disconnected', cleanupPending: false }); expect(secretCount()).toBe(0);
  });
  it('keeps a credential on disable and makes stale in-flight candidate results ineffective', async () => {
    const saved = await service.save(input()); const tested = await service.testCandidate(input({ id: saved.id, expectedRevision: saved.revision, secret: 'late-value' }));
    const disabled = await service.setEnabled(saved.id, false, saved.revision);
    await expect(service.commitCandidate(tested.operationId, tested.candidateHash)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(service.get(saved.id)).toEqual(disabled); expect(secretCount()).toBe(1);
    const enabled = await service.setEnabled(saved.id, true, disabled.revision);
    expect(enabled).toMatchObject({ enabled: true, health: 'unverified' }); expect(service.authentication(saved.id, authVersion(enabled)).secret).toBe('fixture-secret-first');
  });
  it('cancels a newly visible candidate before verification starts and removes only its staged credential', async () => {
    const pending = service.testCandidate(input()); const observed = expect(pending).rejects.toMatchObject({ code: 'CANCELED' });
    let operationId = '';
    await vi.waitFor(() => { const row = sqlite.prepare("SELECT operation_id FROM application_secret_changes WHERE state='preparing'").get() as { operation_id: string } | undefined; expect(row).toBeDefined(); operationId = row!.operation_id; });
    // The row is visible before testCandidate's awaited C continuation resumes.
    expect(verify).not.toHaveBeenCalled();
    await service.discardCandidate(operationId); await observed;
    expect(verify).not.toHaveBeenCalled(); expect(service.list()).toHaveLength(0); expect(secretCount()).toBe(0);
    expect(sqlite.prepare('SELECT state,error_code FROM application_secret_changes WHERE operation_id=?').get(operationId)).toEqual({state:'failed',error_code:'CANCELED'});
  });
  it('cancels a pending candidate and ignores a provider result arriving after cancellation', async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; });
    verify.mockImplementationOnce(async c => { entered(); await gate; return identity(c); });
    const pending = service.testCandidate(input()); const observed = expect(pending).rejects.toMatchObject({ code: 'CANCELED' });
    await ready;
    const row = sqlite.prepare("SELECT operation_id FROM application_secret_changes WHERE state='preparing'").get() as { operation_id: string };
    await service.discardCandidate(row.operation_id); await observed; release(); await Promise.resolve();
    expect(verify).toHaveBeenCalledOnce(); expect(service.list()).toHaveLength(0); expect(secretCount()).toBe(0);
    expect(sqlite.prepare('SELECT state,error_code FROM application_secret_changes WHERE operation_id=?').get(row.operation_id)).toEqual({state:'failed',error_code:'CANCELED'});
  });
  it('bounds a provider that does not finish and discards its staged credential', async () => {
    verify.mockImplementationOnce(async () => new Promise<never>(() => {}));
    const bounded = new ApplicationConnectionService(store, secrets, { verify }, 20);
    await expect(bounded.testCandidate(input())).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(service.list()).toHaveLength(0); expect(secretCount()).toBe(0);
  });
  it('expires a validated candidate without losing an existing credential', async () => {
    const saved = await service.save(input()), tested = await service.testCandidate(input({ id: saved.id, expectedRevision: saved.revision, secret: undefined }));
    sqlite.prepare("UPDATE application_secret_changes SET expires_at='2000-01-01T00:00:00Z' WHERE operation_id=?").run(tested.operationId);
    await expect(service.commitCandidate(tested.operationId, tested.candidateHash)).rejects.toMatchObject({ code: 'CONFIG_PLAN_STALE' });
    expect(secretCount()).toBe(1); expect(service.authentication(saved.id, authVersion(saved)).secret).toBe('fixture-secret-first');
  });
  it('reports incompatible fixed-package authentication and commits only the explicitly reviewed plan', async () => {
    await activateTokenPackage(); const saved = await service.save(input());
    const tested = await service.testCandidate(input({ id: saved.id, expectedRevision: saved.revision, config: { ...config(), authMode: 'password' } as ConnectionConfig, secret: 'password-secret' }));
    expect(tested.compatibility.impacts).toHaveLength(1); expect(tested.compatibility.impacts[0].status).toBe('incompatible');
    await expect(service.commitCandidate(tested.operationId, tested.candidateHash)).rejects.toMatchObject({ code: 'CONFIG_INCOMPATIBLE' });
    expect(service.get(saved.id).config).toEqual(config());
    const changed = await service.commitCandidate(tested.operationId, tested.candidateHash, tested.compatibility.planHash);
    expect(changed.config).toMatchObject({ authMode: 'password' }); expect(changed.identityRevision).toBe(saved.identityRevision);
  });
  it('rejects a compatibility plan if a new historical package reference appeared after testing', async () => {
    const pkg = await activateTokenPackage(), saved = await service.save(input());
    const tested = await service.testCandidate(input({ id: saved.id, expectedRevision: saved.revision, secret: 'candidate-value' }));
    sqlite.prepare(`INSERT INTO capability_session_snapshots VALUES('fixture-history',2,?,'new-snapshot-hash','2026-10-20','created','active')`).run(canonicalJson({ packages: [{ bindings: [{ connectionId: saved.id }] }] }));
    sqlite.prepare('INSERT INTO capability_session_refs VALUES(?,?,?,?,?)').run('fixture-history', 'application-package', pkg.resourceId, pkg.packageHash, pkg.relativePath);
    await expect(service.commitCandidate(tested.operationId, tested.candidateHash)).rejects.toMatchObject({ code: 'CONFIG_PLAN_STALE' });
    expect(service.get(saved.id)).toEqual(saved); expect(secretCount()).toBe(1);
  });
});


describe('host-parent connection verification cancellation',()=>{
 it('does not invoke a provider or stage credentials for an already cancelled parent',async()=>{
  const parent=new AbortController();parent.abort();await expect(service.testCandidate(input(),parent.signal)).rejects.toMatchObject({code:'CANCELED'});expect(verify).not.toHaveBeenCalled();expect(secretCount()).toBe(0);expect(sqlite.prepare('SELECT count(*) n FROM application_secret_changes').get()).toEqual({n:0});
 });
 it('does not stage a credential or start a provider after cancellation while C acquisition was queued',async()=>{
  const lock=join(store.root,'locks/resource.lock');mkdirSync(lock,{recursive:true});writeFileSync(join(lock,'owner.json'),JSON.stringify({token:'private-parent-cancel-fixture',pid:process.pid}));
  const parent=new AbortController(),testing=service.testCandidate(input(),parent.signal);parent.abort();rmSync(lock,{recursive:true});await expect(testing).rejects.toMatchObject({code:'CANCELED'});expect(verify).not.toHaveBeenCalled();expect(secretCount()).toBe(0);expect(sqlite.prepare('SELECT count(*) n FROM application_secret_changes').get()).toEqual({n:0});
 });
 it('propagates a parent cancellation and discards only its candidate despite a late successful provider result',async()=>{
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);verify.mockImplementationOnce(async c=>{entered();await gate;return identity(c);});
  const parent=new AbortController(),testing=service.testCandidate(input(),parent.signal),rejected=expect(testing).rejects.toMatchObject({code:'CANCELED'});await ready;parent.abort();await rejected;release();await Promise.resolve();
  expect(service.list()).toEqual([]);expect(secretCount()).toBe(0);expect(sqlite.prepare("SELECT state,error_code FROM application_secret_changes").get()).toEqual({state:'failed',error_code:'CANCELED'});
 });
});


describe('configuration conversion evidence at candidate commit',()=>{
 it('rejects a candidate when converter implementation changes after verification',async()=>{
  await activateTokenPackage();const saved=await service.save(input());
  const tested=await service.testCandidate(input({id:saved.id,expectedRevision:saved.revision,secret:'replacement-secret'}));
  const original=builtinConfigViews.resolve.bind(builtinConfigViews);
  vi.spyOn(builtinConfigViews,'resolve').mockImplementation((...args)=>({...original(...args),converterHash:'f'.repeat(64)}));
  await expect(service.commitCandidate(tested.operationId,tested.candidateHash)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});
  expect(service.get(saved.id)).toEqual(saved);expect(service.authentication(saved.id,authVersion(saved)).secret).toBe('fixture-secret-first');
 });
 it('reports a missing converter for the active package without staging a false compatible claim',async()=>{
  const pkg=await activateTokenPackage();
  vi.spyOn(builtinConfigViews,'resolve').mockImplementation(()=>{throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','missing fixture converter');});
  const plan=service.planConfigChange(undefined,0,config());
  expect(plan.impacts).toEqual([expect.objectContaining({packageHash:pkg.packageHash,status:'unverified'})]);
  expect(service.list()).toEqual([]);expect(secretCount()).toBe(0);
 });
});

it('refuses a converter output that violates the retained package input schema',async()=>{
 const pkg=await activateTokenPackage(),original=builtinConfigViews.resolve.bind(builtinConfigViews);
 vi.spyOn(builtinConfigViews,'resolve').mockImplementation((...args)=>({...original(...args),view:{...config(),authMode:'password'}}));
 const plan=service.planConfigChange(undefined,0,config());expect(plan.impacts).toEqual([expect.objectContaining({packageHash:pkg.packageHash,status:'incompatible'})]);expect(service.list()).toEqual([]);expect(secretCount()).toBe(0);
});
