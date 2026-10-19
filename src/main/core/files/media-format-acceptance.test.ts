import {afterAll,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mediaType} from '@shared/file-media';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_MEDIA_FORMAT_EVIDENCE)writeFileSync(process.env.SMARTDD_MEDIA_FORMAT_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'I actual native FileService/media capability/chunks, not decoder A',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_MEDIA_FORMAT_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('all reviewed media extensions native integration',()=>{
 for(const kind of ['audio','video'])it(`reads complete revision-bound ${kind} fixture bytes and revokes closed media capabilities`,async()=>{
  const project=process.env.SMARTDD_MEDIA_FORMAT_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;kind:string;sha256:string;size:number;invalid?:boolean}[]};
  const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-media-formats-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'media',path:project,label:'Synthetic media'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
  try{
   const root=(await files.openScope('media',{kind:'project',projectId:'media'})).roots[0];
   for(const item of oracle.cases.filter(c=>c.kind===kind)){
    const document=await files.open('media',{lease:root.lease,generation:root.generation,relativePath:item.name});
    expect(document.content?.kind).toBe(kind);expect(mediaType(item.name.toUpperCase())).toEqual(mediaType(item.name));
    const id=randomUUID(),source=await files.media.open('media',{id,ref:document.ref,baseHash:document.revision.hash});
    expect(source).toMatchObject({transport:'binary',mime:mediaType(item.name)!.mime,size:item.size,hash:item.sha256});
    const parts:Buffer[]=[];
    for(let offset=0;offset<source.size;offset+=1024*1024){parts.push(Buffer.from(await files.media.chunk('media',id,offset,Math.min(1024*1024,source.size-offset)),'base64'))}
    expect(sha(Buffer.concat(parts))).toBe(item.sha256);
    await expect(files.media.chunk('other',id,0,1)).rejects.toThrow('UNTRUSTED');
    files.closeDocument('media',document.ref);
    await expect(files.media.chunk('media',id,0,1)).rejects.toThrow();
    expect(sha(readFileSync(join(project,item.name)))).toBe(item.sha256);
    observations.push({file:item.name,content:document.content,mime:source.mime,sourceSha256:item.sha256,closedCapabilityRejected:true});
   }
  }finally{files.closeOwner('media');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
 });
});
