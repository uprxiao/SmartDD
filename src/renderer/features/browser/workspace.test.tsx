// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {Profiler} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {BrowserWorkspaceState} from '@shared/browser-workspace';
import {AgentBrowserSurface} from './workspace';
import {browserAccess} from './access-store';
import {holdNativeDialog} from '@renderer/lib/ui/native-dialog-layer';
const f=vi.hoisted(()=>({value:null as unknown as {state:BrowserWorkspaceState;error:string},api:{navigate:vi.fn(),profileSiteStates:vi.fn(),continueCertificate:vi.fn(),focusChrome:vi.fn(),placement:vi.fn(),overlay:vi.fn(),find:vi.fn(),pause:vi.fn(),accessState:vi.fn()},store:{openingTab:false,subscribe:()=>()=>{},snapshot:()=>f.value,refresh:vi.fn(),run:async(work:()=>Promise<unknown>)=>work()}}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{browser:f.api,nativeSurface:{overlay:vi.fn(async()=>undefined)}}}));
vi.mock('./store',()=>({browserWorkspaceFor:()=>f.store,openNewBrowserTab:vi.fn()}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:({web}:{web:{view:unknown}})=>web.view}));
vi.mock('@renderer/core/navigation',()=>({navigation:{}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{tasks:[]}}));
it('removes the browser surface on a delayed empty snapshot without discarding a new tab in flight',()=>{
  const original=f.value;
  const empty={...original,state:{...original.state,tabs:[],activeId:null}};
  f.value=empty;
  const onClose=vi.fn();
  const header={target:null,active:false,onActivate:vi.fn(),onClose};
  const surface=<AgentBrowserSurface taskId="t1" workspaceHeader={header}/>;
  const view=render(surface);
  expect(onClose).not.toHaveBeenCalled();
  f.value=original;
  view.rerender(<AgentBrowserSurface taskId="t1" workspaceHeader={header}/>);
  f.store.openingTab=true;
  f.value=empty;
  view.rerender(<AgentBrowserSurface taskId="t1" workspaceHeader={header}/>);
  expect(onClose).not.toHaveBeenCalled();
  f.store.openingTab=false;
  f.value=original;
  view.rerender(<AgentBrowserSurface taskId="t1" workspaceHeader={header}/>);
  expect(onClose).not.toHaveBeenCalled();
  f.value=empty;
  view.rerender(<AgentBrowserSurface taskId="t1" workspaceHeader={header}/>);
  expect(onClose).toHaveBeenCalledOnce();
});
beforeEach(()=>{vi.clearAllMocks();f.api.profileSiteStates.mockResolvedValue([{importState:"ready",profile:{id:"project-p1",scope:"project",label:"项目登录态",source:null,owner:{kind:"project",id:"p1"},partition:"persist:wy-browser-project-p1"},state:{schemaVersion:1,certificates:[],permissions:[]}}]);f.api.placement.mockResolvedValue(null);f.api.overlay.mockResolvedValue(null);f.api.focusChrome.mockResolvedValue(null);f.value={error:'',state:{taskId:'t1',projectId:'p1',activeId:'page1',recent:[],notice:null,external:null,find:{active:0,total:0},tabs:[{id:'page1',url:'about:blank',title:'新标签页',profileId:'project-p1',favicon:null,loading:false,canGoBack:false,canGoForward:false,failure:{kind:'other',url:'https://outside.example.test/',host:'outside.example.test',title:'无法访问 outside.example.test',errorName:'ERR_CERT_AUTHORITY_INVALID',recovery:null},certificate:{url:'https://outside.example.test/',host:'outside.example.test',error:'ERR_CERT_AUTHORITY_INVALID',challengeId:'nonce1'}}]}};});
afterEach(async()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();f.api.accessState.mockResolvedValue({requests:[],grants:[]});await browserAccess.refresh();browserAccess.closeGrants();});
it('shows an initial failed navigation rather than hiding it behind the blank startup page, and binds approval to its nonce',async()=>{
  render(<AgentBrowserSurface taskId="t1"/>);expect(screen.queryByRole('heading',{name:'新标签页'})).toBeNull();expect(screen.getByRole('heading',{name:'此连接不受信任'})).toBeTruthy();expect((screen.getByLabelText('网页地址') as HTMLInputElement).value).toBe('https://outside.example.test/');
  fireEvent.click(screen.getByRole('button',{name:'我了解风险，继续访问'}));await waitFor(()=>expect(f.api.continueCertificate).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',challengeId:'nonce1'}));expect(f.api.placement).not.toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)}));
});
it.each([[false,false],[false,true],[true,false],[true,true]])('preserves the original certificate warning control display (dark: %s, panel last: %s)',(dark,panelLast)=>{
  const browser=readFileSync('src/renderer/features/browser/workspace.css','utf8');
  const panel=readFileSync('src/renderer/features/agent-tasks/agent-tasks.css','utf8');
  const files=readFileSync('src/renderer/features/files/workspace-baseline.css','utf8');
  const style=document.createElement('style');style.textContent=[files,...(panelLast?[browser,panel]:[panel,browser])].join('\n');document.head.append(style);
  const wasDark=document.documentElement.classList.contains('ydark');document.documentElement.classList.toggle('ydark',dark);
  try{
    f.value.state.tabs[0].canGoBack=true;
    render(<div className="agent-right-panel" style={{fontSize:14,lineHeight:1.5,fontWeight:430,color:dark?'#f1f1f1':'#292929','--border':dark?'#303030':'#e9e9e9','--secondary':dark?'#cccccc':'#707070','--hover':dark?'#303030':'#ebebeb'} as React.CSSProperties}><AgentBrowserSurface taskId="t1"/><button>普通面板按钮</button></div>);
    expect(screen.getByRole('heading',{name:'此连接不受信任'})).toBeTruthy();
    const back=getComputedStyle(screen.getByRole('button',{name:'返回'}));
    expect([back.fontSize,back.lineHeight,back.fontWeight,back.borderWidth,back.borderStyle,back.borderRadius,back.paddingTop,back.paddingRight]).toEqual(['13px','19.5px','500','1px','solid','22px','6px','10px']);
    const risk=getComputedStyle(screen.getByRole('button',{name:'我了解风险，继续访问'}));
    expect([risk.fontSize,risk.lineHeight,risk.fontWeight,risk.borderWidth,risk.borderRadius,risk.paddingTop,risk.paddingRight,risk.color,risk.textDecoration]).toEqual(['12px','18px','430','0px','0px','0px','0px',dark?'rgb(239, 143, 132)':'rgb(192, 57, 43)','underline']);
    const ordinary=getComputedStyle(screen.getByRole('button',{name:'普通面板按钮'}));expect([ordinary.borderWidth,ordinary.borderRadius]).toEqual(['0px','5px']);
    expect(f.api.continueCertificate).not.toHaveBeenCalled();
  }finally{style.remove();document.documentElement.classList.toggle('ydark',wasDark);}
});
it('offers no certificate approval for an ordinary failed navigation',()=>{
  f.value.state.tabs[0].certificate=null;render(<AgentBrowserSurface taskId="t1"/>);expect(screen.queryByRole('button',{name:'我了解风险，继续访问'})).toBeNull();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});
it.each([[false,false],[false,true],[true,false],[true,true]])('preserves the approved navigation-failure retry control typography (dark: %s, panel last: %s)',(dark,panelLast)=>{
  const browser=readFileSync('src/renderer/features/browser/workspace.css','utf8');
  const panel=readFileSync('src/renderer/features/agent-tasks/agent-tasks.css','utf8');
  const files=readFileSync('src/renderer/features/files/workspace-baseline.css','utf8');
  const style=document.createElement('style');style.textContent=[files,...(panelLast?[browser,panel]:[panel,browser])].join('\n');document.head.append(style);
  const wasDark=document.documentElement.classList.contains('ydark');document.documentElement.classList.toggle('ydark',dark);
  try{
    f.value.state.tabs[0].certificate=null;
    render(<div className="agent-right-panel" style={{fontSize:14,lineHeight:1.5,fontWeight:430}}><AgentBrowserSurface taskId="t1"/><button>普通面板按钮</button></div>);
    const retry=getComputedStyle(screen.getByRole('button',{name:'重试'}));
    expect([retry.fontSize,retry.lineHeight,retry.fontWeight,retry.borderWidth,retry.borderRadius,retry.paddingTop,retry.paddingRight]).toEqual(['13px','19.5px','500','1px','22px','6px','10px']);
    const ordinary=getComputedStyle(screen.getByRole('button',{name:'普通面板按钮'}));expect([ordinary.borderWidth,ordinary.borderRadius]).toEqual(['0px','5px']);
  }finally{style.remove();document.documentElement.classList.toggle('ydark',wasDark);}
});
it('shows the requested URL and loading feedback on the new tab before the page commits', () => {
  const url = 'https://fixture.example/slow';
  f.value.state.tabs[0] = { ...f.value.state.tabs[0], pendingUrl: url, loading: true, failure: null, certificate: null };
  render(<AgentBrowserSurface taskId="t1" />);
  expect((screen.getByRole('textbox', { name: '网页地址' }) as HTMLInputElement).value).toBe(url);
  expect(screen.getByRole('status', { name: '网页正在加载' })).toBeTruthy();
  expect(screen.queryByLabelText('新标签页')).toBeNull();
});
it('retains the failed destination in the address bar when the new tab has no committed page', () => {
  f.value.state.tabs[0].certificate = null;
  render(<AgentBrowserSurface taskId="t1" />);
  expect((screen.getByRole('textbox', { name: '网页地址' }) as HTMLInputElement).value).toBe('https://outside.example.test/');
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});
it('restores the last committed address after an ordinary failed navigation, while retaining the failure explanation',()=>{
  f.value.state.tabs[0].certificate=null;f.value.state.tabs[0].url='https://previous.example.test/committed';
  render(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.getByRole('heading',{name:'无法访问 outside.example.test'})).toBeTruthy();
  expect((screen.getByLabelText('网页地址') as HTMLInputElement).value).toBe('https://previous.example.test/committed');
  expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});
it.each(['javascript:alert(1)','data:text/html,not-a-navigation'])('keeps invalid input selected with an error surface, without replacing the current document: %s',async address=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const url='https://previous.example.test/committed';
  f.value.state.tabs[0]={...f.value.state.tabs[0],url,failure:null,certificate:null};
  f.api.navigate.mockResolvedValue({...f.value.state,notice:'请输入有效的 http(s) 或 localhost 地址'});
  f.api.overlay.mockResolvedValue('data:image/png;base64,parked-old-page');
  render(<AgentBrowserSurface taskId="t1"/>);
  const input=screen.getByLabelText('网页地址') as HTMLInputElement;input.focus();
  fireEvent.change(input,{target:{value:address}});fireEvent.submit(input.form!);
  expect(input.value).toBe(address);expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);expect(input.selectionEnd).toBe(address.length);
  expect(screen.getByRole('heading',{name:'请输入有效的 http(s) 或 localhost 地址'})).toBeTruthy();
  expect(f.value.state.tabs[0].url).toBe(url);
  await waitFor(()=>expect(f.api.navigate).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',address}));
  expect(f.api.placement.mock.calls.every(([request])=>request.rect===null)).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  await screen.findByRole('menuitem',{name:'浏览器设置'});
  expect(screen.queryByAltText('网页预览')).toBeNull();
});
it('dismisses an old input error when the host commits a different URL',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  f.value.state.tabs[0]={...f.value.state.tabs[0],url:'https://previous.example.test/',failure:null,certificate:null};
  f.api.navigate.mockResolvedValue(f.value.state);
  const view=render(<AgentBrowserSurface taskId="t1"/>);
  const input=screen.getByLabelText('网页地址') as HTMLInputElement;
  fireEvent.change(input,{target:{value:'javascript:alert(1)'}});fireEvent.submit(input.form!);
  expect(screen.getByRole('heading',{name:'请输入有效的 http(s) 或 localhost 地址'})).toBeTruthy();
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],url:'https://next.example.test/committed'}]}};
  view.rerender(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.queryByRole('heading',{name:'请输入有效的 http(s) 或 localhost 地址'})).toBeNull();
  expect(input.value).toBe('https://next.example.test/committed');
});
it('closes downloads with Escape after the focused menu item is removed, without moving focus',async()=>{
  f.value.state.downloads=[{id:'d1',taskId:'t1',pageId:'page1',url:'https://fixture.example/orders',name:'订单.csv',path:'/synthetic/Downloads/订单.csv',destination:'downloads',state:'done',receivedBytes:24,totalBytes:24,updatedAt:Date.now(),error:null}];
  render(<AgentBrowserSurface taskId="t1"/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  const item=await screen.findByRole('menuitem',{name:'下载'});item.focus();fireEvent.click(item);
  await screen.findByRole('region',{name:'下载'});expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(document.body,{key:'Escape',code:'Escape',keyCode:27});
  await waitFor(()=>expect(screen.queryByRole('region',{name:'下载'})).toBeNull());
  expect(f.api.overlay).toHaveBeenLastCalledWith(expect.objectContaining({taskId:'t1',tabId:'page1',open:false,owner:expect.any(String),instance:expect.any(String)}));
  expect(document.activeElement).toBe(document.body);
  expect(fireEvent.keyDown(document.body,{key:'Escape',code:'Escape'})).toBe(true);
});
it('handles the first body Escape as soon as downloads commit, before passive effects',async()=>{
  f.value.state.downloads=[{id:'d1',taskId:'t1',pageId:'page1',url:'https://fixture.example/orders',name:'订单.csv',path:'/synthetic/Downloads/订单.csv',destination:'downloads',state:'done',receivedBytes:24,totalBytes:24,updatedAt:Date.now(),error:null}];
  const captured:{event:KeyboardEvent|null;focus:Element|null}={event:null,focus:null};
  render(<Profiler id="download-first-input" onRender={()=>{
    if(captured.event||!document.querySelector('.bw-downloads'))return;
    captured.focus=document.activeElement;
    captured.event=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true});
    document.body.dispatchEvent(captured.event);
  }}><AgentBrowserSurface taskId="t1"/></Profiler>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  const item=await screen.findByRole('menuitem',{name:'下载'});item.focus();fireEvent.click(item);
  await waitFor(()=>expect(captured.event).not.toBeNull());
  expect(captured.focus).toBe(document.body);expect(captured.event?.defaultPrevented).toBe(true);
  await waitFor(()=>expect(screen.queryByRole('region',{name:'下载'})).toBeNull());
  expect(f.api.overlay).toHaveBeenLastCalledWith(expect.objectContaining({taskId:'t1',tabId:'page1',open:false,owner:expect.any(String),instance:expect.any(String)}));
  expect(document.activeElement).toBe(document.body);
  expect(fireEvent.keyDown(document.body,{key:'Escape',code:'Escape'})).toBe(true);
});
it('renders activity and routes pause/resume as trusted user actions without blocking manual navigation',async()=>{
  f.value.state.tabs[0].agentActive=true;f.value.state.tabs[0].agentRunning=true;const view=render(<AgentBrowserSurface taskId="t1"/>);expect(screen.getByText('Agent 正在操作此页面')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'暂停 Agent'}));expect(f.api.pause).toHaveBeenCalledWith({taskId:'t1',paused:true});
  f.value={...f.value,state:{...f.value.state,paused:true}};view.rerender(<AgentBrowserSurface taskId="t1"/>);expect(screen.getByText(/已暂停 Agent 的浏览器操作/)).toBeTruthy();expect(screen.queryByRole('button',{name:'暂停 Agent'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'恢复 Agent'}));expect(f.api.pause).toHaveBeenLastCalledWith({taskId:'t1',paused:false});expect((screen.getByLabelText('网页地址') as HTMLInputElement).disabled).toBe(false);
});
it.each([false,true])('preserves the confirmed browser activity pills in either unified panel stylesheet order (panel last: %s)',panelLast=>{
  const browser=readFileSync('src/renderer/features/browser/workspace.css','utf8');
  const panel=readFileSync('src/renderer/features/agent-tasks/agent-tasks.css','utf8');
  const files=readFileSync('src/renderer/features/files/workspace-baseline.css','utf8');
  const style=document.createElement('style');style.textContent=[files,...(panelLast?[browser,panel]:[panel,browser])].join('\n');document.head.append(style);
  try{
    f.value.state.tabs[0].agentActive=true;f.value.state.tabs[0].agentRunning=true;
    const surface=()=> <div className="agent-right-panel" style={{fontSize:14,lineHeight:1.5,color:'#292929','--border':'#e9e9e9','--text':'#292929','--hover':'#ebebeb'} as React.CSSProperties}><AgentBrowserSurface taskId="t1"/><button>普通面板按钮</button></div>;
    const view=render(surface());
    const pillStyle=(name:string)=>getComputedStyle(screen.getByRole('button',{name}));
    const controlShape=(s:CSSStyleDeclaration)=>[s.fontSize,s.fontWeight,s.borderWidth,s.borderStyle,s.borderRadius,s.paddingTop,s.paddingRight,s.gap];
    const originallyConfirmedShape=['12px','500','1px','solid','22px','6px','10px','5px'];
    expect(controlShape(pillStyle('暂停 Agent'))).toEqual(originallyConfirmedShape);
    f.value={...f.value,state:{...f.value.state,paused:true}};view.rerender(surface());
    const resume=pillStyle('恢复 Agent');
    expect(controlShape(resume)).toEqual(originallyConfirmedShape);
    expect([resume.color,resume.borderColor]).toEqual(['rgb(154, 98, 0)','rgb(227, 181, 90)']);
    const ordinary=pillStyle('普通面板按钮');expect([ordinary.borderWidth,ordinary.borderRadius]).toEqual(['0px','5px']);
  }finally{style.remove();}
});
it('displays the host activity deadline across remounts and tab switches without extending its lifetime',async()=>{
  vi.useFakeTimers();vi.setSystemTime(10000);
  f.value.state.tabs[0]={...f.value.state.tabs[0],agentActive:true,agentRunning:false,agentHoldUntil:30000};
  let view=render(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 20 秒后清除标记')).toBeTruthy();
  await act(async()=>vi.advanceTimersByTime(7400));
  expect(screen.getByText('Agent 最近操作过此页面 · 13 秒后清除标记')).toBeTruthy();
  view.unmount();await act(async()=>vi.advanceTimersByTime(3000));
  view=render(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 10 秒后清除标记')).toBeTruthy();
  f.value={...f.value,state:{...f.value.state,activeId:'page2',tabs:[...f.value.state.tabs,{...f.value.state.tabs[0],id:'page2',agentHoldUntil:60000}]}};
  view.rerender(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 40 秒后清除标记')).toBeTruthy();
  f.value={...f.value,state:{...f.value.state,activeId:'page1'}};
  view.rerender(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.getByText('Agent 最近操作过此页面 · 10 秒后清除标记')).toBeTruthy();
  await act(async()=>vi.advanceTimersByTime(10000));
  expect(screen.getByText('Agent 最近操作过此页面 · 0 秒后清除标记')).toBeTruthy();
  expect(f.value.state.tabs[0].agentActive).toBe(true);
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],agentActive:false,agentHoldUntil:null}]}};
  view.rerender(<AgentBrowserSurface taskId="t1"/>);
  expect(screen.queryByText(/Agent 最近操作过此页面/)).toBeNull();
});
it('waits for native overlay parking acknowledgement before exposing a scoped authorization dialog',async()=>{
  render(<AgentBrowserSurface taskId="t1"/>);let parked!:(value:null)=>void;f.api.overlay.mockImplementationOnce(()=>new Promise(resolve=>{parked=resolve;}));f.api.accessState.mockResolvedValue({requests:[{id:'r1',runId:'run1',projectId:'p1',requesterTaskId:'t2',targetTaskId:'t1',requesterTitle:'Caller',targetTitle:'Target',projectName:'Project',mode:'observe',requestedMode:'observe',createdAt:Date.now(),expiresAt:Date.now()+60000}],grants:[]});
  await act(async()=>browserAccess.refresh());expect(screen.queryByRole('dialog',{name:'Agent 请求访问其他任务的网页'})).toBeNull();expect(f.api.overlay).toHaveBeenCalledWith(expect.objectContaining({taskId:'t1',tabId:'page1',open:true,owner:expect.any(String),instance:expect.any(String)}));await act(async()=>parked(null));expect(screen.getByRole('dialog',{name:'Agent 请求访问其他任务的网页'})).toBeTruthy();expect(f.api.focusChrome).not.toHaveBeenCalled();
});
// The host owns the actual parking holds. A close without an instance means
// the legacy owner-wide close; an exact close may not remove a newer hold.
function overlayHost(defer=false){
  type Input={taskId:string;tabId:string;open:boolean;owner?:string;instance?:string};
  const held=new Map<string,{instance?:string}>();
  const requests:{input:Input;resolve:(value:string|null)=>void}[]=[];
  f.api.overlay.mockImplementation((input:Input)=>{
    const owner=input.owner??'surface';
    if(!input.open){if(input.instance===undefined||held.get(owner)?.instance===input.instance)held.delete(owner);return Promise.resolve(null);}
    held.set(owner,{instance:input.instance});
    if(!defer)return Promise.resolve('data:image/png;base64,parked');
    return new Promise<string|null>(resolve=>requests.push({input,resolve}));
  });
  return {held,requests};
}
it('keeps the latest real menu parking hold when an earlier capture returns late',async()=>{
  const {held,requests}=overlayHost(true);
  render(<AgentBrowserSurface taskId="t1"/>);
  const trigger=screen.getByRole('button',{name:'浏览器菜单'});
  fireEvent.click(trigger);fireEvent.click(trigger);
  await waitFor(()=>expect(requests.length).toBe(2));
  await act(async()=>requests[1].resolve('data:image/png;base64,new'));
  expect(screen.getByRole('menu')).toBeTruthy();expect(held.size).toBe(1);
  await act(async()=>requests[0].resolve('data:image/png;base64,old'));
  expect(screen.getByRole('menu')).toBeTruthy();expect(held.size).toBe(1);
  fireEvent.click(screen.getByRole('button',{name:'关闭菜单'}));
  await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());expect(held.size).toBe(0);
});
it('releasing an independent access surface does not release the visible browser menu hold',async()=>{
  const {held}=overlayHost();render(<AgentBrowserSurface taskId="t1"/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));await screen.findByRole('menu');
  await act(async()=>browserAccess.openGrants());
  await waitFor(()=>expect(held.size).toBe(2));
  act(()=>browserAccess.closeGrants());
  await waitFor(()=>expect(held.size).toBe(1));expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'关闭菜单'}));
  await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());expect(held.size).toBe(0);
});
it('does not hide or release a re-entered menu when the old close acknowledgement returns',async()=>{
  type Input={taskId:string;tabId:string;open:boolean;owner?:string;instance?:string};
  const held=new Map<string,string|undefined>();let delayed:(()=>void)|undefined;
  let holdFirstClose=true;
  f.api.overlay.mockImplementation((input:Input)=>{
    const owner=input.owner??'surface';
    const release=()=>{if(input.instance===undefined||held.get(owner)===input.instance)held.delete(owner);};
    if(input.open){held.set(owner,input.instance);return Promise.resolve('data:image/png;base64,parked');}
    if(holdFirstClose){holdFirstClose=false;return new Promise<null>(resolve=>{delayed=()=>{release();resolve(null);};});}
    release();return Promise.resolve(null);
  });
  const first=f.value,second={...first,state:{...first.state,activeId:'page2',tabs:[...first.state.tabs,{...first.state.tabs[0],id:'page2'}]}};
  const view=render(<AgentBrowserSurface taskId="t1"/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));await screen.findByRole('menu');
  fireEvent.click(screen.getByRole('button',{name:'关闭菜单'}));await waitFor(()=>expect(delayed).toBeDefined());
  f.value=second;view.rerender(<AgentBrowserSurface taskId="t1"/>);
  f.value=first;view.rerender(<AgentBrowserSurface taskId="t1"/>);
  await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));await screen.findByRole('menu');
  await act(async()=>delayed!());
  expect(screen.getByRole('menu')).toBeTruthy();expect(held.size).toBe(1);
  fireEvent.click(screen.getByRole('button',{name:'关闭菜单'}));
  await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());expect(held.size).toBe(0);
});
it('keeps native page geometry constant when activity starts or expires',async()=>{
  vi.stubGlobal('ResizeObserver',class{constructor(private callback:()=>void){}observe(){this.callback();}disconnect(){}});vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>window.setTimeout(callback,0));vi.stubGlobal('cancelAnimationFrame',(id:number)=>window.clearTimeout(id));vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(10,20,500,400));
  f.value.state.tabs[0]={...f.value.state.tabs[0],url:'https://fixture.example/',failure:null,certificate:null};const view=render(<AgentBrowserSurface taskId="t1"/>);const placed={taskId:'t1',tabId:'page1',rect:{x:12,y:22,width:496,height:396}};await waitFor(()=>expect(f.api.placement).toHaveBeenCalledWith(expect.objectContaining(placed)));const count=f.api.placement.mock.calls.length;
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],agentActive:true}]}};view.rerender(<AgentBrowserSurface taskId="t1"/>);expect(screen.getByTestId('browser-viewport').classList.contains('bw-agent-glow')).toBe(true);expect(f.api.placement.mock.calls.length).toBe(count);
  f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],agentActive:false}]}};view.rerender(<AgentBrowserSurface taskId="t1"/>);expect(screen.getByTestId('browser-viewport').classList.contains('bw-agent-glow')).toBe(false);expect(f.api.placement.mock.calls.filter(([input])=>input.rect!==null).every(([input])=>JSON.stringify({taskId:input.taskId,tabId:input.tabId,rect:input.rect})===JSON.stringify(placed))).toBe(true);
});

