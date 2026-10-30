import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,describe,expect,it,vi} from 'vitest';
import {OfficePackage} from './package';
import {OfficeDocument} from './document';
import {PptxDocument} from './pptx-document';
import {OfficePagesParser} from './pages-parser';
import {FileService} from '../file-service';
import {FileRootsService} from '../roots';
import {FileRecoveryStore} from '../recovery-store';
import {NativeFileBroker} from '../native-broker';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const app=process.env.WILLYOU_PRESERVATION_APP,metadata=process.env.WILLYOU_PRESERVATION_FIXTURES;
const observations:unknown[]=[],sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const fingerprint=(p:string)=>{const s=statSync(p,{bigint:true});return{sha256:sha(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs)};};
const fixture=(kind:string)=>JSON.parse(readFileSync(metadata!,'utf8')).files[kind];
async function preserved(kind:'xlsx'|'pptx',bytes:Uint8Array){
 const f=fixture(kind),file=await OfficePackage.read(bytes);expect(file.names()).toEqual(f.names);
 const changed=Object.keys(f.parts).filter(name=>file.hashes()[name]!==f.parts[name]);
 const allowed=kind==='xlsx'?['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/workbook.xml']:[f.target.part];
 expect(changed).toContain(f.target.part);expect(changed.every(name=>allowed.includes(name))).toBe(true);
 expect(file.read(f.target.part).toString()).toContain(f.target.newText);
 for(const name of f.names.filter((n:string)=>!allowed.includes(n)))expect(file.hashes()[name],name).toBe(f.parts[name]);
 const commentParts=f.names.filter((n:string)=>/comment|vml|customXml/.test(n));expect(commentParts.length).toBeGreaterThan(3);
 for(const name of commentParts)expect(file.hashes()[name],name).toBe(f.parts[name]);
 return{changed,commentParts,namesAndOrderExact:true,unrelatedPartsExact:true};
}
describe.skipIf(!metadata)('Y10 real-comment package model preservation U; not DOCX edit acceptance',()=>{
 it.each(['xlsx','pptx']as const)('retains native %s comment relationships/order and unrelated bytes during an allowed text edit',async kind=>{
  const f=fixture(kind),file=await OfficePackage.read(readFileSync(f.path));let bytes:Uint8Array;
  if(kind==='xlsx'){
   const document=new OfficeDocument(file);document.edit(0,{sheetId:document.state().workbook.sheets[0].id,row:f.target.row,column:f.target.column,text:f.target.newText});bytes=(await document.materialize(1)).bytes;
  }else{
   const document=new PptxDocument(file),slide=document.state().info.slides[f.target.slide-1],element=slide.elements!.find(x=>x.name===f.target.name)!;expect(element).toBeTruthy();document.edit(0,{type:'element-text',slideId:slide.id,elementId:element.id,text:f.target.newText});bytes=(await document.materialize(1)).bytes;
  }
  const result=await preserved(kind,bytes);observations.push({layer:'U',kind,result,sourceUnchanged:sha(readFileSync(f.path))===f.sha256});
 });
});
describe.skipIf(!app||!metadata||process.platform!=='darwin')('Y10 actual packaged Worker/native preservation I; DOCX stays readonly',()=>{
 it.each(['xlsx','pptx','docx']as const)('uses actual %s package/source services without losing original comment/revision parts',async kind=>{
  const f=fixture(kind),base=realpathSync(mkdtempSync('/private/tmp/willyou-office-preservation-I-'));mkdirSync(join(base,'root'));mkdirSync(join(base,'userdata'));
  const path=join(base,'root','source.'+kind);copyFileSync(f.path,path);const before=fingerprint(path),resources=join(app!,'Contents/Resources'),owner='preservation',broker=new NativeFileBroker(join(resources,'native/willyou-files'));
  const resolver={sources:()=>[{kind:'project-directory'as const,id:'root',projectId:'preservation',path:join(base,'root'),label:'Own real-comment fixtures'}]};
  const files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver),undefined,undefined,undefined,{directory:join(resources,'native/office'),userData:join(base,'userdata'),packagePath:app},join(resources,'app.asar/out/main/m9-office-document.js'),undefined,undefined,join(resources,'app.asar/out/main/m9-pptx-document.js'));let pages:OfficePagesParser|undefined;
  try{
   const root=(await files.openScope(owner,{kind:'project',projectId:'preservation'})).roots[0],document=await files.open(owner,{lease:root.lease,generation:root.generation,relativePath:'source.'+kind}),id=randomUUID();
   if(kind==='docx'){
    pages=new OfficePagesParser(join(resources,'app.asar/out/main/m9-office-pages.js'));const info=await pages.inspect(readFileSync(path),before.sha256,new AbortController().signal);expect(info.kind).toBe('docx');expect(info.signed).toBe(false);
    await expect(files.save(owner,{ref:document.ref,baseHash:before.sha256,bufferVersion:1,opId:randomUUID(),base64:readFileSync(path).toString('base64')})).rejects.toThrow('保真');expect(fingerprint(path)).toEqual(before);
    observations.push({layer:'I',kind,base,before,after:fingerprint(path),readonlyOriginalBytesPreserved:true,originalManualEditNotClaimed:true});
   }else{
    let result;
    if(kind==='xlsx'){
     const opened=await files.office.open(owner,{id,ref:document.ref,baseHash:document.revision.hash});await files.office.edit(owner,{id,version:0,edit:{sheetId:opened.workbook.sheets[0].id,row:f.target.row,column:f.target.column,text:f.target.newText}});result=await files.office.save(owner,{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});
    }else{
     const opened=await files.pptx.open(owner,{id,ref:document.ref,baseHash:document.revision.hash}),slide=opened.state.info.slides[f.target.slide-1],element=slide.elements!.find(x=>x.name===f.target.name)!;await files.pptx.edit(owner,{id,version:0,action:{type:'element-text',slideId:slide.id,elementId:element.id,text:f.target.newText}});result=await files.pptx.save(owner,{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});
    }
    expect(result.receipt.state,result.receipt.message).toBe('saved');expect(result.state.dirty).toBe(false);const preservedParts=await preserved(kind,readFileSync(path));observations.push({layer:'I',kind,base,path,before,after:fingerprint(path),receipt:result.receipt,preservedParts});
   }
  }finally{pages?.close();files.closeOwner(owner);await files.watcher.dispose();broker.dispose();}
 });
});
afterAll(()=>{if(process.env.WILLYOU_PRESERVATION_EVIDENCE)writeFileSync(process.env.WILLYOU_PRESERVATION_EVIDENCE,JSON.stringify({at:new Date().toISOString(),app,observations,boundary:'2 direct package-model U +3 real r137 Worker/native I; real comments/author relationships/order and opaque/inert macro preservation. DOCX source readonly is not the original manual-DOCX edit step; formal Y10 pending. No executable macros/GUI or independent LibreOffice claim from this file.'},null,2)+'\n');});
