// @vitest-environment jsdom
import {act,cleanup,render} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {browserShortcutEvent} from '@shared/events';
import {useBrowserShortcuts} from './workspace';

const f=vi.hoisted(()=>{
  const listeners=new Map<unknown,(event:{taskId:string;action:string})=>void>();
  const navigation={currentViewId:'task',currentTaskId:'t2',filePanelOpen:false,openTask:vi.fn((id:string)=>{navigation.currentTaskId=id;navigation.currentViewId='task';}),toggleFilePanel:vi.fn(()=>{navigation.filePanelOpen=!navigation.filePanelOpen;})};
  const byId=new Map<string,{id:string;projectId:string|null}>();
  const tasks={byId,closing:new Set<string>(),refresh:vi.fn(async()=>{}),show:vi.fn(),get current(){return byId.get(navigation.currentTaskId);}};
  return{listeners,navigation,tasks,open:vi.fn(),create:vi.fn()};
});
vi.mock('@renderer/lib/ipc',()=>({events:{on:(key:unknown,listener:(event:{taskId:string;action:string})=>void)=>{f.listeners.set(key,listener);return()=>f.listeners.delete(key);}},rpc:{tasks:{open:f.open},browser:{create:f.create}}}));
vi.mock('@renderer/core/navigation',()=>({navigation:f.navigation}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:f.tasks}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:()=>null}));
vi.mock('./store',()=>({browserWorkspaceFor:vi.fn(),openNewBrowserTab:vi.fn()}));
function Shortcuts(){useBrowserShortcuts();return null;}
async function emit(taskId:string,action='show'){await act(async()=>{f.listeners.get(browserShortcutEvent)?.({taskId,action});});}
beforeEach(()=>{vi.clearAllMocks();f.listeners.clear();f.navigation.currentViewId='task';f.navigation.currentTaskId='t2';f.navigation.filePanelOpen=false;f.tasks.closing.clear();f.tasks.byId.clear();for(const id of ['t1','t2'])f.tasks.byId.set(id,{id,projectId:'p1'});});
afterEach(cleanup);
it('reveals an explicitly focused background browser task without starting an Agent',async()=>{
  render(<Shortcuts/>);await emit('t1');expect(f.navigation.currentTaskId).toBe('t1');expect(f.navigation.currentViewId).toBe('task');expect(f.navigation.filePanelOpen).toBe(true);expect(f.tasks.show).not.toHaveBeenCalled();expect(f.open).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
});
it('honors explicit browser focus from another top-level view',async()=>{
  f.navigation.currentViewId='apps';render(<Shortcuts/>);await emit('t1');expect(f.navigation.currentViewId).toBe('task');expect(f.navigation.currentTaskId).toBe('t1');expect(f.navigation.filePanelOpen).toBe(true);
});
it('opens the current browser panel once and does not toggle it closed on another focus request',async()=>{
  render(<Shortcuts/>);await emit('t2');expect(f.navigation.filePanelOpen).toBe(true);await emit('t2');expect(f.navigation.filePanelOpen).toBe(true);expect(f.navigation.toggleFilePanel).toHaveBeenCalledOnce();
});
it('does not switch tasks or create a page for ordinary shortcuts',async()=>{
  render(<Shortcuts/>);await emit('t1','new');await emit('t1','address');expect(f.navigation.currentTaskId).toBe('t2');expect(f.navigation.filePanelOpen).toBe(false);expect(f.open).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
});
it('ignores a deleted or projectless target without starting a conversation',async()=>{
  f.tasks.byId.set('t0',{id:'t0',projectId:null});render(<Shortcuts/>);await emit('deleted');await emit('t0');expect(f.navigation.currentTaskId).toBe('t2');expect(f.navigation.filePanelOpen).toBe(false);expect(f.tasks.show).not.toHaveBeenCalled();expect(f.open).not.toHaveBeenCalled();
});

it('keeps a newer explicit focus request when an older task lookup finishes late',async()=>{
  let release!:()=>void;const lookup=new Promise<void>(resolve=>{release=resolve;});f.tasks.refresh.mockImplementationOnce(()=>lookup);f.tasks.byId.delete('t1');render(<Shortcuts/>);await emit('t1');await emit('t2');f.tasks.byId.set('t1',{id:'t1',projectId:'p1'});await act(async()=>{release();await lookup;});expect(f.navigation.currentTaskId).toBe('t2');
});
it('does not reveal a target whose close transaction is still pending',async()=>{
  f.tasks.closing.add('t1');render(<Shortcuts/>);await emit('t1');expect(f.navigation.currentTaskId).toBe('t2');expect(f.navigation.filePanelOpen).toBe(false);
});
