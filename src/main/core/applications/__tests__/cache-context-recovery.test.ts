import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
import {CapabilityBundleSource} from '../bundle-source';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {RuntimeRegistry} from '../runtime-registry';
import {canonicalJson,digest} from '../manifest';
import {recoverApplicationCacheClears,recoverApplicationCacheStatus} from '../cache-context-recovery';
import {recoverApplicationReads} from '../read-context-recovery';
let f:Awaited<ReturnType<typeof agentFixture>>,reader:FixtureProcessReader,hash:string;
const owner={pid:77161,startedAt:'darwin-proc-v1:500:61'};
beforeEach(async()=>{f=await agentFixture();reader=new FixtureProcessReader();const source=new CapabilityBundleSource(resolve('out/capability-bundles-compatibility-v1'));await new RuntimeRegistry(f.store).install(source.runtime());hash=(await new BuiltinPackageRegistry(f.store).install(source,source.index.apps.find(a=>a.appId==='mail')!)).packageHash;});
afterEach(()=>f.cleanup());
function recordedContext(kind:'clear'|'status'){
 const action='application.cache.'+kind,semantics=kind==='clear'?'write':'read';
 const id=randomUUID(),lease=randomUUID(),scope=digest(canonicalJson({callerKind:'ui',scopeKind:'connection-management',projectId:null,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:'mail',packageHash:hash,action,semantics,policy:null}));
 f.sqlite.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES(?,'ui','connection-management','mail',?,1,?,?,?,'running',?)").run(id,hash,action,semantics,scope,new Date().toISOString());
 f.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'ui',?,?,?,?,'active',?)").run(lease,'app:'+hash,id,randomUUID(),owner.pid,owner.startedAt,new Date().toISOString());return{id,lease};
}
const op=(id:string)=>f.sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(id) as {state:string;error_code:string|null;ended_at:string|null};
const held=(id:string)=>f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(id) as {state:string};
describe.each(['clear','status'] as const)('proved stopped cache %s program consumer',kind=>{
 const recorded=()=>recordedContext(kind),recover=kind==='clear'?recoverApplicationCacheClears:recoverApplicationCacheStatus;
 const outcome=kind==='clear'?{state:'unknown',error_code:'RESOURCE_RECOVERY_REQUIRED'}:{state:'cancelled',error_code:'CANCELED'};
 it('ends only the dead host consumer, records the appropriate interrupted outcome and preserves business/resource rows',async()=>{const c=recorded(),resources=f.sqlite.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all(),projects=f.sqlite.prepare('SELECT * FROM projects').all();expect((await recoverApplicationReads(f.store,reader)).released).toEqual([]);expect((await recover(f.store,reader)).released).toEqual([c.lease]);expect(held(c.lease).state).toBe('released');expect(op(c.id)).toMatchObject(outcome);expect(op(c.id).ended_at).toBeTruthy();expect(f.sqlite.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all()).toEqual(resources);expect(f.sqlite.prepare('SELECT * FROM projects').all()).toEqual(projects);expect(await recover(f.store,reader)).toEqual({released:[],pending:[]});});
 it.each(['running','unknown'] as const)('keeps a %s owner and original partial outcome untouched',async state=>{const c=recorded();reader.identities.set(owner.pid,owner.startedAt);if(state==='unknown')reader.unknown.add(owner.pid);const before=f.sqlite.serialize();expect((await recover(f.store,reader)).pending).toContainEqual({leaseId:c.lease,reason:'owner-'+state});expect(f.sqlite.serialize()).toEqual(before);});
 it('uses original kernel birth identity when the numeric PID has been reused',async()=>{const c=recorded();reader.identities.set(owner.pid,'darwin-proc-v1:900:1');expect((await recover(f.store,reader)).released).toEqual([c.lease]);});
 it.each(['succeeded','failed','cancelled','unknown'])('preserves a recorded %s effect instead of inventing another outcome',async state=>{const c=recorded();f.sqlite.prepare("UPDATE application_data_operations SET state=?,error_code='CANCELED',ended_at='original' WHERE operation_id=?").run(state,c.id);const before=op(c.id);expect((await recover(f.store,reader)).released).toEqual([c.lease]);expect(op(c.id)).toEqual(before);});
 it.each([
  `UPDATE application_data_operations SET semantics='${kind==='clear'?'read':'write'}'`,
  "UPDATE application_data_operations SET scope_hash='bad'",
  "UPDATE application_data_operations SET targets_json='[{\"slot\":\"smtp\"}]'",
  "UPDATE application_data_operations SET project_id='p1'",
  "UPDATE application_data_operations SET caller_kind='agent-run',scope_kind='project',project_id='p1',task_id='foreign-task',run_id='foreign-run'",
  "UPDATE application_data_operations SET data_api=2",
  "UPDATE capability_resource_leases SET process_started_at='pid-only'",
  "UPDATE capability_resources SET owner_store_id='foreign' WHERE kind='application-package'",
 ])('holds an unverified cache-clear identity: %s',async mutation=>{recorded();f.sqlite.exec(mutation);const before=f.sqlite.serialize();expect((await recover(f.store,reader)).released).toEqual([]);expect(f.sqlite.serialize()).toEqual(before);});
 it('never handles another write action or installer reservation',async()=>{const a=recorded(),b=recorded();f.sqlite.prepare("UPDATE application_data_operations SET action='ui.mail.send.execute',state='unknown' WHERE operation_id=?").run(a.id);f.sqlite.prepare("UPDATE capability_resource_leases SET owner_kind='install' WHERE lease_id=?").run(b.lease);const before=f.sqlite.serialize();expect((await recover(f.store,reader)).released).toEqual([]);expect(f.sqlite.serialize()).toEqual(before);});
 it('keeps incomplete historical schemas on hold',async()=>{const c=recorded();f.sqlite.exec('ALTER TABLE application_data_operations RENAME COLUMN targets_json TO old_targets');const before=f.sqlite.serialize();expect((await recover(f.store,reader)).pending).toContainEqual({leaseId:c.lease,reason:'schema-unverified'});expect(f.sqlite.serialize()).toEqual(before);});
 it('probes outside the C transaction and retains any snapshot changed before the commit',async()=>{const c=recorded(),state=reader.state.bind(reader);reader.state=identity=>{expect(f.sqlite.inTransaction).toBe(false);f.sqlite.prepare('UPDATE capability_resource_leases SET host_instance_id=? WHERE lease_id=?').run(randomUUID(),c.lease);return state(identity);};expect((await recover(f.store,reader)).pending).toContainEqual({leaseId:c.lease,reason:'record-changed'});expect(held(c.lease).state).toBe('active');expect(op(c.id).state).toBe('running');});
 it('rolls back both unknown outcome and lease release on a transaction failure, then retries the original proof',async()=>{const c=recorded(),before=op(c.id);f.sqlite.exec("CREATE TRIGGER cache_release_failure BEFORE UPDATE ON capability_resource_leases BEGIN SELECT RAISE(ABORT,'cache release failure'); END");await expect(recover(f.store,reader)).rejects.toThrow('cache release failure');expect(op(c.id)).toEqual(before);expect(held(c.lease).state).toBe('active');f.sqlite.exec('DROP TRIGGER cache_release_failure');expect((await recover(f.store,reader)).released).toEqual([c.lease]);});
});
