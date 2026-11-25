import Database from 'better-sqlite3';
import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {BrowserService,type BrowserScope} from '../service';
import type {BrowserPage} from '../page-registry';
import {browserTabOpenInput} from '../tab-open';
vi.mock('electron',()=>({app:{userAgentFallback:'WillYou/0.1 Electron/42 Chrome/148'},session:{},nativeImage:{},shell:{}}));

// Software layer: actual BrowserService, BrowserWorkspace, request receipts
// and SQLite. Synthetic tasks and a gated native-navigation boundary only.
const fixtureRoot=process.env.WILLYOU_F36_CONTRACT_DIR;
if(!fixtureRoot?.startsWith('/private/tmp/willyou-f36-reopen-'))throw Error('use isolated F36 fixture data');
const fixtures:{service:BrowserService;db:Database.Database;run:AbortController}[]=[];
function fixture(){
  const db=new Database(':memory:');
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,cwd TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);');
  db.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));
  const root=mkdtempSync(join(fixtureRoot!,'host-')),projects=new Map([['T1','P1'],['T2','P1']]);
  for(const [id,project] of projects)db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(id,project,id,root);
  db.prepare('INSERT INTO projects VALUES(?,?)').run('P1','Synthetic project');
  const run=new AbortController(),service=new BrowserService({
    sqlite:db,userData:root,helper:{executable:'/must-not-run',sha256:'0'.repeat(64)},
    taskProject:id=>projects.get(id)??null,taskDirectory:()=>root,
  });
  fixtures.push({service,db,run});
  const scope=(taskId='T1'):BrowserScope=>({
    taskId,projectId:projects.get(taskId)!,runId:'fixture-run-'+taskId,requestId:randomUUID(),
    operationId:randomUUID(),runSignal:run.signal,signal:new AbortController().signal,
    assertRetained:()=>{},assertActive:()=>{},
  });
  return {service,db,scope,root};
}
afterEach(async()=>{for(const f of fixtures.splice(0)){f.run.abort();await f.service.dispose();f.db.close();}vi.restoreAllMocks();});
function trace(caseName:string,phase:string,value:unknown){
  const row={case:caseName,phase,value};console.log('F36_HOST_TRACE '+JSON.stringify(row));
  const output=process.env.WILLYOU_F36_HOST_TRACE_PATH;if(output)appendFileSync(output,JSON.stringify(row)+'\n');
}
const route='https://fixture.invalid/f36?month=11#report';
const idFixture='11111111-1111-4111-8111-111111111111';
const pageOf=(id:string)=>({id,taskId:'T1',projectId:'P1',closed:false} as BrowserPage);
const operationSummary=(service:BrowserService,scope:BrowserScope)=>service.operations.receipt(scope.runId,scope.requestId);
it('BE04: host parser enforces exactly one logical tab target and existing-page compatibility',()=>{
  const invalid=[{}, {pageId:idFixture,url:route}, {pageId:idFixture,intent:'new'}, {pageId:idFixture,profileId:'synthetic-profile'}];
  const results=[];
  for(const input of invalid){
    let error:unknown;try{browserTabOpenInput(input);}catch(e){error=e;}
    expect(error).toMatchObject({code:'INVALID_INPUT'});results.push({input,error:(error as Error).message});
  }
  expect(browserTabOpenInput({url:route})).toMatchObject({url:route,intent:'reuse-or-new',presentation:'background'});
  expect(browserTabOpenInput({pageId:idFixture})).toMatchObject({pageId:idFixture});
  trace('parser','invalid-target-rejected-and-valid-accepted',results);
});
it('BE04: actual workspace persists close, rejects old ID, allocates a fresh logical ID for new URL, and preserves its original request receipt',async()=>{
  const f=fixture(),w=f.service.workspace,show=vi.fn();f.service.attachOpenPresentation(show);
  // No address: the logical old tab is not attached to a native page in this software test.
  const old=w.create('T1').activeId!;
  expect(await w.close('T1',old)).toMatchObject({tabs:[],activeId:null});
  const saved=JSON.parse((f.db.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:T1') as {value:string}).value);
  expect(saved.closed.map((tab:{id:string})=>tab.id)).toContain(old);
  expect(w.savedTab('T1',old)).toBeUndefined();
  expect(()=>w.select('T1',old)).toThrow('本任务没有这个网页标签');
  const engineCreate=vi.spyOn(f.service.pages,'create');
  const load=vi.spyOn(w,'loadAgentOpen');
  await expect(f.service.execute(f.scope(),'tab open',{pageId:old,presentation:'show'})).rejects.toMatchObject({code:'BROWSER_TAB_NOT_FOUND'});
  expect(show).not.toHaveBeenCalled();expect(engineCreate).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
  trace('close-new-receipt','closed-old-id-rejected',{old,closed:saved.closed.map((tab:{id:string})=>tab.id),tabs:w.snapshot('T1').tabs});
  let release!:(page:BrowserPage)=>void;
  const pending=new Promise<BrowserPage>(r=>{release=r;});
  load.mockReturnValueOnce(pending);
  const request=f.scope(),args={url:route,presentation:'show'};
  try{
    const receipt=await f.service.execute(request,'tab open',args) as {pageId:string;phase:string;reused:boolean};
    expect(receipt).toMatchObject({phase:'loading',reused:false});expect(receipt.pageId).not.toBe(old);
    expect(w.snapshot('T1')).toMatchObject({tabs:[{id:receipt.pageId,pendingUrl:route,loading:true}],activeId:null});
    expect(show).toHaveBeenCalledOnce();
    expect(await f.service.execute(request,'tab open',args)).toEqual(receipt);
    expect(show).toHaveBeenCalledOnce();
    await expect(f.service.execute(request,'tab open',{...args,url:'https://fixture.invalid/f36?month=12#report'})).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
    // This callback stands in for native navigation completion only; no live page is asserted.
    release(pageOf(receipt.pageId));
    await vi.waitFor(()=>expect(operationSummary(f.service,request)).toMatchObject({state:'succeeded',summary:{pageId:receipt.pageId,phase:'ready'}}));
    expect(load).toHaveBeenCalledOnce();expect(engineCreate).not.toHaveBeenCalled();
    const ready=operationSummary(f.service,request);
    trace('close-new-receipt','new-logical-page-and-ready-receipt',{old,receipt,ready,showCalls:show.mock.calls.map(([,pageId])=>pageId)});
    await w.close('T1',receipt.pageId);
    expect(w.snapshot('T1').tabs).toEqual([]);
    const replay=await f.service.execute(request,'tab open',args);
    expect(replay).toMatchObject({pageId:receipt.pageId,phase:'ready'});
    expect(w.snapshot('T1').tabs).toEqual([]);
    expect(show).toHaveBeenCalledOnce();expect(load).toHaveBeenCalledOnce();
    trace('close-new-receipt','same-request-after-close-returns-receipt-without-reopening',{replay,tabs:w.snapshot('T1').tabs});
  }finally{release(pageOf('fixture-cleanup'));}
});
it('BE04: delayed completion of a logically closed pending page settles cancelled; a new request gets a different page ID',async()=>{
  const f=fixture(),w=f.service.workspace,show=vi.fn();f.service.attachOpenPresentation(show);
  let finish!:(page:BrowserPage)=>void;
  const blocked=new Promise<BrowserPage>(resolve=>{finish=resolve;});
  const load=vi.spyOn(w,'loadAgentOpen').mockReturnValueOnce(blocked);
  const firstRequest=f.scope(),args={url:route,presentation:'show'};
  try{
    const first=await f.service.execute(firstRequest,'tab open',args) as {pageId:string;phase:string};
    await vi.waitFor(()=>expect(load).toHaveBeenCalledOnce());
    await w.close('T1',first.pageId);
    expect(w.snapshot('T1').tabs).toEqual([]);
    finish(pageOf(first.pageId));
    await vi.waitFor(()=>expect(operationSummary(f.service,firstRequest)).toMatchObject({state:'failed',summary:{pageId:first.pageId,phase:'cancelled'}}));
    const cancelled=operationSummary(f.service,firstRequest);
    const replay=await f.service.execute(firstRequest,'tab open',args);
    expect(replay).toMatchObject({pageId:first.pageId,phase:'cancelled'});
    expect(w.snapshot('T1').tabs).toEqual([]);expect(show).toHaveBeenCalledOnce();
    const secondRequest=f.scope();
    load.mockImplementationOnce(async(_task,id)=>pageOf(id));
    const second=await f.service.execute(secondRequest,'tab open',args) as {pageId:string;phase:string};
    expect(second.pageId).not.toBe(first.pageId);
    await vi.waitFor(()=>expect(operationSummary(f.service,secondRequest)).toMatchObject({state:'succeeded',summary:{pageId:second.pageId,phase:'ready'}}));
    expect(w.snapshot('T1').tabs.map(tab=>tab.id)).toEqual([second.pageId]);
    expect(show.mock.calls.map(([,pageId])=>pageId)).toEqual([first.pageId,second.pageId]);
    trace('late-closed-pending','cancelled-old-and-distinct-next',{first,cancelled,replay,second,ready:operationSummary(f.service,secondRequest)});
  }finally{finish(pageOf('fixture-cleanup'));}
});
it('BE04: actual logical matching is exact URL/profile/task; force-new never reuses the existing pending tab',async()=>{
  const f=fixture(),w=f.service.workspace;
  // Test reserve matching only, not real profile creation or authorization.
  const initial={url:route,profileId:'fixture-profile-a',forceNew:false};
  const first=w.reserveAgentOpen('T1',initial);
  const reuse=w.reserveAgentOpen('T1',initial);
  expect(reuse.pageId).toBe(first.pageId);expect(reuse.reused).toBe(true);
  const otherQuery=w.reserveAgentOpen('T1',{...initial,url:'https://fixture.invalid/f36?month=12#report'});
  const otherHash=w.reserveAgentOpen('T1',{...initial,url:'https://fixture.invalid/f36?month=11#summary'});
  const otherProfile=w.reserveAgentOpen('T1',{...initial,profileId:'fixture-profile-b'});
  const otherTask=w.reserveAgentOpen('T2',initial);
  const forced=w.reserveAgentOpen('T1',{...initial,forceNew:true});
  const distinct=[first.pageId,otherQuery.pageId,otherHash.pageId,otherProfile.pageId,otherTask.pageId,forced.pageId];
  expect(new Set(distinct).size).toBe(distinct.length);
  expect(()=>w.reserveAgentOpen('T2',{pageId:first.pageId,profileId:initial.profileId,forceNew:false})).toThrow('本任务没有指定的网页标签');
  await w.close('T1',first.pageId);
  expect(()=>w.reserveAgentOpen('T1',{pageId:first.pageId,profileId:initial.profileId,forceNew:false})).toThrow('本任务没有指定的网页标签');
  trace('logical-exact-match','match-identities',{first,reuse,otherQuery,otherHash,otherProfile,otherTask,forced,distinctCount:new Set(distinct).size});
});
