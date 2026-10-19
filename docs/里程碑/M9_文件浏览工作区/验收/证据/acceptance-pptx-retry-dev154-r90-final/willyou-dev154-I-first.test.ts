import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker,type BrokerOptions} from '@main/core/files/native-broker';
import {OfficePackage} from '@main/core/files/office/package';
import {OfficePagesModel} from '@main/core/files/office/pages-model';
import {decodePptxDraft} from '@main/core/files/office/pptx-draft';
import {FileBuffer} from '../file-buffer';
const api=vi.hoisted(()=>Object.fromEntries(['openPptx','closePptx','editPptx','pptxHistory','checkpointPptx','savePptx','drafts','refresh','resolveDraft','closeDocument'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),rows:unknown[]=[],cleanup:(()=>Promise<void>)[]=[];
const until=async(fn:()=>boolean)=>{const end=Date.now()+12000;while(!fn()){expect(Date.now()).toBeLessThan(end);await delay(5);}};
afterEach(async()=>{vi.useRealTimers();for(const close of cleanup.splice(0))await close();vi.resetAllMocks();});
afterAll(()=>{if(process.env.SMARTDD_PPTX_RETRY_EVIDENCE)writeFileSync(process.env.SMARTDD_PPTX_RETRY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-J04',rows},null,2)+'\n');});
async function fixture(){
 const app=process.env.SMARTDD_OFFICE_ACCEPTANCE_APP!,resources=join(app,'Contents/Resources');createRequire(join(resources,'app.asar/package.json'))('original-fs');
 const base=mkdtempSync('/private/tmp/willyou-pptx-retry-I-'),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,'retry.pptx'),bytes=readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx');writeFileSync(path,bytes);
 class ReadOnlyWriteBroker extends NativeFileBroker{
  deny=false;writes:unknown[]=[];
  override async request<T>(input:Record<string,unknown>,options:BrokerOptions={}){
   if(input.operation!=='save')return super.request<T>(input,options);const denied=this.deny;this.deny=false;const before=sha(readFileSync(path));if(denied)chmodSync(path,0o444);
   try{const value=await super.request<T>(input,options);this.writes.push({denied,before,after:sha(readFileSync(path)),input:{baseHash:input.baseHash,relativePath:input.relativePath},receipt:value});return value;}
   finally{if(denied)chmodSync(path,0o644);}
  }
 }
 const broker=new ReadOnlyWriteBroker(join(resources,'native/willyou-files')),resolver={sources:()=>[{kind:'project-directory'as const,id:'retry',path:project,label:'Own PPTX retry',projectId:'retry'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver),undefined,undefined,undefined,undefined,undefined,undefined,undefined,join(resources,'app.asar/out/main/m9-pptx-document.js'));
 const owner='retry',root=(await service.openScope(owner,{kind:'project',projectId:'retry'})).roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:'retry.pptx'});
 api.openPptx.mockImplementation(input=>service.pptx.open(owner,input));api.closePptx.mockImplementation(async id=>service.pptx.close(owner,id));api.editPptx.mockImplementation(input=>service.pptx.edit(owner,input));api.pptxHistory.mockImplementation(input=>service.pptx.history(owner,input));api.checkpointPptx.mockImplementation(input=>service.pptx.checkpoint(owner,input));api.savePptx.mockImplementation(input=>service.pptx.save(owner,input));api.drafts.mockImplementation(ref=>service.drafts(owner,ref));api.refresh.mockImplementation(ref=>service.refresh(owner,ref));api.resolveDraft.mockImplementation(input=>service.resolveDraft(owner,input));api.closeDocument.mockImplementation(ref=>service.closeDocument(owner,ref));
 const buffer=new FileBuffer(file,api as unknown as ConstructorParameters<typeof FileBuffer>[1],()=>undefined);await buffer.load();const pptx=buffer.pptx!;
 cleanup.push(async()=>{buffer.dispose();service.closeOwner(owner);await service.watcher.dispose();await until(()=>broker.activeProcesses===0);expect(service.pptx.activeDocuments).toBe(0);broker.dispose();rmSync(base,{recursive:true,force:true});});
 return{buffer,pptx,service,broker,path,bytes,owner,file};
}
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_OFFICE_ACCEPTANCE_APP)('J04 real PPTX write/flush failure and close protection',()=>{
 it('retains a later edit and durable checkpoint after actual native denial, blocks failed close, explicitly retries and closes',async()=>{
  const f=await fixture(),slide=f.pptx.result!.state.info.slides[0];vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});f.broker.deny=true;f.pptx.setNotes(slide.id,'first failed 中文',slide.notes!);await vi.advanceTimersByTimeAsync(500);await until(()=>!f.pptx.busy&&!!f.buffer.saveError);
  const first=f.buffer.saveError;expect(first).toMatch(/只读|权限|写入/);expect(f.buffer.dirty).toBe(true);expect(sha(readFileSync(f.path))).toBe(sha(f.bytes));expect(f.broker.writes).toHaveLength(1);
  f.pptx.setNotes(slide.id,'latest retained 🙂','first failed 中文',f.pptx.result!.state.version);await vi.advanceTimersByTimeAsync(3000);await until(()=>!f.pptx.busy);expect(f.broker.writes).toHaveLength(1);
  const draft=decodePptxDraft(Buffer.from((await f.service.readDraft(f.owner,f.file.ref,f.buffer.draftId)).base64,'base64'));expect(draft.pending).toMatchObject({text:'latest retained 🙂'});
  f.broker.deny=true;expect(await f.buffer.prepareClose('save')).toBe(false);expect(f.buffer.dirty).toBe(true);expect(sha(readFileSync(f.path))).toBe(sha(f.bytes));expect(f.broker.writes).toHaveLength(2);expect(f.service.pptx.activeDocuments).toBe(1);
  expect(await f.buffer.save()).toBe(true);expect(f.buffer.dirty).toBe(false);expect(f.buffer.saveError).toBe('');expect(new OfficePagesModel(await OfficePackage.read(readFileSync(f.path))).info.slides[0].notes).toBe('latest retained 🙂');expect(await f.buffer.prepareClose('save')).toBe(true);
  rows.push({scenario:'actual-write-denial/continued-edit/failed-close/explicit-retry',firstError:first,writes:f.broker.writes,draftPending:draft.pending,finalHash:sha(readFileSync(f.path)),dirty:f.buffer.dirty,closePrepared:true});
 },30000);
 it('retains invalid chart raw input and refuses close before writing, then saves corrected values and closes',async()=>{
  const f=await fixture(),slide=f.pptx.result!.state.info.slides[0],chart=slide.elements!.find(x=>x.kind==='chart')!;expect(chart.chart?.editableValues).toBe(true);vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  const original=chart.chart!.values!.join(',');f.pptx.setChartValues(slide.id,chart.id,'1,',original);expect(await f.buffer.prepareClose('save')).toBe(false);expect(f.buffer.saveError).toMatch(/数据|数值|数字|逗号|不能为空/);expect(f.pptx.pending?.text).toBe('1,');expect(f.buffer.dirty).toBe(true);expect(f.broker.writes).toHaveLength(0);expect(sha(readFileSync(f.path))).toBe(sha(f.bytes));
  const error=f.buffer.saveError,draft=decodePptxDraft(Buffer.from((await f.service.readDraft(f.owner,f.file.ref,f.buffer.draftId)).base64,'base64'));expect(draft.pending).toMatchObject({text:'1,',chartValues:true});
  f.pptx.setChartValues(slide.id,chart.id,'15,27',original);expect(await f.buffer.save()).toBe(true);expect(f.pptx.result!.state.info.slides[0].elements!.find(x=>x.id===chart.id)!.chart!.values).toEqual([15,27]);expect(await f.buffer.prepareClose('save')).toBe(true);rows.push({scenario:'flush-validation/retained-raw/failed-close/corrected-save',error,draftPending:draft.pending,writes:f.broker.writes,dirty:f.buffer.dirty,closePrepared:true});
 },30000);
});
