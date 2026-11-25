// @vitest-environment jsdom
// F36 BE04/05: renderer state/event composition against unchanged production modules.
// Synthetic RPC responses only. No native browser, network, credentials or user data.
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {createPortal} from 'react-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {appendFileSync} from 'node:fs';
import type {BrowserWorkspaceState,BrowserTabState} from '@shared/browser-workspace';
import {browserChangedEvent,browserOpenPresentationEvent} from '@shared/events';
import {navigation} from '@renderer/core/navigation';
import {AgentWorkspacePanels} from '@renderer/features/agent-tasks/workspace-panels';
import {panelsFor} from '@renderer/features/agent-tasks/workspace-panels-store';
import {useBrowserShortcuts} from './workspace';
import {browserWorkspaceFor,revealBrowserTab} from './store';
import {
  authorizeBrowserPresentation,browserViewRevision,rememberBrowserPresentation,
  type BrowserPresentationEvent,
} from './open-presentation';
import {events} from '@renderer/lib/ipc';

const f=vi.hoisted(()=>({
  api:{
    snapshot:vi.fn(),close:vi.fn(),select:vi.fn(),create:vi.fn(),
    profileSiteStates:vi.fn(),focusChrome:vi.fn(),placement:vi.fn(),overlay:vi.fn(),
    accessState:vi.fn(),
  },
  wire:new Map<string,Set<(data:unknown)=>void>>(),
  calls:[] as {event:string;payload?:unknown}[],
}));
vi.mock('@renderer/lib/ipc',async()=>{
  const {createEventEmitter}=await import('@shared/ipc/events');
  return {
    rpc:{browser:f.api},
    events:createEventEmitter({
      on(name,cb){
        const callbacks=f.wire.get(name)??new Set();f.wire.set(name,callbacks);callbacks.add(cb);
        return()=>{callbacks.delete(cb);if(!callbacks.size)f.wire.delete(name);};
      },
      emit(name,data){f.calls.push({event:'host.emit:'+name,payload:data});for(const callback of [...(f.wire.get(name)??[])])callback(data);},
    }),
  };
});
vi.mock('@renderer/features/agent-tasks/turn-diff-surface',()=>({TurnDiffSurface:()=> <div>Fixture diff</div>}));
vi.mock('@renderer/features/agent-tasks/agent-terminal',()=>({AgentTerminalDrawer:()=> <div>Fixture terminal</div>}));
vi.mock('@renderer/features/agent-tasks/message-attachment-preview',()=>({MessageAttachmentPreview:()=> <div>Fixture attachment</div>}));
vi.mock('@renderer/features/files/file-icon',()=>({FileTreeIcon:()=>null}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{tasks:[]}}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:({workspaceHeader}:{
  workspaceHeader:{target:HTMLElement|null;active:boolean;onActivate:()=>void},
})=><><div>Fixture files</div>{workspaceHeader.target&&createPortal(
  <button type="button" role="tab" aria-selected={workspaceHeader.active} onClick={workspaceHeader.onActivate}>Fixture files tab</button>,
  workspaceHeader.target)}</>}));
function Deferred<T>(){let release!:(value:T)=>void;const promise=new Promise<T>(resolve=>{release=resolve;});return {promise,release};}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function tab(id:string,url:string,pendingUrl?:string):BrowserTabState{
  return {id,url,title:id,profileId:'project-fixture',favicon:null,loading:!!pendingUrl,canGoBack:false,canGoForward:false,...(pendingUrl?{pendingUrl}:{})};
}
let host:BrowserWorkspaceState,taskId:string,oldId:string,newId:string,name:string,scope:{kind:'task';taskId:string},counter=0,
 snapshotHandlers:((captured:BrowserWorkspaceState)=>Promise<BrowserWorkspaceState>)[]=[],
 nextSelect:((selected:BrowserWorkspaceState)=>Promise<BrowserWorkspaceState>)|undefined;
