// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ScheduleSidebar,ScheduleWorkspace,scheduleView} from './workspace';
const h=vi.hoisted(()=>({api:{list:vi.fn(),notices:vi.fn(),get:vi.fn(),run:vi.fn(),setEnabled:vi.fn(),preview:vi.fn(async()=>[])},picker:vi.fn(),openTask:vi.fn(),panel:{diffTurn:null as string|null,open:vi.fn()}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{schedule:h.api},events:{on:()=>()=>{}}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{openAgentTask:h.openTask}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{tasks:[]}}));
vi.mock('@renderer/lib/hooks/useAgents',()=>({useAgents:()=>({data:{configs:[{id:'p',name:'Codex',providerId:'provider',kind:'codex',source:'login',models:[],available:true,isDefault:true}],tools:[],providers:[{id:'provider',name:'Fixture Hub',models:[],endpoints:{}}]}})}));
vi.mock('@renderer/lib/hooks/useProjects',()=>({useProjectList:()=>({data:[]}),useProject:()=>({data:undefined})}));
vi.mock('@renderer/features/agent-tasks/agent-model-picker',()=>({AgentModelPicker:(props:unknown)=>{h.picker(props);return null;}}));
vi.mock('@renderer/features/agent-tasks/agent-task-view',()=>({ScheduledReply:({text}:{text:string})=><div>{text}</div>}));
vi.mock('@renderer/features/agent-tasks/workspace-panels-store',()=>({panelsFor:()=>h.panel}));
const config={title:'验收计划',prompt:'原提示词',projectId:null,dirId:null,cwd:null,workspace:'directory' as const,baseRef:null,destination:'new' as const,boundTask:null,profileId:'p',model:'fixture-model',effort:'medium',tier:'ask' as const,delegation:false,notifyCompleted:false};
const schedule={type:'daily' as const,time:'09:00',zone:'UTC'};
const run={id:'r',planId:'plan',revision:1,trigger:'manual',status:'completed',due:1,claimedAt:1,startedAt:1,finishedAt:2,attempts:1,snapshot:{config,schedule,grace:60},turnId:'turn',taskId:'task',inputId:'input',reason:null,summary:'最终回复'};
const plan={id:'plan',revision:1,config,schedule,grace:60,enabled:true,archived:false,ended:false,nextDue:1234,repair:null,recent:{id:'r',status:'completed',summary:'最终回复',claimedAt:1}};
beforeEach(async()=>{vi.clearAllMocks();h.api.list.mockResolvedValue([plan]);h.api.notices.mockResolvedValue([]);h.api.get.mockResolvedValue({plan,history:[run],workspaces:[]});h.api.run.mockResolvedValue({run,requests:[],items:[],hasMore:false,target:{taskId:'task',turnId:'turn',archived:false},result:{taskId:'task',itemId:'reply',payload:{text:'最终回复'}},changes:[{taskId:'task',turnId:'owned-turn',status:'complete',archived:false,total:1,files:['owned.txt']}]});h.api.setEnabled.mockResolvedValue({...plan,enabled:false});scheduleView.open(null);await scheduleView.refresh();});
afterEach(()=>{cleanup();scheduleView.open(null);});
it('A41 list shows the real provider and recent run summary, and row pause does not navigate',async()=>{render(<ScheduleWorkspace/>);expect(screen.getByText('Codex · Fixture Hub')).toBeTruthy();expect(screen.getByText('最终回复')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'暂停 验收计划'}));await waitFor(()=>expect(h.api.setEnabled).toHaveBeenCalledWith('plan',1,false));expect(scheduleView.planId).toBeNull();});
it('A41 exact result view opens only owned file change turn, not later task history',async()=>{render(<ScheduleWorkspace/>);fireEvent.click(screen.getByText('验收计划'));await screen.findByRole('button',{name:'查看运行记录 ›'});fireEvent.click(screen.getByRole('button',{name:'查看运行记录 ›'}));await screen.findByText('成果文件');expect(screen.getByText('owned.txt')).toBeTruthy();expect(screen.getByText('最终回复')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'查看本轮 1 个文件改动'}));expect(h.panel.diffTurn).toBe('owned-turn');expect(h.panel.open).toHaveBeenCalledWith('diff');expect(h.openTask).toHaveBeenCalledWith('task',false,{turnId:'owned-turn'});});

it('M16 A23 exposes the normal native model catalog before a no-project schedule is created',async()=>{
  render(<ScheduleWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:'新建计划'}));
  await waitFor(()=>expect(h.picker.mock.calls.at(-1)?.[0]).toMatchObject({scope:{kind:'standalone'}}));
});

it('M16 A52 keeps the original long plan title recoverable in the sidebar and independent result navigation',async()=>{
  const title='每个工作日检查项目依赖、记录测试结果并生成超长中文标题用于滚动验收'.repeat(3);
  const longPlan={...plan,config:{...config,title}};
  const longRun={...run,snapshot:{...run.snapshot,config:{...config,title}}};
  h.api.list.mockResolvedValue([longPlan]);h.api.get.mockResolvedValue({plan:longPlan,history:[longRun],workspaces:[]});
  h.api.run.mockResolvedValue({run:longRun,requests:[],items:[],hasMore:false,result:null,changes:[],target:{taskId:'task',turnId:'turn',archived:false}});
  render(<><ScheduleSidebar/><ScheduleWorkspace/></>);
  await waitFor(()=>expect(document.querySelector('.schedule-side-name')?.getAttribute('title')).toBe(title));
  act(()=>scheduleView.open('plan','r'));
  const heading=await screen.findByRole('heading',{name:title});expect(heading.getAttribute('title')).toBe(title);
  expect(document.querySelector('.schedule-back-title')?.getAttribute('title')).toBe(title);
  expect(screen.getByRole('button',{name:'查看完整任务'})).toBeTruthy();
});
