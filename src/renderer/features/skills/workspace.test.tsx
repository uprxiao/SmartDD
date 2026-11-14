// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import type { CapabilityRegistryView,ManagedCapabilityView } from '@shared/managed-capabilities';
import {toast} from 'sonner';
import { SkillsWorkspace } from './workspace';
const m=vi.hoisted(()=>({impact:vi.fn(async()=>({ok:true,value:{runningCount:0,globalDisabled:false,checkedAt:'fixed'}})),state:null as CapabilityRegistryView|null,list:vi.fn(),scan:vi.fn(),adopt:vi.fn(),manage:vi.fn(),enabled:vi.fn(),auto:vi.fn(),approve:vi.fn(),builtin:vi.fn(),builtinEnabled:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{sessionChangeImpact:m.impact},capabilities:{managedList:m.list,scanManaged:m.scan,adoptAll:m.adopt,setManaged:m.manage,setManagedEnabled:m.enabled,setAutoManage:m.auto,setAutoApprove:m.approve,builtinSettings:m.builtin,setBuiltinEnabled:m.builtinEnabled}}}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),info:vi.fn()}}));
const clients:QueryClient[]=[];
const item=(patch:Partial<ManagedCapabilityView>={}):ManagedCapabilityView=>({id:'source',kind:'skill',name:'public-echo',runner:'claude',sourcePath:'/synthetic/.claude/skills/public-echo/SKILL.md',sourceScope:'user',projectRoot:null,sourceLabel:'user',version:null,managed:false,enabled:true,autoApprove:false,present:true,status:'new',issues:[],loaded:'unverified',...patch});
function mount(){const c=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});clients.push(c);return render(<QueryClientProvider client={c}><SkillsWorkspace/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();m.state={items:[item()],autoManage:false,newCount:1};m.list.mockImplementation(async()=>m.state);m.scan.mockImplementation(async()=>m.state);m.builtin.mockResolvedValue({skills:[],mcpEnabled:true});m.adopt.mockImplementation(async()=>m.state);for(const fn of [m.manage,m.enabled,m.auto,m.approve,m.builtinEnabled])fn.mockResolvedValue(undefined);});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});
it('explains Codex Provider native plugin limits while keeping Skill and MCP adoption available',async()=>{
 mount();await screen.findByRole('button',{name:/public-echo/});
 expect(screen.getByText('第三方 Provider 下 Codex 原生插件不可用')).toBeTruthy();
 expect(screen.getByText(/插件自带的 Skill／MCP 可在这里发现并纳管/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'一键纳管'})).toBeTruthy();
});
it('scans on entry and exposes management without independent installers or MCP connection creation',async()=>{
  mount();await screen.findByRole('button',{name:/public-echo/});expect(m.scan).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button',{name:/安装 Skill|新增 MCP|添加 MCP|导入/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'一键纳管'}));await waitFor(()=>expect(m.adopt).toHaveBeenCalledTimes(1));
});
it('conflict details preserve the source and offer no destructive takeover action',async()=>{
  m.state={items:[item({status:'conflict'})],autoManage:false,newCount:0};mount();fireEvent.click(await screen.findByRole('button',{name:/public-echo/}));await screen.findByRole('dialog');
  expect(screen.getByText(/保留所有原件/)).toBeTruthy();expect(screen.queryByRole('button',{name:'纳管'})).toBeNull();expect(m.manage).not.toHaveBeenCalled();
});
it('shows the actual project placement warning and target conflict without offering adoption',async()=>{
  m.state={items:[item({sourceScope:'project',projectRoot:'/synthetic/project',status:'conflict',issues:['project_not_git','skill_target_conflict']})],autoManage:false,newCount:0};
  mount();fireEvent.click(await screen.findByRole('button',{name:/public-echo/}));await screen.findByRole('dialog');
  expect(screen.getByText('当前项目不是 Git 仓库；Codex 项目链接会出现在项目目录')).toBeTruthy();
  expect(screen.getByText('Codex 项目目录存在同名 Skill 目标，保留原件，不覆盖')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'纳管'})).toBeNull();
});
it('MCP approval and enable actions use only the selected opaque identity',async()=>{
  m.state={items:[item({id:'mcp1',kind:'mcp',status:'managed',managed:true})],autoManage:false,newCount:0};mount();fireEvent.click(await screen.findByRole('tab',{name:/MCP/}));fireEvent.click(await screen.findByRole('button',{name:/public-echo/}));await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('radio',{name:/自动批准/}));await waitFor(()=>expect(m.approve).toHaveBeenCalledWith('mcp1',true));
  await waitFor(()=>expect((screen.getByRole('switch',{name:'启用技能'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('switch',{name:'启用技能'}));await waitFor(()=>expect(m.enabled).toHaveBeenCalledWith('mcp1',false));
});
it('global builtin switches have no project selector or old-version controls',async()=>{
  mount();const toggle=await screen.findByRole('switch',{name:'停用 WillYou 项目上下文 MCP'});fireEvent.click(toggle);await waitFor(()=>expect(m.builtinEnabled).toHaveBeenCalledWith('smartdd-project-context',false));expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByText(/已保留.*版本/)).toBeNull();
});

it('uses the other-tool management scope and includes the observed live count only after success',async()=>{
 m.impact.mockResolvedValueOnce({ok:true,value:{runningCount:1,globalDisabled:false,checkedAt:'fixed'}});mount();fireEvent.click(await screen.findByRole('button',{name:/public-echo/}));fireEvent.click(screen.getByRole('button',{name:'纳管'}));
 await waitFor(()=>expect(m.manage).toHaveBeenCalledWith('source',true));expect(m.impact).toHaveBeenCalledWith({kind:'capability',ids:['source'],management:true});await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('public-echo 已纳管：新建或恢复的会话即可使用；1 个运行中的会话重启后完全生效'));
});
it('does not announce adoption or mutate a capability when scope lookup fails',async()=>{
 m.impact.mockRejectedValueOnce(new Error('范围待核对'));mount();fireEvent.click(await screen.findByRole('button',{name:/public-echo/}));fireEvent.click(screen.getByRole('button',{name:'纳管'}));await screen.findByRole('alert');expect(m.manage).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
});

it('reports only newly adopted names returned by the host and leaves conflicts out of the success notice',async()=>{
 m.state={items:[item(),item({id:'conflict',name:'keep-source',status:'conflict'})],autoManage:false,newCount:1};
 m.adopt.mockImplementation(async()=>{m.state={items:[item({managed:true,status:'managed'}),item({id:'conflict',name:'keep-source',status:'conflict'})],autoManage:false,newCount:0};return m.state;});
 mount();fireEvent.click(await screen.findByRole('button',{name:'一键纳管'}));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('已纳管：public-echo；新建或恢复的会话即可使用'));
 expect(m.manage).not.toHaveBeenCalled();
});
