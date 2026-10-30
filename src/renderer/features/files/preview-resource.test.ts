import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {FileDocument} from '@shared/files';
import {openPreviewResource,readPreviewResource} from './preview-resource';
const bytes=new Uint8Array([37,80,68,70]),hash=createHash('sha256').update(bytes).digest('hex'),url='willyou-resource://local/'+'a'.repeat(64);
const file={ref:{id:'doc',lease:'lease',generation:1},content:{kind:'pdf',mime:'application/pdf'},revision:{size:bytes.length,hash}} as FileDocument;
function client(){return{openResource:vi.fn(async(input:{id:string})=>({id:input.id,transport:'protocol' as const,url,mime:'application/pdf',size:bytes.length,hash})),releaseResource:vi.fn(async()=>undefined)};}
afterEach(()=>vi.unstubAllGlobals());
describe('owner-scoped preview URL lifecycle and byte loading',()=>{
 it('releases exactly once when cancellation races a successful open and never issues a Blob fallback',async()=>{
  const api=client(),abort=new AbortController();let resolve!:(value:any)=>void;api.openResource.mockImplementationOnce(()=>new Promise(done=>resolve=done));const pending=openPreviewResource(file,api as never,abort.signal),id=api.openResource.mock.calls[0][0].id;abort.abort();resolve({id,transport:'protocol',url,mime:'application/pdf',size:bytes.length,hash});await expect(pending).rejects.toThrow();expect(api.releaseResource).toHaveBeenCalledTimes(1);expect(api.releaseResource).toHaveBeenCalledWith(id);
 });
 it.each([{url:'file:///private/value.pdf'},{url:url+'?path=/private/value.pdf'},{transport:'binary',url:undefined},{hash:'0'.repeat(64)},{size:bytes.length+1},{mime:'text/html'}])('rejects an untrusted transport or mismatching source %# and revokes it',async change=>{
  const api=client();api.openResource.mockImplementationOnce(async input=>({id:input.id,transport:'protocol',url,mime:'application/pdf',size:bytes.length,hash,...change}) as never);await expect(openPreviewResource(file,api as never,new AbortController().signal)).rejects.toThrow('无效');expect(api.releaseResource).toHaveBeenCalledTimes(1);
 });
 it('loads exact immutable PDF bytes and keeps the private grant until the active preview ends',async()=>{
  const api=client(),abort=new AbortController(),fetcher=vi.fn(async()=>new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}));vi.stubGlobal('fetch',fetcher);expect(await readPreviewResource(file,api as never,abort.signal)).toEqual(bytes);expect(fetcher).toHaveBeenCalledWith(url,{signal:abort.signal,credentials:'omit',cache:'no-store'});expect(api.releaseResource).not.toHaveBeenCalled();abort.abort();expect(api.releaseResource).toHaveBeenCalledTimes(1);
 });
 it.each(['overflow','truncated','wrong-hash','header','rejected'])('rejects %s without yielding mixed bytes and releases the original grant',async mode=>{
  const api=client(),data=mode==='overflow'?new Uint8Array([...bytes,1]):mode==='truncated'?bytes.slice(0,2):mode==='wrong-hash'?new Uint8Array(4):bytes;
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(data,{status:mode==='rejected'?410:200,headers:{'Content-Length':String(mode==='header'?99:4)}})));await expect(readPreviewResource(file,api as never,new AbortController().signal)).rejects.toThrow();expect(api.releaseResource).toHaveBeenCalledTimes(1);
 });
});