it('shows the current host profile and opens its management through the badge after parking the native page',async()=>{
  render(<AgentBrowserSurface taskId="t1"/>);
  const badge=await screen.findByRole('button',{name:'项目登录态'});expect(badge.title).toBe('当前页面的登录态：项目登录态');
  fireEvent.click(badge);await waitFor(()=>expect(f.api.overlay).toHaveBeenCalledWith(expect.objectContaining({taskId:'t1',tabId:'page1',open:true,owner:expect.any(String),instance:expect.any(String)})));
});
it('does not display an obsolete profile response after switching the active profile',async()=>{
  let resolveOld!:(value:unknown[])=>void;f.api.profileSiteStates.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  const view=render(<AgentBrowserSurface taskId="t1"/>);f.value={...f.value,state:{...f.value.state,tabs:[{...f.value.state.tabs[0],profileId:'isolated-new'}]}};
  f.api.profileSiteStates.mockResolvedValueOnce([{profile:{id:'isolated-new',scope:'isolated',label:'独立账号'}}]);view.rerender(<AgentBrowserSurface taskId="t1"/>);
  expect((await screen.findByRole('button',{name:'独立登录态'})).title).toBe('当前页面的登录态：独立账号');
  await act(async()=>resolveOld([{profile:{id:'project-p1',scope:'project',label:'过期账号'}}]));expect(screen.queryByTitle('当前页面的登录态：过期账号')).toBeNull();expect(screen.getByRole('button',{name:'独立登录态'}).title).toBe('当前页面的登录态：独立账号');
});
it('keeps an unavailable profile unknown and recovers through explicit management',async()=>{
  f.api.profileSiteStates.mockRejectedValueOnce(Error('temporarily unavailable'));render(<AgentBrowserSurface taskId="t1"/>);
  const badge=await screen.findByTitle('无法读取当前登录态，点击管理');expect(badge.textContent).toBe('登录态');expect(screen.queryByRole('button',{name:'项目登录态'})).toBeNull();
  fireEvent.click(badge);await waitFor(()=>expect(f.api.overlay).toHaveBeenCalledWith(expect.objectContaining({taskId:'t1',tabId:'page1',open:true,owner:expect.any(String),instance:expect.any(String)})));
});
it('shows the full hovered browser tab title and address through the unified header without leaving the active native page exposed',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent',class extends MouseEvent{readonly pointerType:string;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerType=init.pointerType??'mouse';}});
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const current={...f.value.state.tabs[0],url:'https://fixture.example/active',title:'当前网页',failure:null,certificate:null};
  const title='完整标题 · '+ '长网页标题 '.repeat(50)+'结束';
  const url='https://fixture.example/'+ 'long-address-'.repeat(100)+'end';
  f.value.state.tabs=[current,{...current,id:'page2',url,title}];
  let captured!:(image:string)=>void;
  f.api.overlay.mockImplementationOnce(()=>new Promise(resolve=>{captured=resolve;}));
  const target=document.createElement('div');document.body.appendChild(target);
  const header={target,active:true,onActivate:vi.fn(),onClose:vi.fn()};
  try{
    const view=render(<AgentBrowserSurface taskId="t1" workspaceHeader={header}/>);
    const tab=screen.getByRole('tab',{name:title});
    fireEvent.pointerEnter(tab,{pointerType:'mouse'});
    await act(async()=>{vi.advanceTimersByTime(499);});expect(f.api.overlay).not.toHaveBeenCalled();
    await act(async()=>{vi.advanceTimersByTime(1);});
    const opened=f.api.overlay.mock.calls[0]?.[0];
    expect(opened).toMatchObject({taskId:'t1',tabId:'page1',open:true,owner:expect.stringMatching(/^tab-tooltip:/)});
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(async()=>captured('data:image/png;base64,cGFnZQ=='));
    expect(screen.getByRole('tooltip').textContent).toBe(title+'\n'+url);
    expect(tab.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    expect(screen.getByAltText('网页预览').getAttribute('src')).toBe('data:image/png;base64,cGFnZQ==');
    fireEvent.keyDown(window,{key:'Escape'});await act(async()=>{vi.advanceTimersByTime(0);});
    expect(screen.queryByRole('tooltip')).toBeNull();expect(f.api.overlay).toHaveBeenLastCalledWith({...opened,open:false});
    view.rerender(<AgentBrowserSurface taskId="t1" workspaceHeader={{...header,active:false}}/>);
    fireEvent.pointerEnter(screen.getByRole('tab',{name:title}),{pointerType:'mouse'});
    await act(async()=>{vi.advanceTimersByTime(500);});expect(screen.queryByRole('tooltip')).toBeNull();
  }finally{target.remove();}
});
it.each(['importing','needs-attention'] as const)('keeps the %s recovery explanation visible when a menu captures the parked page',async importState=>{
  f.value.state.tabs[0]={...f.value.state.tabs[0],url:'https://fixture.example/',failure:null,certificate:null,importState};
  f.api.overlay.mockResolvedValue('data:image/png;base64,parked-old-page');
  render(<AgentBrowserSurface taskId="t1"/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  await screen.findByRole('menuitem',{name:'导入 Chrome／Edge 登录态'});
  expect(screen.queryByAltText('网页预览')).toBeNull();
  if(importState==='importing')expect(screen.getByRole('heading',{name:'正在导入登录态'})).toBeTruthy();
  else expect(screen.getByText(/当前登录态需要处理/)).toBeTruthy();
  expect(screen.getByRole('menuitem',{name:'导入 Chrome／Edge 登录态'}).hasAttribute('disabled')).toBe(true);
  if(importState==='needs-attention')expect(screen.getByRole('button',{name:'去处理'})).toBeTruthy();
});

it('keeps a common shell modal above the native browser, shows its captured page and restores placement only after the modal lease closes',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:10,y:20,left:10,top:20,right:410,bottom:320,width:400,height:300,toJSON(){}});
  f.value.state.tabs[0]={...f.value.state.tabs[0],url:'https://fixture.example/current',failure:null,certificate:null};
  f.api.overlay.mockResolvedValue('data:image/jpeg;base64,modal-page');
  render(<AgentBrowserSurface taskId="t1"/>);
  await waitFor(()=>expect(f.api.placement).toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)})));
  let lease!:ReturnType<typeof holdNativeDialog>;await act(async()=>{lease=holdNativeDialog();await lease.ready;});
  await waitFor(()=>expect(screen.getByAltText('网页预览').getAttribute('src')).toBe('data:image/jpeg;base64,modal-page'));
  expect(f.api.placement).toHaveBeenLastCalledWith(expect.objectContaining({rect:null}));
  f.api.placement.mockClear();fireEvent(window,new Event('resize'));await act(async()=>{});expect(f.api.placement).not.toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)}));
  await act(async()=>lease.release());
  await waitFor(()=>expect(f.api.placement).toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)})));
  expect(screen.queryByAltText('网页预览')).toBeNull();
});
