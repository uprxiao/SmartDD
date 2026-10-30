import { createHash,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll,afterEach,describe,expect,it,vi } from 'vitest';
import { NativeFileBroker } from './native-broker';
import { FileRootsService } from './roots';
import { FileService } from './file-service';
import { FileRecoveryStore } from './recovery-store';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const rows:unknown[]=[],clean:Array<()=>Promise<void>>=[],sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
afterEach(async()=>{for(const fn of clean.splice(0))await fn();});
afterAll(()=>{if(process.env.WILLYOU_PPTX_EVIDENCE)writeFileSync(process.env.WILLYOU_PPTX_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-F20',rows,boundary:'Original FileService/PPTX Worker/packaged LibreOffice, independent Poppler. Readonly flag is I only; no invented attachment business host.'},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.WILLYOU_PPTX_APP)('F20 genuine source-aware PPTX static preview',()=>{
 it.each(['writable','filesystem-readonly','source-readonly'])('%s preserves content and separates read/edit permission',async mode=>{
  const manifest=JSON.parse(readFileSync(process.env.WILLYOU_PPTX_FIXTURES!,'utf8')),item=manifest.cases[0],bytes=readFileSync(join(manifest.project,item.name)),base=mkdtempSync('/private/tmp/willyou-pptx-preview-I-'),project=join(base,'project'),userData=join(base,'userdata'),proof=join(process.env.WILLYOU_PPTX_PROOF!,mode);
  mkdirSync(project);mkdirSync(userData);mkdirSync(proof,{recursive:true});const path=join(project,'content.pptx');writeFileSync(path,bytes);if(mode==='filesystem-readonly')chmodSync(path,0o444);
  const resources=join(process.env.WILLYOU_PPTX_APP!,'Contents/Resources'),broker=new NativeFileBroker(join(resources,'native/willyou-files')),resolver={sources:()=>[{kind:'project-directory'as const,id:'root',path:project,label:'Own PPTX fixture',projectId:'pptx'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(resources,'native/libreoffice'),packagePath:process.env.WILLYOU_PPTX_APP!},join(resources,'app.asar/out/main/m9-office-pages.js'),join(resources,'app.asar/out/main/m9-pptx-document.js')),owner='f20-I';
  clean.push(async()=>{service.closeOwner(owner);service.pptx.dispose();service.officePages.dispose();await service.watcher.dispose();const end=Date.now()+10000;while(broker.activeProcesses){expect(Date.now()).toBeLessThan(end);await delay(5);}broker.dispose();expect(readFileSync(path)).toEqual(bytes);chmodSync(path,0o644);rmSync(base,{recursive:true,force:true});});
  const row={mode,status:'running',file:undefined as unknown,state:undefined as unknown,preview:undefined as unknown,independent:undefined as unknown,error:undefined as string|undefined};rows.push(row);
  try{
   const root=(await service.openScope(owner,{kind:'project',projectId:'pptx'})).roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:'content.pptx',...(mode==='source-readonly'?{readOnly:true}:{})}),id=randomUUID(),state=await service.pptx.open(owner,{id,ref:file.ref,baseHash:file.revision.hash});row.file=file;row.state=state;const model=state.state;
   expect(file.writable).toBe(mode==='writable');expect(model.info.kind).toBe('pptx');expect(model.info.slides).toHaveLength(2);expect(model.dirty).toBe(false);expect(model.version).toBe(0);
   expect(model.info.slides[0].elements?.some(x=>x.kind==='chart'&&x.chart?.values?.join(',')==='3,4')).toBe(true);expect(model.info.slides[0].elements?.some(x=>x.kind==='table')).toBe(true);expect(model.info.slides[1].elements?.some(x=>x.kind==='image')).toBe(true);
   if(mode!=='writable')await expect(service.pptx.edit(owner,{id,version:0,action:{type:'notes',slideId:'257',text:'forbidden'}})).rejects.toMatchObject({code:'PERMISSION'});
   const requestId=randomUUID(),result=await service.pptx.render(owner,{id,version:0,requestId});row.preview=result;expect(result.pages).toBe(2);const chunks:Buffer[]=[];
   for(let offset=0;offset<result.bytes;offset+=1024*1024)chunks.push(Buffer.from(service.pptx.chunk(owner,id,requestId,offset,Math.min(1024*1024,result.bytes-offset)),'base64'));
   const pdf=Buffer.concat(chunks);expect(sha(pdf)).toBe(result.hash);const pdfPath=join(proof,'preview.pdf');writeFileSync(pdfPath,pdf);writeFileSync(join(proof,'original.pptx'),bytes);row.independent=JSON.parse(execFileSync('python3',[resolve('scripts/files/pptx-preview-fixtures.py'),'verify',path,pdfPath,proof],{encoding:'utf8',maxBuffer:4*1024*1024}));
   expect(()=>service.pptx.chunk('other-owner',id,requestId,0,16)).toThrow();service.pptx.close(owner,id);expect(service.pptx.activeDocuments).toBe(0);expect(()=>service.pptx.chunk(owner,id,requestId,0,16)).toThrow();expect(readFileSync(path)).toEqual(bytes);row.status='passed';
  }catch(error){row.status='failed';row.error=String(error);throw error;}
 },60000);
});
