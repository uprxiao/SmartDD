import {it,expect} from 'vitest';
import {runFixture,FixtureProcessReader} from './run-fixture';
import {acquireDatabaseAccess} from '../../../db/database-access-gate';
import {activatePreparedPackages} from '../activation-maintenance';

// Real run/session/resource/activation services and SQLite. Native process identity
// is a fixture; no actual CLI is launched, so this is service integration only.
it.skipIf(process.platform!=='darwin').each(['reserved','prepared'] as const)('blocks activation for a real %s run reservation, then resumes after cancellation',async phase=>{
 const f=await runFixture(new FixtureProcessReader(),{application:true,fullProjection:true});
 const lease=await acquireDatabaseAccess(f.root,'maintenance');
 try{
  const target=f.application!,prior=f.packageRegistry.active(target.appId),requests=[{hash:target.packageHash,expectedGeneration:prior?.generation??0}];
  const run=await f.create();if(phase==='prepared')await run.prepare();
  const refs=f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all();
  await expect(activatePreparedPackages({packages:f.packageRegistry,lease,buildId:'run-competition',requests})).rejects.toThrow('尚未停妥');
  expect(f.packageRegistry.active(target.appId)).toEqual(prior);
  expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_operations WHERE kind='application-activation'").get()).toEqual({n:0});
  expect(f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all()).toEqual(refs);
  if(phase==='prepared')await run.cancelBeforeFork();
  else {await run.cli.cancelBeforeLaunch();await run.stop();}
  expect(f.runs.get(run.runId).state).toBe('stopped');
  const result=await activatePreparedPackages({packages:f.packageRegistry,lease,buildId:'run-competition',requests});
  expect(f.packageRegistry.active(target.appId)).toEqual(result.result[0]);
  expect(f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_id').all()).toEqual(refs);
 }finally{await f.runs.dispose();lease.release();f.cleanup();}
},20000);
