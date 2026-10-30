import {afterAll,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {readFileResource} from './resource';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_RASTER_EVIDENCE)writeFileSync(process.env.SMARTDD_RASTER_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-F12',level:'I, actual encoded fixtures through FileService/root/revision reader/native broker. Decoding, alpha and animation tested separately in the actual packaged renderer.',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_RASTER_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('Raster format native input integration',()=>{
  it('recognizes all eight formats and returns exact bytes for valid/corrupt/animated/transparent samples',async()=>{
    const project=process.env.SMARTDD_RASTER_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;mime:string;sha256:string;decodeFailure?:boolean;probe?:{width:number;height:number;nb_read_frames?:string}}[]};
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-raster-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'rasters',path:project,label:'Synthetic raster formats'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
    try{
      expect(oracle.cases).toHaveLength(18);const root=(await files.openScope('rasters',{kind:'project',projectId:'rasters'})).roots[0];
      for(const item of oracle.cases){const path=join(project,item.name),original=readFileSync(path),before=statSync(path,{bigint:true}),document=await files.open('rasters',{lease:root.lease,generation:root.generation,relativePath:item.name});
        expect(document.content).toMatchObject({kind:'image',mime:item.mime});const bytes=await readFileResource(document,{chunk:(ref,offset,length,hash,id)=>files.chunk('rasters',ref,offset,length,hash,id)},new AbortController().signal);expect(Buffer.from(bytes)).toEqual(original);expect(sha(bytes)).toBe(item.sha256);
        const after=statSync(path,{bigint:true});for(const field of ['ino','mtimeNs','ctimeNs'] as const)expect(after[field]).toBe(before[field]);observations.push({file:item.name,classification:document.content,exactSourceSha256:sha(bytes),decoderOracle:item.probe??null,corrupt:!!item.decodeFailure});files.closeDocument('rasters',document.ref);
      }
    }finally{files.closeOwner('rasters');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
  });
});
