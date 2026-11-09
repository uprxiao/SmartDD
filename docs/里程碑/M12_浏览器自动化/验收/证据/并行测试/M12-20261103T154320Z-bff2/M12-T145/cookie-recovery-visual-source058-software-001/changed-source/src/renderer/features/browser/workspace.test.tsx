// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {BrowserWorkspaceState} from '@shared/browser-workspace';
import {TaskBrowserWorkspace} from './workspace';
import {browserAccess} from './access-store';
const f=vi.hoisted(()=>({value:null as unknown as {state:BrowserWorkspaceState;error:string},api:{profileSiteStates:vi.fn(),continueCertificate:vi.fn(),focusChrome:vi.fn(),placement:vi.fn(),overlay:vi.fn(),find:vi.fn(),pause:vi.fn(),accessState:vi.fn()},store:{subscribe:()=>()=>{},snapshot:()=>f.value,refresh:vi.fn(),run:async(work:()=>Promise<unknown>)=>work()}}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{browser:f.api}}));
vi.mock('./store',()=>({browserWorkspaceFor:()=>f.store,openNewBrowserTab:vi.fn()}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:({web}:{web:{view:unknown}})=>web.view}));
vi.mock('@renderer/core/navigation',()=>({navigation:{}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{}}));
beforeEach(()=>{vi.clearAllMocks();f.api.profileSiteStates.mockResolvedValue([{importState:"ready",profile:{id:"project-p1",scope:"project",label:"项目登录态",source:null,owner:{kind:"project",id:"p1"},partition:"persist:wy-browser-project-p1"},state:{schemaVersion:1,certificates:[],permissions:[]}}]);f.api.placement.mockResolvedValue(null);f.api.overlay.mockResolvedValue(null);f.api.focusChrome.mockResolvedValue(null);f.value={error:'',state:{taskId:'t1',projectId:'p1',activeId:'page1',recent:[],notice:null,external:null,find:{active:0,total:0},tabs:[{id:'page1',url:'about:blank',title:'新标签页',profileId:'project-p1',favicon:null,loading:false,canGoBack:false,canGoForward:false,failure:{kind:'other',url:'https://outside.example.test/',host:'outside.example.test',title:'无法访问 outside.example.test',errorName:'ERR_CERT_AUTHORITY_INVALID',recovery:null},certificate:{url:'https://outside.example.test/',host:'outside.example.test',error:'ERR_CERT_AUTHORITY_INVALID',challengeId:'nonce1'}}]}};});
afterEach(async()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();f.api.accessState.mockResolvedValue({requests:[],grants:[]});await browserAccess.refresh();browserAccess.closeGrants();});
it('shows an initial failed navigation rather than hiding it behind the blank startup page, and binds approval to its nonce',async()=>{
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.queryByRole('heading',{name:'新标签页'})).toBeNull();expect(screen.getByRole('heading',{name:'此连接不受信任'})).toBeTruthy();expect((screen.getByLabelText('网页地址') as HTMLInputElement).value).toBe('https://outside.example.test/');
  fireEvent.click(screen.getByRole('button',{name:'我了解风险，继续访问'}));await waitFor(()=>expect(f.api.continueCertificate).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',challengeId:'nonce1'}));expect(f.api.placement).not.toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)}));
});
it('offers no certificate approval for an ordinary failed navigation',()=>{
  f.value.state.tabs[0].certificate=null;render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.queryByRole('button',{name:'我了解风险，继续访问'})).toBeNull();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});
