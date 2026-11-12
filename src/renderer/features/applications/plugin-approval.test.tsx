// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PluginWriteDisplay} from '@shared/plugin-approval';
import {PluginApprovalPanel} from './plugin-approval';
const api=vi.hoisted(()=>({pluginApprovalList:vi.fn(),pluginApprovalDecide:vi.fn(),listener:undefined as ((change:unknown)=>void)|undefined}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:api},events:{on:(_event:unknown,listener:(change:unknown)=>void)=>{api.listener=listener;return()=>{api.listener=undefined;};}}}));
const ok=(value:unknown)=>({ok:true,value});
let client:QueryClient,review:PluginWriteDisplay;
function mount(taskId='task1',ptyId='pty1'){
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><PluginApprovalPanel taskId={taskId} ptyId={ptyId}/></QueryClientProvider>);
}
beforeEach(()=>{
  vi.clearAllMocks();review={id:'00000000-0000-4000-8000-000000000001',operationId:'00000000-0000-4000-8000-000000000002',runId:'run1',taskId:'task1',ptyId:'pty1',projectId:'p1',appId:'demo-tracker',displayName:'Demo Tracker',version:'0.1.0',packageHash:'a'.repeat(64),capability:'demo-tracker.items.add',title:'新增待办',permission:'demo-tracker.write',semantics:'write',targets:[{slot:'tracker',connectionId:'account-one',name:'测试账号一'}],input:{title:'<img src=x onerror=alert(1)>'},createdAt:Date.now(),expiresAt:Date.now()+60000,reviewHash:'b'.repeat(64),displayReceiptId:'00000000-0000-4000-8000-000000000003'};
  api.pluginApprovalList.mockImplementation(target=>Promise.resolve(ok(target.taskId==='task1'&&target.ptyId==='pty1'?[review]:[])));api.pluginApprovalDecide.mockResolvedValue(ok({id:review.id,decision:'allowed'}));
});
afterEach(()=>{cleanup();client?.clear();vi.useRealTimers();});
describe('per-terminal explicit plugin write approval',()=>{
  it('shows the concrete operation/account/input as inert text and never approves or steals focus on render',async()=>{
    const terminal=document.createElement('textarea');document.body.append(terminal);terminal.focus();mount();await screen.findByRole('dialog',{name:'确认本次插件写操作'});
    expect(document.activeElement).toBe(terminal);expect(screen.getByText(/测试账号一/)).toBeTruthy();expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();expect(document.querySelector('img')).toBeNull();expect(api.pluginApprovalDecide).not.toHaveBeenCalled();terminal.remove();
  });
  it.each([true,false])('submits only the displayed one-time receipt and matching terminal target; allow=%s',async allow=>{
    mount();await screen.findByRole('dialog');api.pluginApprovalList.mockResolvedValue(ok([]));fireEvent.click(screen.getByRole('button',{name:allow?'允许这一次':'拒绝'}));
    await waitFor(()=>expect(api.pluginApprovalDecide).toHaveBeenCalledExactlyOnceWith({taskId:'task1',ptyId:'pty1',id:review.id,displayReceiptId:review.displayReceiptId,reviewHash:review.reviewHash,allow}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('does not approve on Enter in the terminal and uses Escape inside the request as a rejection',async()=>{
    const terminal=document.createElement('textarea');document.body.append(terminal);mount();const dialog=await screen.findByRole('dialog');fireEvent.keyDown(terminal,{key:'Enter'});expect(api.pluginApprovalDecide).not.toHaveBeenCalled();fireEvent.keyDown(dialog,{key:'Escape'});await waitFor(()=>expect(api.pluginApprovalDecide).toHaveBeenCalledWith(expect.objectContaining({allow:false})));terminal.remove();
  });
  it('prevents a duplicate decision while the host is processing it',async()=>{
    let done!:(value:unknown)=>void;api.pluginApprovalDecide.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));mount();await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'允许这一次'}));fireEvent.click(screen.getByRole('button',{name:'正在处理…'}));expect(api.pluginApprovalDecide).toHaveBeenCalledTimes(1);
    api.pluginApprovalList.mockResolvedValue(ok([]));await act(async()=>done(ok({id:review.id,decision:'allowed'})));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('disables an expired allow button without extending the deadline or sending a decision',async()=>{
    review.expiresAt=Date.now()-1;mount();await screen.findByRole('dialog');expect((screen.getByRole('button',{name:'允许这一次'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'允许这一次'}));expect(api.pluginApprovalDecide).not.toHaveBeenCalled();
  });
  it('does not show another task/PTY request and refreshes only the relevant task notification',async()=>{
    mount('task2','pty2');await waitFor(()=>expect(api.pluginApprovalList).toHaveBeenCalledTimes(1));expect(screen.queryByRole('dialog')).toBeNull();
    await act(async()=>{api.listener?.({kind:'plugin-approval',taskId:'task1'});});expect(api.pluginApprovalList).toHaveBeenCalledTimes(1);
    await act(async()=>{api.listener?.({kind:'plugin-approval',taskId:'task2'});});expect(api.pluginApprovalList).toHaveBeenCalledTimes(2);
  });
  it('shows host authorization failure and never silently retries an allow decision',async()=>{
    api.pluginApprovalDecide.mockResolvedValueOnce({ok:false,code:'INTENT_STALE',message:'原连接已变化，请重新发起操作'});mount();await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'允许这一次'}));await screen.findByRole('alert');expect(screen.getByText('原连接已变化，请重新发起操作')).toBeTruthy();expect(api.pluginApprovalDecide).toHaveBeenCalledTimes(1);
  });
  it('makes an unavailable review channel visible with a manual retry',async()=>{
    api.pluginApprovalList.mockResolvedValueOnce({ok:false,code:'SOURCE_UNAVAILABLE',message:'界面通道不可用'});mount();await screen.findByRole('alert');api.pluginApprovalList.mockResolvedValue(ok([]));fireEvent.click(screen.getByRole('button',{name:'重试'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(api.pluginApprovalDecide).not.toHaveBeenCalled();
  });
});
