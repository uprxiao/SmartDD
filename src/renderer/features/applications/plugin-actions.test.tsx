// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {PluginActionButton} from './plugin-actions';
const m=vi.hoisted(()=>({prepare:vi.fn(),review:vi.fn(),release:vi.fn(),open:vi.fn(),bind:vi.fn(),insert:vi.fn(),releaseBinding:vi.fn(),newTask:vi.fn(),openTask:vi.fn(),done:vi.fn(),tasks:[] as any[],terminals:new Map<string,string>()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{pluginPrepareAction:m.prepare,pluginReviewAction:m.review,pluginReleaseAction:m.release,pluginOpenAction:m.open,terminalBind:m.bind,terminalInsert:m.insert,terminalRelease:m.releaseBinding}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{get tasks(){return m.tasks;},get byId(){return new Map(m.tasks.map(t=>[t.id,t]));},get current(){return null;},terminals:m.terminals}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{prepareApplicationTask:m.newTask,openTask:m.openTask,currentViewId:'applications',currentTaskId:null}}));
vi.mock('@renderer/features/files/terminal-context/store',()=>({currentFileTerminal:()=>null}));
const request={receiptId:'a0000000-0000-4000-8000-000000000001',actionIndex:0,row:{receiptId:'a0000000-0000-4000-8000-000000000001',index:0}};
const value={id:'b0000000-0000-4000-8000-000000000001',appId:'demo',projectId:'p1',title:'插入引用',kind:'insertTerminal' as const,text:'Host original reference',closeOnDone:true,expiresAt:9999999999999};
const ok=(value:unknown)=>({ok:true,value});
const mount=()=>render(<PluginActionButton title="插入引用" request={request} onDone={m.done}/>);
beforeEach(()=>{
  vi.clearAllMocks();m.tasks=[{id:'t1',title:'本项目运行中',projectId:'p1',ptyId:'pty1',archivedAt:null},{id:'t2',title:'另一个项目',projectId:'p2',ptyId:'pty2',archivedAt:null},{id:'t3',title:'已停止',projectId:'p1',ptyId:null,archivedAt:null}];m.terminals.clear();m.terminals.set('t1','pty1');m.terminals.set('t2','pty2');
  m.prepare.mockResolvedValue(ok(value));m.review.mockResolvedValue(ok(value));m.release.mockResolvedValue(ok({released:true}));m.open.mockResolvedValue(ok({opened:true}));m.bind.mockResolvedValue(ok({id:'binding',taskId:'t1',ptyId:'pty1',projectId:'p1',runId:'run',text:value.text,expiresAt:9999999999999}));m.insert.mockImplementation(input=>Promise.resolve(ok({state:'inserted',operationId:input.operationId})));m.releaseBinding.mockResolvedValue(ok({released:true}));
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});
describe('declarative action UI with explicit terminal choice',()=>{
  it('lists only this project’s running terminals, never selects one automatically, and sends only a host action identity',async()=>{
    mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));const dialog=await screen.findByRole('dialog',{name:'选择插入会话'});expect(within(dialog).queryByRole('option',{name:'另一个项目'})).toBeNull();expect(within(dialog).queryByRole('option',{name:'已停止'})).toBeNull();expect(m.bind).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();expect(within(dialog).queryByRole('button',{name:'新建会话并插入'})).toBeNull();
    fireEvent.change(within(dialog).getByRole('combobox',{name:'插件引用目标会话'}),{target:{value:'t1'}});fireEvent.click(within(dialog).getByRole('button',{name:'插入所选会话'}));await waitFor(()=>expect(m.done).toHaveBeenCalledWith(true,true));
    expect(m.prepare).toHaveBeenCalledWith(request);expect(m.bind).toHaveBeenCalledWith({projectId:'p1',target:{taskId:'t1',ptyId:'pty1'},source:{kind:'pluginAction',appId:'demo',actionId:value.id}});expect(m.insert).toHaveBeenCalledTimes(1);expect(m.newTask).not.toHaveBeenCalled();expect(m.release).toHaveBeenCalledWith(value.id);
  });
  it('prepares a new composer only after an explicit click and a fresh host check; never launches or sends a task',async()=>{
    m.tasks=[];mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));await screen.findByText('本项目没有运行中的会话。');expect(m.newTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'新建会话并插入'}));await waitFor(()=>expect(m.newTask).toHaveBeenCalledWith('p1',value.text));expect(m.review).toHaveBeenCalledWith(value.id);expect(m.bind).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();
  });
  it('refuses stale composer input and cancels without writing or choosing a replacement',async()=>{
    m.tasks=[];m.review.mockResolvedValue({ok:false,code:'APP_NOT_ENABLED',message:'插件已停用'});mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));fireEvent.click(await screen.findByRole('button',{name:'新建会话并插入'}));await screen.findByText('插件已停用');expect(m.newTask).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'取消'}));await waitFor(()=>expect(m.release).toHaveBeenCalledWith(value.id));
  });
  it('opens a host-resolved URL only once per click sequence, without passing an arbitrary URL through IPC',async()=>{
    m.prepare.mockResolvedValue(ok({...value,kind:'openUrl',url:'https://example.invalid/item'}));mount();const button=screen.getByRole('button',{name:'插入引用'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(m.done).toHaveBeenCalledWith(true,false));expect(m.prepare).toHaveBeenCalledTimes(1);expect(m.open).toHaveBeenCalledTimes(1);expect(m.open).toHaveBeenCalledWith(value.id);expect(m.insert).not.toHaveBeenCalled();
  });
  it('keeps a lost open acknowledgement unknown without retry and releases the original handle',async()=>{
    m.prepare.mockResolvedValue(ok({...value,kind:'openUrl',url:'https://example.invalid/item'}));m.open.mockRejectedValue(new Error('transport lost'));mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));await screen.findByText('打开结果未确认，不会自动重试。');fireEvent.click(screen.getByRole('button',{name:'插入引用'}));expect(m.open).toHaveBeenCalledTimes(1);expect(m.prepare).toHaveBeenCalledTimes(1);expect(m.done).not.toHaveBeenCalled();expect(m.release).toHaveBeenCalledWith(value.id);
  });
  it('releases a late prepared action after unmount without opening a URL or inserting text',async()=>{
    let finish!:(value:unknown)=>void;m.prepare.mockImplementation(()=>new Promise(r=>finish=r));const view=mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));view.unmount();finish(ok(value));await waitFor(()=>expect(m.release).toHaveBeenCalledWith(value.id));expect(m.open).not.toHaveBeenCalled();expect(m.bind).not.toHaveBeenCalled();expect(m.newTask).not.toHaveBeenCalled();
  });
});
