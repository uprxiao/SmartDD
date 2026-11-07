// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {BrowserWorkspaceState} from '@shared/browser-workspace';
import {TaskBrowserWorkspace} from './workspace';
import {browserAccess} from './access-store';
const f=vi.hoisted(()=>({value:null as unknown as {state:BrowserWorkspaceState;error:string},api:{continueCertificate:vi.fn(),focusChrome:vi.fn(),placement:vi.fn(),overlay:vi.fn(),find:vi.fn(),pause:vi.fn(),accessState:vi.fn()},store:{subscribe:()=>()=>{},snapshot:()=>f.value,refresh:vi.fn(),run:async(work:()=>Promise<unknown>)=>work()}}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{browser:f.api}}));
vi.mock('./store',()=>({browserWorkspaceFor:()=>f.store,openNewBrowserTab:vi.fn()}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:({web}:{web:{view:unknown}})=>web.view}));
vi.mock('@renderer/core/navigation',()=>({navigation:{}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{}}));
beforeEach(()=>{vi.clearAllMocks();f.api.placement.mockResolvedValue(null);f.api.overlay.mockResolvedValue(null);f.api.focusChrome.mockResolvedValue(null);f.value={error:'',state:{taskId:'t1',projectId:'p1',activeId:'page1',recent:[],notice:null,external:null,find:{active:0,total:0},tabs:[{id:'page1',url:'about:blank',title:'新标签页',profileId:'project-p1',favicon:null,loading:false,canGoBack:false,canGoForward:false,failure:{kind:'other',url:'https://outside.example.test/',host:'outside.example.test',title:'无法访问 outside.example.test',errorName:'ERR_CERT_AUTHORITY_INVALID',recovery:null},certificate:{url:'https://outside.example.test/',host:'outside.example.test',error:'ERR_CERT_AUTHORITY_INVALID',challengeId:'nonce1'}}]}};});
afterEach(async()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();f.api.accessState.mockResolvedValue({requests:[],grants:[]});await browserAccess.refresh();browserAccess.closeGrants();});
it('shows an initial failed navigation rather than hiding it behind the blank startup page, and binds approval to its nonce',async()=>{
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.queryByRole('heading',{name:'新标签页'})).toBeNull();expect(screen.getByRole('heading',{name:'此连接不受信任'})).toBeTruthy();expect((screen.getByLabelText('网页地址') as HTMLInputElement).value).toBe('https://outside.example.test/');
  fireEvent.click(screen.getByRole('button',{name:'我了解风险，继续访问'}));await waitFor(()=>expect(f.api.continueCertificate).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',challengeId:'nonce1'}));expect(f.api.placement).not.toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)}));
});
it('offers no certificate approval for an ordinary failed navigation',()=>{
  f.value.state.tabs[0].certificate=null;render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.queryByRole('button',{name:'我了解风险，继续访问'})).toBeNull();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});
it('closes downloads with Escape after the focused menu item is removed, without moving focus',async()=>{
  f.value.state.downloads=[{id:'d1',taskId:'t1',pageId:'page1',url:'https://fixture.example/orders',name:'订单.csv',path:'/synthetic/Downloads/订单.csv',destination:'downloads',state:'done',receivedBytes:24,totalBytes:24,updatedAt:Date.now(),error:null}];
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  const item=await screen.findByRole('menuitem',{name:'下载'});item.focus();fireEvent.click(item);
  await screen.findByRole('region',{name:'下载'});expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(document.body,{key:'Escape',code:'Escape',keyCode:27});
  await waitFor(()=>expect(screen.queryByRole('region',{name:'下载'})).toBeNull());
  expect(f.api.overlay).toHaveBeenLastCalledWith({taskId:'t1',tabId:'page1',open:false});
  expect(document.activeElement).toBe(document.body);
  expect(fireEvent.keyDown(document.body,{key:'Escape',code:'Escape'})).toBe(true);
});
it('renders activity and routes pause/resume as trusted user actions without blocking manual navigation',async()=>{
  f.value.state.tabs[0].agentActive=true;f.value.state.tabs[0].agentRunning=true;const view=render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.getByText('Agent 正在操作此页面')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'暂停 Agent'}));expect(f.api.pause).toHaveBeenCalledWith({taskId:'t1',paused:true});
  f.value={...f.value,state:{...f.value.state,paused:true}};view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.getByText(/已暂停 Agent 的浏览器操作/)).toBeTruthy();expect(screen.queryByRole('button',{name:'暂停 Agent'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'恢复 Agent'}));expect(f.api.pause).toHaveBeenLastCalledWith({taskId:'t1',paused:false});expect((screen.getByLabelText('网页地址') as HTMLInputElement).disabled).toBe(false);
});
it('waits for native overlay parking acknowledgement before exposing a scoped authorization dialog',async()=>{
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);let parked!:(value:null)=>void;f.api.overlay.mockImplementationOnce(()=>new Promise(resolve=>{parked=resolve;}));f.api.accessState.mockResolvedValue({requests:[{id:'r1',runId:'run1',projectId:'p1',requesterTaskId:'t2',targetTaskId:'t1',requesterTitle:'Caller',targetTitle:'Target',projectName:'Project',mode:'observe',requestedMode:'observe',createdAt:Date.now(),expiresAt:Date.now()+60000}],grants:[]});
  await act(async()=>browserAccess.refresh());expect(screen.queryByRole('dialog',{name:'Agent 请求访问其他任务的网页'})).toBeNull();expect(f.api.overlay).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',open:true});await act(async()=>parked(null));expect(screen.getByRole('dialog',{name:'Agent 请求访问其他任务的网页'})).toBeTruthy();expect(f.api.focusChrome).not.toHaveBeenCalled();
});
it('keeps native page geometry constant when activity starts or expires',async()=>{
  vi.stubGlobal('ResizeObserver',class{constructor(private callback:()=>void){}observe(){this.callback();}disconnect(){}});vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>window.setTimeout(callback,0));vi.stubGlobal('cancelAnimationFrame',(id:number)=>window.clearTimeout(id));vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(10,20,500,400));
  f.value.state.tabs[0]={...f.value.state.tabs[0],url:'https://fixture.example/',failure:null,certificate:null};const view=render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);const placed={taskId:'t1',tabId:'page1',rect:{x:12,y:22,width:496,height:396}};await waitFor(()=>expect(f.api.placement).toHaveBeenCalledWith(placed));const count=f.api.placement.mock.calls.length;
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],agentActive:true}]}};view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.getByTestId('browser-viewport').classList.contains('bw-agent-glow')).toBe(true);expect(f.api.placement.mock.calls.length).toBe(count);
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],agentActive:false}]}};view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.getByTestId('browser-viewport').classList.contains('bw-agent-glow')).toBe(false);expect(f.api.placement.mock.calls.filter(([input])=>input.rect!==null).every(([input])=>JSON.stringify(input)===JSON.stringify(placed))).toBe(true);
});