it('restores the last committed address after an ordinary failed navigation, while retaining the failure explanation',()=>{
  f.value.state.tabs[0].certificate=null;f.value.state.tabs[0].url='https://previous.example.test/committed';
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect(screen.getByRole('heading',{name:'无法访问 outside.example.test'})).toBeTruthy();
  expect((screen.getByLabelText('网页地址') as HTMLInputElement).value).toBe('https://previous.example.test/committed');
  expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
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
it('displays the host activity deadline across remounts and tab switches without extending its lifetime',async()=>{
  vi.useFakeTimers();vi.setSystemTime(10000);
  f.value.state.tabs[0]={...f.value.state.tabs[0],agentActive:true,agentRunning:false,agentHoldUntil:30000};
  let view=render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 20 秒后清除标记')).toBeTruthy();
  await act(async()=>vi.advanceTimersByTime(7400));
  expect(screen.getByText('Agent 最近操作过此页面 · 13 秒后清除标记')).toBeTruthy();
  view.unmount();await act(async()=>vi.advanceTimersByTime(3000));
  view=render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 10 秒后清除标记')).toBeTruthy();
  f.value={...f.value,state:{...f.value.state,activeId:'page2',tabs:[...f.value.state.tabs,{...f.value.state.tabs[0],id:'page2',agentHoldUntil:60000}]}};
  view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 40 秒后清除标记')).toBeTruthy();
  f.value={...f.value,state:{...f.value.state,activeId:'page1'}};
  view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 10 秒后清除标记')).toBeTruthy();
  await act(async()=>vi.advanceTimersByTime(10000));
  expect(screen.getByText('Agent 最近操作过此页面 · 0 秒后清除标记')).toBeTruthy();
  expect(f.value.state.tabs[0].agentActive).toBe(true);
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],agentActive:false,agentHoldUntil:null}]}};
  view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect(screen.queryByText(/Agent 最近操作过此页面/)).toBeNull();
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

it('shows the current host profile and opens its management through the badge after parking the native page',async()=>{
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  const badge=await screen.findByRole('button',{name:'项目登录态'});expect(badge.title).toBe('当前页面的登录态：项目登录态');
  fireEvent.click(badge);await waitFor(()=>expect(f.api.overlay).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',open:true}));
});
it('does not display an obsolete profile response after switching the active profile',async()=>{
  let resolveOld!:(value:unknown[])=>void;f.api.profileSiteStates.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  const view=render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],profileId:'isolated-new'}]}};
  f.api.profileSiteStates.mockResolvedValueOnce([{profile:{id:'isolated-new',scope:'isolated',label:'独立账号'}}]);view.rerender(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  expect((await screen.findByRole('button',{name:'独立登录态'})).title).toBe('当前页面的登录态：独立账号');
  await act(async()=>resolveOld([{profile:{id:'project-p1',scope:'project',label:'过期账号'}}]));expect(screen.queryByTitle('当前页面的登录态：过期账号')).toBeNull();expect(screen.getByRole('button',{name:'独立登录态'}).title).toBe('当前页面的登录态：独立账号');
});
it('keeps an unavailable profile unknown and recovers through explicit management',async()=>{
  f.api.profileSiteStates.mockRejectedValueOnce(Error('temporarily unavailable'));render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  const badge=await screen.findByTitle('无法读取当前登录态，点击管理');expect(badge.textContent).toBe('登录态');expect(screen.queryByRole('button',{name:'项目登录态'})).toBeNull();
  fireEvent.click(badge);await waitFor(()=>expect(f.api.overlay).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',open:true}));
});
it.each(['importing','needs-attention'] as const)('keeps the %s recovery explanation visible when a menu captures the parked page',async importState=>{
  f.value.state.tabs[0]={...f.value.state.tabs[0],url:'https://fixture.example/',failure:null,certificate:null,importState};
  f.api.overlay.mockResolvedValue('data:image/png;base64,parked-old-page');
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  await screen.findByRole('menuitem',{name:'导入 Chrome／Edge 登录态'});
  expect(screen.queryByAltText('网页预览')).toBeNull();
  if(importState==='importing')expect(screen.getByRole('heading',{name:'正在导入登录态'})).toBeTruthy();
  else expect(screen.getByText(/当前登录态需要处理/)).toBeTruthy();
  expect(screen.getByRole('menuitem',{name:'导入 Chrome／Edge 登录态'}).hasAttribute('disabled')).toBe(true);
  if(importState==='needs-attention')expect(screen.getByRole('button',{name:'去处理'})).toBeTruthy();
});
