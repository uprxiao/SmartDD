import {afterAll,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_PDF_SOURCE_EVIDENCE)writeFileSync(process.env.SMARTDD_PDF_SOURCE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'I actual native root/revision/chunk bytes; PDF parser/rendering separately verified in packaged App',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_PDF_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('PDF native source boundary',()=>{
 it('delivers exact multi-page/encrypted/damaged/non-embedded-font PDFs to the isolated parser, never a filename URL',async()=>{
  const project=process.env.SMARTDD_PDF_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;kind:string;sha256:string;size:number}[]};
  const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pdf-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'pdf',path:project,label:'Synthetic PDFs'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
  try{const root=(await files.openScope('pdf',{kind:'project',projectId:'pdf'})).roots[0];for(const item of oracle.cases){
   const file=await files.open('pdf',{lease:root.lease,generation:root.generation,relativePath:item.name});expect(file.content?.kind).toBe('pdf');const chunks:Buffer[]=[];
   for(let offset=0;offset<item.size;offset+=65536){const part=await files.chunk('pdf',file.ref,offset,Math.min(65536,item.size-offset),file.revision.hash);chunks.push(Buffer.from(part,'base64'))}
   expect(sha(Buffer.concat(chunks))).toBe(item.sha256);await expect(files.chunk('other',file.ref,0,1,file.revision.hash)).rejects.toThrow('UNTRUSTED');files.closeDocument('pdf',file.ref);await expect(files.read('pdf',file.ref)).rejects.toThrow();expect(sha(readFileSync(join(project,item.name)))).toBe(item.sha256);observations.push({file:item.name,kind:item.kind,content:file.content,sourceSha256:item.sha256,closedReadRejected:true});
  }}finally{files.closeOwner('pdf');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
 });
});
