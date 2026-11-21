// @vitest-environment jsdom
import {act,cleanup,render} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {browserShortcutEvent} from '@shared/events';
import {useBrowserShortcuts} from './workspace';

const f=vi.hoisted(()=>{
  const listeners=new Map<unknown,(event:{taskId:string;action:string})=>void>();
  const navigation={currentViewId:'agentTask',currentAgentTaskId:'t2',agentTaskReadOnly:false,openAgentTask:vi.fn((id:string)=>{navigation.currentAgentTaskId=id;navigation.currentViewId='agentTask';})};
  const byId=new Map<string,{taskId:string;projectId:string|null}>();
  const tasks={byId,refresh:vi.fn(async()=>{}),get tasks(){return [...byId.values()];}};
  return{listeners,navigation,tasks,openPanel:vi.fn(),create:vi.fn()};
});
vi.mock('@renderer/lib/ipc',()=>({events:{on:(key:unknown,listener:(event:{taskId:string;action:string})=>void)=>{f.listeners.set(key,listener);return()=>f.listeners.delete(key);}},rpc:{browser:{create:f.create}}}));
vi.mock('@renderer/core/navigation',()=>({navigation:f.navigation}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:f.tasks}));
vi.mock('@renderer/features/agent-tasks/workspace-panels-store',()=>({panelsFor:()=>({open:f.openPanel})}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:()=>null}));
vi.mock('./store',()=>({browserWorkspaceFor:vi.fn(),openNewBrowserTab:vi.fn()}));
function Shortcuts(){useBrowserShortcuts();return null;}
async function emit(taskId:string,action='show'){await act(async()=>{f.listeners.get(browserShortcutEvent)?.({taskId,action});});}
beforeEach(()=>{vi.clearAllMocks();f.listeners.clear();f.navigation.currentViewId='agentTask';f.navigation.currentAgentTaskId='t2';f.tasks.byId.clear();for(const id of ['t1','t2'])f.tasks.byId.set(id,{taskId:id,projectId:'p1'});});
afterEach(cleanup);
it('reveals an explicitly focused background browser task without starting an Agent',async()=>{
  render(<Shortcuts/>);await emit('t1');expect(f.navigation.currentAgentTaskId).toBe('t1');expect(f.navigation.currentViewId).toBe('agentTask');expect(f.openPanel).toHaveBeenCalledWith('browser');expect(f.create).not.toHaveBeenCalled();
});
it('honors explicit browser focus from another top-level view',async()=>{
  f.navigation.currentViewId='apps';render(<Shortcuts/>);await emit('t1');expect(f.navigation.currentViewId).toBe('agentTask');expect(f.navigation.currentAgentTaskId).toBe('t1');expect(f.openPanel).toHaveBeenCalledWith('browser');
});
it('requests an explicit browser open for each focus event',async()=>{
  render(<Shortcuts/>);await emit('t2');expect(f.openPanel).toHaveBeenCalledWith('browser');await emit('t2');expect(f.openPanel).toHaveBeenCalledWith('browser');expect(f.openPanel).toHaveBeenCalledTimes(2);
});
it('does not switch tasks or create a page for ordinary shortcuts',async()=>{
  render(<Shortcuts/>);await emit('t1','new');await emit('t1','address');expect(f.navigation.currentAgentTaskId).toBe('t2');expect(f.openPanel).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
});
it('ignores a deleted or projectless target without starting a conversation',async()=>{
  f.tasks.byId.set('t0',{taskId:'t0',projectId:null});render(<Shortcuts/>);await emit('deleted');await emit('t0');expect(f.navigation.currentAgentTaskId).toBe('t2');expect(f.openPanel).not.toHaveBeenCalled();
});

it('keeps a newer explicit focus request when an older task lookup finishes late',async()=>{
  let release!:()=>void;const lookup=new Promise<void>(resolve=>{release=resolve;});f.tasks.refresh.mockImplementationOnce(()=>lookup);f.tasks.byId.delete('t1');render(<Shortcuts/>);await emit('t1');await emit('t2');f.tasks.byId.set('t1',{taskId:'t1',projectId:'p1'});await act(async()=>{release();await lookup;});expect(f.navigation.currentAgentTaskId).toBe('t2');
});
