import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BrowserService,type BrowserScope} from '../service';
import {BrowserPageQueue} from '../queue';
import {BrowserDeferredReferenceGuards} from '../deferred-reference';
import type {BrowserPage} from '../page-registry';
import type {BrowserProfileClones} from '../profile-clones';
import {isApplicationPreflightFailure} from '../../applications/capability-preflight';
vi.mock('electron',()=>({app:{userAgentFallback:'WillYou/0.1 Electron/42 Chrome/148'},session:{},nativeImage:{},shell:{}}));

// Software composition: actual service, SQLite receipts, workspace, profile ACL,
// lifecycle and queues. Only the native page/clone boundaries are substituted.
const fixtures:{service:BrowserService;sqlite:Database.Database;root:string;runs:Map<string,AbortController>}[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){for(const run of f.runs.values())run.abort();await f.service.dispose();f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}vi.restoreAllMocks();});
function fixture(){
  const sqlite=new Database(':memory:');sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,cwd TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);');sqlite.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));
  const root=mkdtempSync(join(tmpdir(),'willyou-access-service-')),projects=new Map([['T1','P1'],['T2','P1'],['T3','P2']]);for(const[id,project]of projects)sqlite.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(id,project,id+' title',root);sqlite.prepare('INSERT INTO projects VALUES(?,?)').run('P1','Project One');
  const runs=new Map<string,AbortController>(),service=new BrowserService({sqlite,userData:root,helper:{executable:'/must-not-run',sha256:'0'.repeat(64)},taskProject:id=>projects.get(id)??null,taskDirectory:()=>root});fixtures.push({service,sqlite,root,runs});
  const scope=(taskId='T1',runId='R1'):BrowserScope=>{let run=runs.get(runId);if(!run){run=new AbortController();runs.set(runId,run);}return{taskId,projectId:projects.get(taskId)!,runId,requestId:randomUUID(),operationId:randomUUID(),runSignal:run.signal,signal:new AbortController().signal,assertActive:()=>{}};};
  const grant=async(mode:'observe'|'control'='control',caller=scope(),target='T2',chosen?:'observe'|'control')=>{const result=service.execute(caller,'access request',{task:target,mode});const request=service.access.snapshot().requests.at(-1)!;service.respondAccess(request.id,true,chosen);await result;return request.id;};
  const page=(taskId='T2',profileId=service.profiles.ensureProject('P1').id)=>{
    const fake={id:randomUUID(),taskId,projectId:'P1',profileId,kind:'tab',closed:false,abort:new AbortController(),queue:new BrowserPageQueue(),helper:{ensureSession:vi.fn(async()=>{})},contents:{getURL:()=> 'https://fixture.example/',getTitle:()=> 'Fixture',printToPDF:vi.fn(async()=>Buffer.from('%PDF-test'))}} as unknown as BrowserPage;
    vi.spyOn(service.workspace,'target').mockResolvedValue(fake);vi.spyOn(service.pages,'all').mockReturnValue([fake]);vi.spyOn(service.pages,'list').mockImplementation(id=>id===fake.taskId?[fake]:[]);return fake;
  };
  return{service,sqlite,scope,grant,page,runs,root,projects};
}
describe('actual caller and target authority in the browser service',()=>{
  it.each(['click','exec'] as const)('keeps a %s reference armed through the dialog and finishes it under the original page queue',async command=>{
    const f=fixture(),page=f.page('T1'),guards=new BrowserDeferredReferenceGuards(),nativeFinish=vi.fn(async()=>({connected:true,blocked:[],accepted:['mousedown','mouseup','click']})),inspect=vi.fn(async()=>({connected:true,blocked:[],accepted:['mousedown','mouseup','click']}));
    const armed={selector:'[held-node]',hostClick:false,finish:vi.fn(async(_preserve:boolean,defer:boolean,failed:()=>void)=>{
      if(!defer)throw Error('JavaScript finish would block while prompt is open');
      return guards.defer({id:'exact-old-node',inspect,finish:nativeFinish,failed});
    })};
    const references={arm:vi.fn(async()=>armed),get hasOpenDialog(){return guards.dialogOpen;},get hasDeferredGuards(){return guards.pending;},settleDeferredGuards:()=>guards.settle(),assertDeferredGuardsReady:()=>guards.assertReady()};
    Object.assign(page,{references});page.helper.command=vi.fn(async()=>{guards.opening('original-dialog');return{clicked:true,dialogOpened:true};});
    const scope=f.scope();const result=await f.service.execute(scope,command,command==='click'?{element:'@held'}:{command:'click @held'});
    expect(result).toMatchObject({dialogOpened:true});expect(inspect).not.toHaveBeenCalled();expect(nativeFinish).not.toHaveBeenCalled();
    expect(f.service.operations.receipt('R1',scope.requestId)).toMatchObject({effectState:'completed'});
    await expect(f.service.execute(f.scope(),'snapshot',{})).rejects.toThrow('先处理');
    vi.spyOn(f.service.javascriptDialogs,'respondFromAgent').mockImplementation(async(_task,_page,_accept,_text,dispatched)=>{dispatched();guards.closed('original-dialog');return{handled:true};});
    await expect(f.service.execute(f.scope(),'dialog accept',{text:'accepted'})).resolves.toEqual({result:{handled:true}});
    expect(nativeFinish).toHaveBeenCalledOnce();expect(guards.pending).toBe(false);expect(page.helper.command).toHaveBeenCalledOnce();
  });
  it('retains a replaced-node failure in the original click receipt while answering the real dialog successfully',async()=>{
    const f=fixture(),page=f.page('T1'),guards=new BrowserDeferredReferenceGuards(),state={connected:false,blocked:['mouseup','click'],accepted:['mousedown']};
    const armed={selector:'[held-old-node]',hostClick:false,finish:vi.fn(async(_preserve:boolean,defer:boolean,failed:()=>void)=>{expect(defer).toBe(true);return guards.defer({id:'old',inspect:async()=>state,finish:async()=>state,failed});})};
    Object.assign(page,{references:{arm:async()=>armed,get hasOpenDialog(){return guards.dialogOpen;},get hasDeferredGuards(){return guards.pending;},settleDeferredGuards:()=>guards.settle(),assertDeferredGuardsReady:()=>guards.assertReady()}});
    page.helper.command=vi.fn(async()=>{guards.opening('dialog');return{clicked:true,dialogOpened:true};});const original=f.scope();await f.service.execute(original,'click',{element:'@old'});
    vi.spyOn(f.service.javascriptDialogs,'respondFromAgent').mockImplementation(async(_task,_page,_accept,_text,dispatched)=>{dispatched();guards.closed('dialog');return{handled:true};});
    await expect(f.service.execute(f.scope(),'dialog accept',{})).resolves.toEqual({result:{handled:true,inputContinuation:'blocked'}});
    expect(f.service.operations.receipt('R1',original.requestId)).toMatchObject({state:'unknown',effectState:'unknown',code:'BROWSER_STALE_REF'});
    expect(page.helper.command).toHaveBeenCalledOnce();expect(guards.pending).toBe(false);
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
});
