import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {OfficePackage} from '@main/core/files/office/package';
import {OfficeWorkbook} from '@main/core/files/office/workbook';
import {FileBuffer} from '../file-buffer';
const api=vi.hoisted(()=>Object.fromEntries(['openOffice','closeOffice','officeCell','editOffice','checkpointOffice','saveOffice','recalculateOffice','rebaseOffice','drafts','refresh','resolveDraft','closeDocument'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const rows:unknown[]=[],cleanup:(()=>Promise<void>)[]=[];
const until=async(fn:()=>boolean)=>{const end=Date.now()+15000;while(!fn()){expect(Date.now()).toBeLessThan(end);await delay(5);}};
afterEach(async()=>{vi.useRealTimers();for(const close of cleanup.splice(0))await close();vi.resetAllMocks();});
afterAll(()=>{if(process.env.SMARTDD_OFFICE_REFRESH_EVIDENCE)writeFileSync(process.env.SMARTDD_OFFICE_REFRESH_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-J09',rows},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_OFFICE_ACCEPTANCE_APP)('J09 real XLSX native refresh coordination',()=>{
 it.each(['clean','pending','version-revert','busy-edit','old-stat-after-save'] as const)('%s preserves current local/native versions and source',async scenario=>{
  const resources=join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP!,'Contents/Resources');createRequire(join(resources,'app.asar/package.json'))('original-fs');const base=mkdtempSync('/private/tmp/willyou-office-refresh-I-'),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,'refresh.xlsx');writeFileSync(path,readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
  const broker=new NativeFileBroker(join(resources,'native/willyou-files')),resolver={sources:()=>[{kind:'project-directory'as const,id:'refresh',path:project,label:'Own refresh',projectId:'refresh'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver),undefined,undefined,undefined,undefined,join(resources,'app.asar/out/main/m9-office-document.js')),owner='refresh';
  const root=(await service.openScope(owner,{kind:'project',projectId:owner})).roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:'refresh.xlsx'});
  for(const[name,fn]of Object.entries({openOffice:(x:never)=>service.office.open(owner,x),officeCell:(x:never)=>service.office.cell(owner,x),closeOffice:async(id:string)=>service.office.close(owner,id),editOffice:(x:never)=>service.office.edit(owner,x),checkpointOffice:(x:never)=>service.office.checkpoint(owner,x),saveOffice:(x:never)=>service.office.save(owner,x),recalculateOffice:(x:never)=>service.office.recalculate(owner,x),rebaseOffice:(x:never)=>service.office.rebase(owner,x),drafts:(x:never)=>service.drafts(owner,x),refresh:(x:never)=>service.refresh(owner,x),resolveDraft:(x:never)=>service.resolveDraft(owner,x),closeDocument:async(x:never)=>service.closeDocument(owner,x)}))api[name].mockImplementation(fn);
  const buffer=new FileBuffer(file,api as unknown as ConstructorParameters<typeof FileBuffer>[1],()=>undefined);let release=()=>{};
  cleanup.push(async()=>{release();buffer.dispose();service.closeOwner(owner);await service.watcher.dispose();await until(()=>broker.activeProcesses===0);expect(service.office.activeDocuments).toBe(0);broker.dispose();rmSync(base,{recursive:true,force:true});});
  await buffer.getOffice().load();const office=buffer.office!,client=office.client;vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  const pending=(text:string)=>office.setPending({sheetId:'1',row:0,column:0,text},'Label',0),disk=async()=>new OfficeWorkbook(await OfficePackage.read(readFileSync(path))).cell('1',0,0).value;
  const external=()=>JSON.parse(execFileSync('/usr/bin/python3',[resolve('scripts/files/write-office-external.py'),path,'external '+scenario],{encoding:'utf8'}));let writing:unknown;
  if(scenario==='old-stat-after-save'){
   const original=api.refresh.getMockImplementation()!;let reply:unknown;api.refresh.mockImplementationOnce(async x=>{reply=await original(x);return new Promise(done=>{release=()=>done(reply);});});const refreshing=office.refresh();await until(()=>!!reply);pending('own save');expect(await buffer.save()).toBe(true);const hash=buffer.baseHash;release();await refreshing;expect(buffer.baseHash).toBe(hash);expect(buffer.conflict).toBe(false);expect(office.client).toBe(client);expect(await disk()).toBe('own save');
  }else if(scenario==='busy-edit'){
   const original=api.editOffice.getMockImplementation()!;let reply:unknown;api.editOffice.mockImplementationOnce(async x=>{reply=await original(x);return new Promise(done=>{release=()=>done(reply);});});const editing=office.editCell({sheetId:'1',row:0,column:0,text:'local busy'});await until(()=>!!reply);writing=external();const refreshing=office.refresh();release();expect(await editing).toBe(true);await refreshing;expect(buffer.conflict).toBe(true);expect(office.client).toBe(client);expect(buffer.dirty).toBe(true);expect(await disk()).toBe('external '+scenario);expect(await buffer.keepLocal()).toBe(true);expect(await disk()).toBe('local busy');
  }else{
   if(scenario==='pending')pending('retained local');writing=external();let held:unknown;const original=api.refresh.getMockImplementation()!;
   if(scenario==='version-revert')api.refresh.mockImplementationOnce(async x=>{held=await original(x);return new Promise(done=>{release=()=>done(held);});});
   const refreshing=office.refresh();if(scenario==='version-revert'){await until(()=>!!held);pending('temporary');pending('Label');expect(buffer.dirty).toBe(false);release();}await refreshing;
   if(scenario==='clean'){expect(buffer.conflict).toBe(false);expect(buffer.baseHash).not.toBe(file.revision.hash);expect(office.client).not.toBe(client);expect(office.result!.state.dirty).toBe(false);expect(await office.client!.text('1',0,0)).toBe('external clean');}
   else{expect(buffer.conflict).toBe(true);expect(office.client).toBe(client);expect(buffer.baseHash).toBe(file.revision.hash);await office.refresh();expect(office.client).toBe(client);expect(await buffer.useDisk()).toBe(true);expect(buffer.conflict).toBe(false);expect(buffer.dirty).toBe(false);expect(office.client).not.toBe(client);}
   expect(await disk()).toBe('external '+scenario);
  }
  rows.push({scenario,writing,dirty:buffer.dirty,conflict:buffer.conflict,refreshCalls:api.refresh.mock.calls.length,finalHash:buffer.baseHash,pass:true,boundary:'Actual native FileService/packaged Worker with source OfficeBuffer. Original native edit or stat reply delayed only in IPC test adapter for races. Independent same-inode fsync writer. No fabricated model, source revision or receipt.'});
 },30000);
});
