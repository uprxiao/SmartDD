import { createHash,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { FileError,type FileRef } from '@shared/files';
import type { OfficeSource } from './service';
import { FileOfficePagesService } from './pages-service';
import { FileHeavyJobs } from '../heavy-jobs';
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const ref:FileRef={id:randomUUID(),lease:randomUUID(),generation:1};
const fixture=(name:string)=>readFileSync(resolve('prototypes/m6-codex/public/assets/m9-docx',name));
let directory:string,worker:string;
beforeAll(()=>{
  directory=mkdtempSync('/private/tmp/willyou-docx-source-test-');worker=join(directory,'pages.cjs');
  const require=createRequire(import.meta.url),build=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
  build.buildSync({entryPoints:[resolve('src/main/core/files/office/pages-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
});
afterAll(()=>rmSync(directory,{recursive:true,force:true}));
function setup(bytes=fixture('three-page-tracked.docx'),patch:Partial<OfficeSource>={}){
  const controller=new AbortController();
  const source:OfficeSource={name:'owned.docx',hash:sha(bytes),size:bytes.length,signal:controller.signal,assert(){},read:async(offset,length)=>bytes.subarray(offset,offset+length),...patch};
  const service=new FileOfficePagesService((owner)=>{if(owner!=='owner')throw new FileError('UNTRUSTED','foreign');return source;},undefined,worker,new FileHeavyJobs());
  return {bytes,source,controller,service};
}
describe('legacy DOCX bounded, owner-scoped original bytes',()=>{
  it.each([['one-page-clean.docx',false],['three-page-clean.docx',false],['three-page-tracked.docx',true]] as const)('reads validated %s without invoking native PDF layout',async(name,hasRevisions)=>{
    const {bytes,source,service}=setup(fixture(name)),id=randomUUID(),before=Buffer.from(bytes);
    try{
      const result=await service.openDocx('owner',{id,ref,baseHash:source.hash});
      expect(result).toMatchObject({id,sourceHash:sha(bytes),bytes:bytes.length,info:{kind:'docx',hasRevisions}});
      expect(Buffer.from(service.chunk('owner',id,0,bytes.length),'base64')).toEqual(bytes);
      expect(()=>service.chunk('foreign',id,0,1)).toThrow('UNTRUSTED');
      expect(()=>service.chunk('owner',id,0,1024*1024+1)).toThrow('INVALID_INPUT');
      expect(()=>service.chunk('owner',id,bytes.length,1)).toThrow('INVALID_INPUT');
      await expect(service.openDocx('owner',{id,ref,baseHash:source.hash})).rejects.toMatchObject({code:'IDEMPOTENCY'});
      service.release('owner',id);expect(service.activeDocuments).toBe(0);
      expect(()=>service.chunk('owner',id,0,1)).toThrow('UNTRUSTED');expect(bytes).toEqual(before);
    }finally{service.dispose();}
  });
  it('rejects stale versions, foreign owners and corrupt packages without retaining grants',async()=>{
    const {service,source}=setup();
    try{
      await expect(service.openDocx('owner',{id:randomUUID(),ref,baseHash:'0'.repeat(64)})).rejects.toMatchObject({code:'CHANGED'});
      await expect(service.openDocx('foreign',{id:randomUUID(),ref,baseHash:source.hash})).rejects.toMatchObject({code:'UNTRUSTED'});
      expect(service.activeDocuments).toBe(0);
    }finally{service.dispose();}
    const bad=setup(Buffer.from('not an OOXML zip'));
    try{await expect(bad.service.openDocx('owner',{id:randomUUID(),ref,baseHash:bad.source.hash})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(bad.service.activeDocuments).toBe(0);}finally{bad.service.dispose();}
  });
  it('source cancellation prevents a late read from creating a readable document',async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),bytes=fixture('one-page-clean.docx');
    const {service,source,controller}=setup(bytes,{read:async(offset,length)=>{await gate;return bytes.subarray(offset,offset+length);}}),id=randomUUID();
    try{const open=service.openDocx('owner',{id,ref,baseHash:source.hash});controller.abort();release();await expect(open).rejects.toMatchObject({code:'CANCELLED'});expect(service.activeDocuments).toBe(0);expect(()=>service.chunk('owner',id,0,1)).toThrow('UNTRUSTED');}finally{service.dispose();}
  });
  it('the original source identity is checked after parse, not just before reading',async()=>{
    let changed=false;const bytes=fixture('one-page-clean.docx');
    const {service,source}=setup(bytes,{read:async(offset,length)=>{if(length===1)changed=true;return bytes.subarray(offset,offset+length);},assert(){if(changed)throw new FileError('CHANGED','changed during parse');}});
    try{await expect(service.openDocx('owner',{id:randomUUID(),ref,baseHash:source.hash})).rejects.toMatchObject({code:'CHANGED'});expect(service.activeDocuments).toBe(0);}finally{service.dispose();}
  });
});
