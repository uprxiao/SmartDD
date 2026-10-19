import {describe,expect,it,vi} from 'vitest';
import {openPreviewResource} from './preview-resource';
import type {FileDocument} from '@shared/files';
describe('K04 PDF renderer limit differs from image artifact gate',()=>{
 for(const [kind,size,allowed]of [['pdf',41943041,true],['pdf',268435456,true],['pdf',268435457,false],['image',41943041,false]]as const)it(kind+' '+size,async()=>{
  const mime=kind==='pdf'?'application/pdf':'image/png',file={ref:{id:crypto.randomUUID(),lease:crypto.randomUUID(),generation:1},revision:{size,hash:'a'.repeat(64)},content:{kind,mime}}as FileDocument,api={openResource:vi.fn(async(input:any)=>({id:input.id,hash:file.revision.hash,size,mime,transport:'protocol'as const,url:'willyou-resource://local/'+'b'.repeat(64)})),releaseResource:vi.fn(async()=>undefined)};
  if(allowed){const source=await openPreviewResource(file,api,new AbortController().signal);expect(api.openResource).toHaveBeenCalledTimes(1);source.release();expect(api.releaseResource).toHaveBeenCalledTimes(1)}else{await expect(openPreviewResource(file,api,new AbortController().signal)).rejects.toThrow('读取上限');expect(api.openResource).not.toHaveBeenCalled()}
 });
});
