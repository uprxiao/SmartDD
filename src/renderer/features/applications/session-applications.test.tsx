// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ApplicationSessionDiagnostic,SessionRunDiagnostic} from '@shared/application-session-diagnostics';
import {SessionApplicationsPanel} from './session-applications';
const m=vi.hoisted(()=>({session:vi.fn(),newTask:vi.fn(),prepareApplicationTask:vi.fn(),openApplications:vi.fn(),openApplicationActivity:vi.fn(),openProject:vi.fn(),close:vi.fn(),create:vi.fn(),open:vi.fn(),kill:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{session:m.session},tasks:{create:m.create,open:m.open,kill:m.kill}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{current:{id:'t1',projectId:'p1',ptyId:'pty1',archivedAt:null},terminals:new Map([['t1','pty1']])}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{newTask:m.newTask,prepareApplicationTask:m.prepareApplicationTask,openApplications:m.openApplications,openApplicationActivity:m.openApplicationActivity,openProject:m.openProject}}));
let client:QueryClient;
const run=(current=true):SessionRunDiagnostic=>({id:current?'run-current':'run-history',state:current?'active':'stopped',startedAt:'2026-10-20T14:00:00.000Z',endedAt:current?null:'2026-10-20T14:01:00.000Z',current,preparation:{schema:1,runId:current?'run-current':'run-history',selectionHash:'a'.repeat(64),cliVersion:'0.162.1',adapterHash:'b'.repeat(64),state:'prepared',issueCode:null,manifestPath:'/private/owned/manifest.json',configPaths:['/private/owned/mcp.json'],preparedAt:'2026-10-20T14:00:00.000Z'},preparationIssue:null,restriction:null,restrictionIssue:null,bridge:{connected:current,observedAt:'2026-10-20T14:00:01.000Z',issueCode:null}});
const fixture=(more:Partial<ApplicationSessionDiagnostic>={}):ApplicationSessionDiagnostic=>({taskId:'t1',projectId:'p1',title:'原会话',runner:'codex',selection:'fixed',snapshotHash:'a'.repeat(64),agentState:'running',canNewSession:true,createdCliVersion:'0.160.0',currentRun:run(),recentRuns:[run(false)],applications:[{appId:'mail',name:'邮件',fixedVersion:'1.0.0',defaultVersion:'2.0.0',packageHash:'c'.repeat(64),policy:'enabled',resourceState:'verified',issueCode:null,skills:[{id:'work-assistant',name:'versioned-mail',sourceHash:'d'.repeat(64),projectionPath:'/private/owned/SKILL.md'}],permissions:['mail.read','mail.draft'],connections:[{slot:'smtp',id:'current-smtp',name:'当前发件',originalId:'old-smtp',originalName:'原发件',health:'unavailable',testedAt:null,selection:'changed',compatibility:'compatible',issueCode:null}],evidence:{skillDiscovery:'unverified',skillRead:'unverified',toolRequests:1,successfulToolRequests:1,latestToolAt:null,latestErrorCode:null,latestEffectState:null}}],deliveryCopies:null,issues:[],checkedAt:'2026-10-20T14:02:00.000Z',...more});
function mount(projectName?:string){client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><SessionApplicationsPanel taskId="t1" projectName={projectName} onClose={m.close}/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({ok:true,value:fixture()});Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:()=>{}});});
afterEach(()=>{cleanup();client?.clear();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});

