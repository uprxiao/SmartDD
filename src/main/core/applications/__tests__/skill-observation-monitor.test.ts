import {afterEach,expect,it,vi} from 'vitest';
import {SkillObservationMonitor} from '../skill-observation-monitor';
afterEach(()=>vi.useRealTimers());
it('collects without a UI query, serializes slow reads and cancels on run revocation',async()=>{
 vi.useFakeTimers();let finish!:()=>void;const collect=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const monitor=new SkillObservationMonitor(collect,20),abort=new AbortController();monitor.start('task','run',abort.signal);
 expect(collect).toHaveBeenCalledExactlyOnceWith('task','run');await vi.advanceTimersByTimeAsync(100);expect(collect).toHaveBeenCalledTimes(1);
 finish();await vi.advanceTimersByTimeAsync(20);expect(collect).toHaveBeenCalledTimes(2);
 abort.abort();finish();await vi.advanceTimersByTimeAsync(100);expect(collect).toHaveBeenCalledTimes(2);monitor.close();
});
it('continues after an unavailable observation and stops at host shutdown',async()=>{
 vi.useFakeTimers();const collect=vi.fn().mockRejectedValueOnce(new Error('not yet bound')).mockResolvedValue(undefined),monitor=new SkillObservationMonitor(collect,20),abort=new AbortController();
 monitor.start('task','run',abort.signal);await vi.advanceTimersByTimeAsync(20);expect(collect).toHaveBeenCalledTimes(2);monitor.close();await vi.advanceTimersByTimeAsync(100);expect(collect).toHaveBeenCalledTimes(2);
 monitor.start('other','other',abort.signal);expect(collect).toHaveBeenCalledTimes(2);
});
it('never starts with a revoked run',()=>{const collect=vi.fn(),monitor=new SkillObservationMonitor(collect),abort=new AbortController();abort.abort();monitor.start('task','run',abort.signal);expect(collect).not.toHaveBeenCalled();monitor.close();});

it('keeps simultaneous run ownership independent and cancels pending work at shutdown',async()=>{
 vi.useFakeTimers();const resolvers:(()=>void)[]=[],collect=vi.fn(()=>new Promise<void>(resolve=>resolvers.push(resolve))),monitor=new SkillObservationMonitor(collect,20),a=new AbortController(),b=new AbortController();
 monitor.start('task-a','run-a',a.signal);monitor.start('task-b','run-b',b.signal);expect(collect.mock.calls).toEqual([['task-a','run-a'],['task-b','run-b']]);
 a.abort();resolvers[0]();resolvers[1]();await vi.advanceTimersByTimeAsync(20);expect(collect).toHaveBeenCalledTimes(3);expect(collect).toHaveBeenLastCalledWith('task-b','run-b');
 monitor.close();resolvers[2]();await vi.advanceTimersByTimeAsync(100);expect(collect).toHaveBeenCalledTimes(3);expect(vi.getTimerCount()).toBe(0);
});

it('refreshes after native binding without waiting for the polling interval or overlapping reads',async()=>{
 vi.useFakeTimers();const finishes:(()=>void)[]=[],collect=vi.fn(()=>new Promise<void>(resolve=>finishes.push(resolve)));
 const monitor=new SkillObservationMonitor(collect,2000),abort=new AbortController();
 monitor.start('task','run',abort.signal);
 monitor.start('task','run',abort.signal);monitor.start('task','run',abort.signal);
 expect(collect).toHaveBeenCalledTimes(1);finishes[0]();
 await vi.advanceTimersByTimeAsync(0);expect(collect).toHaveBeenCalledTimes(2);
 finishes[1]();await vi.advanceTimersByTimeAsync(0);
 monitor.start('task','run',abort.signal);expect(collect).toHaveBeenCalledTimes(3);
 abort.abort();finishes[2]();await vi.advanceTimersByTimeAsync(4000);expect(collect).toHaveBeenCalledTimes(3);monitor.close();
});
