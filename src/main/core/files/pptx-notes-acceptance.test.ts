import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,describe,expect,it,vi} from 'vitest';
import {NativeFileBroker} from './native-broker';
import {FileRootsService} from './roots';
import {FileService} from './file-service';
import {FileRecoveryStore} from './recovery-store';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const rows:unknown[]=[],sha=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex');
afterAll(()=>{if(process.env.WILLYOU_NOTES_I_EVIDENCE)writeFileSync(process.env.WILLYOU_NOTES_I_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-W10',rows,boundary:'Original FileService, packaged native broker and original packaged PPTX Worker; genuine permission, exact saves and independent Python ZIP/XML reader. No PDF/mock-render or source-host A claim.'},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.WILLYOU_NOTES_APP)('W10 real notes permission and persistence',()=>{
 it.each(['readonly','editable'])('%s with present and absent notes',async mode=>{
  const base=mkdtempSync('/private/tmp/willyou-pptx-notes-I-'),project=join(base,'project'),userData=join(base,'userdata');mkdirSync(userData);
  const fixture=JSON.parse(execFileSync('python3',['scripts/files/pptx-notes-fixtures.py',project],{encoding:'utf8'}));
  const item=fixture.cases.find((x:any)=>x.theme==='light'&&x.mode===mode),path=join(project,item.name),resources=join(process.env.WILLYOU_NOTES_APP!,'Contents/Resources'),broker=new NativeFileBroker(join(resources,'native/willyou-files'));
  const resolver={sources:()=>[{kind:'project-directory' as const,id:'root',path:project,label:'Own W10',projectId:'notes'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(resources,'native/libreoffice'),packagePath:process.env.WILLYOU_NOTES_APP!},join(resources,'app.asar/out/main/m9-office-pages.js'),join(resources,'app.asar/out/main/m9-pptx-document.js')),owner='w10-I';
  const row:any={mode,before:item,status:'running'};rows.push(row);
  try{
   const root=(await service.openScope(owner,{kind:'project',projectId:'notes'})).roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:item.name}),id=randomUUID(),open=await service.pptx.open(owner,{id,ref:file.ref,baseHash:file.revision.hash});row.open=open;
   expect(file.writable).toBe(mode==='editable');expect(open.state.info.slides.map(s=>s.notes)).toEqual(['SLIDE_ONE_NOTES','']);const ids=open.state.info.slides.map(s=>s.id);
   if(mode==='readonly'){
    for(const slideId of ids)await expect(service.pptx.edit(owner,{id,version:0,action:{type:'notes',slideId,text:'MUST_NOT_WRITE'}})).rejects.toMatchObject({code:'PERMISSION'});
    expect(sha(readFileSync(path))).toBe(item.sha256);row.permissionRejected=2;
   }else{
    let version=0;const values=['W10 existing 中文🙂\nsecond line','W10 created 空备注🙂'];
    for(let n=0;n<2;n++){const state=await service.pptx.edit(owner,{id,version,action:{type:'notes',slideId:ids[n],text:values[n]}});version=state.version;expect(state.dirty).toBe(true);}
    const saved=await service.pptx.save(owner,{id,version,draftId:randomUUID(),bufferVersion:version,opId:randomUUID()});row.saved=saved;expect(saved.receipt.state).toBe('saved');
    service.pptx.close(owner,id);const refreshed=await service.refresh(owner,file.ref),next=randomUUID(),reopened=await service.pptx.open(owner,{id:next,ref:refreshed.ref,baseHash:refreshed.revision.hash});row.reopened=reopened;expect(reopened.state.info.slides.map(s=>s.notes)).toEqual(values);expect(reopened.state.dirty).toBe(false);service.pptx.close(owner,next);
    const independent=JSON.parse(execFileSync('python3',['scripts/files/pptx-notes-fixtures.py','inspect',path],{encoding:'utf8'}));row.independent=independent;expect(independent.slideNotes).toEqual(values);
    for(const name of item.names)if(!['ppt/notesSlides/notesSlide1.xml','ppt/slides/_rels/slide2.xml.rels','[Content_Types].xml'].includes(name))expect(independent.parts[name],name).toBe(item.parts[name]);
   }
   row.status='passed';
  }catch(error){row.status='failed';row.error=String(error);throw error;}
  finally{service.closeOwner(owner);service.pptx.dispose();service.officePages.dispose();await service.watcher.dispose();const end=Date.now()+10000;while(broker.activeProcesses){expect(Date.now()).toBeLessThan(end);await new Promise(r=>setTimeout(r,10));}broker.dispose();for(const f of fixture.cases)chmodSync(join(project,f.name),0o644);rmSync(base,{recursive:true,force:true});}
 },60000);
});
