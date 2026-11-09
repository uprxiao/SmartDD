import {afterEach,expect,it,vi} from 'vitest';
import {BrowserAutomation} from '../automation';

const fixtures:BrowserAutomation[]=[];
afterEach(()=>{fixtures.splice(0).forEach(value=>value.dispose());vi.useRealTimers();vi.restoreAllMocks();});
function fixture(){const changed=vi.fn(),ended=vi.fn(),automation=new BrowserAutomation({changed,ended}),run=new AbortController(),binding={runId:'R1',taskId:'T1',projectId:'P1',signal:run.signal};fixtures.push(automation);automation.track(binding);return{automation,changed,ended,run,binding};}
it('keeps activity through concurrent commands and exactly20seconds after the last completion',()=>{
  vi.useFakeTimers();const f=fixture(),first=f.automation.begin('R1','T1','page'),last=f.automation.begin('R1','T1','page');
  first();vi.advanceTimersByTime(21000);expect(f.automation.activity('page')).toEqual({active:true,running:true,holdUntil:null});last();last();const deadline=Date.now()+20000;
  vi.advanceTimersByTime(19999);expect(f.automation.activity('page')).toEqual({active:true,running:false,holdUntil:deadline});vi.advanceTimersByTime(1);expect(f.automation.activity('page')).toEqual({active:false,running:false,holdUntil:null});expect(vi.getTimerCount()).toBe(0);
});
it('ending a run clears its pause and in-flight activity, with a bounded tail and no inheritance',()=>{
  vi.useFakeTimers();const f=fixture();f.automation.begin('R1','T1','page');f.automation.pause('T1',true);f.run.abort();expect(f.ended).toHaveBeenCalledExactlyOnceWith('R1');expect(f.automation.paused('T1')).toBe(false);expect(f.automation.activity('page')).toEqual({active:true,running:false,holdUntil:Date.now()+20000});
  f.automation.track({...f.binding,runId:'R2',signal:new AbortController().signal});expect(f.automation.paused('T1')).toBe(false);vi.advanceTimersByTime(20000);expect(f.automation.activity('page').active).toBe(false);
});
it('replaces a completed command deadline only after the next command actually finishes',()=>{
  vi.useFakeTimers();vi.setSystemTime(10000);const f=fixture();
  f.automation.begin('R1','T1','page')();expect(f.automation.activity('page').holdUntil).toBe(30000);
  vi.advanceTimersByTime(19000);const finish=f.automation.begin('R1','T1','page');
  expect(f.automation.activity('page')).toEqual({active:true,running:true,holdUntil:null});
  vi.advanceTimersByTime(2000);expect(f.automation.activity('page').active).toBe(true);
  finish();expect(f.automation.activity('page').holdUntil).toBe(51000);
  f.automation.pause('T1',true);expect(f.automation.activity('page').holdUntil).toBe(51000);
  vi.advanceTimersByTime(19000);expect(f.automation.activity('page').holdUntil).toBe(51000);
  vi.advanceTimersByTime(1000);expect(f.automation.activity('page')).toEqual({active:false,running:false,holdUntil:null});
});
it('binds a target pause to its own run when present, otherwise to incoming driver runs',()=>{
  const f=fixture(),other=new AbortController();f.automation.target('R1','T2');f.automation.pause('T2',true);f.run.abort();expect(f.automation.paused('T2')).toBe(false);
  const caller=new AbortController();f.automation.track({...f.binding,runId:'R3',signal:caller.signal});f.automation.track({...f.binding,runId:'R2',taskId:'T2',signal:other.signal});f.automation.target('R3','T2');f.automation.pause('T2',true);caller.abort();expect(f.automation.paused('T2')).toBe(true);expect(f.automation.paused('T1')).toBe(false);other.abort();expect(f.automation.paused('T2')).toBe(false);
});
it('forgets idle pauses on new actual runs, rejects forged identities and cleans timers on disposal',()=>{
  vi.useFakeTimers();const f=fixture();f.automation.pause('T2',true);f.automation.track({...f.binding,runId:'R2',taskId:'T2',signal:new AbortController().signal});expect(f.automation.paused('T2')).toBe(false);
  expect(()=>f.automation.track({...f.binding,taskId:'T2'})).toThrow();expect(()=>f.automation.track({...f.binding,signal:new AbortController().signal})).toThrow();const finish=f.automation.begin('R1','T1','page');finish();f.automation.dispose();expect(vi.getTimerCount()).toBe(0);expect(f.automation.activity('page').active).toBe(false);
});
it('does not lose lifetime cleanup when the renderer notification throws',()=>{
  vi.useFakeTimers();vi.spyOn(console,'warn').mockImplementation(()=>{});const f=fixture();f.changed.mockImplementation(()=>{throw Error('window closed');});expect(()=>{f.automation.begin('R1','T1','page');f.automation.pause('T1',true);f.run.abort();vi.advanceTimersByTime(20000);}).not.toThrow();expect(f.automation.paused('T1')).toBe(false);expect(f.ended).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
