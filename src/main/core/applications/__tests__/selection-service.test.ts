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
  connections = new ApplicationConnectionService(store, secrets, { verify: async config => ({ providerId: config.kind, serviceId: 'fixture-service', accountId: config.kind === 'foxmail' ? config.account : 'username' in config ? config.username : 'fixture-account', contractMajor: 1 }) });
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
  it.each(['foxmail','smtp'] as const)('rejects ambiguous persisted %s bindings without silently choosing an account',async slot=>{
    await service.setAdded('mail',true,0);const source=await connection('foxmail','source-a'),sender=await connection('smtp','sender-a'),other=await connection(slot,'other');
    const original=await service.select({projectId:'p1',appId:'mail',expectedRevision:0,enabled:true,connections:{foxmail:source.id,smtp:sender.id}});
    // Fault injection: shadow this connection's table with an unconstrained legacy copy.
    // Current schema forbids duplicate slots; test the reader's fail-closed compatibility path.
    sqlite.exec('CREATE TEMP TABLE application_project_bindings AS SELECT * FROM main.application_project_bindings');
    try{
      sqlite.prepare('INSERT INTO temp.application_project_bindings VALUES(?,?,?,?,?)').run('p1','mail',slot,other.id,other.identityRevision);
      for(let attempt=0;attempt<2;attempt++)expect(()=>service.projectSettings('p1','mail')).toThrowError(expect.objectContaining({code:'CONFIG_COMPATIBILITY_UNVERIFIED',message:expect.stringContaining('明确重新选择')}));
      expect(()=>service.requireEnabled('p1','mail')).toThrowError(expect.objectContaining({code:'CONFIG_COMPATIBILITY_UNVERIFIED'}));
      // SE diagnostic: an explicit select is also rejected by the strict reader.
      // This proves fail-closed preservation only, not a working user repair path.
      const before=sqlite.prepare('SELECT * FROM temp.application_project_bindings ORDER BY rowid').all(),changes=sqlite.prepare('SELECT * FROM application_binding_changes ORDER BY rowid').all();
      await expect(service.select({projectId:'p1',appId:'mail',expectedRevision:original.revision,enabled:true,connections:original.connections})).rejects.toMatchObject({code:'CONFIG_COMPATIBILITY_UNVERIFIED'});
      expect(sqlite.prepare('SELECT * FROM temp.application_project_bindings ORDER BY rowid').all()).toEqual(before);expect(sqlite.prepare('SELECT * FROM application_binding_changes ORDER BY rowid').all()).toEqual(changes);
      expect(sqlite.prepare('SELECT count(*) n FROM temp.application_project_bindings WHERE project_id=? AND slot=?').get('p1',slot)).toEqual({n:2});
      expect(stop).not.toHaveBeenCalled();
    }finally{sqlite.exec('DROP TABLE temp.application_project_bindings');}
    expect(service.projectSettings('p1','mail')).toEqual(original);
  });
  it('stops project runs before committing another ZenTao source', async () => {
    await service.setAdded('zentao', true, 0); const a = await connection('zentao'), b = await connection('zentao', 'b');
    const selected = await service.select(selectZen(a.id, 0)); expect(stop).not.toHaveBeenCalled(); live = 1;
    const changed = await service.select(selectZen(b.id, selected.revision));
    expect(stop).toHaveBeenCalledExactlyOnceWith('p1','zentao'); expect(changed.connections.zentao).toBe(b.id); expect(changed.revision).toBe(selected.revision + 1); expect(changed.pendingOperationId).toBeNull();
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

it('PQ records a transaction failure after confirmed stop without claiming that the runs failed to stop',async()=>{
 await service.setAdded('zentao',true,0);const a=await connection('zentao','pq-a'),b=await connection('zentao','pq-b'),old=await service.select(selectZen(a.id,0));live=2;
 sqlite.exec(`CREATE TEMP TRIGGER pq_commit_abort BEFORE INSERT ON main.application_project_bindings WHEN NEW.connection_id='${b.id}' BEGIN SELECT RAISE(ABORT,'PQ_OWN_COMMIT_FAILURE');END;`);
 try{await expect(service.select(selectZen(b.id,old.revision))).rejects.toThrow('PQ_OWN_COMMIT_FAILURE');}finally{sqlite.exec('DROP TRIGGER pq_commit_abort');}
 expect(live).toBe(0);expect(stop).toHaveBeenCalledExactlyOnceWith('p1','zentao');expect(service.projectSettings('p1','zentao')).toEqual(old);
 expect(sqlite.prepare("SELECT state,error_code FROM application_binding_changes WHERE state='failed'").all()).toEqual([{state:'failed',error_code:'CAPABILITY_UNAVAILABLE'}]);
 const retried=await service.select(selectZen(b.id,old.revision));expect(retried.connections.zentao).toBe(b.id);expect(retried.revision).toBe(old.revision+1);
});
it('PQ retains the stop-failure category for an unexpected stop exception before exit is confirmed',async()=>{
 await service.setAdded('zentao',true,0);const a=await connection('zentao','pq-a'),b=await connection('zentao','pq-b'),old=await service.select(selectZen(a.id,0));live=2;stop.mockRejectedValueOnce(new Error('PQ_PRIVATE_STOP_FAILURE'));
 await expect(service.select(selectZen(b.id,old.revision))).rejects.toThrow('PQ_PRIVATE_STOP_FAILURE');expect(live).toBe(2);expect(service.projectSettings('p1','zentao')).toEqual(old);
 expect(sqlite.prepare("SELECT state,error_code FROM application_binding_changes WHERE state='failed'").all()).toEqual([{state:'failed',error_code:'RUN_STOP_FAILED'}]);
});

it('SD never labels a conflict after stopping runs as an initial no-effect rejection',async()=>{
 await service.setAdded('zentao',true,0);const a=await connection('zentao'),b=await connection('zentao','b'),old=await service.select(selectZen(a.id,0));live=1;
 stop.mockImplementationOnce(async()=>{live=0;sqlite.prepare("UPDATE application_project_settings SET binding_revision=binding_revision+1 WHERE project_id='p1'AND app_id='zentao'").run();return true;});
 let error:unknown;try{await service.select(selectZen(b.id,old.revision));}catch(value){error=value;}expect(error).toMatchObject({code:'REVISION_CONFLICT'});expect((error as Error).constructor).toBe(ApplicationError);expect(stop).toHaveBeenCalledExactlyOnceWith('p1','zentao');expect(live).toBe(0);expect(service.projectSettings('p1','zentao')).toMatchObject({connections:{zentao:a.id},pendingOperationId:null});
});

describe('SF explicit recovery keeps strict business reads and untouched raw slots',()=>{
 const rows=()=>sqlite.prepare('SELECT * FROM application_project_bindings ORDER BY project_id,app_id,slot,connection_id').all();
 const versions=()=>sqlite.prepare('SELECT * FROM application_binding_slot_revisions ORDER BY project_id,app_id,slot').all();
 async function mismatchedMail(){await service.setAdded('mail',true,0);const source=await connection('foxmail','sf-source'),sender=await connection('smtp','sf-sender');await service.select({projectId:'p1',appId:'mail',expectedRevision:0,enabled:true,connections:{foxmail:source.id,smtp:sender.id}});sqlite.prepare("UPDATE application_project_bindings SET identity_revision=identity_revision+1 WHERE project_id='p1' AND app_id='mail'").run();return{source,sender};}
 it('offers an unconfirmed UI view,repairs one explicit identity slot and preserves the other until explicitly cleared',async()=>{
  const{source,sender}=await mismatchedMail();const original=rows(),initialVersions=versions(),view=service.projectView('p1','mail');expect(view.repair?.slots).toEqual(['foxmail','smtp']);expect(view.connections).toEqual({foxmail:null,smtp:null});expect(()=>service.projectSettings('p1','mail')).toThrowError(expect.objectContaining({code:'CONFIG_COMPATIBILITY_UNVERIFIED'}));
  const next=await service.select({projectId:'p1',appId:'mail',enabled:true,expectedRevision:view.revision,connections:{foxmail:source.id,smtp:null},repair:{slot:'foxmail',fingerprint:view.repair!.fingerprint}});expect(next.repair?.slots).toEqual(['smtp']);expect(next.connections).toEqual({foxmail:source.id,smtp:null});expect(rows().filter((x:any)=>x.slot==='smtp')).toEqual(original.filter((x:any)=>x.slot==='smtp'));expect(versions().filter((x:any)=>x.slot==='smtp')).toEqual(initialVersions.filter((x:any)=>x.slot==='smtp'));expect(()=>service.requireEnabled('p1','mail')).toThrowError(expect.objectContaining({code:'CONFIG_COMPATIBILITY_UNVERIFIED'}));
  const done=await service.select({projectId:'p1',appId:'mail',enabled:true,expectedRevision:next.revision,connections:{foxmail:source.id,smtp:null},repair:{slot:'smtp',fingerprint:next.repair!.fingerprint}});expect(done.repair).toBeUndefined();expect(done.connections).toEqual({foxmail:source.id,smtp:null});expect(service.requireEnabled('p1','mail')).toEqual(done);expect(connections.get(sender.id)).toEqual(sender);expect(stop).not.toHaveBeenCalled();expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  const audit=sqlite.prepare('SELECT previous_json FROM application_binding_changes ORDER BY rowid DESC LIMIT 1').get()as{previous_json:string};expect(JSON.parse(audit.previous_json).rawBindings).toHaveLength(2);
 });
 it.each(['fingerprint','other-slot','enable','other-project','connection-change','pending'] as const)('rejects %s recovery interference without cleaning or selecting anything',async fault=>{
  const{source,sender}=await mismatchedMail();const v=service.projectView('p1','mail');const input:ProjectApplicationSelectionInput={projectId:'p1',appId:'mail',enabled:true,expectedRevision:v.revision,connections:{foxmail:source.id,smtp:null},repair:{slot:'foxmail',fingerprint:v.repair!.fingerprint}};
  if(fault==='fingerprint')input.repair!.fingerprint='0'.repeat(64);if(fault==='other-slot')input.connections.smtp=sender.id;if(fault==='enable')input.enabled=false;if(fault==='other-project')input.projectId='p2';if(fault==='connection-change')sqlite.prepare('UPDATE application_connections SET revision=revision+1 WHERE id=?').run(source.id);if(fault==='pending')sqlite.prepare("UPDATE application_project_settings SET pending_operation_id='sf-other' WHERE project_id='p1' AND app_id='mail'").run();
  const before=rows(),vbefore=versions(),journal=sqlite.prepare('SELECT * FROM application_binding_changes ORDER BY rowid').all();await expect(service.select(input)).rejects.toBeInstanceOf(ApplicationError);expect(rows()).toEqual(before);expect(versions()).toEqual(vbefore);expect(sqlite.prepare('SELECT * FROM application_binding_changes ORDER BY rowid').all()).toEqual(journal);expect(stop).not.toHaveBeenCalled();
 });
 it('repairs one duplicate legacy slot while preserving the other duplicate and the independent project',async()=>{
  const{source,sender}=await mismatchedMail();const other=await connection('foxmail','sf-other');sqlite.exec('CREATE TEMP TABLE application_project_bindings AS SELECT * FROM main.application_project_bindings');try{sqlite.prepare('INSERT INTO temp.application_project_bindings VALUES(?,?,?,?,?)').run('p1','mail','foxmail',other.id,other.identityRevision);const before=rows(),v=service.projectView('p1','mail');const done=await service.select({projectId:'p1',appId:'mail',enabled:true,expectedRevision:v.revision,connections:{foxmail:other.id,smtp:null},repair:{slot:'foxmail',fingerprint:v.repair!.fingerprint}});expect(done.connections.foxmail).toBe(other.id);expect(done.repair?.slots).toEqual(['smtp']);expect(rows().filter((x:any)=>x.slot==='smtp')).toEqual(before.filter((x:any)=>x.slot==='smtp'));expect(service.projectView('p2','mail').connections).toEqual({foxmail:null,smtp:null});expect(connections.get(source.id)).toEqual(source);expect(connections.get(sender.id)).toEqual(sender);}finally{sqlite.exec('DROP TABLE temp.application_project_bindings');}
 });
 it('never resets a missing slot revision to zero or makes it recoverable',async()=>{
  await mismatchedMail();sqlite.prepare("DELETE FROM application_binding_slot_revisions WHERE project_id='p1' AND slot='smtp'").run();const before=rows();expect(()=>service.projectView('p1','mail')).toThrowError(expect.objectContaining({code:'CONFIG_COMPATIBILITY_UNVERIFIED'}));expect(rows()).toEqual(before);
 });
 it.each(['success','stop-failure','changed-during-stop'] as const)('stops before recovering ambiguous ZenTao identity: %s',async outcome=>{
  await service.setAdded('zentao',true,0);const a=await connection('zentao','sf-z');await service.select(selectZen(a.id,0));sqlite.prepare("UPDATE application_project_bindings SET identity_revision=identity_revision+1 WHERE project_id='p1' AND app_id='zentao'").run();const before=rows(),v=service.projectView('p1','zentao');live=1;stop.mockImplementationOnce(async()=>{expect(rows()).toEqual(before);if(outcome==='stop-failure')return false;live=0;if(outcome==='changed-during-stop')sqlite.prepare('UPDATE application_connections SET revision=revision+1 WHERE id=?').run(a.id);return true;});const input:ProjectApplicationSelectionInput={projectId:'p1',appId:'zentao',enabled:true,expectedRevision:v.revision,connections:{zentao:a.id},repair:{slot:'zentao',fingerprint:v.repair!.fingerprint}};
  if(outcome==='success'){const next=await service.select(input);expect(next.repair).toBeUndefined();expect(service.requireEnabled('p1','zentao').connections.zentao).toBe(a.id);}else{let error:unknown;try{await service.select(input);}catch(e){error=e;}expect(error).toBeInstanceOf(ApplicationError);expect((error as Error).constructor).toBe(ApplicationError);expect(rows()).toEqual(before);expect(service.projectView('p1','zentao').pendingOperationId).toBeNull();}expect(stop).toHaveBeenCalledExactlyOnceWith('p1','zentao');
 });
});
