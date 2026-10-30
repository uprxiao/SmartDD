import {createRequire} from 'node:module';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {OfficePackage} from '@main/core/files/office/package';
import {OfficeWorkbook} from '@main/core/files/office/workbook';
import {FileWorkspaceStore} from '../workspace-store';
import type {FileClient} from '../file-buffer';
const names=['openOffice','closeOffice','editOffice','editOfficeRange','checkpointOffice','saveOffice','recalculateOffice','drafts','refresh','resolveDraft','closeDocument','roots','list','open','closeScope'];const api=vi.hoisted(()=>Object.fromEntries(['openOffice','closeOffice','editOffice','editOfficeRange','checkpointOffice','saveOffice','recalculateOffice','drafts','refresh','resolveDraft','closeDocument','roots','list','open','closeScope'].map(x=>[x,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const rows:unknown[]=[],cleanup:(()=>Promise<void>)[]=[];const until=async(fn:()=>boolean)=>{const end=Date.now()+15000;while(!fn()){expect(Date.now()).toBeLessThan(end);await delay(5);}};
afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.resetAllMocks();});afterAll(()=>{if(process.env.SMARTDD_OFFICE_CLOSE_EVIDENCE)writeFileSync(process.env.SMARTDD_OFFICE_CLOSE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-J10',rows},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_OFFICE_ACCEPTANCE_APP)('J10 actual XLSX queue/close/native persistence',()=>{
 it.each(['checkpoint-success','checkpoint-failure','append-success','append-failure','materialize-success','materialize-failure','clean-range-success'])('%s never disposes an outstanding required save',async scenario=>{
  const resources=join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP!,'Contents/Resources');createRequire(join(resources,'app.asar/package.json'))('original-fs');const base=mkdtempSync('/private/tmp/willyou-office-close-I-'),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,'close.xlsx'),source=readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx');writeFileSync(path,source);
  const broker=new NativeFileBroker(join(resources,'native/willyou-files')),resolver={sources:()=>[{kind:'project-directory'as const,id:'close',path:project,label:'Own close',projectId:'close'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver),undefined,undefined,undefined,undefined,join(resources,'app.asar/out/main/m9-office-document.js')),owner='close',scope={kind:'project'as const,projectId:owner};
  const impl:Record<string,unknown>={openOffice:(x:never)=>service.office.open(owner,x),closeOffice:async(id:string)=>service.office.close(owner,id),editOffice:(x:never)=>service.office.edit(owner,x),editOfficeRange:(x:never)=>service.office.rangeAction(owner,x),checkpointOffice:(x:never)=>service.office.checkpoint(owner,x),saveOffice:(x:never)=>service.office.save(owner,x),recalculateOffice:(x:never)=>service.office.recalculate(owner,x),drafts:(x:never)=>service.drafts(owner,x),refresh:(x:never)=>service.refresh(owner,x),resolveDraft:(x:never)=>service.resolveDraft(owner,x),closeDocument:async(x:never)=>service.closeDocument(owner,x),roots:()=>service.openScope(owner,scope),open:(x:never)=>service.open(owner,x),list:(x:never)=>service.list(owner,x),closeScope:async()=>{}};
  for(const name of names)api[name].mockImplementation(impl[name] as never);const store=new FileWorkspaceStore(scope,api as unknown as FileClient,{getItem:()=>null,setItem:()=>{}},{load:async()=>null,save:async()=>{}});let release=()=>{},fault=false;
  cleanup.push(async()=>{release();chmodSync(project,0o755);const recovery=join(userdata,'file-recovery/v1');try{chmodSync(recovery,0o700);}catch{}store.dispose();service.closeOwner(owner);await service.watcher.dispose();await until(()=>broker.activeProcesses===0);expect(service.office.activeDocuments).toBe(0);broker.dispose();rmSync(base,{recursive:true,force:true});});
  await store.initialize();await store.open(store.roots.roots[0],'close.xlsx',true);const tab=store.active!,buffer=tab.buffer!,office=buffer.getOffice();await office.load();office.pauseAutosave();
  const kind=scenario.split('-')[0],failed=scenario.endsWith('failure'),method=kind==='checkpoint'?'checkpointOffice':kind==='append'?'editOffice':kind==='materialize'?'saveOffice':'editOfficeRange',original=api[method].getMockImplementation()!;let first=true,held:{value?:unknown;error?:unknown;before:string}|undefined;
  fault=failed&&kind!=='append';api[method].mockImplementation(async input=>{
   let value:unknown,error:unknown;const directory=kind==='checkpoint'?join(userdata,'file-recovery/v1'):project,mode=statSync(directory).mode&0o777;
   try{if(fault)chmodSync(directory,kind==='checkpoint'?0o500:0o555);value=await original(input);}catch(caught){error=caught;}finally{if(fault)chmodSync(directory,mode);}
   if(first){first=false;held={value,error,before:JSON.stringify(value??String(error))};await new Promise<void>(done=>{release=done;});expect(JSON.stringify(value??String(error))).toBe(held.before);}if(error)throw error;return value;
  });
  let operation:Promise<boolean>;
  if(kind==='clean'){operation=office.rangeAction({type:'format',sheetId:'1',range:{firstRow:0,lastRow:0,firstColumn:0,lastColumn:0},format:{font:{bold:true}}});}
  else{office.setPending({sheetId:'1',row:0,column:0,text:failed&&kind==='append'?'=SUM(':'latest '+scenario},'Label',0);operation=buffer.save();}
  await until(()=>!!held);if(kind==='clean')expect(buffer.dirty).toBe(false);let finished=false;const closing=store.close(tab.id).then(x=>{finished=true;return x;});await delay(30);expect(finished).toBe(false);expect(api.closeOffice).not.toHaveBeenCalled();expect(service.office.activeDocuments).toBe(1);
  release();expect(await operation).toBe(!failed);const closed=await closing;expect(closed).toBe(failed?'blocked':'closed');
  if(failed){expect(store.active).toBe(tab);expect(buffer.dirty).toBe(true);expect(readFileSync(path)).toEqual(source);expect(api.closeOffice).not.toHaveBeenCalled();if(kind==='checkpoint')expect(String(held!.error)).toContain('Recovery root permissions changed');if(kind==='materialize')expect(held!.value).toMatchObject({receipt:{state:'failed'}});fault=false;office.setPending({sheetId:'1',row:0,column:0,text:'latest '+scenario},'Label',office.result!.state.version);expect(await store.close(tab.id)).toBe('closed');}
  expect(store.tabs).toHaveLength(0);const workbook=new OfficeWorkbook(await OfficePackage.read(readFileSync(path)));expect(workbook.cell('1',0,0).value).toBe(kind==='clean'?'Label':'latest '+scenario);if(kind==='clean'){const cell=workbook.window('1',0,0,1,1);expect(cell.styles[cell.cells[0].style].font?.bold).toBe(true);}
  expect(api.closeOffice).toHaveBeenCalledTimes(1);expect(api.closeDocument).toHaveBeenCalledTimes(1);rows.push({scenario,firstClose:closed,held:held!.before,saveCalls:api.saveOffice.mock.calls.length,checkpointCalls:api.checkpointOffice.mock.calls.length,finalValue:workbook.cell('1',0,0).value,pass:true,boundary:'Real WorkspaceStore/FileBuffer/native broker and packaged Worker. Public pauseAutosave isolates close queue; source inputs/outputs/errors untouched, one original result delayed. Failure checkpoint uses actual private recovery-root permission guard, append actual invalid formula, materialize genuine source-parent write denial. Source byte preservation and explicit successful retry verified.'});
 },30000);
});
