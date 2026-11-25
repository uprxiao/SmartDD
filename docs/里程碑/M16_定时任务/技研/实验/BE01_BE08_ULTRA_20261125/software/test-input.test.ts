import Database from 'better-sqlite3';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {BaseWindow,Rectangle} from 'electron';
import {BrowserWorkspace} from '../workspace';
import {BrowserPageRegistry,browserProjectProfile,type BrowserPage} from '../page-registry';
import {BrowserOperations} from '../operations';
import {BrowserTabOpen,browserTabOpenInput} from '../tab-open';
import type {BrowserScope} from '../service';
import {BrowserPageQueue} from '../queue';
import {ApplicationError} from '@shared/applications';

// Actual workspace/registry/open receipts; synthetic native view and initialization
// boundaries only. No Electron window, driver, helper, or network is launched.
const fixtureRoot=process.env.WY_F36_ULTRA_FIXTURE_DIR;
if(!fixtureRoot?.startsWith('/private/tmp/willyou-f36-ultra-'))throw Error('private experiment root required');
const task='task-fixed',project='project-fixed',profile=browserProjectProfile(project),url='http://127.0.0.1:1/fixed-local-fixture';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const rect={x:10,y:10,width:640,height:480};
const image={getSize:()=>({width:640,height:480}),toJPEG:()=>Buffer.from('fixed-image')};
function gate<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;return{promise:new Promise<T>((a,b)=>{resolve=a;reject=b}),resolve,reject};}
const fixtureCleanup: Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of fixtureCleanup.splice(0))await fn();vi.restoreAllMocks();});
function trace(name:string,value:unknown){console.log('ULTRA_LIFECYCLE '+JSON.stringify({name,value}));}
function fixture(ids:string[]=[]){
  const db=new Database(':memory:');db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');db.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));
  const shell={label:'AppShell'},children:unknown[]=[shell];
  const window={isDestroyed:()=>false,contentView:{children,addChildView(view:unknown,index?:number){const old=children.indexOf(view);if(old>=0)children.splice(old,1);children.splice(index??children.length,0,view);},removeChildView(view:unknown){const old=children.indexOf(view);if(old>=0)children.splice(old,1);}}};
  const pages=new BrowserPageRegistry({userData:fixtureRoot!,helper:{executable:'/must-not-run',sha256:'0'.repeat(64)},window:()=>window as unknown as BaseWindow});
  const workspace=new BrowserWorkspace({sqlite:db,pages,taskProject:id=>id===task?project:null});
  if(ids.length)db.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserWorkspace.v1:'+task,JSON.stringify({version:1,tabs:ids.map((id,i)=>({id,url:i===0?url:url+'?second=1',title:id,profileId:profile,favicon:null})),activeId:ids[0],closed:[]}));
  const actualMap=(pages as unknown as {pages:Map<string,BrowserPage>}).pages;
  const makePage=(id:string)=>{let dead=false;const contents={isDestroyed:()=>dead,close:vi.fn(()=>{dead=true;}),capturePage:vi.fn(async()=>image),getURL:()=>url};const view={label:id,webContents:contents,setBounds:vi.fn()};const helper={close:vi.fn(async()=>{})};const p={id,short:id,taskId:task,projectId:project,profileId:profile,view,contents,proxy:{stop:vi.fn(async()=>{})},helper,references:{invalidate:vi.fn(),documentGeneration:1},queue:new BrowserPageQueue(),rect,closed:false,abort:new AbortController(),hostNavigation:null,kind:'tab'} as unknown as BrowserPage;
    actualMap.set(id,p);window.contentView.addChildView(view,0);return{p,view,helper,contents};};
  fixtureCleanup.push(async()=>{await workspace.dispose();await pages.dispose();db.close();});
  return{db,pages,workspace,window,children,makePage};
}
function saved(f:ReturnType<typeof fixture>){return JSON.parse((f.db.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:'+task) as {value:string}).value);}
function newScope(){const run=new AbortController(),scope:BrowserScope={taskId:task,projectId:project,runId:randomUUID(),requestId:randomUUID(),operationId:randomUUID(),runSignal:run.signal,signal:run.signal,assertRetained:()=>{},assertActive:()=>{}};return{run,scope};}
function abort(run:AbortController){run.abort(new ApplicationError('CANCELED','本地合成任务已取消'));}
const openArgs=browserTabOpenInput({url});
const openOptions={authorize:()=>{},dispatch:()=>{},ready:async()=>{}};
const finalPhase=(operations:BrowserOperations,scope:BrowserScope)=>operations.receipt(scope.runId,scope.requestId);

describe('F36 Ultra private close and shared open lifecycle',()=>{
 it('close-in-flight must not match the old tab for a new URL request',async()=>{
   const f=fixture([A]),a=f.makePage(A),closeGate=gate<void>();a.helper.close.mockReturnValueOnce(closeGate.promise);
   const closing=f.workspace.close(task,A);
   await vi.waitFor(()=>expect(a.helper.close).toHaveBeenCalledOnce());
   let replacement!:ReturnType<BrowserWorkspace['reserveAgentOpen']>;let explicitRejected=false;
   try{replacement=f.workspace.reserveAgentOpen(task,{url,profileId:profile,forceNew:false});try{f.workspace.reserveAgentOpen(task,{pageId:A,profileId:profile,forceNew:false});}catch{explicitRejected=true;}}
   finally{closeGate.resolve();await closing;}
   trace('close-reserve',{old:A,replacement,explicitRejected,saved:saved(f)});
   expect(replacement.pageId).not.toBe(A);expect(replacement.reused).toBe(false);expect(explicitRejected).toBe(true);expect(saved(f).tabs.map((t:{id:string})=>t.id)).toEqual([replacement.pageId]);
 });
 it('duplicate overlapping close adds exactly one closed-history entry',async()=>{
   const f=fixture([A]),a=f.makePage(A),closeGate=gate<void>();a.helper.close.mockReturnValueOnce(closeGate.promise);
   const x=f.workspace.close(task,A);await vi.waitFor(()=>expect(a.helper.close).toHaveBeenCalledOnce());const y=f.workspace.close(task,A);
   closeGate.resolve();await Promise.all([x,y]);trace('double-close',saved(f));
   expect(saved(f).closed.map((t:{id:string})=>t.id)).toEqual([A]);expect(a.helper.close).toHaveBeenCalledOnce();
   f.workspace.reopen(task);f.workspace.reopen(task);expect(f.workspace.snapshot(task).tabs).toHaveLength(1);
 });
 it('two same-URL callers share one pending creation, cancellation of one keeps the valid other caller',async()=>{
   const f=fixture(),ops=new BrowserOperations(f.db),opens=new BrowserTabOpen(f.workspace,ops),x=newScope(),y=newScope(),native=gate<void>();
   const create=vi.spyOn(f.pages,'create').mockImplementation(async(_task,_project,id)=>{await native.promise;return f.makePage(id!).p;});const navigate=vi.spyOn(f.pages,'navigate').mockResolvedValue();
   const first=opens.start(x.scope,openArgs,profile,openOptions),second=opens.start(y.scope,openArgs,profile,openOptions);
   try{expect(first.pageId).toEqual(second.pageId);await vi.waitFor(()=>expect(create).toHaveBeenCalledOnce());abort(x.run);await vi.waitFor(()=>expect(finalPhase(ops,x.scope)).toMatchObject({state:'failed',summary:{phase:'cancelled'}}));native.resolve();await vi.waitFor(()=>expect(finalPhase(ops,y.scope)).toMatchObject({state:'succeeded',summary:{phase:'ready'}}));trace('shared-one-cancel',{first,second,one:finalPhase(ops,x.scope),other:finalPhase(ops,y.scope),create:create.mock.calls.length,navigate:navigate.mock.calls.length});expect(navigate).toHaveBeenCalledOnce();}
   finally{native.resolve();abort(x.run);abort(y.run);await vi.waitFor(()=>expect((f.pages as unknown as {pages:Map<string,BrowserPage>}).pages.size).toBe(1));}
 });
 it('a new URL request after all old callers cancel must not join a dead initialization',async()=>{
   const f=fixture(),ops=new BrowserOperations(f.db),opens=new BrowserTabOpen(f.workspace,ops),x=newScope(),y=newScope(),newRequest=newScope(),native=gate<void>();let count=0;
   const create=vi.spyOn(f.pages,'create').mockImplementation(async(_task,_project,id)=>{if(++count===1)await native.promise;return f.makePage(id!).p;});const navigate=vi.spyOn(f.pages,'navigate').mockResolvedValue();
   const first=opens.start(x.scope,openArgs,profile,openOptions),second=opens.start(y.scope,openArgs,profile,openOptions);
   try{expect(first.pageId).toEqual(second.pageId);await vi.waitFor(()=>expect(create).toHaveBeenCalledOnce());abort(x.run);abort(y.run);await vi.waitFor(()=>{expect(finalPhase(ops,x.scope)).toMatchObject({state:'failed',summary:{phase:'cancelled'}});expect(finalPhase(ops,y.scope)).toMatchObject({state:'failed',summary:{phase:'cancelled'}});});const fresh=opens.start(newRequest.scope,openArgs,profile,openOptions);native.resolve();await vi.waitFor(()=>expect(ops.get(newRequest.scope.runId,newRequest.scope.requestId)?.state).not.toBe('running'));trace('shared-all-cancel-new',{first,second,fresh,result:finalPhase(ops,newRequest.scope),create:create.mock.calls.length,navigate:navigate.mock.calls.map(([page])=>page.id)});expect(finalPhase(ops,newRequest.scope)).toMatchObject({state:'succeeded',summary:{phase:'ready'}});expect(navigate).toHaveBeenCalledOnce();expect(navigate.mock.calls[0][0].id).toEqual(fresh.pageId);}
   finally{native.resolve();abort(x.run);abort(y.run);abort(newRequest.run);await vi.waitFor(()=>expect((f.pages as unknown as {pages:Map<string,BrowserPage>}).pages.size).toBeGreaterThanOrEqual(1));}
 });
});

describe('F36 Ultra private UI placement/overlay instance lifecycle',()=>{
 it('a late null for another page cannot demote the current mounted page',async()=>{
   const f=fixture([A,B]),a=f.makePage(A),b=f.makePage(B);await f.workspace.placement(task,A,rect);await f.workspace.placement(task,B,rect);await f.workspace.placement(task,A,null);
   trace('late-null-other-page',{front:f.children.map(x=>(x as {label:string}).label),mountedB:f.pages.isMounted(b.p)});expect(f.pages.isMounted(b.p)).toBe(true);expect(f.children.at(-1)).toBe(b.view);expect(f.pages.isMounted(a.p)).toBe(false);
 });
 it('a delayed old native transition cannot commit after the newest A→B→A selection',async()=>{
   const f=fixture([A,B]),a=f.makePage(A),b=f.makePage(B);await f.workspace.placement(task,A,rect);const park=(f.pages as unknown as {park:{park:(view:unknown,rect:Rectangle)=>Promise<void>}}).park,original=park.park.bind(park),delay=gate<void>();let blocked=false;
   vi.spyOn(park,'park').mockImplementationOnce(async(view,r)=>{blocked=true;await delay.promise;return original(view,r);});const older=f.workspace.placement(task,B,rect);await vi.waitFor(()=>expect(blocked).toBe(true));const newer=f.workspace.placement(task,A,rect);delay.resolve();await Promise.all([older,newer]);
   trace('native-aba',{front:f.children.map(x=>(x as {label:string}).label),mountedA:f.pages.isMounted(a.p),mountedB:f.pages.isMounted(b.p)});expect(f.pages.isMounted(a.p)).toBe(true);expect(f.children.at(-1)).toBe(a.view);
 });
 it('a cancelled capture cannot re-park or publish after same-owner menu reentry',async()=>{
   const f=fixture([A]),a=f.makePage(A);await f.workspace.placement(task,A,rect);const older=gate<typeof image>();a.contents.capturePage.mockReturnValueOnce(older.promise);const first=f.workspace.overlay(task,A,true,true,'surface');await f.workspace.overlay(task,A,false,true,'surface');await f.workspace.overlay(task,A,true,false,'surface');const nativePlace=vi.spyOn(f.pages,'placement');older.resolve(image);const result=await first;trace('overlay-reentry',{result,extraPlacement:nativePlace.mock.calls.length});expect(result).toBeNull();expect(nativePlace).not.toHaveBeenCalled();await f.workspace.overlay(task,A,false,true,'surface');
 });
 // Experimental input seam: a producer-order ticket per logical view acquisition.
 // Old implementation ignores the extra argument; an isolated candidate can consume it.
 it('old A layout release cannot detach a fresh A after A→B→A',async()=>{
   const f=fixture([A,B]),a=f.makePage(A);f.makePage(B);const place=f.workspace.placement.bind(f.workspace) as (task:string,id:string,r:Rectangle|null,instance:number)=>Promise<void>;
   await place(task,A,rect,1);await place(task,B,rect,2);await place(task,A,rect,3);await place(task,A,null,1);
   trace('layout-instance-aba',{front:f.children.map(x=>(x as {label:string}).label),mountedA:f.pages.isMounted(a.p)});expect(f.pages.isMounted(a.p)).toBe(true);expect(f.children.at(-1)).toBe(a.view);
 });
 it('old same-owner release cannot remove a new overlay acquisition',async()=>{
   const f=fixture([A]),a=f.makePage(A);await f.workspace.placement(task,A,rect);const overlay=f.workspace.overlay.bind(f.workspace) as (task:string,id:string,open:boolean,capture:boolean,owner:string,instance:string)=>Promise<string|null>;
   await overlay(task,A,true,false,'surface','old');await overlay(task,A,false,false,'surface','old');await overlay(task,A,true,false,'surface','new');await overlay(task,A,false,false,'surface','old');await f.workspace.placement(task,A,rect);
   trace('overlay-instance-release',{mountedA:f.pages.isMounted(a.p),front:f.children.map(x=>(x as {label:string}).label)});expect(f.pages.isMounted(a.p)).toBe(false);await overlay(task,A,false,false,'surface','new');await f.workspace.placement(task,A,rect);expect(f.pages.isMounted(a.p)).toBe(true);
 });
});