const originalTaskIdentity=()=>{expect(screen.getByTestId('session-current-title').textContent).toBe('原会话');expect(m.session).toHaveBeenCalledExactlyOnceWith('t1');for(const f of[m.create,m.open,m.kill,m.newTask,m.prepareApplicationTask,m.openApplications,m.openApplicationActivity,m.openProject])expect(f).not.toHaveBeenCalled();};
describe('T073 confirmed compact session-plugin prototype, not an unapproved diagnostics workspace',()=>{
 it('has the original launch selection and only completion, with no retained diagnostic/management tree even when closed',async()=>{
  const value=fixture();value.applications[0].currentState='available';m.session.mockResolvedValue({ok:true,value});const view=mount();await screen.findByText('原会话');const dialog=screen.getByRole('dialog',{name:'会话插件'}),body=screen.getByTestId('session-applications'),row=body.querySelector('[data-session-plugin="mail"]')!;
  expect(row).not.toBeNull();expect(row.textContent).toContain('本次启动时 v1.0.0');expect(row.textContent).toContain('原发件');expect(row.textContent).not.toContain('当前发件');expect(row.textContent).toContain('已更新到 2.0.0');expect(body.textContent).toContain('启动时已加载的 Skill 与 MCP 在重启会话后才按最新状态变化；插件调用立即按最新状态执行。');
  // Presence, not visibility: merely closing <details> must not make the removed surface pass.
  expect(body.querySelector('[data-session-diagnostics]')).toBeNull();expect(body.querySelector('summary')).toBeNull();expect(body.querySelectorAll('button,a,input,select,textarea')).toHaveLength(0);
  for(const text of['诊断与管理','复制脱敏诊断','重新核对','使用当前版本新建会话','项目插件','固定包与 Skill 来源','运行追溯与配置路径'])expect(within(dialog).queryByText(text)).toBeNull();
  expect(within(dialog.querySelector('footer')!).getAllByRole('button').map(x=>x.textContent)).toEqual(['完成']);originalTaskIdentity();fireEvent.click(screen.getByRole('button',{name:'完成'}));expect(m.close).toHaveBeenCalledTimes(1);expect(view.container.querySelector('[data-session-diagnostics]')).toBeNull();
 });
 it.each([['unknown-history','历史能力未知'],['corrupt','固定能力快照损坏'],['unsupported-schema','原能力快照格式暂不支持']] as const)('keeps %s safety visible without implying current catalog was selected',async(selection,expected)=>{
  m.session.mockResolvedValue({ok:true,value:fixture({selection,applications:[],currentRun:null,recentRuns:[]})});mount();const warning=await screen.findByText(new RegExp(expected));expect(warning.closest('details')).toBeNull();expect(warning.textContent).toContain('查看当前项目可用版本不表示本会话已选用');expect(document.querySelectorAll('[data-session-plugin]')).toHaveLength(0);expect(document.querySelector('[data-session-diagnostics]')).toBeNull();originalTaskIdentity();
 });
 it('keeps the exact current-run name conflict warning outside removed diagnostics, never resolves it or starts a task',async()=>{
  const value=fixture();value.applications[0].issueCode='AGENT_CAPABILITY_NAME_CONFLICT';value.applications[0].resourceState='unavailable';m.session.mockResolvedValue({ok:true,value});mount();const warning=await screen.findByText(/本轮此插件与用户原生能力名称或启停配置冲突/);expect(warning.closest('details')).toBeNull();expect(warning.textContent).toContain('保留用户配置及原会话选择');expect(document.querySelector('[data-session-diagnostics]')).toBeNull();originalTaskIdentity();
 });
 it('keeps a current native-only restriction visibly unavailable instead of deleting safety with the diagnostics tree',async()=>{
  const value=fixture(),run=value.currentRun!;run.restriction={schema:1,runId:run.id,taskId:value.taskId,snapshotHash:value.snapshotHash!,selectionHash:run.preparation!.selectionHash,reason:'managed_launch_payload_too_large',issueCode:'AGENT_ADAPTER_UNSUPPORTED',restrictedAt:run.startedAt};m.session.mockResolvedValue({ok:true,value});mount();const warning=await screen.findByText(/本次插件能力内容超过启动容量，已停用插件注入/);expect(warning.closest('details')).toBeNull();expect(warning.textContent).toContain('Agent 可继续工作');expect(document.querySelector('[data-session-diagnostics]')).toBeNull();originalTaskIdentity();
 });
});


