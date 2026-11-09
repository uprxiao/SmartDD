import {afterEach,describe,expect,it,vi} from 'vitest';
import type {WebContents} from 'electron';
import {BrowserCdpProxy} from '../cdp-proxy';
afterEach(()=>vi.useRealTimers());
describe('completion of an owned native mouse dispatch',()=>{
  it('waits for the actual input acknowledgement before guarded cleanup',async()=>{
    let finish!:(value:object)=>void;const sendCommand=vi.fn(()=>new Promise<object>(resolve=>{finish=resolve;}));
    const proxy=new BrowserCdpProxy({isDestroyed:()=>false,debugger:{sendCommand}} as unknown as WebContents);
    const input=proxy.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:2});let settled=false;
    const completion=proxy.waitForInputCompletion().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
    finish({});await input;await completion;expect(settled).toBe(true);expect(sendCommand).toHaveBeenCalledOnce();
  });
  it('does not mistake the client timeout for completion of native input',async()=>{
    vi.useFakeTimers();let finish!:(value:object)=>void;
    const sendCommand=vi.fn(()=>new Promise<object>(resolve=>{finish=resolve;}));const proxy=new BrowserCdpProxy({isDestroyed:()=>false,debugger:{sendCommand}} as unknown as WebContents);
    const timed=proxy.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:2}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(10000);expect(await timed).toMatchObject({code:'BROWSER_TIMEOUT'});
    let settled=false;const completion=proxy.waitForInputCompletion().then(()=>{settled=true;});await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(false);
    finish({});await completion;expect(settled).toBe(true);expect(sendCommand).toHaveBeenCalledOnce();
  });
  it('leaves an unconfirmed dispatch explicit and never resends it',async()=>{
    vi.useFakeTimers();const sendCommand=vi.fn(()=>new Promise(()=>{}));const proxy=new BrowserCdpProxy({isDestroyed:()=>false,debugger:{sendCommand}} as unknown as WebContents);
    const timed=proxy.send('Input.dispatchMouseEvent',{type:'mouseReleased'}).catch(error=>error);
    const completion=proxy.waitForInputCompletion().catch(error=>error);await vi.advanceTimersByTimeAsync(10000);
    expect(await timed).toMatchObject({code:'BROWSER_TIMEOUT'});expect(await completion).toMatchObject({code:'BROWSER_TIMEOUT'});expect(sendCommand).toHaveBeenCalledOnce();
  });
});
