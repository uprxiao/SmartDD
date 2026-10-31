// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readApplication} from './ui-read';
const m=vi.hoisted(()=>({cancelUiRead:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m},events:{on:vi.fn()}}));
beforeEach(()=>{vi.resetAllMocks();m.cancelUiRead.mockResolvedValue({ok:true,value:{canceled:true}});});
describe('renderer query-to-host cancellation',()=>{
 it('does not start a producer for an already-canceled observer',async()=>{const signal=new AbortController();signal.abort();const read=vi.fn();await expect(readApplication(signal.signal,read)).rejects.toMatchObject({name:'AbortError'});expect(read).not.toHaveBeenCalled();expect(m.cancelUiRead).not.toHaveBeenCalled();});
 it('removes the cancellation listener when a result has already completed',async()=>{const signal=new AbortController();expect(await readApplication(signal.signal,async()=>({ok:true,value:7}))).toBe(7);signal.abort();expect(m.cancelUiRead).not.toHaveBeenCalled();});
 it('cancels its original request once and rejects a later successful producer reply',async()=>{const signal=new AbortController();let finish!:(value:{ok:true;value:number})=>void,request='';const pending=readApplication(signal.signal,async id=>{request=id;return new Promise<{ok:true;value:number}>(r=>{finish=r;});});signal.abort();signal.abort();expect(m.cancelUiRead).toHaveBeenCalledExactlyOnceWith(request);finish({ok:true,value:8});await expect(pending).rejects.toMatchObject({name:'AbortError'});});
 it('does not send cancellation after the producer has failed',async()=>{const signal=new AbortController();await expect(readApplication(signal.signal,async()=>{throw Error('original-read-error');})).rejects.toThrow('original-read-error');signal.abort();expect(m.cancelUiRead).not.toHaveBeenCalled();});
 it('does not turn a failed cancellation acknowledgement into an unhandled business retry',async()=>{const signal=new AbortController();m.cancelUiRead.mockRejectedValue(Error('own document closed'));let finish!:(value:{ok:true;value:number})=>void;const read=vi.fn(async()=>new Promise<{ok:true;value:number}>(r=>{finish=r;}));const pending=readApplication(signal.signal,read);signal.abort();finish({ok:true,value:4});await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(read).toHaveBeenCalledTimes(1);expect(m.cancelUiRead).toHaveBeenCalledTimes(1);});
});
