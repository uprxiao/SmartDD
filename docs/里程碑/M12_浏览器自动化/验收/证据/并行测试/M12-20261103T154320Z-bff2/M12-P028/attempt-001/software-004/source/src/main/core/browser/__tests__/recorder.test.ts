import {describe,it,expect} from 'vitest';
import {BrowserRecorder} from '../recorder';
import type {BrowserPage} from '../page-registry';

function fixture(){
  let listener:((event:{method:string;params:Record<string,unknown>;sessionId?:string})=>void)|undefined;
  const calls:string[]=[],abort=new AbortController();
  const recorder=new BrowserRecorder({abort,proxy:{onEvent:(callback:typeof listener)=>{listener=callback;return()=>{listener=undefined;};},send:async(method:string)=>{calls.push(method);return{};}}} as unknown as BrowserPage);
  const emit=(method:string,params:Record<string,unknown>,sessionId?:string)=>listener?.({method,params,sessionId});
  const request=(id:string,url:string,sessionId?:string)=>emit('Network.requestWillBeSent',{requestId:id,timestamp:10,wallTime:1700000000,request:{url,method:'GET',headers:{}}},sessionId);
  return{recorder,calls,emit,request,abort};
}
describe('browser passive network recording',()=>{
  it('keeps HAR timing totals valid when finish precedes response timestamp',async()=>{
    const f=fixture();await f.recorder.start();f.request('a','https://example.test/a?q=one&q=two');
    f.emit('Network.responseReceived',{requestId:'a',timestamp:10.002,response:{status:200,statusText:'OK',headers:{},mimeType:'text/plain'}});
    f.emit('Network.loadingFinished',{requestId:'a',timestamp:10.00195,encodedDataLength:50});
    const entry=f.recorder.stop().log.entries[0];expect(entry.time).toBeCloseTo(2);expect(entry.time).toBe(entry.timings.send+entry.timings.wait+entry.timings.receive);expect(entry.timings.receive).toBe(0);expect(entry.request.queryString).toEqual([{name:'q',value:'one'},{name:'q',value:'two'}]);
  });
  it('keeps identical request IDs in two owned iframe sessions separate',async()=>{
    const f=fixture();await f.recorder.start();f.request('same','https://example.test/main');f.request('same','https://example.test/frame','owned-frame');
    expect(f.recorder.stop().log.entries.map(entry=>entry.request.url)).toEqual(['https://example.test/main','https://example.test/frame']);
  });
  it('records only the first pattern without Fetch routing or pausing traffic',async()=>{
    const f=fixture();expect(await f.recorder.enable(['**/A','**/B'])).toMatchObject({recordOnly:true,ignoredPatterns:['**/B']});f.request('a','https://example.test/A');f.request('b','https://example.test/B');expect(f.recorder.list().requests.map(request=>request.requestId)).toEqual(['a']);expect(f.calls).toEqual(['Network.enable']);f.recorder.disable();f.request('c','https://example.test/A');expect(f.recorder.list().requests).toHaveLength(1);
  });
  it('retains redirect hops sharing one request ID and distinguishes body bytes from transport bytes',async()=>{
    const f=fixture();await f.recorder.start();f.request('a','https://example.test/redirect');
    f.emit('Network.requestWillBeSent',{requestId:'a',timestamp:11,wallTime:1700000001,request:{url:'https://example.test/final',method:'GET',headers:{}},redirectResponse:{status:302,statusText:'Found',headers:{Location:'/final'},mimeType:'text/plain'}});
    f.emit('Network.responseReceived',{requestId:'a',timestamp:12,response:{status:200,statusText:'OK',headers:{},mimeType:'text/plain'}});
    f.emit('Network.dataReceived',{requestId:'a',dataLength:100,encodedDataLength:40});f.emit('Network.loadingFinished',{requestId:'a',timestamp:13,encodedDataLength:180});
    const entries=f.recorder.stop().log.entries;expect(entries).toHaveLength(2);expect(entries[0].response).toMatchObject({status:302,redirectURL:'/final'});expect(entries[1].response).toMatchObject({content:{size:100},bodySize:40,_transferSize:180});
  });
  it('rejects a duplicate start before marking any new write dispatched',async()=>{
    const f=fixture();await f.recorder.start();let dispatched=false;await expect(f.recorder.start(()=>{dispatched=true;})).rejects.toThrow('已在采集');expect(dispatched).toBe(false);
  });
});