describe('compact session identity, status and read failures',()=>{
 it('includes fixed builtin and external launch selections, excludes builtin catalog-only entries and uses original connection identity',async()=>{
  const value=fixture();
  value.applications.push({...value.applications[0],appId:'browser',name:'浏览器',fixedVersion:null,packageHash:null,skills:[],connections:[]});
  value.plugins=[{appId:'demo-tracker',name:'Demo Tracker',launchVersion:'0.1.0',currentVersion:'0.2.0',state:'available',connections:[{slot:'tracker-api',id:'launch-account',name:'启动账号'}]}];
  m.session.mockResolvedValue({ok:true,value});const view=mount();await screen.findByText('原会话');
  const list=view.container.querySelector<HTMLElement>('.m13-session-plugin-list')!;expect(list).not.toBeNull();
  expect([...list.querySelectorAll<HTMLElement>('[data-session-plugin]')].map(row=>row.dataset.sessionPlugin).sort()).toEqual(['demo-tracker','mail']);
  const mail=list.querySelector<HTMLElement>('[data-session-plugin="mail"]')!;
  expect(mail.textContent).toContain('邮件');expect(mail.textContent).toContain('本次启动时 v1.0.0');
  expect(mail.textContent).toContain('原发件');expect(mail.textContent).not.toContain('当前发件');
  expect(mail.textContent).toContain('运行中继续用这个连接');
  expect(list.textContent).not.toContain('浏览器');
  expect(list.querySelector('[data-session-plugin="demo-tracker"]')?.textContent).toContain('启动账号');
  expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it.each(['unknown-history','corrupt','unsupported-schema'] as const)('does not display untrusted launch rows or claim empty selection for %s',async selection=>{
  const value=fixture({selection});value.applications[0].currentState='available';m.session.mockResolvedValue({ok:true,value});mount();await screen.findByText('原会话');
  expect(document.querySelector('[data-session-plugin]')).toBeNull();expect(screen.queryByText('这个任务启动时没有可用的插件。')).toBeNull();originalTaskIdentity();
 });
 it('does not turn a past restriction into a current restriction',async()=>{
  const value=fixture({currentRun:null});const prior=value.recentRuns[0];prior.restriction={schema:1,runId:prior.id,taskId:value.taskId,snapshotHash:value.snapshotHash!,selectionHash:prior.preparation!.selectionHash,reason:'managed_launch_payload_too_large',issueCode:'AGENT_ADAPTER_UNSUPPORTED',restrictedAt:prior.startedAt};m.session.mockResolvedValue({ok:true,value});mount();
  await screen.findByText(/当前没有可核实的插件运行证据/);expect(screen.queryByText(/本次插件能力内容超过启动容量/)).toBeNull();expect(document.querySelector('details')).toBeNull();originalTaskIdentity();
 });
 it('keeps damaged current evidence conservative without exposing internal paths or management controls',async()=>{
  const value=fixture();value.currentRun!.restrictionIssue='RESOURCE_RECOVERY_REQUIRED';value.currentRun!.preparationIssue='RESOURCE_RECOVERY_REQUIRED';value.currentRun!.skillObservationIssue='RESOURCE_RECOVERY_REQUIRED';m.session.mockResolvedValue({ok:true,value});mount();
  await screen.findByText(/启动限制记录待核查/);expect(screen.getByText(/本次插件准备或连接状态暂无法核实/)).toBeTruthy();expect(screen.getByText(/Skill 历史证据不完整/)).toBeTruthy();expect(screen.queryByText(/private\/owned/)).toBeNull();expect(document.querySelector('details')).toBeNull();originalTaskIdentity();
 });
 it('keeps independent Skill or MCP conflicts visible without reconfiguring them',async()=>{
  const value=fixture();value.currentRun!.preparation={...value.currentRun!.preparation!,schema:2,capabilities:[{kind:'project-mcp',id:'conflict',name:'private conflict',state:'unavailable',issueCode:'AGENT_CAPABILITY_NAME_CONFLICT',selectedHash:'e'.repeat(64),paths:[],sources:[]}]};m.session.mockResolvedValue({ok:true,value});mount();
  await screen.findByText(/本轮 Skill 或 MCP 与用户原生能力名称或启停配置冲突/);expect(document.querySelector('details')).toBeNull();originalTaskIdentity();
 });
 it('hides prior run rows while a new owned run is being read',async()=>{
  const view=mount();await screen.findByText('原会话');let finish!:(result:{ok:true;value:ApplicationSessionDiagnostic})=>void;m.session.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  view.rerender(<QueryClientProvider client={client}><SessionApplicationsPanel taskId="t1" runIdentity="next-owned-run" onClose={m.close}/></QueryClientProvider>);
  await screen.findByText('正在读取会话插件');expect(screen.queryByTestId('session-current-title')).toBeNull();expect(document.querySelector('[data-session-plugin]')).toBeNull();
  await act(async()=>{finish({ok:true,value:fixture({title:'新运行原会话',applications:[],currentRun:null,recentRuns:[]})});});await screen.findByText('新运行原会话');expect(screen.queryByText('本次启动时 v1.0.0')).toBeNull();expect(m.session).toHaveBeenCalledTimes(2);for(const f of[m.create,m.open,m.kill,m.newTask])expect(f).not.toHaveBeenCalled();
 });
 it('can retry a failed read without opening or replacing a task',async()=>{
  m.session.mockRejectedValueOnce(new Error('public read failed'));mount();await screen.findByText('会话插件读取未完成');expect(document.querySelector('[data-session-plugin]')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'重试读取'}));await screen.findByText('原会话');expect(m.session).toHaveBeenCalledTimes(2);for(const f of[m.create,m.open,m.kill,m.newTask])expect(f).not.toHaveBeenCalled();
 });
 it('closes the compact dialog with Escape without a task lifecycle action',async()=>{
  mount();await screen.findByText('原会话');fireEvent(screen.getByRole('dialog',{name:'会话插件'}),new Event('cancel',{bubbles:false,cancelable:true}));expect(m.close).toHaveBeenCalledTimes(1);originalTaskIdentity();
 });
});
