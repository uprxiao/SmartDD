import {afterEach,describe,expect,it,vi} from 'vitest';
import {BrowserDeferredReferenceGuards} from '../deferred-reference';

afterEach(()=>vi.useRealTimers());
const good=()=>({blocked:[],accepted:['mousedown','mouseup','click'],connected:true});
describe('retained references across a synchronous JavaScript dialog',()=>{
  it('does not send JavaScript cleanup while a dialog is open, then finishes the original click once',async()=>{
    const guards=new BrowserDeferredReferenceGuards(),inspect=vi.fn(async()=>good()),finish=vi.fn(async()=>good());
    guards.opening('owned-dialog');
    expect(guards.defer({id:'exact-node',inspect,finish})).toMatchObject({pending:true});
    await expect(guards.settle()).resolves.toEqual({pending:true,blocked:false});
    expect(inspect).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
    await expect(guards.assertReady()).rejects.toThrow('先处理');
    guards.closed('owned-dialog');
    await Promise.all([guards.settle(),guards.settle()]);
    expect(inspect).toHaveBeenCalledOnce();expect(finish).toHaveBeenCalledOnce();expect(guards.pending).toBe(false);
  });
  it('keeps the guard until the actual delayed release produces a click',async()=>{
    vi.useFakeTimers();
    const guards=new BrowserDeferredReferenceGuards(),inspect=vi.fn().mockResolvedValueOnce({blocked:[],accepted:['mousedown'],connected:true}).mockResolvedValue(good()),finish=vi.fn(async()=>good());
    guards.defer({id:'node',inspect,finish});const result=guards.settle();
    await vi.advanceTimersByTimeAsync(0);expect(finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);await expect(result).resolves.toEqual({pending:false,blocked:false});expect(finish).toHaveBeenCalledOnce();
  });
  it('reports a replaced node and preserves blocked activation evidence',async()=>{
    const guards=new BrowserDeferredReferenceGuards(),failed=vi.fn(),state={blocked:['mouseup','click'],accepted:['mousedown'],connected:false};
    guards.defer({id:'old-node',inspect:async()=>state,finish:async()=>state,failed});
    await expect(guards.settle()).resolves.toEqual({pending:false,blocked:true});expect(failed).toHaveBeenCalledOnce();
  });
  it('waits for cancellation of a future or in-flight release before disarming a disconnected target',async()=>{
    const guards=new BrowserDeferredReferenceGuards();let stop!:()=>void;const cancel=vi.fn(()=>new Promise<void>(resolve=>{stop=resolve;})),state={blocked:[],accepted:['mousedown'],connected:false},finish=vi.fn(async()=>state);
    guards.defer({id:'old',inspect:async()=>state,finish,cancel});const result=guards.settle();
    await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());expect(finish).not.toHaveBeenCalled();stop();await expect(result).resolves.toEqual({pending:false,blocked:true});expect(finish).toHaveBeenCalledOnce();
  });
  it('records a stopped run as unknown while retaining the old guard until completion',async()=>{
    const guards=new BrowserDeferredReferenceGuards(),run=new AbortController(),failed=vi.fn(),completed=vi.fn();guards.opening('dialog');
    guards.defer({id:'node',signal:run.signal,failed,completed,inspect:async()=>good(),finish:async()=>good()});run.abort();
    expect(failed).toHaveBeenCalledWith('unknown');expect(guards.pending).toBe(true);guards.closed('dialog');await guards.settle();expect(completed).toHaveBeenCalledOnce();
  });
  it('removes a completed run observer so it cannot change an already finished receipt',async()=>{
    const guards=new BrowserDeferredReferenceGuards(),run=new AbortController(),failed=vi.fn();guards.defer({id:'node',signal:run.signal,failed,inspect:async()=>good(),finish:async()=>good()});
    await guards.settle();run.abort();expect(failed).not.toHaveBeenCalled();
  });
  it('does not dispatch a missing release until the dialog is answered',async()=>{
    const guards=new BrowserDeferredReferenceGuards(),resume=vi.fn(async()=>true),finish=vi.fn(async()=>good());
    guards.opening('dialog');guards.defer({id:'node',resume,inspect:async()=>good(),finish});
    await guards.settle();expect(resume).not.toHaveBeenCalled();
    guards.closed('dialog');await guards.settle();await guards.settle();expect(resume).toHaveBeenCalledOnce();expect(finish).toHaveBeenCalledOnce();
  });
  it('retains a continuation that was interrupted before dispatch',async()=>{
    const guards=new BrowserDeferredReferenceGuards();const resume=vi.fn().mockImplementationOnce(async()=>{guards.opening('second');return false;}).mockResolvedValue(true);
    guards.defer({id:'node',resume,inspect:async()=>good(),finish:async()=>good()});
    await expect(guards.settle()).resolves.toMatchObject({pending:true});guards.closed('second');
    await expect(guards.settle()).resolves.toMatchObject({pending:false});expect(resume).toHaveBeenCalledTimes(2);
  });
  it('does not disarm after a new dialog interrupts a read-only inspection',async()=>{
    const guards=new BrowserDeferredReferenceGuards();let resolve!:(value:ReturnType<typeof good>)=>void;
    const inspect=vi.fn(()=>new Promise<ReturnType<typeof good>>(done=>{resolve=done;})),finish=vi.fn(async()=>good());
    guards.defer({id:'node',inspect,finish});const pending=guards.settle();guards.opening('second');
    await expect(pending).resolves.toMatchObject({pending:true});expect(finish).not.toHaveBeenCalled();
    resolve(good());guards.closed('second');inspect.mockResolvedValue(good());await guards.settle();expect(finish).toHaveBeenCalledOnce();
  });
  it('keeps the same cleanup promise if a second dialog interrupts its completion',async()=>{
    const guards=new BrowserDeferredReferenceGuards();let finish!:(value:ReturnType<typeof good>)=>void;
    const cleanup=vi.fn(()=>{guards.opening('second');return new Promise<ReturnType<typeof good>>(resolve=>{finish=resolve;});});
    guards.defer({id:'node',inspect:async()=>good(),finish:cleanup});await expect(guards.settle()).resolves.toMatchObject({pending:true});
    expect(cleanup).toHaveBeenCalledOnce();guards.closed('second');finish(good());await expect(guards.settle()).resolves.toMatchObject({pending:false});expect(cleanup).toHaveBeenCalledOnce();
  });
  it('does not clean up an old document after navigation discards its pending read',async()=>{
    const guards=new BrowserDeferredReferenceGuards();let resolve!:(value:ReturnType<typeof good>)=>void;const finish=vi.fn(async()=>good());
    guards.defer({id:'old-node',inspect:()=>new Promise(done=>{resolve=done;}),finish});const pending=guards.settle();guards.discard();
    await expect(pending).resolves.toMatchObject({pending:false});resolve(good());await Promise.resolve();expect(finish).not.toHaveBeenCalled();
  });
  it('retains uncertain input ownership rather than allowing a new input to overwrite its guard',async()=>{
    const guards=new BrowserDeferredReferenceGuards(),failed=vi.fn();guards.defer({id:'node',inspect:async()=>{throw Error('context unavailable');},finish:async()=>good(),failed});
    await expect(guards.settle()).resolves.toEqual({pending:true,blocked:false,unknown:true});
    await expect(guards.assertReady()).rejects.toThrow('重新加载');expect(failed).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledWith('unknown');guards.discard();await expect(guards.assertReady()).resolves.toBeUndefined();
  });
});
