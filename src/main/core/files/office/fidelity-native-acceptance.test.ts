import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { NativeFileBroker } from '../native-broker';
import { OfficePackage } from './package';
import { OfficeParser } from './parser';
import { PptxParser } from './pptx-parser';
import { createFileController } from '../controller';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { decodeOfficeDraft } from './draft';
import { decodePptxDraft } from './pptx-draft';
import { OfficeWorkbook } from './workbook';
import { OfficePagesModel } from './pages-model';
import type { IpcMainInvokeEvent } from 'electron';
const system=vi.hoisted(()=>({dialog:vi.fn(),window:{isDestroyed:()=>false}}));
vi.mock('electron', () => ({ BrowserWindow: {fromWebContents:()=>system.window}, dialog: {showSaveDialog:system.dialog}, shell: {} }));
const app=process.env.WILLYOU_FIDELITY_APP, fixtures=process.env.WILLYOU_FIDELITY_FIXTURES;
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const observations:unknown[]=[];
const owner='730:7:30';
let base='',broker:NativeFileBroker,files:FileService,invoke:(method:string,input:any,event?:IpcMainInvokeEvent)=>Promise<any>,event:IpcMainInvokeEvent;
const kinds=['xlsx','pptx']as const, modes=['missing','unrelated-rewrite','layout-rewrite','broken-relationship']as const;
const fingerprint=(p:string)=>{const s=statSync(p,{bigint:true});return {sha256:hash(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs)};};
async function corrupt(bytes:Uint8Array,mode:typeof modes[number]){
  const file=await OfficePackage.read(bytes),part=mode==='missing'?'customXml/vbaProject.bin':mode==='unrelated-rewrite'?'customXml/revisions.xml':mode==='layout-rewrite'?'customXml/layout.xml':'customXml/_rels/item1.xml.rels';
  const next=mode==='missing'?null:Buffer.from(file.read(part).toString().replace(mode==='unrelated-rewrite'?'KEEP REVISION':mode==='layout-rewrite'?'margin="137"':'annotations.xml',mode==='unrelated-rewrite'?'LOST REVISION':mode==='layout-rewrite'?'margin="0"':'absent.xml'));
  const output=await file.patch(new Map([[part,next]]),{changed:next?[part]:[],removed:next?[]:[part],added:[]}).bytes();
  expect(hash(output)).not.toBe(hash(bytes));return {bytes:output,hash:hash(output)};
}
describe.skipIf(process.platform!=='darwin'||!app||!fixtures)('Y13 actual Office Worker/native before-commit fidelity',()=>{
  beforeEach(context=>{
    base=realpathSync(mkdtempSync('/private/tmp/willyou-office-fidelity-I-'));mkdirSync(join(base,'root'));mkdirSync(join(base,'userdata'));
    const resources=join(app!,'Contents/Resources');broker=new NativeFileBroker(join(resources,'native/willyou-files'));
    const resolver={sources:()=>[{kind:'project-directory'as const,id:'root',path:join(base,'root'),label:'Y13 own synthetic',projectId:'Y13'}]};
    const workers=process.env.WILLYOU_FIDELITY_WORKERS;
    const calculation=context.task.name.includes('intentional xlsx')?{directory:join(resources,'native/office'),userData:join(base,'userdata'),packagePath:app}:undefined;
    files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver),undefined,undefined,undefined,calculation,workers?join(workers,'m9-office-document.js'):join(resources,'app.asar/out/main/m9-office-document.js'),undefined,undefined,workers?join(workers,'m9-pptx-document.js'):join(resources,'app.asar/out/main/m9-pptx-document.js'));
    const sender=Object.assign(new EventEmitter(),{id:730,mainFrame:{processId:7,routingId:30},isDestroyed:()=>false});event={sender,senderFrame:sender.mainFrame}as unknown as IpcMainInvokeEvent;
    const handlers=new Map<string,Function>();registerRPCRouter({files:createFileController(files,()=>true)},{handle:(channel:string,fn:Function)=>handlers.set(channel,fn)}as never);
    invoke=async(method,input,origin=event)=>handlers.get('files.'+method)!(origin,input);system.dialog.mockReset();system.dialog.mockResolvedValue({canceled:true});
  });
  afterEach(async()=>{vi.restoreAllMocks();files?.closeOwner(owner);if(files)await files.watcher.dispose();broker?.dispose();});
  async function edited(kind:typeof kinds[number],signed=false){
    const fixture=JSON.parse(readFileSync(fixtures!,'utf8')).files[`${signed?'signed':'rich'}.${kind}`],path=join(base,'root',`source.${kind}`);expect(hash(readFileSync(fixture.path))).toBe(fixture.sha256);copyFileSync(fixture.path,path);
    const root=(await files.openScope(owner,{kind:'project',projectId:'Y13'})).roots[0],document=await files.open(owner,{lease:root.lease,generation:root.generation,relativePath:`source.${kind}`}),id=randomUUID(),before=fingerprint(path);
    if(kind==='xlsx')await files.office.open(owner,{id,ref:document.ref,baseHash:document.revision.hash});else await files.pptx.open(owner,{id,ref:document.ref,baseHash:document.revision.hash});
    const edit=()=>kind==='xlsx'?files.office.edit(owner,{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'19'}}):files.pptx.edit(owner,{id,version:0,action:{type:'notes',slideId:'256',text:'Y13 allowed notes 中文🙂'}});
    return {id,path,root,document,before,fixture,edit,save:(draftId=randomUUID())=>kind==='xlsx'?files.office.save(owner,{id,version:1,bufferVersion:1,draftId,opId:randomUUID()}):files.pptx.save(owner,{id,version:1,bufferVersion:1,draftId,opId:randomUUID()})};
  }
  function inject(kind:typeof kinds[number],mode:typeof modes[number]){
    const Parser=kind==='xlsx'?OfficeParser:PptxParser,original=Parser.prototype.materialize;
    return vi.spyOn(Parser.prototype,'materialize').mockImplementationOnce(async function(this:OfficeParser,version,signal){const value=await original.call(this,version,signal),bad=await corrupt(value.bytes,mode);return {...value,...bad};});
  }
  async function blocked(kind:typeof kinds[number]){const f=await edited(kind);await f.edit();inject(kind,'missing');const draftId=randomUUID(),result=await f.save(draftId);expect(result.fidelity?.total).toBeGreaterThan(0);expect(result.state.dirty).toBe(true);expect(fingerprint(f.path)).toEqual(f.before);return {...f,result,draftId,copy:{kind,id:f.id,token:result.fidelity!.token}};}
  it.each(kinds)('allows a legitimate %s edit and keeps every unrelated part exact',async kind=>{
    const f=await edited(kind);await f.edit();const result=await f.save();expect(result.receipt.state,result.receipt.message).toBe('saved');
    const after=await OfficePackage.read(readFileSync(f.path)),changed=Object.entries(f.fixture.parts).filter(([name,sha])=>after.hashes()[name]!==sha).map(([name])=>name);
    expect(after.names().sort()).toEqual(Object.keys(f.fixture.parts).sort());
    expect(changed).toEqual(kind==='xlsx'?['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/workbook.xml']:['ppt/notesSlides/notesSlide1.xml']);
    for(const name of Object.keys(f.fixture.parts).filter(n=>n.startsWith('customXml/')))expect(after.hashes()[name]).toBe(f.fixture.parts[name]);
    observations.push({base,kind,branch:'legitimate',before:f.before,after:fingerprint(f.path),changed,receipt:result.receipt});
  });
  it.each(kinds)('accepts intentional %s part removals from a legitimate structural edit',async kind=>{
    const f=await edited(kind);if(kind==='xlsx')await files.office.sheetAction(owner,{id:f.id,version:0,action:{type:'delete',sheetId:'3'}});else await files.pptx.edit(owner,{id:f.id,version:0,action:{type:'delete',slideId:'257'}});
    const result=await f.save();expect(result.receipt.state,result.receipt.message).toBe('saved');const file=await OfficePackage.read(readFileSync(f.path)),removed=Object.keys(f.fixture.parts).filter(n=>!file.has(n));expect(removed.length).toBeGreaterThan(0);expect(removed).toContain(kind==='xlsx'?'xl/worksheets/sheet3.xml':'ppt/slides/slide2.xml');for(const[n,sha]of Object.entries(f.fixture.parts))if(n.startsWith('customXml/'))expect(file.hashes()[n]).toBe(sha);observations.push({base,kind,branch:'legitimate-part-removal',removed,receipt:result.receipt,unrelatedPartsPreserved:true});
  });
  for(const mode of modes)it.each(kinds)(`blocks %s ${mode} before original IO and retains its actual draft`,async kind=>{
    const f=await edited(kind);await f.edit();
    // One explicit main-side delivery fault: the actual Worker/model remains
    // original, but one save candidate loses/rewrites a preserved part. Never
    // replace a business result with a canned success or change source bytes.
    inject(kind,mode);
    const draftId=randomUUID();let result:any,error='';try{result=await f.save(draftId);}catch(e){error=String(e);}
    const after=fingerprint(f.path);observations.push({base,kind,branch:mode,before:f.before,after,result,error,fault:'one actual Worker materialize delivery; current legal model unchanged'});
    expect(after,'unexpected fidelity loss must not write the original').toEqual(f.before);
    expect(result?.receipt.state).toBe('failed');expect(result?.fidelity?.total).toBeGreaterThan(0);expect(result?.fidelity?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.checkpoint).toBeTruthy();const recovered=await files.readDraft(owner,f.document.ref,draftId);
    expect(recovered.encoding).toBe('ooxml-draft');
    const draft=kind==='xlsx'?decodeOfficeDraft(Buffer.from(recovered.base64,'base64')):decodePptxDraft(Buffer.from(recovered.base64,'base64')),model=await OfficePackage.read(draft.bytes);
    for(const [name,sha]of Object.entries(f.fixture.parts))if(name.startsWith('customXml/'))expect(model.hashes()[name]).toBe(sha);
    expect(kind==='xlsx'?new OfficeWorkbook(model).cell('1',1,1).value:new OfficePagesModel(model).info.slides[0].notes).toBe(kind==='xlsx'?'19':'Y13 allowed notes 中文🙂');
  });
  it.each(kinds)('cancels a %s lossy copy without acknowledging the original or resolving its draft',async kind=>{
    const f=await blocked(kind),ack=vi.spyOn((kind==='xlsx'?OfficeParser:PptxParser).prototype,'acknowledge'),resolve=vi.spyOn(files,'resolveDraft');
    expect(await invoke('saveOfficeLossyCopy',f.copy)).toEqual({state:'cancelled'});expect(system.dialog).toHaveBeenCalledOnce();expect(system.dialog.mock.calls[0][1].title).toBe('另存有损副本');expect(fingerprint(f.path)).toEqual(f.before);expect(ack).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();expect(files.drafts(owner,f.document.ref).some(d=>d.id===f.draftId)).toBe(true);
    observations.push({base,kind,branch:'copy-cancelled',before:f.before,after:fingerprint(f.path),receipt:f.result.receipt,originalAcknowledged:false,draftRetained:true,dialog:'explicit I adapter, no native GUI'});
  });
  it.each(kinds)('copies the exact blocked %s candidate through native IO and keeps the original dirty',async kind=>{
    const f=await blocked(kind),target=join(base,`lossy.${kind}`);writeFileSync(target,'OLD COPY');system.dialog.mockResolvedValue({canceled:false,filePath:target});
    const candidate=await (kind==='xlsx'?files.office:files.pptx).lossyCandidate(owner,f.id,f.copy.token),ack=vi.spyOn((kind==='xlsx'?OfficeParser:PptxParser).prototype,'acknowledge'),resolve=vi.spyOn(files,'resolveDraft');
    const receipt=await invoke('saveOfficeLossyCopy',f.copy);expect(receipt.state).toBe('saved');expect(hash(readFileSync(target))).toBe(hash(candidate.bytes));expect(fingerprint(f.path)).toEqual(f.before);expect(ack).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();expect(files.drafts(owner,f.document.ref).some(d=>d.id===f.draftId)).toBe(true);
    observations.push({base,kind,branch:'copy-saved',before:f.before,after:fingerprint(f.path),target,copyHash:hash(readFileSync(target)),candidateHash:hash(candidate.bytes),originalAcknowledged:false,draftRetained:true,dialog:'explicit I adapter; actual native copy/CAS/backup'});
  });
  for(const alias of [false,true])it.each(kinds)(`rejects %s lossy copy to its original (hardlink=${alias})`,async kind=>{
    const f=await blocked(kind),target=alias?join(base,`alias.${kind}`):f.path;if(alias)linkSync(f.path,target);system.dialog.mockResolvedValue({canceled:false,filePath:target});await expect(invoke('saveOfficeLossyCopy',f.copy)).rejects.toThrow(/覆盖源文件/);expect(fingerprint(f.path)).toEqual(f.before);observations.push({base,kind,branch:'same-source-copy',hardlink:alias,sourcePreserved:true});
  });
  it.each(kinds)('rejects %s stale, foreign, subframe and byte-injected copy requests before any picker',async kind=>{
    const f=await blocked(kind);await expect(invoke('saveOfficeLossyCopy',{...f.copy,bytes:Buffer.from('forged')})).rejects.toThrow();await expect(invoke('saveOfficeLossyCopy',f.copy,{...event,senderFrame:{}}as never)).rejects.toThrow('可信');
    const otherSender=Object.assign(new EventEmitter(),{id:731,mainFrame:{processId:7,routingId:31},isDestroyed:()=>false});await expect(invoke('saveOfficeLossyCopy',f.copy,{sender:otherSender,senderFrame:otherSender.mainFrame}as never)).rejects.toThrow(/关闭|不属于/);
    if(kind==='xlsx')await files.office.edit(owner,{id:f.id,version:1,edit:{sheetId:'1',row:1,column:1,text:'23'}});else await files.pptx.edit(owner,{id:f.id,version:1,action:{type:'notes',slideId:'256',text:'newer note'}});
    await expect(invoke('saveOfficeLossyCopy',f.copy)).rejects.toThrow('过期');expect(system.dialog).not.toHaveBeenCalled();expect(fingerprint(f.path)).toEqual(f.before);observations.push({base,kind,branch:'copy-authority',checks:['strict-schema','subframe','foreign-owner','new-version'],pickerCalls:0,sourcePreserved:true});
  });
  it.each(kinds)('prevents generic %s byte writes and checkpoints from bypassing the Office gate',async kind=>{
    const f=await edited(kind),data=readFileSync(f.path).toString('base64');await expect(files.save(owner,{ref:f.document.ref,opId:randomUUID(),bufferVersion:1,baseHash:f.document.revision.hash,base64:data})).rejects.toThrow('保真');
    await expect(files.checkpoint(owner,{ref:f.document.ref,draftId:randomUUID(),bufferVersion:1,baseHash:f.document.revision.hash,base64:data,encoding:'ooxml-draft',bom:false})).rejects.toThrow('保真');expect(fingerprint(f.path)).toEqual(f.before);observations.push({base,kind,branch:'generic-bypass-denied',sourcePreserved:true});
  });
  it.each(kinds)('restores the verified %s draft after a blocked candidate and saves only the legitimate model',async kind=>{
    const f=await blocked(kind);if(kind==='xlsx')files.office.close(owner,f.id);else files.pptx.close(owner,f.id);files.closeDocument(owner,f.document.ref);
    const document=await files.open(owner,{lease:f.root.lease,generation:f.root.generation,relativePath:`source.${kind}`}),id=randomUUID();let result;
    if(kind==='xlsx'){await files.office.open(owner,{id,ref:document.ref,baseHash:document.revision.hash});const restored=await files.office.restore(owner,{id,version:0,draftId:f.draftId});expect(restored.state.dirty).toBe(true);expect(fingerprint(f.path)).toEqual(f.before);result=await files.office.save(owner,{id,version:restored.state.version,draftId:f.draftId,bufferVersion:2,opId:randomUUID()});}
    else{await files.pptx.open(owner,{id,ref:document.ref,baseHash:document.revision.hash});const restored=await files.pptx.restore(owner,{id,version:0,draftId:f.draftId});expect(restored.state.dirty).toBe(true);expect(fingerprint(f.path)).toEqual(f.before);result=await files.pptx.save(owner,{id,version:restored.state.version,draftId:f.draftId,bufferVersion:2,opId:randomUUID()});}
    expect(result.receipt.state).toBe('saved');const recovered=await OfficePackage.read(readFileSync(f.path));for(const[n,sha]of Object.entries(f.fixture.parts))if(n.startsWith('customXml/'))expect(recovered.hashes()[n]).toBe(sha);observations.push({base,kind,branch:'verified-draft-restore',before:f.before,after:fingerprint(f.path),receipt:result.receipt,unrelatedPartsPreserved:true});
  });
  it.each(kinds)('reports %s private draft IO failure without losing the live model or writing the original',async kind=>{
    const f=await edited(kind);await f.edit();inject(kind,'missing');const original=broker.request.bind(broker);vi.spyOn(broker,'request').mockImplementation((request:any,options:any)=>request.operation==='checkpoint'?Promise.reject(new Error('Synthetic private draft disk full')):original(request,options));
    const result=await f.save();expect(result.receipt.state).toBe('failed');expect(result.fidelity?.total).toBeGreaterThan(0);expect(result.checkpoint).toBeUndefined();expect(result.draftError).toContain('未确认写入磁盘');expect(result.state.dirty).toBe(true);expect(fingerprint(f.path)).toEqual(f.before);observations.push({base,kind,branch:'draft-IO-failure',before:f.before,after:fingerprint(f.path),fidelity:result.fidelity,draftError:result.draftError,memoryDirty:result.state.dirty,durable:false});
  });
  it.each(kinds)('rejects %s signature editing before any source write',async kind=>{
    const f=await edited(kind,true);await expect(f.edit()).rejects.toThrow(/签名/);expect(fingerprint(f.path)).toEqual(f.before);observations.push({base,kind,branch:'signed-readonly',before:f.before,after:fingerprint(f.path),signatureMarkerOnly:true});
  });
});
afterAll(()=>{if(process.env.WILLYOU_FIDELITY_EVIDENCE)writeFileSync(process.env.WILLYOU_FIDELITY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-Y13',app,observations,boundary:'Actual FileService/native broker and packaged document Workers. Small private synthetic files; one explicitly injected candidate delivery mutation, no model/receiver/native result success stubs. Not GUI/layout/cryptographic-signature/other-platform proof.'},null,2)+'\n');});