const targetUrl='https://fixture.invalid/f36-new';
function state(tabs:BrowserTabState[],activeId:string|null):BrowserWorkspaceState{
  return{taskId,projectId:'fixture-project',activeId,tabs,recent:[],notice:null,external:null,find:{active:0,total:0}};
}
function trace(phase:string,extra:Record<string,unknown>={}){
  const panels=panelsFor(scope),snapshot=browserWorkspaceFor(taskId).snapshot().state;
  const row={
    case:name,phase,revision:browserViewRevision(),route:{view:navigation.currentViewId,task:navigation.currentAgentTaskId},
    panel:{active:panels.active,tabs:[...panels.tabs]},snapshot:snapshot&&{activeId:snapshot.activeId,tabs:snapshot.tabs.map(t=>({id:t.id,url:t.url,pendingUrl:t.pendingUrl,loading:t.loading}))},
    host:{activeId:host.activeId,tabs:host.tabs.map(t=>({id:t.id,url:t.url,pendingUrl:t.pendingUrl,loading:t.loading}))},
    address:(screen.queryByRole('textbox',{name:'网页地址'}) as HTMLInputElement|null)?.value??null,
    visibleBrowser:!!screen.queryByTestId('browser-viewport'),calls:[...f.calls],...extra,
  };
  console.log('F36_TRACE '+JSON.stringify(row));
  const output=process.env.WILLYOU_F36_TRACE_PATH;
  if(output)appendFileSync(output,JSON.stringify(row)+'\n');
}
function setup(caseName:string){
  name=caseName;
  taskId='fixture-task-'+ ++counter;scope={kind:'task',taskId};
  oldId='old-'+counter;newId='new-'+counter;
  host=state([tab(oldId,'https://fixture.invalid/old')],oldId);
  navigation.openAgentTask(taskId);
  panelsFor(scope).open('browser');
  function Root(){useBrowserShortcuts();return <AgentWorkspacePanels scope={scope} projectId={host.projectId}/>;}
  render(<Root/>);
}
async function mountedOld(){
  await screen.findByRole('button',{name:'关闭网页 '+oldId});
  await waitFor(()=>expect((screen.getByRole('textbox',{name:'网页地址'}) as HTMLInputElement).value).toBe('https://fixture.invalid/old'));
  trace('old-page-visible');
}
async function closeNormally(){
  fireEvent.click(screen.getByRole('button',{name:'关闭网页 '+oldId}));
  await waitFor(()=>expect(panelsFor(scope).tabs).not.toContain('browser'));
  trace('old-close-and-empty-cleanup-settled');
}
async function beginDelayedClose(){
  // Close saves and sends browser:changed; renderer also refreshes after its
  // close RPC resolves. Capture/gate both old empty responses, so the latest
  // request (not a deliberately obsolete earlier request) can still publish.
  const gates=[Deferred<BrowserWorkspaceState>(),Deferred<BrowserWorkspaceState>()];
  const captured:BrowserWorkspaceState[]=[];
  snapshotHandlers=gates.map(gate=>next=>{captured.push(next);return gate.promise;});
  fireEvent.click(screen.getByRole('button',{name:'关闭网页 '+oldId}));
  await waitFor(()=>expect(captured.map(item=>item.tabs)).toEqual([[],[]]));
  trace('both-empty-close-snapshots-captured-and-transport-delayed');
  return {release:()=>gates.forEach((gate,i)=>gate.release(captured[i]))};
}
function sendIntent():BrowserPresentationEvent{
  const event={taskId,pageId:newId,clientInputId:'input-'+counter,operationId:'operation-'+counter};
  rememberBrowserPresentation(taskId,event.clientInputId);
  trace('new-user-input-remembered',{event,guard:authorizeBrowserPresentation(event)});
  return event;
}
function reserveNew(){
  // Host reserve creates the tab without making it active. Deliver browser:changed
  // before browser:open-presentation, as BrowserWorkspace.save -> main/index dispatch.
  host=state([tab(newId,'about:blank',targetUrl)],null);
  trace('fixture-host-reservation-in-loading-phase');
  events.emit(browserChangedEvent,{taskId});
}
function emitShow(event:BrowserPresentationEvent){
  trace('host-presentation-before-renderer',{event,guard:authorizeBrowserPresentation(event)});
  events.emit(browserOpenPresentationEvent,event);
}
async function expectShownPending(){
  await waitFor(()=>{
    expect(panelsFor(scope).active).toBe('browser');
    expect((screen.getByRole('textbox',{name:'网页地址'}) as HTMLInputElement).value).toBe(targetUrl);
    expect(screen.getByRole('status',{name:'网页正在加载'})).toBeTruthy();
  });
}
async function emitReady(){
  host=state([tab(newId,targetUrl)],newId);
  await act(async()=>{events.emit(browserChangedEvent,{taskId});await tick();});
  await waitFor(()=>{
    expect((screen.getByRole('textbox',{name:'网页地址'}) as HTMLInputElement).value).toBe(targetUrl);
    expect(screen.queryByRole('status',{name:'网页正在加载'})).toBeNull();
  });
  trace('same-page-ready-visible');
}
beforeEach(()=>{
  vi.resetAllMocks();
  f.calls.length=0;snapshotHandlers=[];nextSelect=undefined;
  vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>window.setTimeout(()=>fn(performance.now()),0));
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>window.clearTimeout(id));
  f.api.snapshot.mockImplementation(async({taskId:asked})=>{
    if(asked!==taskId)throw new Error('unexpected task');
    const captured=structuredClone(host);
    f.calls.push({event:'rpc.snapshot',payload:{activeId:captured.activeId,ids:captured.tabs.map(t=>t.id)}});
    const handler=snapshotHandlers.shift();if(handler)return handler(captured);
    return captured;
  });
  f.api.close.mockImplementation(async({taskId:asked,tabId})=>{
    expect(asked).toBe(taskId);expect(tabId).toBe(oldId);
    f.calls.push({event:'rpc.close',payload:{taskId:asked,tabId}});
    host=state([],null);
    // Match BrowserWorkspace.close -> save -> changed event before returning.
    events.emit(browserChangedEvent,{taskId});
    return structuredClone(host);
  });
  f.api.select.mockImplementation(async({taskId:asked,tabId})=>{
    f.calls.push({event:'rpc.select',payload:{taskId:asked,tabId}});
    if(asked!==taskId||!host.tabs.some(t=>t.id===tabId))throw new Error('BROWSER_TAB_NOT_FOUND');
    host={...host,activeId:tabId};
    const selected=structuredClone(host);
    if(nextSelect){const handler=nextSelect;nextSelect=undefined;return handler(selected);}
    return selected;
  });
  f.api.profileSiteStates.mockResolvedValue([]);
  f.api.focusChrome.mockResolvedValue(null);f.api.placement.mockResolvedValue(null);
  f.api.overlay.mockResolvedValue(null);f.api.accessState.mockResolvedValue({requests:[],grants:[]});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();f.wire.clear();});
