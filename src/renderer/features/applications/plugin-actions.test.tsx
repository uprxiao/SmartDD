// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {PluginActionButton} from './plugin-actions';
import {agentComposerTargets} from '../agent-tasks/composer-target';
const m=vi.hoisted(()=>({prepare:vi.fn(),review:vi.fn(),release:vi.fn(),open:vi.fn(),reference:vi.fn(),insert:vi.fn(),newTask:vi.fn(),done:vi.fn(),tasks:[] as {taskId:string;title:string;projectId:string}[],nav:{currentViewId:'apps',currentAgentTaskId:null as string|null}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{pluginPrepareAction:m.prepare,pluginReviewAction:m.review,pluginReleaseAction:m.release,pluginOpenAction:m.open},agentTasks:{applicationReference:m.reference}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{get tasks(){return m.tasks;}}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{
  prepareApplicationTask:m.newTask,
  openAgentTask:(id:string)=>{m.nav.currentAgentTaskId=id;m.nav.currentViewId='agentTask';},
  get currentViewId(){return m.nav.currentViewId;},
  get currentAgentTaskId(){return m.nav.currentAgentTaskId;},
}}));
const request={receiptId:'a0000000-0000-4000-8000-000000000001',actionIndex:0,row:{receiptId:'a0000000-0000-4000-8000-000000000001',index:0}};
const value={id:'b0000000-0000-4000-8000-000000000001',appId:'demo',projectId:'p1',title:'插入引用',kind:'insertTerminal' as const,text:'Host original reference',closeOnDone:true,expiresAt:9999999999999};
const ok=(value:unknown)=>({ok:true,value});
const mount=()=>render(<PluginActionButton title="插入引用" request={request} onDone={m.done}/>);
beforeEach(()=>{
  vi.clearAllMocks();m.nav.currentViewId='apps';m.nav.currentAgentTaskId=null;
  m.tasks=[{taskId:'t1',title:'本项目运行中',projectId:'p1'},{taskId:'t2',title:'另一个项目',projectId:'p2'},{taskId:'t3',title:'已停止',projectId:'p1'}];
  m.prepare.mockResolvedValue(ok(value));m.review.mockResolvedValue(ok(value));m.release.mockResolvedValue(ok({released:true}));m.open.mockResolvedValue(ok({opened:true}));
  m.reference.mockResolvedValue({taskId:'t1',projectId:'p1',text:value.text});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});
describe('declarative action UI with explicit Agent task choice',()=>{
  it('offers only the current project’s tasks and inserts a host-resolved draft reference only after selection',async()=>{
    const off=agentComposerTargets.register({taskId:'t1',projectId:'p1',insert:m.insert,focus:()=>{}});
    try {
      mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));
      const dialog=await screen.findByRole('dialog',{name:'选择插入会话'});
      expect(within(dialog).queryByRole('option',{name:'另一个项目'})).toBeNull();
      expect(within(dialog).getByRole('option',{name:'已停止'})).toBeTruthy();
      expect(m.reference).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();
      fireEvent.change(within(dialog).getByRole('combobox',{name:'插件引用目标任务'}),{target:{value:'t1'}});
      fireEvent.click(within(dialog).getByRole('button',{name:'插入所选会话'}));
      await waitFor(()=>expect(m.done).toHaveBeenCalledWith(true,true));
      expect(m.prepare).toHaveBeenCalledWith(request);
      expect(m.reference).toHaveBeenCalledExactlyOnceWith('t1',{kind:'pluginAction',appId:'demo',actionId:value.id});
      expect(m.insert).toHaveBeenCalledExactlyOnceWith(value.text);
      expect(m.newTask).not.toHaveBeenCalled();expect(m.release).toHaveBeenCalledWith(value.id);
    } finally { off(); }
  });
  it('prepares a new composer only after an explicit click and a fresh host check; never launches or sends a task',async()=>{
    m.tasks=[];mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));await screen.findByText('本项目没有可选任务。');expect(m.newTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'新建会话并插入'}));await waitFor(()=>expect(m.newTask).toHaveBeenCalledWith('p1',value.text));expect(m.review).toHaveBeenCalledWith(value.id);expect(m.reference).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();
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
    let finish!:(value:unknown)=>void;m.prepare.mockImplementation(()=>new Promise(r=>finish=r));const view=mount();fireEvent.click(screen.getByRole('button',{name:'插入引用'}));view.unmount();finish(ok(value));await waitFor(()=>expect(m.release).toHaveBeenCalledWith(value.id));expect(m.open).not.toHaveBeenCalled();expect(m.reference).not.toHaveBeenCalled();expect(m.newTask).not.toHaveBeenCalled();
  });
});
