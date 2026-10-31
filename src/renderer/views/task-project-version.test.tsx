// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {TaskView} from '@shared/tasks';
import {TaskHeader} from './task-chrome';
const api=vi.hoisted(()=>({projects:{get:vi.fn()},aiProfiles:{list:vi.fn(async()=>[])},tasks:{kill:vi.fn()}}));
const resume=vi.hoisted(()=>vi.fn());
vi.mock('@renderer/lib/ipc',()=>({rpc:api,events:{on:()=>()=>undefined}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{terminals:new Map(),resuming:new Set(),closing:new Set(),resume}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{filePanelOpen:false,toggleFilePanel:vi.fn(),newTask:vi.fn()}}));
vi.mock('@renderer/lib/theme',()=>({useTheme:()=>({effectiveTheme:'ydark',setTheme:vi.fn()})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,value?:{from:number;to:number})=>key==='task.configChanged'?`Project changed ${value!.from} -> ${value!.to}`:key})}));
const clients:QueryClient[]=[];
const task=(extra:Partial<TaskView>={}):TaskView=>({id:'task-one',projectId:'project-one',projectName:'Project',dirId:'dir-A',cwd:'/launch/snapshot/A',aiProfileId:null,aiProfileName:null,aiProfileColor:null,runner:'claude',nativeSessionId:'one',title:'Task',firstMessage:'',injectedEnvNames:[],configVersion:2,projectConfigVersion:2,archivedAt:null,createdAt:1,updatedAt:1,lastLaunchedAt:1,ptyId:'pty-running',recovery:'fresh',recoveryReason:'',...extra});
function mount(value:TaskView,client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}})){clients.push(client);render(<QueryClientProvider client={client}><TaskHeader task={value}/></QueryClientProvider>);return client}
beforeEach(()=>{vi.clearAllMocks();api.projects.get.mockResolvedValue({id:'project-one',configVersion:3})});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear())});
describe('task launch snapshot with current project metadata',()=>{
 it('shows a fresh project version while the task-list cache stays unchanged',async()=>{const value=task(),client=mount(value);fireEvent.click(screen.getByTestId('task-info'));await screen.findByTestId('task-info-popup');await waitFor(()=>expect(screen.getByText('Project changed 2 -> 3')).toBeDefined());await act(async()=>{client.setQueryData(['project','project-one'],{id:'project-one',configVersion:4})});await waitFor(()=>expect(screen.getByText('Project changed 2 -> 4')).toBeDefined());expect(screen.getByText('/launch/snapshot/A')).toBeDefined();expect(value.configVersion).toBe(2);expect(value.projectConfigVersion).toBe(2);expect(value.ptyId).toBe('pty-running');expect(api.tasks.kill).not.toHaveBeenCalled();expect(resume).not.toHaveBeenCalled()});
 it('does not hide an already-known change while an older project cache refetches',async()=>{let finish!:(p:unknown)=>void;api.projects.get.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});client.setQueryData(['project','project-one'],{id:'project-one',configVersion:1});mount(task({projectConfigVersion:5}),client);fireEvent.click(screen.getByTestId('task-info'));await screen.findByTestId('task-info-popup');expect(screen.getByText('Project changed 2 -> 5')).toBeDefined();await waitFor(()=>expect(api.projects.get).toHaveBeenCalled());await act(async()=>finish({id:'project-one',configVersion:5}));expect(screen.getByText('Project changed 2 -> 5')).toBeDefined()});
 it('keeps an unassigned task independent of project lookups',async()=>{mount(task({projectId:null,projectName:null,projectConfigVersion:null,configVersion:null}));fireEvent.click(screen.getByTestId('task-info'));await screen.findByTestId('task-info-popup');expect(api.projects.get).not.toHaveBeenCalled();expect(screen.queryByText(/Project changed/)).toBeNull();expect(screen.getByText('/launch/snapshot/A')).toBeDefined()});
});
