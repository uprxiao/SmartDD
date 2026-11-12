import {describe,it,expect} from 'vitest';
import {FixtureProcessReader,runFixture} from './run-fixture';

describe('explicit host-only no-fork cancellation, distinct from exit/recovery',()=>{
  it.each(['reserved','armed'] as const)('cancels a known %s window without inventing a PID or exit',async state=>{
    const f=await runFixture();try{
      const run=await f.create();await run.prepare();const bridge=await run.reserveBridge();if(state==='armed')await bridge.arm();
      await bridge.cancelUnforked!();expect(f.sqlite.prepare('SELECT state,pid,process_started_at FROM capability_run_processes WHERE process_id=?').get(bridge.processId)).toEqual({state:'canceled',pid:null,process_started_at:null});
      await run.cancelBeforeFork();expect(f.runs.get(run.runId).state).toBe('stopped');
    }finally{f.cleanup();}
  });
  it('refuses the actual attached process and requires its own exit observation',async()=>{
    const reader=new FixtureProcessReader(),f=await runFixture(reader);try{
      const run=await f.create();await run.prepare();const bridge=await run.reserveBridge();await bridge.arm();reader.identities.set(992001,'darwin-proc-v1:2026:992001');await bridge.attach(992001);
      await expect(bridge.cancelUnforked!()).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(f.sqlite.prepare('SELECT state,pid FROM capability_run_processes WHERE process_id=?').get(bridge.processId)).toEqual({state:'active',pid:992001});
      reader.identities.delete(992001);await bridge.exited();await run.cli.cancelUnforked!();await run.stop();expect(f.runs.get(run.runId).state).toBe('stopped');
    }finally{f.cleanup();}
  });
  it('keeps an unknown fork window occupied even though no PID was recovered',async()=>{
    const f=await runFixture();try{
      const run=await f.create();await run.prepare();const bridge=await run.reserveBridge();await bridge.arm();await expect(bridge.attach(0)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});
      await expect(bridge.cancelUnforked!()).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});await run.stop();expect(f.runs.get(run.runId).state).toBe('stopping');expect(f.sqlite.prepare('SELECT state,pid FROM capability_run_processes WHERE process_id=?').get(bridge.processId)).toEqual({state:'unknown',pid:null});
    }finally{f.cleanup();}
  });
});
