import {afterAll,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {classifyFile} from '@shared/file-classification';
import type {FileDocument} from '@shared/files';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {FileBuffer,type FileClient} from './file-buffer';
import {readFileResource} from './resource';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_FORMAT_BOUNDARY_EVIDENCE)writeFileSync(process.env.SMARTDD_FORMAT_BOUNDARY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'U/I; native FileService and controlled actions, no OS external application launched',observations},null,2)+'\n')});
describe('Unsupported upper-level dispatch',()=>{
  it('rejects TIFF even when the lower-layer descriptor claims image content',()=>{
    for(const extension of ['tif','tiff']){
      const file={name:'forged.'+extension,content:{kind:'image',mime:'image/tiff',basis:'extension'},revision:{hash:'a'.repeat(64)}} as FileDocument;
      const buffer=new FileBuffer(file,{closeDocument:async()=>{}} as unknown as FileClient,()=>{});expect(buffer.content).toMatchObject({kind:'unsupported',format:extension});expect(buffer.content.reason).toContain('TIFF');buffer.dispose();
    }
  });
});
describe.skipIf(!process.env.SMARTDD_FORMAT_BOUNDARY_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('SVG/TIFF/unsupported Office real-file dispatch',()=>{
  it('matches the fixed fixture oracle through native sample reading and keeps all source identities and bytes',async()=>{
    const project=process.env.SMARTDD_FORMAT_BOUNDARY_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;caseId:string;kind:string;mime?:string;reason?:string}[]};
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-format-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'formats',path:project,label:'Synthetic formats'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
    try{
      const root=(await files.openScope('formats',{kind:'project',projectId:'formats'})).roots[0];
      for(const item of oracle.cases){
        const path=join(project,item.name),original=readFileSync(path),before=statSync(path,{bigint:true}),document=await files.open('formats',{lease:root.lease,generation:root.generation,relativePath:item.name});
        expect(classifyFile(item.name,original).kind).toBe(item.kind);expect(document.content?.kind).toBe(item.kind);if(item.mime)expect(document.content?.mime).toBe(item.mime);if(item.reason)expect(document.content?.reason).toContain(item.reason);
        expect(Buffer.from(await readFileResource(document,{chunk:(ref,offset,length,hash,id)=>files.chunk('formats',ref,offset,length,hash,id)},new AbortController().signal))).toEqual(original);
        if(item.kind==='unsupported'){
          const target={kind:'document' as const,ref:document.ref},applications=await files.actions.applications('formats',target);expect(applications.id).toBeTypeOf('string');
          await expect(files.actions.open('other',{listId:applications.id,appId:applications.apps[0]?.id??randomUUID(),remember:false})).rejects.toThrow('UNTRUSTED');
          await expect(files.actions.open('formats',{listId:applications.id,appId:randomUUID(),remember:false})).rejects.toThrow('UNTRUSTED');
          const selection=await files.actions.prepareCopy('formats',{target}),destination=join(base,item.name);const receipt=await files.actions.copyTo('formats',selection,destination);expect(receipt.state).toBe('saved');expect(readFileSync(destination)).toEqual(original);
          observations.push({caseId:item.caseId,file:item.name,content:document.content,discoveredApplications:applications.apps.map(a=>a.name),copySha256:sha(readFileSync(destination)),outsideOwnerAndUnlistedAppRejected:true});
        }else observations.push({caseId:item.caseId,file:item.name,content:document.content,sha256:sha(original)});
        expect(readFileSync(path)).toEqual(original);const after=statSync(path,{bigint:true});for(const field of ['ino','mtimeNs','ctimeNs'] as const)expect(after[field]).toBe(before[field]);files.closeDocument('formats',document.ref);
      }
    }finally{files.closeOwner('formats');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
  },60000);
});
