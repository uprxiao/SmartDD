import {createHash,randomUUID}from 'node:crypto';
import{copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,statSync,writeFileSync}from 'node:fs';
import{join}from 'node:path';
import{afterAll,describe,expect,it,vi}from 'vitest';
import{FileService}from '../file-service';
import{FileRootsService}from '../roots';
import{FileRecoveryStore}from '../recovery-store';
import{NativeFileBroker}from '../native-broker';
import{OfficeParser}from './parser';
import{PptxParser}from './pptx-parser';
import{OfficePagesParser}from './pages-parser';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const app=process.env.WILLYOU_FIDELITY_APP,metadata=process.env.WILLYOU_FIDELITY_SIGNED,observations:unknown[]=[],sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const fingerprint=(p:string)=>{const s=statSync(p,{bigint:true});return{sha256:sha(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs)};};
describe.skipIf(!app||!metadata||process.platform!=='darwin')('Y13 unmodified upstream XML-signature fixtures',()=>{
 it.each(['xlsx','pptx','docx']as const)('detects the original %s signature with packaged parsing and preserves its source',async kind=>{
  const fixture=JSON.parse(readFileSync(metadata!,'utf8')).files.find((x:{kind:string})=>x.kind===kind),base=realpathSync(mkdtempSync('/private/tmp/willyou-office-signed-I-'));mkdirSync(join(base,'root'));mkdirSync(join(base,'userdata'));expect(sha(readFileSync(fixture.path))).toBe(fixture.sha256);const path=join(base,'root','signed.'+kind);copyFileSync(fixture.path,path);const before=fingerprint(path),resources=join(app!,'Contents/Resources'),broker=new NativeFileBroker(join(resources,'native/willyou-files')),resolver={sources:()=>[{kind:'project-directory'as const,id:'root',projectId:'signed',path:join(base,'root'),label:'Own public signed fixture'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver),undefined,undefined,undefined,undefined,join(resources,'app.asar/out/main/m9-office-document.js'),undefined,undefined,join(resources,'app.asar/out/main/m9-pptx-document.js'));let parser:OfficePagesParser|undefined;
  try{
   const root=(await files.openScope('signed',{kind:'project',projectId:'signed'})).roots[0],document=await files.open('signed',{lease:root.lease,generation:root.generation,relativePath:'signed.'+kind}),id=randomUUID(),request=vi.spyOn(broker,'request');expect(document.writable).toBe(true);
   if(kind==='xlsx'){
    const opened=await files.office.open('signed',{id,ref:document.ref,baseHash:document.revision.hash});expect(opened.workbook.signed).toBe(true);const materialize=vi.spyOn(OfficeParser.prototype,'materialize');
    await expect(files.office.edit('signed',{id,version:0,edit:{sheetId:opened.workbook.sheets[0].id,row:0,column:0,text:'MUST NOT WRITE'}})).rejects.toThrow(/签名/);
    await expect(files.office.save('signed',{id,version:0,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()})).rejects.toThrow(/签名/);expect(materialize).not.toHaveBeenCalled();
   }else if(kind==='pptx'){
    const opened=await files.pptx.open('signed',{id,ref:document.ref,baseHash:document.revision.hash});expect(opened.state.info.signed).toBe(true);const materialize=vi.spyOn(PptxParser.prototype,'materialize');
    await expect(files.pptx.edit('signed',{id,version:0,action:{type:'notes',slideId:opened.state.info.slides[0].id,text:'MUST NOT WRITE'}})).rejects.toThrow(/签名/);
    await expect(files.pptx.save('signed',{id,version:0,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()})).rejects.toThrow(/签名/);expect(materialize).not.toHaveBeenCalled();
   }else{
    parser=new OfficePagesParser(join(resources,'app.asar/out/main/m9-office-pages.js'));const info=await parser.inspect(readFileSync(path),before.sha256,new AbortController().signal);expect(info.kind).toBe('docx');expect(info.signed).toBe(true);
    await expect(files.save('signed',{ref:document.ref,baseHash:before.sha256,bufferVersion:1,opId:randomUUID(),base64:readFileSync(path).toString('base64')})).rejects.toThrow('保真');
   }
   expect(request.mock.calls.some(([input])=>['save','checkpoint'].includes(String(input.operation)))).toBe(false);expect(fingerprint(path)).toEqual(before);observations.push({kind,base,source:fixture.url,sourceSha256:fixture.sha256,before,after:fingerprint(path),actualSignatureParts:fixture.signatures,noSourceWrites:true,noCryptographicTrustClaim:true});
  }finally{vi.restoreAllMocks();parser?.close();files.closeOwner('signed');await files.watcher.dispose();broker.dispose();}
 });
});
afterAll(()=>{if(process.env.WILLYOU_FIDELITY_SIGNED_EVIDENCE)writeFileSync(process.env.WILLYOU_FIDELITY_SIGNED_EVIDENCE,JSON.stringify({at:new Date().toISOString(),app,observations,boundary:'Unmodified Apache POI upstream OOXML with SignatureValue/certificate, actual r137 parsing Workers/native source service. DOCX uses actual parsing Worker plus existing generic-write denial; no DOCX editor introduced. No independent crypto/certificate-validity/GUI claim.'},null,2)+'\n');});
