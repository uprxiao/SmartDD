import {afterAll,describe,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {PDFDocument} from 'pdf-lib';
import {FileService} from '../file-service';
import {FileRootsService} from '../roots';
import {FileRecoveryStore} from '../recovery-store';
import {NativeFileBroker} from '../native-broker';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_TEX_ACCEPTANCE_EVIDENCE)writeFileSync(process.env.SMARTDD_TEX_ACCEPTANCE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),level:'I actual FileService/native broker/offline Tectonic/sandbox, generated PDF independently parsed; provider-unavailable native contract separately',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_TEX_PROJECT||!process.env.SMARTDD_TEX_RESOURCES||!process.env.SMARTDD_FILES_NATIVE_PATH)('F16 TeX real compile source and result boundary',()=>{
 it('keeps source bytes for success, missing package, no-pages and unavailable-provider results',async()=>{
  const project=process.env.SMARTDD_TEX_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;kind:string;sha256:string}[]};
  const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-tex-acceptance-native-'))),userData=join(base,'userdata');mkdirSync(userData);
  const broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'tex',path:project,label:'Synthetic TeX'}]};
  const unavailable=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver));
  const files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,{userData,directory:process.env.SMARTDD_TEX_RESOURCES!,workerPath:resolve('out/main/m9-tex-resources.js')});
  try{
   const deniedRoot=(await unavailable.openScope('missing-provider',{kind:'project',projectId:'tex'})).roots[0],denied=await unavailable.open('missing-provider',{lease:deniedRoot.lease,generation:deniedRoot.generation,relativePath:'success.tex'});
   await expect(unavailable.tex.open('missing-provider',{id:randomUUID(),ref:denied.ref,baseHash:denied.revision.hash})).rejects.toThrow('本平台尚未提供离线 TeX 编译器');observations.push({providerUnavailable:true,explicitUnsupported:true});
   const root=(await files.openScope('tex',{kind:'project',projectId:'tex'})).roots[0];
   for(const item of oracle.cases){
    const file=await files.open('tex',{lease:root.lease,generation:root.generation,relativePath:item.name}),id=randomUUID();let result:Record<string,unknown>={file:item.name,sourceSha256:item.sha256};
    if(item.kind==='success'){
     const compiled=await files.tex.open('tex',{id,ref:file.ref,baseHash:file.revision.hash}),parts:Buffer[]=[];
     for(let offset=0;offset<compiled.bytes;offset+=65536)parts.push(Buffer.from(files.tex.chunk('tex',id,offset,Math.min(65536,compiled.bytes-offset)),'base64'));
     const bytes=Buffer.concat(parts);expect(sha(bytes)).toBe(compiled.hash);expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
     const pdf=join(base,'generated.pdf'),text=join(base,'parsed.json');writeFileSync(pdf,bytes);execFileSync('node',[resolve('scripts/files/inspect-pdf.mjs'),pdf,text],{timeout:15000,stdio:'pipe'});
     const parsed=JSON.parse(readFileSync(text,'utf8'));expect(parsed.pages.map((p:{text:string})=>p.text).join(' ')).toContain('TEXF16SUCCESS');
     files.tex.release('tex',id);expect(()=>files.tex.chunk('tex',id,0,1)).toThrow('UNTRUSTED');result={...result,pdfSha256:compiled.hash,pages:compiled.pages,independentParsedMarker:true};
    }else{
     let failure:unknown;try{await files.tex.open('tex',{id,ref:file.ref,baseHash:file.revision.hash})}catch(error){failure=error}
     expect(failure).toBeInstanceOf(Error);const message=(failure as Error).message;
     expect(message).toMatch(item.kind==='failure'?/willyoumissingpackagef16|未.*包|not find|not found/:/PDF|没有.*页|未生成/);
     expect(()=>files.tex.chunk('tex',id,0,1)).toThrow('UNTRUSTED');result={...result,error:message,noResultCapability:true};
    }
    expect(sha(readFileSync(join(project,item.name)))).toBe(item.sha256);files.closeDocument('tex',file.ref);observations.push(result);
   }
  }finally{unavailable.closeOwner('missing-provider');files.closeOwner('tex');await unavailable.watcher.dispose();await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
 },45000);
});
