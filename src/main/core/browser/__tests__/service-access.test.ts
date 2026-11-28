import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {boundedJson} from '@shared/application-bridge';
import {BrowserService,type BrowserScope} from '../service';
import {BrowserPageQueue} from '../queue';
import {BrowserDeferredReferenceGuards,type BrowserReferenceDeferral} from '../deferred-reference';
import type {BrowserPage} from '../page-registry';
import {browserProjectProfile} from '../profiles';
import type {BrowserProfileClones} from '../profile-clones';
import {isApplicationPreflightFailure} from '../../applications/capability-preflight';
vi.mock('electron',()=>({app:{userAgentFallback:'WillYou/0.1 Electron/42 Chrome/148'},session:{},nativeImage:{},shell:{}}));

// Software composition: actual service, SQLite receipts, workspace, profile ACL,
// lifecycle and queues. Only the native page/clone boundaries are substituted.
const fixtures:{service:BrowserService;sqlite:Database.Database;root:string;runs:Map<string,AbortController>}[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){for(const run of f.runs.values())run.abort();await f.service.dispose();f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}vi.restoreAllMocks();});
function fixture(scheduledRun?:(id:string)=>boolean){
  const sqlite=new Database(':memory:');sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,cwd TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);');sqlite.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));
  const root=mkdtempSync(join(tmpdir(),'willyou-access-service-')),projects=new Map([['T1','P1'],['T2','P1'],['T3','P2']]);for(const[id,project]of projects)sqlite.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(id,project,id+' title',root);sqlite.prepare('INSERT INTO projects VALUES(?,?)').run('P1','Project One');
  const runs=new Map<string,AbortController>(),service=new BrowserService({sqlite,userData:root,helper:{executable:'/must-not-run',sha256:'0'.repeat(64)},taskProject:id=>projects.get(id)??null,taskDirectory:()=>root,scheduledRun});fixtures.push({service,sqlite,root,runs});
  const scope=(taskId='T1',runId='R1'):BrowserScope=>{let run=runs.get(runId);if(!run){run=new AbortController();runs.set(runId,run);}return{taskId,projectId:projects.get(taskId)!,runId,requestId:randomUUID(),operationId:randomUUID(),runSignal:run.signal,signal:new AbortController().signal,assertActive:()=>{}};};
  const grant=async(mode:'observe'|'control'='control',caller=scope(),target='T2',chosen?:'observe'|'control')=>{const result=service.execute(caller,'access request',{task:target,mode});const request=service.access.snapshot().requests.at(-1)!;service.respondAccess(request.id,true,chosen);await result;return request.id;};
  const page=(taskId='T2',profileId=service.profiles.ensureProject('P1').id)=>{
    const fake={id:randomUUID(),taskId,projectId:'P1',profileId,kind:'tab',closed:false,abort:new AbortController(),queue:new BrowserPageQueue(),helper:{ensureSession:vi.fn(async()=>{}),close:vi.fn(async()=>{})},proxy:{waitForInputCompletion:vi.fn(async()=>{})},contents:{getURL:()=> 'https://fixture.example/',getTitle:()=> 'Fixture',printToPDF:vi.fn(async()=>Buffer.from('%PDF-test'))}} as unknown as BrowserPage;
    vi.spyOn(service.workspace,'target').mockResolvedValue(fake);vi.spyOn(service.pages,'all').mockReturnValue([fake]);vi.spyOn(service.pages,'list').mockImplementation(id=>id===fake.taskId?[fake]:[]);return fake;
  };
  return{service,sqlite,scope,grant,page,runs,root,projects};
}
describe('actual caller and target authority in the browser service',()=>{
  it('M16 A48 preserves ordinary own-tab authority and denies new cross-task grants during scheduled turns only',async()=>{
    const scheduled=new Set(['R1','R2','R3']),f=fixture(id=>scheduled.has(id));
    for(const runId of ['R1','R2','R3']){
      const scope=f.scope('T1',runId);
      await expect(f.service.execute(scope,'access request',{task:'T2',mode:'observe'})).rejects.toMatchObject({code:'SCOPE_DENIED'});
      expect(f.service.access.snapshot()).toEqual({requests:[],grants:[]});
      await expect(f.service.execute(f.scope('T1',runId),'tab list',{})).resolves.toBeDefined();
    }
    scheduled.delete('R1');const ownManual=f.scope('T1','R1');
    await f.grant('observe',ownManual,'T2');
    expect(f.service.access.snapshot().grants).toMatchObject([{runId:'R1',targetTaskId:'T2',mode:'observe'}]);
  });

  it('reserves one pending tab for equivalent opens and preserves the original request receipt',async()=>{
    const f=fixture();
    const scope={...f.scope(),assertRetained:()=>{}};
    const page=f.page('T1');
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const load=vi.spyOn(f.service.workspace,'loadAgentOpen').mockImplementation(async()=>{await gate;return page;});
    const show=vi.fn();f.service.attachOpenPresentation(show);
    const args={url:'https://fixture.example/desk?month=11#report',presentation:'show'};
    const first=await f.service.execute(scope,'tab open',args) as {pageId:string;phase:string;reused:boolean};
    const second=await f.service.execute({...f.scope(),assertRetained:()=>{}},'tab open',{...args,presentation:'background'});
    expect(first).toMatchObject({phase:'loading',reused:false});
    expect(second).toMatchObject({pageId:first.pageId,phase:'loading',reused:true});
    expect(f.service.workspace.snapshot('T1')).toMatchObject({activeId:null,tabs:[{id:first.pageId,pendingUrl:args.url,loading:true}]});
    expect(show).toHaveBeenCalledOnce();
    expect(await f.service.execute(scope,'tab open',args)).toEqual(first);
    await expect(f.service.execute(scope,'tab open',{...args,url:'https://fixture.example/other'})).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
    release();
    await vi.waitFor(()=>expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({summary:{phase:'ready'}}));
    expect(load).toHaveBeenCalledOnce();
  });
  it('M16 B04 shares navigation across independent callers, rolls off all-cancelled reservations, and preserves adopted or existing tabs',async()=>{
    const f=fixture(),page=f.page('T1');
    const gates=new Map<string,{signal:AbortSignal;release:()=>void}>();
    const load=vi.spyOn(f.service.workspace,'loadAgentOpen').mockImplementation(async(_task,id,signal,authorize)=>{
      await new Promise<void>(resolve=>gates.set(id,{signal,release:resolve}));
      signal.throwIfAborted();authorize();return page;
    });
    const own=(runId:string)=>({...f.scope('T1',runId),assertRetained:()=>{}});
    const open=async(scope:BrowserScope,args:{url?:string;pageId?:string})=>await f.service.execute(scope,'tab open',{...args,presentation:'background'}) as {pageId:string};
    const finished=(scope:BrowserScope,phase:string)=>vi.waitFor(()=>expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({summary:{phase}}));
    const workspace=()=>JSON.parse((f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:T1') as {value:string}).value) as {tabs:{id:string}[];closed:unknown[];activeId:string|null};
    try{
      const a=own('cancel-one-a'),b=own('cancel-one-b'),first=await open(a,{url:'https://fixture.example/one'}),second=await open(b,{url:'https://fixture.example/one'});
      expect(second.pageId).toBe(first.pageId);await vi.waitFor(()=>expect(gates.has(first.pageId)).toBe(true));
      f.runs.get(a.runId)!.abort();await finished(a,'cancelled');expect(gates.get(first.pageId)!.signal.aborted).toBe(false);
      gates.get(first.pageId)!.release();await finished(b,'ready');expect(workspace().tabs.map(t=>t.id)).toContain(first.pageId);
      const c=own('cancel-all-a'),d=own('cancel-all-b'),old=await open(c,{url:'https://fixture.example/all'}),same=await open(d,{url:'https://fixture.example/all'});expect(same.pageId).toBe(old.pageId);
      await vi.waitFor(()=>expect(gates.has(old.pageId)).toBe(true));f.runs.get(c.runId)!.abort();f.runs.get(d.runId)!.abort();await finished(c,'cancelled');await finished(d,'cancelled');
      expect(gates.get(old.pageId)!.signal.aborted).toBe(true);
      const e=own('new-owner'),fresh=await open(e,{url:'https://fixture.example/all'});expect(fresh.pageId).not.toBe(old.pageId);await vi.waitFor(()=>expect(gates.has(fresh.pageId)).toBe(true));
      gates.get(old.pageId)!.release();await vi.waitFor(()=>expect(workspace().tabs.map(t=>t.id)).not.toContain(old.pageId));expect(workspace().closed).toEqual([]);
      gates.get(fresh.pageId)!.release();await finished(e,'ready');expect(workspace().tabs.map(t=>t.id)).toContain(fresh.pageId);
      const adopted=own('adopted'),ad=await open(adopted,{url:'https://fixture.example/adopt'});await vi.waitFor(()=>expect(gates.has(ad.pageId)).toBe(true));
      f.service.workspace.select('T1',ad.pageId);f.runs.get(adopted.runId)!.abort();await finished(adopted,'cancelled');gates.get(ad.pageId)!.release();
      await vi.waitFor(()=>expect(f.service.workspace.snapshot('T1').tabs.find(t=>t.id===ad.pageId)?.pendingUrl).toBeUndefined());
      expect(workspace()).toMatchObject({activeId:ad.pageId,closed:[]});expect(workspace().tabs.map(t=>t.id)).toContain(ad.pageId);
      const existing=own('existing'),ex=await open(existing,{pageId:ad.pageId});expect(ex.pageId).toBe(ad.pageId);await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(5));
      f.runs.get(existing.runId)!.abort();await finished(existing,'cancelled');gates.get(ex.pageId)!.release();
      await new Promise<void>(resolve=>setImmediate(resolve));expect(workspace().tabs.map(t=>t.id)).toContain(ad.pageId);expect(workspace().closed).toEqual([]);
    }finally{for(const gate of gates.values())gate.release();}
  });
  it('does not start a deferred tab navigation after the original authority ends',async()=>{
    const f=fixture(),scope={...f.scope(),assertRetained:()=>{}};
    const load=vi.spyOn(f.service.workspace,'loadAgentOpen');
    await f.service.execute(scope,'tab open',{url:'https://fixture.example/forbidden-after-revocation'});
    f.runs.get(scope.runId)!.abort();
    await vi.waitFor(()=>expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({summary:{phase:'cancelled'}}));
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps URL variants distinct and selects the visible matching tab unless an ID is specified',async()=>{
    const f=fixture(),page=f.page('T1');
    vi.spyOn(f.service.workspace,'loadAgentOpen').mockResolvedValue(page);
    const open=async(args:Record<string,unknown>)=>{
      const scope={...f.scope(),assertRetained:()=>{}};
      const receipt=await f.service.execute(scope,'tab open',args) as {pageId:string;reused:boolean;url:string};
      await vi.waitFor(()=>expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({summary:{phase:'ready'}}));
      // Stand in for the native navigation's real committed-address event.
      const saved=f.service.workspace.savedTab(scope.taskId,receipt.pageId)!;
      if(!receipt.reused)saved.url=receipt.url;
      return receipt;
    };
    const url='https://fixture.example/desk?month=11#report';
    const first=await open({url});
    const second=await open({url,intent:'new'});
    expect(second.pageId).not.toBe(first.pageId);
    f.service.workspace.select('T1',second.pageId);
    expect(await open({url})).toMatchObject({pageId:second.pageId,reused:true});
    expect(await open({pageId:first.pageId})).toMatchObject({pageId:first.pageId,reused:true});
    const month=await open({url:'https://fixture.example/desk?month=12#report'});
    const anchor=await open({url:'https://fixture.example/desk?month=12#details'});
    expect(new Set([first.pageId,second.pageId,month.pageId,anchor.pageId]).size).toBe(4);
    expect(f.service.workspace.savedTab('T1',first.pageId)?.url).toBe(url);
  });
  it('M16 B05 rejects conflicting targets and semantic request replays without creating or navigating another tab',async()=>{
    const f=fixture(),page=f.page('T1');
    const load=vi.spyOn(f.service.workspace,'loadAgentOpen').mockResolvedValue(page);
    const own=()=>({...f.scope('T1','contract-run'),assertRetained:()=>{}});
    const call=(scope:BrowserScope,args:Record<string,unknown>)=>f.service.execute(scope,'tab open',args);
    const url='https://fixture.example/desk?month=11#report',profile=f.service.profiles.ensureProject('P1').id;
    const otherProfile=f.service.profiles.create({taskId:'T1',projectId:'P1'},'Other own fixture profile').id;
    const unknownPage=randomUUID();
    for(const args of [{},{url,pageId:unknownPage},{pageId:unknownPage,intent:'new'},{pageId:unknownPage,profileId:profile}]){
      await expect(call(own(),args)).rejects.toMatchObject({code:'INVALID_INPUT'});
    }
    expect(f.service.workspace.snapshot('T1').tabs).toEqual([]);expect(load).not.toHaveBeenCalled();
    await expect(call(own(),{pageId:unknownPage})).rejects.toMatchObject({code:'BROWSER_TAB_NOT_FOUND'});
    const original=own(),args={url,profileId:profile,intent:'reuse-or-new',presentation:'background'};
    const first=await call(original,args) as {pageId:string;operationId:string};
    await vi.waitFor(()=>expect(f.service.operations.receipt(original.runId,original.requestId)).toMatchObject({summary:{phase:'ready'}}));
    const replay=await call({...original,operationId:randomUUID()},args);
    expect(replay).toMatchObject({pageId:first.pageId,operationId:first.operationId,phase:'ready'});
    for(const changed of [{...args,url:'https://fixture.example/other'},{...args,profileId:otherProfile},{...args,intent:'new'},{...args,presentation:'show'},{pageId:first.pageId}]){
      await expect(call(original,changed)).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
    }
    expect(load).toHaveBeenCalledOnce();expect(f.service.workspace.snapshot('T1').tabs.map(t=>t.id)).toEqual([first.pageId]);
    const freshScope=own(),fresh=await call(freshScope,{...args,intent:'new'}) as {pageId:string};
    expect(fresh.pageId).not.toBe(first.pageId);await vi.waitFor(()=>expect(f.service.operations.receipt(freshScope.runId,freshScope.requestId)).toMatchObject({summary:{phase:'ready'}}));
    await f.service.workspace.close('T1',first.pageId);
    await expect(call(own(),{pageId:first.pageId})).rejects.toMatchObject({code:'BROWSER_TAB_NOT_FOUND'});
    expect(await call(original,args)).toMatchObject({pageId:first.pageId,operationId:first.operationId,phase:'ready'});
    expect(load).toHaveBeenCalledTimes(2);expect(f.service.workspace.snapshot('T1').tabs.map(t=>t.id)).toEqual([fresh.pageId]);
  });
  it('preserves action and verification separately across runs and blocks a dependent write',async()=>{
    const f=fixture(),page=f.page('T1');
    const initial=f.scope(),successor=f.scope('T1','R2'),unrelated=f.scope('T1','R3');
    f.sqlite.exec(`
      CREATE TABLE capability_runs(run_id TEXT,task_id TEXT,project_id TEXT,binding_id TEXT,state TEXT);
      INSERT INTO capability_runs VALUES('R1','T1','P1','B1','active'),('R2','T1','P1','B1','active'),('R3','T1','P1','B2','active');
    `);
    f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserWorkspace.v1:T1',JSON.stringify({
      version:1,activeId:page.id,closed:[],tabs:[{id:page.id,url:page.contents.getURL(),title:'Fixture',favicon:null,profileId:page.profileId}],
    }));
    vi.spyOn(f.service.pages,'get').mockReturnValue(page);
    const click=vi.fn(async(_args:string[],invoke:{dispatched:()=>void})=>{invoke.dispatched();return {clicked:'@ref'};});
    page.helper.command=click;
    Object.assign(page,{references:{
      documentGeneration:'document-1',
      arm:async()=>({selector:'[held-node]',hostClick:false,finish:async()=>({connected:true,blocked:[],accepted:['click']})}),
    }});
    f.service['conditions'].set(page,{run:vi.fn(async(_args:unknown,_signal:AbortSignal,authorize:()=>void)=>{authorize();return{waited:true};})} as never);
    const id=randomUUID(),action={page:page.id,element:'@ref',checkpoint:{id,selector:'#receipt',text:'RPT-11'}};
    await f.service.execute(initial,'click',action);
    const dependent={...action,checkpoint:{...action.checkpoint,id:randomUUID(),after:id}};
    await expect(f.service.execute(f.scope('T1','R2'),'click',dependent)).rejects.toMatchObject({code:'RESOURCE_BUSY'});
    expect(click).toHaveBeenCalledOnce();
    await expect(f.service.execute(successor,'checkpoint status',{checkpointId:id})).resolves.toMatchObject({result:{business:'needs-review',action:{state:'succeeded'}}});
    await expect(f.service.execute(unrelated,'checkpoint status',{checkpointId:id})).rejects.toMatchObject({code:'SCOPE_DENIED'});
    await expect(f.service.execute(f.scope('T1','R2'),'checkpoint verify',{checkpointId:id})).resolves.toMatchObject({result:{business:'verified',evidence:{generation:'document-1'}}});
    await f.service.execute(f.scope('T1','R2'),'click',dependent);
    expect(click).toHaveBeenCalledTimes(2);
  });
  it.each(['ready','timed-out','unavailable','changed'])('returns the original action when its observation is %s',async expected=>{
    const f=fixture(),page=f.page('T1'),caller=new AbortController();
    const scope={...f.scope(),signal:caller.signal};
    let generation='document-1';
    const click=vi.fn(async(_args:string[],options:{dispatched:()=>void})=>{
      options.dispatched();
      return {clicked:'@held'};
    });
    page.helper.command=click;
    const snapshot=vi.fn(async()=>{
      if(expected==='changed')generation='document-2';
      return {snapshot:'button "Next" [ref=@fresh]',refs:[{ref:'@fresh',role:'button',name:'Next',available:true}]};
    });
    Object.assign(page,{references:{
      arm:async()=>({selector:'[held-node]',hostClick:false,finish:async()=>({connected:true,blocked:[],accepted:['click']})}),
      snapshot,get documentGeneration(){return generation;},
    }});
    const wait=vi.fn(async(_:unknown,signal:AbortSignal,authorize:()=>void)=>{
      authorize();
      expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({state:'succeeded',effectState:'completed'});
      if(expected==='timed-out'){
        await new Promise<void>((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      }
      if(expected==='unavailable')caller.abort();
      return {waited:true};
    });
    f.service['conditions'].set(page,{run:wait} as never);
    const result=await f.service.execute(scope,'click',{element:'@held',observeAfter:{container:'#controls',timeout:100}});
    expect(result).toMatchObject({action:{state:'completed',result:{clicked:'@held'}},observation:{state:expected,pageId:page.id}});
    expect(boundedJson(result)).toBe(true);
    if(expected==='ready'){
      expect(result).toMatchObject({observation:{generation:'document-1',data:{refs:[{ref:'@fresh'}]}}});
      expect(snapshot).toHaveBeenCalledWith(page.helper,expect.any(AbortSignal),'#controls');
    }
    expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({state:'succeeded',effectState:'completed'});
    expect(click).toHaveBeenCalledOnce();
  });
  it('revalidates previously reviewed saved tabs after startup without opening them or adding other dormant tabs',async()=>{
    const f=fixture(),id=randomUUID(),other=randomUUID(),url='https://fixture.example.test/cold';
    const savedTab=(pageId:string,address:string)=>({id:pageId,url:address,title:'Previously open tab',favicon:null,profileId:browserProjectProfile('P1')});
    f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserWorkspace.v1:T2',JSON.stringify({
      version:1,tabs:[savedTab(id,url),savedTab(other,'https://fixture.example.test/other')],activeId:id,closed:[],
    }));
    const create=vi.spyOn(f.service.pages,'create');
    expect(f.service.workspace.snapshot('T2').tabs).toHaveLength(2);
    expect(f.service.accessTarget('T2')).toEqual({projectId:'P1',pages:[]});
    expect(f.service.accessTarget('T2',[id])).toEqual({projectId:'P1',pages:[{id,url}]});
    expect(f.service.accessTarget('T3',[id])).toEqual({projectId:'P2',pages:[]});
    await f.service.workspace.close('T2',id);
    expect(f.service.accessTarget('T2',[id])).toEqual({projectId:'P1',pages:[]});
    expect(create).not.toHaveBeenCalled();
  });
  it('prefers the live browser address when the reviewed tab also has a saved address',()=>{
    const f=fixture(),page=f.page();
    f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserWorkspace.v1:T2',JSON.stringify({
      version:1,tabs:[{id:page.id,url:'https://fixture.example.test/previous',title:'Fixture',favicon:null,profileId:page.profileId}],
      activeId:page.id,closed:[],
    }));
    expect(f.service.accessTarget('T2',[page.id])).toEqual({
      projectId:'P1',pages:[{id:page.id,url:page.contents.getURL()}],
    });
  });
  it.each(['click','exec'] as const)('keeps a %s reference armed through the dialog and finishes it under the original page queue',async command=>{
    const f=fixture(),page=f.page('T1'),guards=new BrowserDeferredReferenceGuards(),nativeFinish=vi.fn(async()=>({connected:true,blocked:[],accepted:['mousedown','mouseup','click']})),inspect=vi.fn(async()=>({connected:true,blocked:[],accepted:['mousedown','mouseup','click']}));
    const armed={selector:'[held-node]',hostClick:false,finish:vi.fn(async(_preserve:boolean,deferred:BrowserReferenceDeferral|undefined)=>{
      if(!deferred)throw Error('JavaScript finish would block while prompt is open');
      return guards.defer({...deferred,id:'exact-old-node',inspect,finish:nativeFinish});
    })};
    const references={arm:vi.fn(async()=>armed),get hasOpenDialog(){return guards.dialogOpen;},get hasDeferredGuards(){return guards.pending;},settleDeferredGuards:()=>guards.settle(),assertDeferredGuardsReady:()=>guards.assertReady()};
    Object.assign(page,{references});page.helper.command=vi.fn(async()=>{guards.opening('original-dialog');return{clicked:true,dialogOpened:true};});
    const scope=f.scope();const result=await f.service.execute(scope,command,command==='click'?{element:'@held'}:{command:'click @held'});
    expect(result).toMatchObject({dialogOpened:true});expect(inspect).not.toHaveBeenCalled();expect(nativeFinish).not.toHaveBeenCalled();
    expect(f.service.operations.receipt('R1',scope.requestId)).toMatchObject({state:'unknown',effectState:'unknown'});
    expect(f.service.operations.get('R1','audit:'+scope.requestId)).toMatchObject({state:'running',effect_state:'unknown'});expect(f.service.automation.activity(page.id).running).toBe(true);
    await expect(f.service.execute(f.scope(),'snapshot',{})).rejects.toThrow('先处理');
    vi.spyOn(f.service.javascriptDialogs,'respondFromAgent').mockImplementation(async(_task,_page,_accept,_text,dispatched)=>{dispatched();guards.closed('original-dialog');return{handled:true};});
    await expect(f.service.execute(f.scope(),'dialog accept',{text:'accepted'})).resolves.toEqual({result:{handled:true}});
    expect(nativeFinish).toHaveBeenCalledOnce();expect(guards.pending).toBe(false);expect(page.helper.command).toHaveBeenCalledOnce();expect(f.service.operations.receipt('R1',scope.requestId)).toMatchObject({state:'succeeded',effectState:'completed'});expect(f.service.operations.get('R1','audit:'+scope.requestId)).toMatchObject({state:'succeeded',effect_state:'completed'});expect(f.service.automation.activity(page.id).running).toBe(false);
  });
  it('retains a replaced-node failure in the original click receipt while answering the real dialog successfully',async()=>{
    const f=fixture(),page=f.page('T1'),guards=new BrowserDeferredReferenceGuards(),state={connected:false,blocked:['mouseup','click'],accepted:['mousedown']};
    const armed={selector:'[held-old-node]',hostClick:false,finish:vi.fn(async(_preserve:boolean,deferred:BrowserReferenceDeferral|undefined)=>{expect(deferred).toBeDefined();return guards.defer({...deferred,id:'old',inspect:async()=>state,finish:async()=>state});})};
    Object.assign(page,{references:{arm:async()=>armed,get hasOpenDialog(){return guards.dialogOpen;},get hasDeferredGuards(){return guards.pending;},settleDeferredGuards:()=>guards.settle(),assertDeferredGuardsReady:()=>guards.assertReady()}});
    page.helper.command=vi.fn(async()=>{guards.opening('dialog');return{clicked:true,dialogOpened:true};});const original=f.scope();await f.service.execute(original,'click',{element:'@old'});
    vi.spyOn(f.service.javascriptDialogs,'respondFromAgent').mockImplementation(async(_task,_page,_accept,_text,dispatched)=>{dispatched();guards.closed('dialog');return{handled:true};});
    await expect(f.service.execute(f.scope(),'dialog accept',{})).resolves.toEqual({result:{handled:true,inputContinuation:'blocked'}});
    expect(f.service.operations.receipt('R1',original.requestId)).toMatchObject({state:'unknown',effectState:'unknown',errorCode:'BROWSER_STALE_REF'});
    expect(page.helper.command).toHaveBeenCalledOnce();expect(guards.pending).toBe(false);
  });
  it('stops an owned deferred kernel release before replacing the document',async()=>{
    const f=fixture(),page=f.page('T1'),order:string[]=[];Object.assign(page,{references:{hasDeferredGuards:true,invalidate:(discard:boolean)=>{expect(discard).toBe(true);order.push('discard');}}});
    page.helper.close=vi.fn(async()=>{order.push('stop-kernel');});vi.spyOn(f.service.pages,'navigate').mockImplementation(async()=>{order.push('navigate');});
    await f.service.execute(f.scope(),'goto',{url:'https://fixture.example/new'});expect(order).toEqual(['stop-kernel','discard','navigate']);expect(page.helper.close).toHaveBeenCalledOnce();
  });
  it('settles the retained guard for a trusted user dialog reply too',async()=>{
    const f=fixture(),page=f.page('T1'),settle=vi.fn(async()=>({pending:false,blocked:false}));
    Object.assign(page,{references:{hasDeferredGuards:true,settleDeferredGuards:settle}});
    vi.spyOn(f.service.javascriptDialogs,'snapshot').mockReturnValue({id:'dialog',pageId:page.id,profileId:page.profileId,kind:'prompt',url:'https://fixture.example/',message:'Question',defaultValue:'value'});
    vi.spyOn(f.service.javascriptDialogs,'respond').mockResolvedValue();await f.service.respondJavascriptDialog('T1','dialog',true,'accepted');expect(settle).toHaveBeenCalledOnce();
  });
  it('routes dedicated and compatibility dialog answers through the owned host without starting a cold Helper',async()=>{
    const f=fixture(),page=f.page('T1'),helperCommand=vi.fn(async()=>({})),reply=vi.spyOn(f.service.javascriptDialogs,'respondFromAgent').mockImplementation(async(_task,_page,_accept,_text,dispatched)=>{dispatched();return{handled:true as const};});
    page.helper.command=helperCommand;
    await expect(f.service.execute(f.scope(),'dialog accept',{text:'accepted-中文'})).resolves.toMatchObject({result:{handled:true}});
    await expect(f.service.execute(f.scope(),'exec',{command:'dialog dismiss'})).resolves.toEqual({handled:true});
    expect(reply).toHaveBeenNthCalledWith(1,'T1',page.id,true,'accepted-中文',expect.any(Function));
    expect(reply).toHaveBeenNthCalledWith(2,'T1',page.id,false,undefined,expect.any(Function));
    expect(page.helper.ensureSession).not.toHaveBeenCalled();expect(helperCommand).not.toHaveBeenCalled();
  });
  it('fails an unavailable audit before native work with an honest not-started marker',async()=>{
    const f=fixture(),page=f.page('T1'),scope=f.scope();vi.spyOn(f.service.operations,'begin').mockImplementationOnce(()=>{throw Error('private audit storage path');});const failure=await f.service.execute(scope,'goto',{url:'https://fixture.example/'}).catch(e=>e);expect(failure).toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(isApplicationPreflightFailure(failure,scope.operationId)).toBe(true);expect(String(failure)).not.toContain('private audit');expect(page.helper.ensureSession).not.toHaveBeenCalled();expect(f.service.operations.receipt('R1',scope.requestId)).toEqual({state:'not-found'});
  });
  it('allows self without a grant; rejects unauthorized, cross-project and missing-lifetime requests before page access',async()=>{
    const f=fixture(),target=vi.spyOn(f.service.workspace,'target');await expect(f.service.execute(f.scope(),'tab list',{task:'T1'})).resolves.toEqual({tabs:[]});
    for(const [command,args]of[['tab list',{task:'T2'}],['access request',{task:'T3',mode:'control'}],['access request',{task:'T1',mode:'control'}]] as const)await expect(f.service.execute(f.scope(),command,args)).rejects.toMatchObject({code:'SCOPE_DENIED'});
    await expect(f.service.execute({...f.scope(),runSignal:undefined},'access request',{task:'T2',mode:'observe'})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(f.service.access.snapshot().requests).toEqual([]);expect(target).not.toHaveBeenCalled();
  });
  it('observe permits reads but refuses write, wait fn and foreign-profile clone/delete/selection even without --task',async()=>{
    const f=fixture(),profile=f.service.profiles.create({taskId:'T2',projectId:'P1'},'T2 isolated');await f.grant('observe');await expect(f.service.execute(f.scope(),'tab list',{task:'T2'})).resolves.toEqual({tabs:[]});
    for(const[command,args]of[['eval',{task:'T2',expression:'window.count++'}],['wait fn',{task:'T2',fn:'window.count++'}],['tab profile clone',{profile:profile.id}],['tab profile delete',{profile:profile.id}],['tab create',{profile:profile.id}]] as const)await expect(f.service.execute(f.scope(),command,args)).rejects.toMatchObject({code:'SCOPE_DENIED'});
    expect(f.service.profiles.list(f.scope()).some(p=>p.id===profile.id)).toBe(true);expect(f.service.profiles.list(f.scope()).some(p=>p.owner.id==='P2')).toBe(false);
  });
  it('uses the trusted user-selected mode and preserves caller ownership and audit correlation',async()=>{
    const f=fixture(),request=f.scope();await f.grant('observe',request,'T2','control');const result=await f.service.execute(f.scope(),'tab profile create',{task:'T2',label:'caller-owned'});expect(result).toMatchObject({result:{profile:{owner:{kind:'task',id:'T1'}}}});
    const state=f.service.accessState();expect(state.grants[0]).toMatchObject({requestedMode:'observe',mode:'control',requestId:request.requestId,requesterTitle:'T1 title',targetTitle:'T2 title',projectName:'Project One'});
    const row=f.sqlite.prepare("SELECT summary FROM browser_operations WHERE command='access decision'").get() as {summary:string};expect(JSON.parse(row.summary)).toMatchObject({requesterTaskId:'T1',targetTaskId:'T2',requestedMode:'observe',mode:'control',requestId:request.requestId,decisionSource:'user',result:'allowed'});
  });
  it('clones with caller identity, rejects forged run bindings and never inherits authorization after run end',async()=>{
    const f=fixture(),profile=f.service.profiles.create({taskId:'T2',projectId:'P1'},'T2 isolated');await f.grant();const clone=vi.spyOn((f.service as unknown as {clones:BrowserProfileClones}).clones,'clone').mockImplementation(async(caller,_source,admit,send)=>{admit();send();expect(caller).toMatchObject({taskId:'T1',runId:'R1'});return f.service.profiles.create(caller,'copy');});
    const cloneScope=f.scope();await expect(f.service.execute(cloneScope,'tab profile clone',{task:'T2',profile:profile.id})).resolves.toMatchObject({result:{profile:{owner:{id:'T1'}}}});expect(clone).toHaveBeenCalledOnce();expect(JSON.parse(f.service.operations.get('R1','audit:'+cloneScope.requestId)!.summary!).authorizations).toEqual([expect.objectContaining({targetTaskId:'T2',source:'user'})]);
    await expect(f.service.execute(f.scope('T2','R1'),'tab list',{})).rejects.toMatchObject({code:'SCOPE_DENIED'});f.runs.get('R1')!.abort();await expect(f.service.execute(f.scope('T1','R2'),'tab list',{task:'T2'})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(f.service.access.snapshot().grants).toEqual([]);
  });
  it('revokes only this run queued work immediately, preserving an admitted write and another run queue',async()=>{
    const f=fixture(),page=f.page(),id=await f.grant();let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),navigate=vi.spyOn(f.service.pages,'navigate').mockImplementationOnce(()=>barrier).mockResolvedValue(undefined);
    const first=f.service.execute(f.scope(),'goto',{task:'T2',url:'https://fixture.example/first'});await vi.waitFor(()=>expect(navigate).toHaveBeenCalledTimes(1));
    const queued=Array.from({length:3},()=>{const scope=f.scope();return{scope,result:f.service.execute(scope,'goto',{task:'T2',url:'https://fixture.example/cancelled'}).catch(e=>e)};});
    const owner=f.service.execute(f.scope('T2','R2'),'goto',{url:'https://fixture.example/owner'});await Promise.resolve();await Promise.resolve();f.service.revokeAccess(id);
    for(const item of queued){const error=await item.result;expect(error).toMatchObject({code:'SCOPE_DENIED'});expect(isApplicationPreflightFailure(error,item.scope.operationId)).toBe(true);expect(f.service.operations.receipt('R1',item.scope.requestId)).toMatchObject({effectState:'not-started'});}
    expect(navigate).toHaveBeenCalledTimes(1);release();await first;await owner;expect(navigate).toHaveBeenCalledTimes(2);await page.queue.settled();
  });
  it('pause cancels restoration-time waits and blocks own/cross commands while trusted user changes remain available',async()=>{
    const f=fixture();await f.service.execute(f.scope(),'tab list',{});await f.grant('control',f.scope('T2','R2'),'T1');const target=vi.spyOn(f.service.workspace,'target').mockImplementation(()=>new Promise(()=>{}));
    const wait=f.service.execute(f.scope(),'wait',{text:'never',timeout:90000}).catch(e=>e);f.service.pauseFromUi('T1',true);await expect(wait).resolves.toMatchObject({code:'BROWSER_PAUSED'});
    for(const scope of[f.scope(),f.scope('T2','R2')])await expect(f.service.execute(scope,'tab list',{task:'T1'})).rejects.toMatchObject({code:'BROWSER_PAUSED'});
    expect((await f.service.createProfile('T1','User while paused')).result.owner.id).toBe('T1');f.service.pauseFromUi('T1',false);await expect(f.service.execute(f.scope(),'tab list',{})).resolves.toEqual({tabs:[]});f.service.pauseFromUi('T1',true);f.runs.get('R1')!.abort();expect(f.service.workspace.snapshot('T1').paused).toBe(false);expect(target).toHaveBeenCalledOnce();
  });
  it('cannot use an own-page foreign-profile alias after revocation',async()=>{
    const f=fixture(),profile=f.service.profiles.create({taskId:'T2',projectId:'P1'},'T2 isolated'),id=await f.grant(),page=f.page('T1',profile.id);f.service.revokeAccess(id);
    await expect(f.service.execute(f.scope(),'pdf',{})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(page.helper.ensureSession).not.toHaveBeenCalled();expect(page.contents.printToPDF).not.toHaveBeenCalled();
  });
  it('pause cancels all four queued writes immediately but lets the first admitted write complete',async()=>{
    const f=fixture(),page=f.page('T1');let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),navigate=vi.spyOn(f.service.pages,'navigate').mockImplementationOnce(()=>gate).mockResolvedValue(undefined);
    const first=f.service.execute(f.scope(),'goto',{url:'https://fixture.example/first'});await vi.waitFor(()=>expect(navigate).toHaveBeenCalledOnce());
    const queued=Array.from({length:4},()=>f.service.execute(f.scope(),'goto',{url:'https://fixture.example/cancelled'}).catch(e=>e));await Promise.resolve();await Promise.resolve();f.service.pauseFromUi('T1',true);for(const result of queued)await expect(result).resolves.toMatchObject({code:'BROWSER_PAUSED'});expect(navigate).toHaveBeenCalledOnce();release();await first;await page.queue.settled();expect(navigate).toHaveBeenCalledOnce();
  });
  it('writes a cross-task read artifact to the authenticated caller directory',async()=>{
    const f=fixture();await f.grant('observe');f.page();const result=await f.service.execute(f.scope(),'pdf',{task:'T2'}) as {file:{path:string;bytes:number}};expect(result.file.path).toContain(join(f.root,'browser/artifacts/T1/'));expect(readFileSync(result.file.path,'utf8')).toBe('%PDF-test');
  });
  it('returns full Cookie results only to the command and journals a detached redacted read record',async()=>{
    const f=fixture(),page=f.page('T1'),cookies={cookies:[{name:'session',value:'service-cookie-canary',domain:'fixture.example'}]},send=vi.fn(async()=>cookies);Object.assign(page,{proxy:{send}});const scope=f.scope();const value=await f.service.execute(scope,'cookie get',{});expect(value).toEqual({result:cookies});expect(cookies.cookies[0].value).toBe('service-cookie-canary');const row=f.service.operations.get('R1','audit:'+scope.requestId)!;expect(row).toMatchObject({page_id:page.id,task_id:'T1',state:'succeeded',effect_state:'read-only'});expect(row.summary).not.toContain('service-cookie-canary');expect(row.summary).toContain('已脱敏');expect(f.service.operations.receipt('R1',scope.requestId)).toEqual({state:'not-found'});
  });
  it('queries the retained input type before filling and masks the value even when the fill fails',async()=>{
    const f=fixture(),page=f.page('T1'),calls:string[]=[],armed={read:vi.fn(async(what:string)=>{calls.push(what);return'password';}),fill:vi.fn(async(_value:string,options:{dispatched:()=>void})=>{calls.push('fill');options.dispatched();throw Error('private native failure');}),finish:vi.fn(async()=>({connected:true,blocked:[],accepted:['input']}))};Object.assign(page,{references:{arm:vi.fn(async()=>armed)}});const scope=f.scope();await expect(f.service.execute(scope,'fill',{element:'@ref',value:'service-password-canary'})).rejects.toThrow();expect(calls).toEqual(['type','fill']);const row=f.service.operations.get('R1','audit:'+scope.requestId)!;expect(row).toMatchObject({state:'unknown',effect_state:'unknown'});expect(JSON.parse(row.summary!)).toMatchObject({passwordFill:true,arguments:{value:{redacted:'已脱敏',length:23}}});expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM browser_operations').all())).not.toMatch(/service-password-canary|private native failure/);
  });
  it('routes compatibility credentials through the same user-prompt guard without entering the helper',async()=>{
    const f=fixture(),page=f.page('T1'),set=vi.spyOn(f.service.authentication,'setCredentials').mockImplementation(()=>{});await expect(f.service.execute(f.scope(),'exec',{command:'set credentials user private-password'})).resolves.toEqual({result:{configured:true}});expect(set).toHaveBeenCalledWith(page.contents,'user','private-password',expect.any(Function));expect(page.helper.ensureSession).not.toHaveBeenCalled();
    vi.spyOn(f.service.authentication,'snapshot').mockReturnValue({id:randomUUID(),pageId:page.id,profileId:page.profileId,url:'https://fixture.example/',host:'fixture.example',realm:'private',proxy:false});await expect(f.service.execute(f.scope(),'exec',{command:'set credentials user private-password'})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(set).toHaveBeenCalledOnce();expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM browser_operations').all())).not.toContain('private-password');
  });
  it('lets a started multi-page profile change finish after pause, then refuses new commands on the task',async()=>{
    const f=fixture(),state=f.service.workspace.create('T1');f.service.workspace.create('T1');const profile=f.service.profiles.create(f.scope(),'new');let count=0;
    vi.spyOn(f.service.workspace,'setProfile').mockImplementation(async(_task,_page,_profile,admit=()=>{},send=()=>{})=>{admit();send();if(++count===1)f.service.pauseFromUi('T1',true);admit();return undefined;});
    const scope=f.scope();await expect(f.service.execute(scope,'tab profile set',{task:'T1',profile:profile.id})).resolves.toMatchObject({result:{pages:expect.arrayContaining([state.activeId])}});expect(count).toBe(2);expect(f.service.operations.receipt('R1',scope.requestId)).toMatchObject({effectState:'completed'});await expect(f.service.execute(f.scope(),'tab list',{})).rejects.toMatchObject({code:'BROWSER_PAUSED'});
  });

  function checkpointFixture(){
    const f=fixture(),page=f.page('T1');
    f.sqlite.exec(`
      CREATE TABLE capability_runs(run_id TEXT,task_id TEXT,project_id TEXT,binding_id TEXT,state TEXT);
      INSERT INTO capability_runs VALUES('R1','T1','P1','B1','active'),('R2','T1','P1','B1','active'),('R3','T1','P1','B2','active');
    `);
    f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserWorkspace.v1:T1',JSON.stringify({
      version:1,activeId:page.id,closed:[],tabs:[{id:page.id,url:page.contents.getURL(),title:'Fixture',favicon:null,profileId:page.profileId}],
    }));
    vi.spyOn(f.service.pages,'get').mockReturnValue(page);
    Object.assign(page,{references:{
      documentGeneration:'doc-current',
      arm:async()=>({selector:'[held-node]',hostClick:false,finish:async()=>({connected:true,blocked:[],accepted:['click']})}),
    }})
    const input={page:page.id,element:'@ref',checkpoint:{id:randomUUID(),selector:'#receipt',text:'synthetic original record'}};
    return {...f,page,input,current:f.scope(),successor:f.scope('T1','R2'),wrongBinding:f.scope('T1','R3')};
  }

  it('A20 reconciles a dispatched action with an interrupted helper reply without replaying it',async()=>{
    const f=checkpointFixture();
    const changed=vi.fn();
    f.service.attachCheckpointUpdates(changed);
    let records=0;
    f.page.helper.command=vi.fn(async(_args:string[],call:{dispatched:()=>void})=>{
      call.dispatched();records++;throw Error('synthetic interrupted tool reply')
    });
    await expect(f.service.execute(f.current,'click',f.input)).rejects.toMatchObject({code:'BROWSER_ERROR'});
    const checkpointId=f.input.checkpoint.id;
    expect(changed).toHaveBeenLastCalledWith('T1',expect.objectContaining({checkpointId,business:'needs-review'}));
    await expect(f.service.execute(f.successor,'checkpoint status',{checkpointId})).resolves.toMatchObject({
      result:{business:'needs-review',action:{state:'unknown',effectState:'unknown'}},
    });
    f.service['conditions'].set(f.page,{run:async(args:{selector:string;text?:string},_signal:AbortSignal,authorize:()=>void)=>{
      authorize();expect(args).toMatchObject({selector:'#receipt',text:'synthetic original record'});
      expect(records).toBe(1);return {waited:true};
    }} as never);
    await expect(f.service.execute(f.scope('T1','R2'),'checkpoint verify',{checkpointId})).resolves.toMatchObject({
      result:{business:'verified',action:{state:'unknown',effectState:'unknown'},evidence:{generation:'doc-current'}},
    });
    expect(changed).toHaveBeenLastCalledWith('T1',expect.objectContaining({checkpointId,business:'verified'}));
    expect(records).toBe(1);
  });

  it('A21 keeps the expired unknown step locked for successor, another binding, and another task',async()=>{
    const f=checkpointFixture();
    const action=vi.fn(async(_args:string[],call:{dispatched:()=>void})=>{call.dispatched();throw Error('synthetic disconnected tool');});
    f.page.helper.command=action;
    await expect(f.service.execute(f.current,'click',f.input)).rejects.toMatchObject({code:'BROWSER_ERROR'});
    f.service.operations.recover(Date.now()+8*86400000);
    expect(f.service.operations.receipt(f.current.runId,f.current.requestId)).toEqual({state:'not-found'});
    const checkpointId=f.input.checkpoint.id;
    await expect(f.service.execute(f.successor,'checkpoint status',{checkpointId})).resolves.toMatchObject({
      result:{business:'needs-review',action:{state:'not-found',effectState:'unknown'}},
    });
    await expect(f.service.execute(f.wrongBinding,'checkpoint status',{checkpointId})).rejects.toMatchObject({code:'SCOPE_DENIED'});
    await expect(f.service.execute(f.scope('T2'),'checkpoint status',{checkpointId})).rejects.toMatchObject({code:'SCOPE_DENIED'});
    await expect(f.service.execute(f.scope('T1','R2'),'click',{...f.input,checkpoint:{...f.input.checkpoint,id:randomUUID(),after:checkpointId}})).rejects.toMatchObject({code:'RESOURCE_BUSY'});
    expect(action).toHaveBeenCalledOnce();
  });

  it('A21 refuses redispatch even with the original request identity after operation detail expires',async()=>{
    const f=checkpointFixture();
    const action=vi.fn(async(_args:string[],call:{dispatched:()=>void})=>{call.dispatched();throw Error('synthetic disconnected tool');});
    f.page.helper.command=action;
    await expect(f.service.execute(f.current,'click',f.input)).rejects.toMatchObject({code:'BROWSER_ERROR'});
    f.service.operations.recover(Date.now()+8*86400000);
    expect(f.service.operations.receipt(f.current.runId,f.current.requestId)).toEqual({state:'not-found'});
    await expect(f.service.execute(f.current,'click',f.input)).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
    expect(f.service.operations.receipt(f.current.runId,f.current.requestId)).toEqual({state:'not-found'});
    expect(action).toHaveBeenCalledOnce();
  });

  it('A17 preserves the admitted action and refuses the requested observation after scope revocation',async()=>{
    const f=checkpointFixture();
    let authorized=true;
    const snapshot=vi.fn(async()=>({snapshot:'button "Continue"',refs:[]}));
    Object.assign(f.page.references,{snapshot});
    const click=vi.fn(async(_args:string[],call:{dispatched:()=>void})=>{call.dispatched();return {clicked:'@ref'}});
    f.page.helper.command=click;
    f.service['conditions'].set(f.page,{run:async()=>{authorized=false;return {waited:true}}} as never);
    const scope={...f.current,assertActive:()=>{if(!authorized)throw new Error('synthetic host authority revoked')}};
    const result=await f.service.execute(scope,'click',{page:f.page.id,element:'@ref',observeAfter:{container:'#safe',timeout:100}});
    expect(result).toMatchObject({action:{state:'completed',result:{clicked:'@ref'}},observation:{state:'unavailable',pageId:f.page.id}});
    expect(click).toHaveBeenCalledOnce();
    expect(snapshot).not.toHaveBeenCalled();
    expect(f.service.operations.receipt(scope.runId,scope.requestId)).toMatchObject({state:'succeeded',effectState:'completed'});
  });
});
