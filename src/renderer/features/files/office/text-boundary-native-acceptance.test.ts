import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {OfficePackage} from '@main/core/files/office/package';
import {OfficePagesModel} from '@main/core/files/office/pages-model';
import {FileBuffer} from '../file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
// The Office IPC singleton is not exercised by these source-text/DOCX paths.
// All FileBuffer persistence below goes to the real native FileService.
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
interface Case {name:string;mode:string;base64:string;expectedBase64?:string;expectedRows?:string[][];before:{sha256:string;parts?:Record<string,string>;names?:string[];lineEndings?:string[];bom?:boolean}}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),rows:unknown[]=[],cleanups:Array<()=>Promise<void>>=[];
const resources=process.env.WILLYOU_WRITEBACK_RESOURCES;
let manifest:{cases:Case[];base?:string}|undefined;
function testCase(name:string):Case {
  manifest??=JSON.parse(process.env.WILLYOU_WRITEBACK_FIXTURES?readFileSync(process.env.WILLYOU_WRITEBACK_FIXTURES,'utf8'):execFileSync('/usr/bin/python3',[resolve('scripts/files/text-writeback-fixtures.py')],{encoding:'utf8',maxBuffer:4*1024*1024}))as{cases:Case[];base?:string};
  const found=manifest.cases.find(c=>c.name===name);if(!found)throw new Error('Missing own writeback fixture '+name);return found;
}
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
afterAll(()=>{if(process.env.WILLYOU_WRITEBACK_EVIDENCE)writeFileSync(process.env.WILLYOU_WRITEBACK_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-J11',resources,rows,boundary:'Actual current FileBuffer/EditorState/source EOL model + FileService/native persistence; own fixtures. Public pauseAutosave isolates explicit write. No GUI asserted. Office IPC singleton unexercised; DOCX model provider genuinely rejects before any document Worker, preview model independently parses original complex package. Clean save return is explicitly no-op, not a genuine write receipt.'},null,2)+'\n');});
async function fixture(c:Case){
 const base=mkdtempSync('/private/tmp/willyou-office-writeback-I-'),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,c.name),original=Buffer.from(c.base64,'base64');writeFileSync(path,original);const resolver={sources:()=>[{kind:'project-directory'as const,id:'source',path:project,label:'J11 native source',projectId:'j11'}]},broker=new NativeFileBroker(join(resources!,'native/willyou-files')),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver),undefined,undefined,undefined,undefined,join(resources!,'app.asar/out/main/m9-office-document.js')),owner='j11',root=(await service.openScope(owner,{kind:'project',projectId:owner})).roots[0],open=()=>service.open(owner,{lease:root.lease,generation:root.generation,relativePath:c.name}),saves:unknown[]=[],buffers:FileBuffer[]=[];
 const api:ConstructorParameters<typeof FileBuffer>[1]={read:ref=>service.read(owner,ref),refresh:ref=>service.refresh(owner,ref),save:async input=>{const result=await service.save(owner,input);saves.push({input,result});return result;},checkpoint:input=>service.checkpoint(owner,input),drafts:async ref=>service.drafts(owner,ref),readDraft:(ref,id)=>service.readDraft(owner,ref,id),resolveDraft:input=>service.resolveDraft(owner,input),closeDocument:async ref=>{await service.closeDocument(owner,ref);}};
 const make=async()=>{const buffer=new FileBuffer(await open(),api,()=>{});buffer.pauseAutosave();buffers.push(buffer);await buffer.load();return buffer;};
 cleanups.push(async()=>{for(const b of buffers)b.dispose();service.closeOwner(owner);await service.watcher.dispose();const end=Date.now()+10000;while(broker.activeProcesses){expect(Date.now()).toBeLessThan(end);await delay(5);}broker.dispose();rmSync(base,{recursive:true,force:true});});
 return{path,original,service,owner,open,make,saves};
}
describe.skipIf(!resources||process.platform!=='darwin')('J11 actual source writeback and unsupported provider boundary',()=>{
 it.each(['matrix.csv','bom.csv','matrix.tsv','bom.tsv'])('%s source edit preserves exact separators, quoting, BOM, mixed EOL and reopens latest',async name=>{
  const c=testCase(name);
  const f=await fixture(c),b=await f.make();expect(b.editable).toBe(true);expect(b.editor).not.toBeNull();const normalized=b.editor!.doc.toString(),from=normalized.indexOf('Hello');expect(from).toBeGreaterThan(0);const transaction=b.editor!.update({changes:{from,to:from+5,insert:'World'}});b.acceptTransactions(transaction.state,[transaction]);expect(b.dirty).toBe(true);const expected=Buffer.from(c.expectedBase64!,'base64');expect(Buffer.from(b.raw,'utf8')).toEqual(expected.subarray(c.before.bom?3:0));expect(await b.save()).toBe(true);expect(b.saveReceipt?.state).toBe('saved');expect(b.saveReceipt&&'revision'in b.saveReceipt?b.saveReceipt.revision?.hash:null).toBe(sha(expected));expect(readFileSync(f.path)).toEqual(expected);expect(f.saves).toHaveLength(1);
  const independent=JSON.parse(execFileSync('/usr/bin/python3',[resolve('scripts/files/text-writeback-fixtures.py'),'verify',f.path],{encoding:'utf8'}));expect(independent.rows).toEqual(c.expectedRows);expect(independent.lineEndings).toEqual(c.before.lineEndings);expect(independent.bom).toBe(c.before.bom);b.dispose();const reopened=await f.make();expect(reopened.editor!.doc.toString()).toBe(normalized.replace('Hello','World'));expect(reopened.dirty).toBe(false);expect(reopened.bom).toBe(c.before.bom);rows.push({file:c.name,mode:c.mode,before:c.before.sha256,after:sha(expected),receipt:b.saveReceipt,independent,reopened:reopened.editor!.doc.toString(),pass:true});
 });
 it.each(['utf16.csv','utf16.tsv','legacy.csv'])('%s has no editable view or write receipt and retains original bytes',async name=>{
  const c=testCase(name);
  const f=await fixture(c),b=await f.make();expect(b.editor).toBeNull();expect(b.editable).toBe(false);expect(b.decoded?.kind).toBe('unsupported-encoding');const noOp=await b.save();expect(noOp).toBe(true);expect(b.saveReceipt).toBeNull();expect(f.saves).toHaveLength(0);expect(readFileSync(f.path)).toEqual(f.original);rows.push({file:c.name,mode:c.mode,reason:b.decoded?.reason,noOpReturn:noOp,genuineSaveReceipts:0,sourceHash:sha(readFileSync(f.path)),pass:true});
 });
 it('complex DOCX preserves every original part and offers no unimplemented text/Office writeback provider',async()=>{
  const c=testCase('complex.docx'),f=await fixture(c),b=await f.make();expect(b.content).toMatchObject({kind:'office',format:'docx'});expect(b.editor).toBeNull();expect(b.editable).toBe(false);const parsed=new OfficePagesModel(await OfficePackage.read(f.original));expect(parsed.info).toMatchObject({kind:'docx',hasRevisions:true});const read=await f.service.read(f.owner,b.file.ref);expect(Buffer.from(read.base64,'base64')).toEqual(f.original);await expect(f.service.office.open(f.owner,{id:randomUUID(),ref:b.file.ref,baseHash:b.file.revision.hash})).rejects.toThrow('此 Office 类型');expect(f.service.office.activeDocuments).toBe(0);const noOp=await b.save();expect(f.saves).toHaveLength(0);expect(b.saveReceipt).toBeNull();const independent=JSON.parse(execFileSync('/usr/bin/python3',[resolve('scripts/files/text-writeback-fixtures.py'),'verify',f.path],{encoding:'utf8'}));expect(independent.names).toEqual(c.before.names);expect(independent.parts).toEqual(c.before.parts);expect(readFileSync(f.path)).toEqual(f.original);rows.push({file:c.name,mode:c.mode,info:parsed.info,noOpReturn:noOp,genuineSaveReceipts:0,originalPartsPreserved:independent.parts,sourceHash:sha(readFileSync(f.path)),pass:true});
 });
});
