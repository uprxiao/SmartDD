import {createHash,randomUUID} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {FILE_LIMITS} from '@shared/files';
import {FILE_IMAGE_LIMIT} from '@shared/file-resource';
import {FileResourceService} from './resource-service';
function fixture(kind='image',size=8){
 const bytes=Buffer.alloc(size<1024?size:0,37),abort=new AbortController(),revision={size,hash:createHash('sha256').update(bytes).digest('hex'),device:'1',inode:'2',modifiedNs:'1',changedNs:'1'};
 const read=vi.fn(async(offset:number,length:number,signal:AbortSignal)=>{signal.throwIfAborted();return bytes.subarray(offset,offset+length);});
 const service=new FileResourceService(()=>({name:'signature-without-extension',content:{kind,mime:kind==='pdf'?'application/pdf':'image/png'},revision,signal:abort.signal,read}));
 const input=()=>({id:randomUUID(),ref:{id:randomUUID(),lease:randomUUID(),generation:1},baseHash:revision.hash});return{bytes,abort,revision,read,service,input};
}
describe('M11 protected image/PDF resource capabilities',()=>{
 it('fails closed when the owner-gated protocol cannot be installed, without a shared Blob transport',async()=>{
  const f=fixture();await expect(f.service.open('a',f.input())).rejects.toThrow('UNSUPPORTED');expect(f.read).not.toHaveBeenCalled();expect(f.service.resourceCounts.grants).toBe(0);
 });
 it.each(['image','pdf'])('binds %s opaque URLs to owner, immutable revision and preview lifetime',async kind=>{
  const f=fixture(kind);f.service.setProtocolAvailable(true);const input=f.input(),source=await f.service.open('owner',input);expect(source.url).toMatch(/^willyou-resource:\/\/local\/[a-f0-9]{64}$/);expect(f.service.allows('owner',source.url!)).toBe(true);expect(f.service.allows('other',source.url!)).toBe(false);
  for(const url of[source.url+'?path=/private',source.url+'/../../secret',source.url!.replace('://local/','://foreign/'),source.url!.replace('://local/','://user@local/'),source.url!.replace('willyou-resource:','file:'),source.url!.replace('willyou-resource:','https:'),source.url!.replace(/.$/,'z')]){const before=f.read.mock.calls.length;expect(f.service.allows('owner',url)).toBe(false);if(new URL(url).username)expect(()=>new Request(url)).toThrow();else expect((await f.service.handle(new Request(url))).status).toBe(404);expect(f.read).toHaveBeenCalledTimes(before);}
  const response=await f.service.handle(new Request(source.url!));expect(response.headers.get('Cache-Control')).toBe('no-store');expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes);
  f.service.release('other',input.id);expect(f.service.allows('owner',source.url!)).toBe(true);f.abort.abort();expect(f.service.allows('owner',source.url!)).toBe(false);expect((await f.service.handle(new Request(source.url!))).status).toBe(404);expect(f.service.resourceCounts).toEqual({grants:0,tokens:0,readers:0});
 });
 it.each([{kind:'image',limit:FILE_IMAGE_LIMIT},{kind:'pdf',limit:FILE_LIMITS.asset}])('enforces $kind exact size independently before native IO',async({kind,limit})=>{
  const big=fixture(kind,limit+1);big.service.setProtocolAvailable(true);await expect(big.service.open('a',big.input())).rejects.toThrow('TOO_LARGE');expect(big.read).not.toHaveBeenCalled();
  const equal=fixture(kind,limit);equal.service.setProtocolAvailable(true);expect((await equal.service.open('a',equal.input())).size).toBe(limit);equal.service.closeOwner('a');expect(equal.service.resourceCounts.grants).toBe(0);
 });
 it('does not mint a disk-reading token for arbitrary text or an invented resource path',async()=>{
  const f=fixture('text');f.service.setProtocolAvailable(true);await expect(f.service.open('a',f.input())).rejects.toThrow('UNSUPPORTED');expect(f.read).not.toHaveBeenCalled();
  await expect(f.service.open('a',{...f.input(),path:'/private/secret'} as never)).rejects.toThrow('unrecognized_keys');
 });
 it('cancels a pending native open and prevents its late result from reissuing a revoked token',async()=>{
  const f=fixture();f.service.setProtocolAvailable(true);let done!:(bytes:Buffer<ArrayBuffer>)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>done=resolve));const input=f.input(),pending=f.service.open('a',input);await Promise.resolve();f.service.release('a',input.id);done(Buffer.alloc(0));await expect(pending).rejects.toThrow();expect(f.service.resourceCounts).toEqual({grants:0,tokens:0,readers:0});
 });
 it('aborts an outstanding response stream on owner destruction and returns all reader slots',async()=>{
  const f=fixture();f.service.setProtocolAvailable(true);const source=await f.service.open('a',f.input()),response=await f.service.handle(new Request(source.url!));f.service.closeOwner('a');await expect(response.arrayBuffer()).rejects.toThrow('CANCELLED');expect(f.service.resourceCounts).toEqual({grants:0,tokens:0,readers:0});
 });
});
