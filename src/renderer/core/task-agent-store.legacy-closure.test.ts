import {beforeEach,expect,it,vi} from 'vitest';
import type {TaskView} from '@shared/tasks';
const f=vi.hoisted(()=>({preview:vi.fn(),open:vi.fn(),list:vi.fn(),kill:vi.fn(),close:vi.fn(),nav:{currentViewId:'task',currentTaskId:'task',openTask:vi.fn(),closeTask:vi.fn(),newTask:vi.fn()},prepare:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{tasks:{agentResumePreview:f.preview,open:f.open,list:f.list,kill:f.kill,closeSession:f.close}},events:{on:()=>()=>{}}}));
vi.mock('./navigation',()=>({navigation:f.nav}));
vi.mock('./terminal-size',()=>({terminalSize:()=>({cols:90,rows:30})}));
vi.mock('../features/files/workspace-store',()=>({prepareFileWorkspaceClose:f.prepare}));
import {tasksStore} from './tasks-store';
function task(changes:any={}):TaskView{return{id:'task',projectId:'project',ptyId:null,archivedAt:null,aiProfileId:'original',runner:'claude',nativeSessionId:'native',runtimeSnapshot:{},agentSnapshot:{version:1},recovery:'resumable',...changes} as TaskView;}
beforeEach(()=>{vi.clearAllMocks();tasksStore.tasks=[task()];tasksStore.tabs=['task'];tasksStore.terminals.clear();tasksStore.resuming.clear();tasksStore.resumeErrors.clear();tasksStore.closing.clear();(tasksStore as any).autoResumed.clear();(tasksStore as any).opening.clear();(tasksStore as any).resumeEpochs.clear();f.preview.mockResolvedValue({sourceChanged:false,model:{changed:false}});f.open.mockResolvedValue({task:task({ptyId:'new-pty'}),ptyId:'new-pty'});f.list.mockResolvedValue([task({ptyId:'new-pty'})]);f.close.mockResolvedValue(task());f.prepare.mockResolvedValue({assertCurrent:vi.fn(),commit:vi.fn(async()=>{}),cancel:vi.fn()});f.nav.currentViewId='task';f.nav.currentTaskId='task';});
it('an old native task with unknown Agent source does not auto-open before explicit source selection',async()=>{
 const old=task({agentSnapshot:null,runtimeSnapshot:{},nativeSessionId:'original-native'});tasksStore.tasks=[old];
 expect(await tasksStore.autoResume(old)).toBe(false);
 expect(f.open).not.toHaveBeenCalled();expect(tasksStore.resuming.size).toBe(0);
});
