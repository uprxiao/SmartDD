import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {DiscoveryCatalog} from '../discovery-catalog';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
let f:Awaited<ReturnType<typeof agentFixture>>,reader:FixtureProcessReader,catalog:DiscoveryCatalog;
beforeEach(async()=>{f=await agentFixture();reader=new FixtureProcessReader();catalog=new DiscoveryCatalog(f.store,f.home,reader);});
afterEach(()=>f.cleanup());
async function early(){
  const sources=f.projector.sourceSkills(f.plan('codex')),file=join(catalog.root,'pending.json');let bytes!:Buffer;
  const original=new DiscoveryCatalog(f.store,f.home,reader,{intentCheckpoint:()=>{bytes=readFileSync(file);throw Error('captured pre-C intent');}});
  await expect(original.publish(sources)).rejects.toThrow('captured pre-C');
  // The live failure rolls itself back. Restore its exact captured pre-C bytes
  // as a controlled persistent-state fixture; actual SIGKILL is tested separately.
  expect(existsSync(file)).toBe(false);writeFileSync(file,bytes);
  const intent=JSON.parse(bytes.toString());reader.identities.set(process.pid,'darwin-proc-v1:999:42');catalog=new DiscoveryCatalog(f.store,f.home,reader);
  return{sources,file,bytes,intent};
}
describe('early H intent recovery refuses unknown ownership and partial C footprints',()=>{
  it('registers and completes the same stopped pre-C intent without substituting source versions',async()=>{
    const x=await early(),before=x.sources.map(s=>f.snapshotTree(f.store.directory(f.store.get(s.sourceResourceId)))),done=await catalog.recover(x.intent.operationId,x.sources);
    catalog.verify(done);expect(done.entries.map(e=>e.sourceHash).sort()).toEqual(x.sources.map(s=>s.sourceHash).sort());
    expect(x.sources.map(s=>f.snapshotTree(f.store.directory(f.store.get(s.sourceResourceId))))).toEqual(before);
    expect(f.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=?').get(x.intent.operationId)).toEqual({state:'committed'});
  });
  it.each(['running','unknown'] as const)('preserves a %s original pre-C owner and all intent bytes',async state=>{
    const x=await early();if(state==='running')reader.identities.set(process.pid,x.intent.owner.startedAt);else reader.unknown.add(process.pid);
    await expect(catalog.recover(x.intent.operationId,x.sources)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(x.file)).toEqual(x.bytes);expect(f.sqlite.prepare('SELECT 1 FROM capability_resource_operations WHERE operation_id=?').get(x.intent.operationId)).toBeUndefined();
  });
  it.each(['staging','target','target-link','resource','lease','operation','advanced-phase','source'] as const)('preserves a pre-C %s inconsistency instead of inventing a fresh operation',async kind=>{
    const x=await early(),source=x.sources[0],target=dirname(source.path),ledger=()=>({operations:f.sqlite.prepare('SELECT * FROM capability_resource_operations ORDER BY operation_id').all(),leases:f.sqlite.prepare('SELECT * FROM capability_resource_leases ORDER BY lease_id').all(),resources:f.sqlite.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all()});
    if(kind==='staging')mkdirSync(join(catalog.root,'staging',x.intent.operationId));
    if(kind==='target'){mkdirSync(target,{recursive:true});writeFileSync(join(target,'user-data'),'preserve');}
    if(kind==='target-link'){mkdirSync(dirname(target),{recursive:true});symlinkSync(join(f.root,'user-missing-target'),target);}
    if(kind==='resource')f.sqlite.prepare('UPDATE capability_resources SET operation_id=? WHERE resource_id=?').run(x.intent.operationId,source.sourceResourceId);
    if(kind==='lease')f.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,state,created_at) VALUES(?,?,'install',?,'unverified-resumer','recovery-required',?)").run(randomUUID(),source.sourceResourceId,x.intent.operationId,new Date().toISOString());
    if(kind==='operation')f.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'different-operation',?,'preparing','{}',?,?)").run(x.intent.operationId,f.store.storeId,new Date().toISOString(),new Date().toISOString());
    if(kind==='advanced-phase'){x.intent.phase='materializing';writeFileSync(x.file,JSON.stringify(x.intent));}
    if(kind==='source')writeFileSync(join(f.store.directory(f.store.get(source.sourceResourceId)),'SKILL.md'),'source no longer matches');
    const before=ledger(),bytes=readFileSync(x.file);
    await expect(catalog.recover(x.intent.operationId,x.sources)).rejects.toBeDefined();expect(readFileSync(x.file)).toEqual(bytes);expect(ledger()).toEqual(before);if(kind==='target')expect(readFileSync(join(target,'user-data'),'utf8')).toBe('preserve');
  });
});