it('BE05 positive: settled last-close then explicit show reaches loading and ready on the same new page',async()=>{
  setup('settled-close');await mountedOld();await closeNormally();
  const event=sendIntent();
  await act(async()=>{reserveNew();emitShow(event);await tick();});
  await expectShownPending();trace('loading-visible');await emitReady();
  expect(f.api.select).toHaveBeenCalledWith({taskId,tabId:newId});
});
it('BE05 RED A: old empty snapshot cleanup must not cancel the newer user intent recorded while close reply is in flight',async()=>{
  setup('red-A-empty-before-presentation');await mountedOld();
  const delayed=await beginDelayedClose();const event=sendIntent();
  await act(async()=>{delayed.release();await tick();});
  trace('old-empty-cleanup-released',{guard:authorizeBrowserPresentation(event)});
  await act(async()=>{reserveNew();emitShow(event);await tick();});
  trace('after-new-presentation',{guard:authorizeBrowserPresentation(event)});
  // R12 acceptance: the explicit new request should be visible, even when old
  // UI emptiness finishes later. Keep the desired assertion red on the baseline.
  await expectShownPending();
});
it('BE05 RED B: old empty cleanup must not cancel a valid presentation between select request and reply',async()=>{
  setup('red-B-empty-during-select');await mountedOld();
  const delayed=await beginDelayedClose();const event=sendIntent();
  const selecting=Deferred<BrowserWorkspaceState>(),newSnapshot=Deferred<BrowserWorkspaceState>();
  nextSelect=()=>selecting.promise;
  await act(async()=>{
    delayed.release();await tick(); // publish empty to external store; React commit is still batched
    trace('empty-published-before-react-effect',{guard:authorizeBrowserPresentation(event)});
    expect(browserWorkspaceFor(taskId).snapshot().state?.tabs).toEqual([]);
    snapshotHandlers=[()=>newSnapshot.promise]; // new host snapshot still in flight
    reserveNew();emitShow(event);await tick();
    expect(f.api.select).toHaveBeenCalledWith({taskId,tabId:newId}); // verify first guard accepted
    trace('select-started-before-old-render-cleanup');
  });
  trace('react-empty-effect-settled-while-selecting',{guard:authorizeBrowserPresentation(event)});
  await act(async()=>{selecting.release(structuredClone(host));newSnapshot.release(structuredClone(host));await tick();});
  trace('after-select-and-new-snapshot-replies',{guard:authorizeBrowserPresentation(event)});
  await expectShownPending();
});
it('BE05 positive: deliberate file-panel switch after intent invalidates that presentation before select',async()=>{
  setup('deliberate-user-file-switch');await mountedOld();const event=sendIntent();
  fireEvent.click(screen.getByRole('tab',{name:'Fixture files tab'}));
  await act(async()=>{reserveNew();emitShow(event);await tick();});
  expect(f.api.select).not.toHaveBeenCalled();expect(panelsFor(scope).active).toBe('files');
  trace('user-panel-switch-preserved',{guard:authorizeBrowserPresentation(event)});
});
it('BE05 positive: deliberate file-panel switch during select prevents the second guard from stealing focus',async()=>{
  setup('deliberate-user-switch-while-selecting');await mountedOld();const event=sendIntent();
  const gate=Deferred<BrowserWorkspaceState>();nextSelect=()=>gate.promise;
  await act(async()=>{reserveNew();emitShow(event);await tick();});
  expect(f.api.select).toHaveBeenCalledWith({taskId,tabId:newId});
  fireEvent.click(screen.getByRole('tab',{name:'Fixture files tab'}));
  await act(async()=>{gate.release(structuredClone(host));await tick();});
  expect(panelsFor(scope).active).toBe('files');
  trace('user-panel-switch-during-select-preserved',{guard:authorizeBrowserPresentation(event)});
});
it('BE05 positive: background reservation leaves the surface closed; deliberate reveal selects the existing page and a closed ID fails',async()=>{
  setup('background-and-deliberate-reveal');await mountedOld();await closeNormally();
  await act(async()=>{reserveNew();await tick();});
  expect(f.api.select).not.toHaveBeenCalled();expect(panelsFor(scope).tabs).not.toContain('browser');
  trace('background-no-show-intent');
  await act(async()=>{await revealBrowserTab(taskId,newId);await tick();});
  await expectShownPending();trace('explicit-reveal-existing-page');
  // Close this displayed page through the real UI; allow only its actual ID in the fixture.
  f.api.close.mockImplementationOnce(async({tabId})=>{expect(tabId).toBe(newId);f.calls.push({event:'rpc.close',payload:{tabId}});host=state([],null);events.emit(browserChangedEvent,{taskId});return host;});
  fireEvent.click(screen.getByRole('button',{name:'关闭网页 '+newId}));
  await waitFor(()=>expect(panelsFor(scope).tabs).not.toContain('browser'));
  await expect(revealBrowserTab(taskId,newId)).rejects.toThrow('BROWSER_TAB_NOT_FOUND');
  expect(panelsFor(scope).tabs).not.toContain('browser');
  trace('closed-explicit-reveal-rejected');
});
