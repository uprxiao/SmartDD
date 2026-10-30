import{randomUUID}from'node:crypto';
import{describe,expect,it,vi}from'vitest';
import{MEDIA_LIMIT}from'@shared/file-media';
import type{FileDocument}from'@shared/files';
import{FileMediaService}from'@main/core/files/media-service';
import{openMediaResource}from'./resource';
describe('K05 renderer and main immutable media byte budget (synthetic source)',()=>{
 for(const name of['sound.wav','clip.mp4'])for(const delta of[-1,0,1])it(name+' 128MiB '+delta,async()=>{
  expect(MEDIA_LIMIT).toBe(134217728);const size=MEDIA_LIMIT+delta,hash='a'.repeat(64),ref={id:randomUUID(),lease:randomUUID(),generation:1},file={name,ref,relativePath:name,absolutePath:'/synthetic/'+name,documentKey:'test',writable:false,revision:{hash,size,device:'1',inode:'1',modifiedNs:'1',changedNs:'1'}} satisfies FileDocument;
  const read=vi.fn(async(_offset:number,length:number)=>Buffer.alloc(length)),service=new FileMediaService(()=>({name,revision:file.revision,signal:new AbortController().signal,read}));service.setProtocolAvailable(true);
  const api={openMedia:vi.fn((input:Parameters<FileMediaService['open']>[1])=>service.open('own',input)),mediaChunk:vi.fn((id:string,offset:number,length:number)=>service.chunk('own',id,offset,length)),releaseMedia:vi.fn(async(id:string)=>service.release('own',id))};
  if(delta>0){await expect(openMediaResource(file,api,new AbortController().signal)).rejects.toThrow('128 MiB');expect(api.openMedia).not.toHaveBeenCalled();await expect(service.open('own',{id:randomUUID(),ref,baseHash:hash})).rejects.toThrow('128 MiB');expect(read).not.toHaveBeenCalled();}
  else{const source=await openMediaResource(file,api,new AbortController().signal);expect(source.transport).toBe('protocol');expect(api.openMedia).toHaveBeenCalledWith(expect.objectContaining({ref,baseHash:hash}));expect(api.mediaChunk).not.toHaveBeenCalled();expect(read.mock.calls.map(c=>c[1])).toEqual([0]);source.release();await Promise.resolve();}
  expect(service.resourceCounts).toEqual({grants:0,tokens:0,readers:0});
 });
});
