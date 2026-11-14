// @vitest-environment jsdom
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {TaskView} from '@shared/tasks';
const f=vi.hoisted(()=>({profiles:[] as any[],session:vi.fn(),settings:vi.fn(),drop:vi.fn(),panel:vi.fn()}));
vi.mock('@renderer/lib/hooks/useAiProfiles',()=>({useAiProfiles:()=>({data:f.profiles})}));
vi.mock('@renderer/lib/hooks/useProjects',()=>({useProject:()=>({data:undefined})}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{tasks:[],terminals:new Map(),resuming:new Set(),closing:new Set(),resume:vi.fn(),dropTerminal:f.drop}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{filePanelOpen:false,toggleFilePanel:vi.fn(),openSettings:f.settings,newTask:vi.fn()}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{session:f.session},tasks:{kill:vi.fn()}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/lib/theme',()=>({useTheme:()=>({effectiveTheme:'ylight',setTheme:vi.fn()})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key,i18n:{language:'zh'}})}));
vi.mock('@renderer/lib/profile-health',()=>({HealthDot:()=>null,ProfileHealthMark:()=>null}));
vi.mock('@renderer/features/applications/session-applications',()=>({SessionApplicationsPanel:(props:unknown)=>{f.panel(props);return null;}}));
vi.mock('@renderer/features/browser/store',()=>({openNewBrowserTab:vi.fn()}));
vi.mock('@renderer/views/capabilities',()=>({RuntimeCapabilities:()=>null}));
vi.mock('@renderer/views/task-close',()=>({useTaskClose:()=>({requestClose:vi.fn(),closeDialog:null,busy:false})}));
vi.mock('@shared/task-header-layout.mjs',()=>({observeTaskHeaderLayout:()=>()=>{}}));
import {TaskHeader,RuntimeBar} from './task-chrome';
const CURRENT_MODEL='PUBLIC_CURRENT_PROFILE_MODEL_MUST_NOT_BECOME_HISTORY';
const clients:QueryClient[]=[];
function task():TaskView{return{id:'pre-m13-history',projectId:'synthetic-project',projectName:'Synthetic Project',dirId:null,cwd:'/synthetic/history',aiProfileId:'profile',aiProfileName:'Recorded historical config name',aiProfileColor:null,runner:'claude',nativeSessionId:'original-native-history',title:'Old history without AI snapshot',firstMessage:'Old input',injectedEnvNames:[],runtimeSnapshot:null,agentSnapshot:null,configVersion:null,projectConfigVersion:null,archivedAt:null,createdAt:1,updatedAt:2,lastLaunchedAt:2,ptyId:null,recovery:'resumable',recoveryReason:''};}
function mount(node:React.ReactNode){const c=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0,refetchOnWindowFocus:false}}});clients.push(c);return render(<QueryClientProvider client={c}>{node}</QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();f.profiles=[{id:'profile',name:'Present edited profile name',runner:'claude',env:[],args:['--model',CURRENT_MODEL],color:null}];f.session.mockResolvedValue({ok:true,value:{applications:[]}});});
afterEach(()=>{cleanup();for(const c of clients.splice(0))c.clear();});
it('actual TaskHeader no-snapshot information must not infer historical model from the presently edited profile',async()=>{
 mount(<TaskHeader task={task()}/>);fireEvent.click(screen.getByTestId('task-info'));
 const info=await screen.findByTestId('task-info-popup');
 expect(info.textContent).toContain('Recorded historical config name');
 // Unknown historical model may be omitted or labelled unrecorded; do not fabricate a requestedModel.
 expect(info.textContent).not.toContain(CURRENT_MODEL);
});
it('actual RuntimeBar no-snapshot branch must not present the current profile default as the task historical model',()=>{
 const t=task(),view=mount(<RuntimeBar task={t}/>);
 expect(screen.getByTestId('runtime-profile').textContent).toContain(t.aiProfileName);
 expect(screen.getByTestId('runtime-bar').textContent).not.toContain(CURRENT_MODEL);
 f.profiles=[{...f.profiles[0],args:['--model','PUBLIC_SECOND_EDIT_MUST_NOT_BECOME_HISTORY']}];
 view.rerender(<QueryClientProvider client={clients[0]}><RuntimeBar task={t}/></QueryClientProvider>);
 expect(screen.getByTestId('runtime-bar').textContent).not.toContain('PUBLIC_SECOND_EDIT_MUST_NOT_BECOME_HISTORY');
});

it('plugin-labelled task entry opens the current task session plugin panel',()=>{
 const t=task();mount(<TaskHeader task={t}/>);
 expect(screen.queryByRole('button',{name:'应用'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'会话插件'}));
 expect(f.panel).toHaveBeenLastCalledWith(expect.objectContaining({taskId:t.id,projectName:t.projectName,runIdentity:'stopped:unrecorded'}));
});
