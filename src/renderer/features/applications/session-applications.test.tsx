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
describe('P09 real session diagnostic presentation',()=>{
 it.each([false,true])('keeps diagnostic copy feedback outside the long scrolling report (rejected=%s)',async rejected=>{
  const previous=Object.getOwnPropertyDescriptor(navigator,'clipboard'),writeText=rejected?vi.fn().mockRejectedValue(new Error('clipboard unavailable')):vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  try{mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'复制脱敏诊断'}));
   const feedback=await screen.findByText(rejected?'复制未完成，可展开追溯信息查看':'已复制脱敏诊断信息');
   expect(feedback.getAttribute('role')).toBe('status');expect(feedback.closest('[data-testid="session-applications"]')).toBeNull();
   expect(writeText).toHaveBeenCalledWith(JSON.stringify(fixture(),null,2));expect(screen.getByRole('button',{name:'关闭'})).toBeTruthy();expect(m.newTask).not.toHaveBeenCalled();
  }finally{if(previous)Object.defineProperty(navigator,'clipboard',previous);else Reflect.deleteProperty(navigator,'clipboard');}
 });

 it.each([{code:'TRANSIENT_FAILURE',attempts:3,effect:'read-only',reason:'临时服务或网络错误',next:'稍后明确发起新调用'},{code:'AUTH_FAILED',attempts:1,effect:'not-started',reason:'连接认证失败',next:'检查原连接并重新认证'},{code:'SCOPE_DENIED',attempts:0,effect:'not-started',reason:'当前调用没有所需授权',next:'检查项目选用与连接授权'},{code:'CANCELED',attempts:1,effect:'read-only',reason:'本次调用已取消',next:'需要继续时，明确发起新调用'},{code:'TRANSIENT_FAILURE',attempts:null,effect:'unknown',reason:'外部执行结果未知',next:'先核实原执行，不自动重发'},{code:'SOURCE_BUSY',attempts:3,effect:'read-only',reason:'本地邮件来源暂时被占用',next:'解除来源占用后，再明确发起新调用'},{code:'SOURCE_UNAVAILABLE',attempts:1,effect:'read-only',reason:'本地邮件来源暂不可读',next:'检查原来源路径和读取权限'},{code:'UNLISTED_ERROR',attempts:undefined,effect:'not-started',reason:'本次应用调用未完成',next:'核对原连接条件和调用记录'}])('PD exposes $code attempts/reason/next-step without restarting or replaying',async({code,attempts,effect,reason,next})=>{
  const value=fixture();value.applications[0].evidence={...value.applications[0].evidence,successfulToolRequests:0,latestErrorCode:code,latestEffectState:effect,latestAttemptCount:attempts};m.session.mockResolvedValue({ok:true,value});mount();const notice=await screen.findByLabelText('邮件最近调用结果');expect(notice.textContent).toContain(reason);expect(notice.textContent).toContain(next);expect(notice.textContent).toContain(attempts==null?'尝试次数未记录':'本次记录 '+attempts+' 次尝试');expect(notice.textContent).toContain(code);expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it.each(['success','failure'])('PD-02 hides stale current evidence until explicit refresh settles (%s)',async outcome=>{
  const old=fixture();old.applications[0].evidence={...old.applications[0].evidence,latestErrorCode:'TRANSIENT_FAILURE',latestAttemptCount:1,latestEffectState:'read-only'};m.session.mockResolvedValueOnce({ok:true,value:old});mount();await screen.findByLabelText('邮件最近调用结果');let finish!:(v:{ok:true;value:ApplicationSessionDiagnostic})=>void,fail!:(e:Error)=>void;m.session.mockReturnValueOnce(new Promise((resolve,reject)=>{finish=resolve;fail=reject;}));fireEvent.click(screen.getByRole('button',{name:'重新核对'}));await screen.findByText('正在核对原会话');expect(screen.queryByLabelText('邮件最近调用结果')).toBeNull();expect(screen.queryByText('本会话 v1.0.0')).toBeNull();if(outcome==='success'){await act(async()=>{finish({ok:true,value:fixture()});});await screen.findByText('本会话 v1.0.0');expect(screen.queryByLabelText('邮件最近调用结果')).toBeNull();}else{await act(async()=>{fail(new Error('PD explicit diagnostic read failed'));});await screen.findByText('会话诊断未完成');expect(screen.queryByText('本会话 v1.0.0')).toBeNull();expect(screen.queryByLabelText('邮件最近调用结果')).toBeNull();}expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('PD-02 preserves an already-entered new-session summary while its source diagnostic refreshes',async()=>{
  mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));const input=screen.getByRole('textbox',{name:'任务摘要（可选）'});fireEvent.change(input,{target:{value:'PD keep this explicit summary'}});let finish!:(v:{ok:true;value:ApplicationSessionDiagnostic})=>void;m.session.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));await act(async()=>{void client!.invalidateQueries({queryKey:['applications','session','t1']});await Promise.resolve();});expect(screen.getByRole('textbox',{name:'任务摘要（可选）'})).toBe(input);expect(input).toHaveProperty('value','PD keep this explicit summary');await act(async()=>{finish({ok:true,value:fixture()});});expect(input).toHaveProperty('value','PD keep this explicit summary');expect(m.newTask).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
 it('opens copy retention reasons and historical receipts without starting cleanup or a task',async()=>{
  m.session.mockResolvedValue({ok:true,value:fixture({runner:'claude',deliveryCopies:{incomplete:false,issueCode:null,records:[{deliveryId:'delivery-original',relativePath:'claude-deliveries/t1/delivery-original/previous',contentHash:'e'.repeat(64),state:'held',issueCode:'OWNERSHIP_CONFLICT',updatedAt:'2026-10-23T12:00:00.000Z'}]}})});mount();
  await screen.findByText('交付副本保留与清理记录');fireEvent.click(screen.getByText('交付副本保留与清理记录'));
  expect(screen.getByText(/当前内容或目录归属与原记录不符/)).toBeTruthy();expect(screen.getByText(/相对路径：claude-deliveries\/t1\/delivery-original\/previous/)).toBeTruthy();expect(screen.getByText(/仅有完成记录不证明当前路径已不存在/)).toBeTruthy();expect(m.session).toHaveBeenCalledTimes(1);expect(m.create).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();
 });
 it('displays truncated or damaged evidence as incomplete without hiding a healthy App',async()=>{
  m.session.mockResolvedValue({ok:true,value:fixture({deliveryCopies:{incomplete:true,issueCode:'RESOURCE_RECOVERY_REQUIRED',records:[]}})});mount();await screen.findByText(/未完整核对全部记录/);expect(screen.getByText(/原处理记录待核查，不推断副本已清理/)).toBeTruthy();expect(screen.getByText('本会话 v1.0.0')).toBeTruthy();expect(m.kill).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
 it.each(['verified','unavailable'] as const)('keeps a conflicted App unavailable in P09 while the healthy Mail example remains usable (%s original resources)',async resourceState=>{
  const value=fixture(),mail=value.applications[0],zen={...mail,appId:'zentao' as const,name:'禅道',resourceState,issueCode:'AGENT_CAPABILITY_NAME_CONFLICT',skills:[{...mail.skills[0],id:'bug-analysis',name:'original-zen'}],connections:[]};value.applications.push(zen);m.session.mockResolvedValue({ok:true,value});mount();await screen.findByText('禅道');const section=within(screen.getByRole('region',{name:'禅道会话应用'})),healthy=within(screen.getByRole('region',{name:'邮件会话应用'}));expect(section.getByText(/本轮此应用与用户原生能力名称或启停配置冲突/)).toBeTruthy();expect(section.queryByRole('button',{name:/插入示例到终端/})).toBeNull();expect(healthy.getByRole('button',{name:/插入示例到终端/}).hasAttribute('disabled')).toBe(false);expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });

 it('shows unavailable original resources as a native continuation without reporting capacity overflow or replacing the session',async()=>{
  const value=fixture(),current=value.currentRun!;current.preparation!.state='unavailable';current.preparation!.issueCode='CAPABILITY_UNAVAILABLE';current.bridge.connected=false;current.restriction={schema:1,runId:current.id,taskId:value.taskId,snapshotHash:value.snapshotHash!,selectionHash:current.preparation!.selectionHash,reason:'fixed_application_resources_unavailable',issueCode:'CAPABILITY_UNAVAILABLE',restrictedAt:current.startedAt};m.session.mockResolvedValue({ok:true,value});mount();
  await screen.findByText(/原固定应用资源不可用，本次保留原会话继续工作/);expect(screen.queryByText(/本次应用能力内容超过启动容量/)).toBeNull();expect(screen.getByText(/未改用其他版本/)).toBeTruthy();expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('distinguishes a recorded unsupported snapshot from genuinely unrecorded history and never starts or replaces its task',async()=>{
  m.session.mockResolvedValue({ok:true,value:fixture({selection:'unsupported-schema',currentRun:null,applications:[],issues:['HOST_INCOMPATIBLE']})});mount();await screen.findByText(/原能力快照格式暂不支持/);expect(screen.queryByText(/历史能力未知，不自动补入当前应用/)).toBeNull();expect(screen.getByText(/原记录已保留，不自动迁移或替换/)).toBeTruthy();expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('shows capacity-disabled injection separately from initial preparation while the native terminal continues, without lifecycle actions',async()=>{
  const native={...run(),restriction:{schema:1 as const,runId:'run-current',taskId:'t1',snapshotHash:'a'.repeat(64),selectionHash:'b'.repeat(64),reason:'managed_launch_payload_too_large' as const,issueCode:'AGENT_ADAPTER_UNSUPPORTED' as const,restrictedAt:'2026-10-20T14:00:02.000Z'},bridge:{connected:false,observedAt:null,issueCode:null}};
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:native,recentRuns:[]})});mount();await screen.findByText(/本次应用能力内容超过启动容量/);expect(screen.getByText(/Agent 终端：运行中/)).toBeTruthy();expect(screen.getByText(/原文件准备记录保留/)).toBeTruthy();expect(screen.queryByRole('button',{name:/插入示例到终端/})).toBeNull();expect(screen.getByRole('button',{name:/准备新任务/})).toBeTruthy();expect(screen.getByText(/当前未核实连接/)).toBeTruthy();expect(screen.getByText('本会话 v1.0.0')).toBeTruthy();expect(m.kill).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
 it('reports corrupt restriction evidence without presenting it as a healthy or authenticated channel',async()=>{
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:{...run(),restrictionIssue:'RESOURCE_RECOVERY_REQUIRED',bridge:{connected:false,observedAt:null,issueCode:null}},recentRuns:[]})});mount();await screen.findByText(/启动限制记录待核查/);expect(screen.queryByText(/当前连接有效/)).toBeNull();expect(m.kill).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();
 });
 it('explains unverified capability loading while keeping the original native terminal and selection',async()=>{
  const current=run();current.preparation!.state='unavailable';current.preparation!.issueCode='AGENT_ADAPTER_UNSUPPORTED';current.bridge={connected:false,observedAt:null,issueCode:null};current.restriction={schema:1,runId:current.id,taskId:'t1',snapshotHash:'a'.repeat(64),selectionHash:current.preparation!.selectionHash,reason:'managed_capabilities_unavailable',issueCode:'AGENT_ADAPTER_UNSUPPORTED',restrictedAt:current.startedAt};m.session.mockResolvedValue({ok:true,value:fixture({currentRun:current,recentRuns:[]})});mount();await screen.findByText(/本次应用能力未完成加载核验/);expect(screen.getByText(/Agent 终端：运行中/)).toBeTruthy();expect(screen.getByText(/原会话选择与历史保留/)).toBeTruthy();expect(screen.getByText('本会话 v1.0.0')).toBeTruthy();expect(screen.queryByRole('button',{name:/插入示例到终端/})).toBeNull();expect(m.kill).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
 it('keeps fixed/default/CLI evidence separate and never equates a call or bridge with Skill discovery or reading',async()=>{mount();await screen.findByText('本会话 v1.0.0');expect(screen.getByText(/新会话默认 v2.0.0/)).toBeTruthy();expect(screen.getByText(/Agent 发现 Skill：未验证/)).toBeTruthy();expect(screen.getByText(/Agent 读取 Skill：未验证/)).toBeTruthy();expect(screen.getByText(/本次运行工具请求：1 次/)).toBeTruthy();expect(screen.queryByRole('button',{name:/同步|更换版本|重启 Agent/})).toBeNull();expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();});
 it('keeps network health distinct from original-package configuration compatibility and preserves the original identity',async()=>{mount();await screen.findByText(/发件账号：当前发件 · 当前不可用/);expect(screen.getByText(/创建时：原发件/)).toBeTruthy();expect(screen.getByText(/原包配置兼容/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'检查邮件与连接'}));expect(m.openApplications).toHaveBeenCalledWith('mail','p1');expect(m.kill).not.toHaveBeenCalled();});
 it('refreshes only the read RPC and starts a new-session composer only on an explicit action',async()=>{mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'重新核对'}));await waitFor(()=>expect(m.session).toHaveBeenCalledTimes(2));expect(m.newTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));expect(m.newTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'前往新会话输入框'}));expect(m.newTask).toHaveBeenCalledWith('p1');expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();});
 it('shows unknown history and old-run evidence without giving the old run current connectivity',async()=>{m.session.mockResolvedValue({ok:true,value:fixture({selection:'unknown-history',currentRun:null,applications:[]})});mount();await screen.findByText(/历史能力未知，不自动补入当前应用/);expect(screen.getByText(/当前没有可核实的应用运行证据/)).toBeTruthy();fireEvent.click(screen.getByText('最近 1 次历史运行证据'));expect(screen.getByText(/历史运行，不作为当前就绪依据/)).toBeTruthy();expect(screen.queryByText('本会话 v1.0.0')).toBeNull();});
 it('keeps an orphaned or foreign active record uncertain instead of labelling it a stopped historical run',async()=>{m.session.mockResolvedValue({ok:true,value:fixture({currentRun:null,recentRuns:[{...run(false),state:'orphaned',endedAt:null}]})});mount();await screen.findByText('最近 1 次其他运行记录');expect(screen.getByText(/运行归属或退出状态待核查/)).toBeTruthy();expect(screen.queryByText(/历史运行，不作为当前就绪依据/)).toBeNull();});
 it('drops cached current-run claims and re-reads when the owned task terminal/run identity changes',async()=>{const view=mount();await screen.findByText(/本次运行工具请求：1 次/);const next=fixture({currentRun:null});next.applications[0].evidence.toolRequests=0;next.applications[0].evidence.successfulToolRequests=0;m.session.mockResolvedValue({ok:true,value:next});view.rerender(<QueryClientProvider client={client}><SessionApplicationsPanel taskId="t1" runIdentity="new-run" onClose={m.close}/></QueryClientProvider>);await screen.findByText(/当前没有可核实的应用运行证据/);await waitFor(()=>expect(m.session).toHaveBeenCalledTimes(2));expect(screen.queryByText(/本次运行工具请求：1 次/)).toBeNull();expect(m.open).not.toHaveBeenCalled();});
 it('shows corruption and read failures without taking the place of the original session or enabling new-session actions for a deleted project',async()=>{m.session.mockResolvedValue({ok:true,value:fixture({selection:'corrupt',canNewSession:false,currentRun:null,applications:[],issues:['SNAPSHOT_CORRUPT']})});mount();await screen.findByText(/固定能力快照损坏/);expect(screen.queryByRole('button',{name:'使用当前版本新建会话'})).toBeNull();expect(m.create).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();});
});

describe('visible per-capability preparation and exact conflict locations',()=>{
 function detailed(){const value=fixture(),current=value.currentRun!,base=current.preparation!;current.preparation={...base,schema:2,capabilities:[{kind:'standard-skill',id:'database-query',name:'database-query',selectedHash:'e'.repeat(64),paths:['/private/selected/DB/SKILL.md'],state:'unavailable',issueCode:'AGENT_CAPABILITY_NAME_CONFLICT',sources:[{kind:'skill-config',name:'database-query',path:'/private/selected/DB/SKILL.md',configurationPath:'/private/project/.codex/config.toml',location:'file'}]},{kind:'project-mcp',id:'smartdd-project-original',name:'smartdd-project-original',selectedHash:'f'.repeat(64),paths:[],state:'unavailable',issueCode:'AGENT_CAPABILITY_NAME_CONFLICT',sources:[{kind:'mcp',name:'smartdd-project-original',path:'/private/project/.codex/config.toml',configurationPath:null,location:'file'}]}]} as unknown as NonNullable<SessionRunDiagnostic['preparation']>;return value;}
 it('shows omitted independent Skill/MCP and their exact paths without claiming Agent use or modifying configuration',async()=>{
  m.session.mockResolvedValue({ok:true,value:detailed()});mount();await screen.findByText('本次能力准备与冲突来源');fireEvent.click(screen.getByText('本次能力准备与冲突来源'));expect(screen.getByText('database-query')).toBeTruthy();expect(screen.getByText('smartdd-project-original')).toBeTruthy();expect(screen.getAllByText(/\/private\/project\/\.codex\/config.toml/).length).toBeGreaterThan(0);expect(screen.getByText(/仅记录准备结果，不证明 Agent 已发现或读取/)).toBeTruthy();expect(m.open).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('keeps an earlier prepared item unavailable after native-only restriction',async()=>{
  const value=detailed(),current=value.currentRun!,capabilities=(current.preparation as unknown as {capabilities:{state:string;issueCode:string|null}[]}).capabilities;for(const item of capabilities){item.state='prepared';item.issueCode=null;}current.restriction={schema:1,runId:current.id,taskId:value.taskId,snapshotHash:value.snapshotHash!,selectionHash:current.preparation!.selectionHash,reason:'managed_launch_payload_too_large',issueCode:'AGENT_ADAPTER_UNSUPPORTED',restrictedAt:current.startedAt};m.session.mockResolvedValue({ok:true,value});mount();await screen.findByText('本次能力准备与冲突来源');expect(screen.getAllByText(/本轮已停用；保留原准备记录/)).toHaveLength(2);expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('labels schema1 preparation as missing per-capability evidence instead of inferring current defaults',async()=>{
  m.session.mockResolvedValue({ok:true,value:fixture({recentRuns:[]})});mount();await screen.findByText(/该运行未记录逐项准备证据/);expect(m.session).toHaveBeenCalledTimes(1);expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();
 });
});

describe('application conflict source disclosure uses this run only',()=>{
 it.each([true,false])('opens captured source or explicit missing evidence without mutation (%s captured)',async recorded=>{
  const value=fixture({recentRuns:[]}),app=value.applications[0];app.issueCode='AGENT_CAPABILITY_NAME_CONFLICT';if(recorded)value.currentRun!.preparation={...value.currentRun!.preparation!,schema:2,capabilities:[{kind:'application',id:'mail',name:'mail',selectedHash:app.packageHash!,paths:app.skills.map(s=>s.projectionPath),state:'unavailable',issueCode:app.issueCode,sources:[{kind:'mcp',name:'mail-user-mcp-conflict',path:'/private/user/.mcp.json',configurationPath:null,location:'file'}]}]} as unknown as NonNullable<SessionRunDiagnostic['preparation']>;
  m.session.mockResolvedValue({ok:true,value});mount();await screen.findByRole('button',{name:'查看冲突'});expect(screen.queryByText('以下为本轮准备时记录的冲突来源；不会修改配置或重新启动 Agent。')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'查看冲突'}));expect(screen.getByRole('button',{name:'查看冲突'}).getAttribute('aria-expanded')).toBe('true');if(recorded)expect(screen.getByText(/来源路径：\/private\/user\/\.mcp.json/)).toBeTruthy();else expect(screen.getByText(/本轮未记录具体冲突来源/)).toBeTruthy();expect(m.session).toHaveBeenCalledTimes(1);expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
});

it('shows verified current Skill reads without claiming discovery or adding tool use',async()=>{const value=fixture();value.applications[0].evidence.skillRead='verified';value.applications[0].evidence.toolRequests=0;m.session.mockResolvedValue({ok:true,value});mount();await screen.findByText(/已核验本次原生读取/);expect(screen.getByText(/Agent 发现 Skill：未验证/)).toBeTruthy();expect(m.create).not.toHaveBeenCalled();});

it('shows catalog discovery without claiming Skill body reading',async()=>{const value=fixture();value.applications[0].evidence.skillDiscovery='verified';m.session.mockResolvedValue({ok:true,value});mount();await screen.findByText(/已核验本次原生清单/);expect(screen.getByText(/Agent 读取 Skill：未验证/)).toBeTruthy();});

it('labels retained Skill observations as historical and warns on damaged records',async()=>{const value=fixture();value.recentRuns[0].skillObservations=[{runId:value.recentRuns[0].id,appId:'mail',skillId:'work-assistant',kind:'read',packageHash:'c'.repeat(64),recordHash:'d'.repeat(64),observedAt:'2026-10-20T14:00:00.000Z',cliVersion:'0.162.1'}];value.recentRuns[0].skillObservationIssue='RESOURCE_RECOVERY_REQUIRED';m.session.mockResolvedValue({ok:true,value});mount();await screen.findByText(/Skill 历史证据不完整或已损坏/);expect(screen.getByText(/仅表示原运行曾观察到的证据/)).toBeTruthy();expect(screen.getByText(/Agent 读取 Skill：未验证/)).toBeTruthy();expect(m.open).not.toHaveBeenCalled();});


describe('T66 explicit optional summary handoff',()=>{
 it('passes only the user selected multiline text to the same project composer without reading or mutating old history',async()=>{
  mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));
  const input=screen.getByRole('textbox',{name:'任务摘要（可选）'});expect(input).toHaveProperty('value','');expect(m.newTask).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled();
  const summary='保留我选择的摘要\n  第二行：原样传递，不包含诊断配置。';fireEvent.change(input,{target:{value:summary}});fireEvent.click(screen.getByRole('button',{name:'前往新会话输入框'}));
  expect(m.prepareApplicationTask).toHaveBeenCalledExactlyOnceWith('p1',summary);expect(m.newTask).not.toHaveBeenCalled();expect(m.session).toHaveBeenCalledTimes(1);expect(m.close).toHaveBeenCalledTimes(1);expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('discards a canceled summary and reopens the original fixed-version diagnostic without navigation',async()=>{
  mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));fireEvent.change(screen.getByRole('textbox',{name:'任务摘要（可选）'}),{target:{value:'取消的文字'}});fireEvent.click(screen.getByRole('button',{name:'返回原会话'}));
  expect(screen.getByText('本会话 v1.0.0')).toBeTruthy();expect(m.prepareApplicationTask).not.toHaveBeenCalled();expect(m.newTask).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));expect(screen.getByRole('textbox',{name:'任务摘要（可选）'})).toHaveProperty('value','');
 });
 it('treats whitespace as no summary and closes Escape back to the original diagnostic',async()=>{
  mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));fireEvent(screen.getByRole('dialog',{name:'使用当前版本新建会话'}),new Event('cancel',{bubbles:false,cancelable:true}));
  expect(screen.getByText('本会话 v1.0.0')).toBeTruthy();expect(m.newTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));fireEvent.change(screen.getByRole('textbox',{name:'任务摘要（可选）'}),{target:{value:' \n  '}});fireEvent.click(screen.getByRole('button',{name:'前往新会话输入框'}));
  expect(m.newTask).toHaveBeenCalledExactlyOnceWith('p1');expect(m.prepareApplicationTask).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
 it('cannot carry the old summary into a different task or project when the panel changes identity',async()=>{
  const view=mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));fireEvent.change(screen.getByRole('textbox',{name:'任务摘要（可选）'}),{target:{value:'旧项目内容'}});
  m.session.mockResolvedValue({ok:true,value:fixture({taskId:'t2',projectId:'p2',title:'另一项目会话'})});view.rerender(<QueryClientProvider client={client}><SessionApplicationsPanel taskId="t2" onClose={m.close}/></QueryClientProvider>);await screen.findByText('另一项目会话');
  expect(screen.queryByRole('textbox',{name:'任务摘要（可选）'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));expect(screen.getByRole('textbox',{name:'任务摘要（可选）'})).toHaveProperty('value','');fireEvent.click(screen.getByRole('button',{name:'前往新会话输入框'}));expect(m.newTask).toHaveBeenCalledExactlyOnceWith('p2');expect(m.prepareApplicationTask).not.toHaveBeenCalled();
 });
});

it('focuses the optional summary after the native dialog initial focus is established',async()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');this.querySelector<HTMLButtonElement>('button')?.focus();}});
 mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'使用当前版本新建会话'}));const summary=screen.getByRole('textbox',{name:'任务摘要（可选）'});expect(document.activeElement).toBe(summary);expect(m.newTask).not.toHaveBeenCalled();expect(m.prepareApplicationTask).not.toHaveBeenCalled();
});


describe('QA P09 confirmed header grouping with real evidence boundaries',()=>{
 it('groups the App mark, original fixed version and current default without calling file verification Agent use',async()=>{
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:null})});const view=mount();const card=await screen.findByLabelText('邮件会话应用'),header=card.querySelector('header')!;
  expect(header.querySelector('.m10-appmark.mail svg')).toBeTruthy();expect(header.querySelector('div>strong .m10-package-version')?.textContent).toContain('本会话 v1.0.0');expect(header.querySelector('div>small')?.textContent).toContain('新会话默认 v2.0.0');expect(header.querySelector('div>small')?.textContent).toContain('当前项目已启用');expect(header.querySelector('.m10-state')?.textContent).toBe('原资源已核对');
  expect(view.container.textContent).toContain('当前没有可核实的应用运行证据');expect(view.container.textContent).toContain('Agent 读取 Skill：未验证');expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();
 });
 it('keeps the current task title with its project in the dialog heading and retains original data',async()=>{
  const value=fixture();m.session.mockResolvedValue({ok:true,value});const view=mount('测试项目');await screen.findByText('原会话');const d=view.container.querySelector('dialog')!;expect(d.classList.contains('m10-session-dialog')).toBe(true);expect(d.querySelector('header [data-testid=session-current-title]')?.textContent).toBe('原会话');expect(d.querySelector('.m10-dialog-subtitle')?.textContent).toBe('测试项目 · 原会话');expect(d.querySelector('[data-testid=session-applications] h3')?.textContent).not.toBe('原会话');expect(m.session).toHaveBeenCalledTimes(1);expect(value.applications[0].fixedVersion).toBe('1.0.0');expect(m.create).not.toHaveBeenCalled();
 });
});

it('QA project applications entry opens only the diagnosed original project without starting or switching the task',async()=>{mount();await screen.findByText('原会话');fireEvent.click(screen.getByRole('button',{name:'项目应用'}));expect(m.openProject).toHaveBeenCalledExactlyOnceWith('p1','applications');expect(m.close).toHaveBeenCalledTimes(1);expect(m.create).not.toHaveBeenCalled();expect(m.open).not.toHaveBeenCalled();expect(m.kill).not.toHaveBeenCalled();});
describe('M11 S8 run plan diagnostics',()=>{
 it('keeps observed Skill reading distinct from the still-unverified chat authorization level',async()=>{
  const current={...run(),runPlan:{cliVersion:'0.166.0',verified:true,nativeSendEvidence:false,sandboxSource:'inherited-named-permissions',levels:(['L0.skill','L0.mcp','L0.cli','L1','L2','L3'] as const).map(level=>({level,state:level==='L3'?'unverified' as const:'declared' as const})),applications:[]},runPlanIssue:null};
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:current})});mount();
  const plan=await screen.findByLabelText('本次运行计划');
  expect(within(plan).getByText('聊天原话授权在此版本上尚未验证，保持关闭：发送使用页面授权。')).toBeTruthy();
  expect(plan.textContent).not.toContain('聊天原话授权与「已确认读取 Skill」在此版本上尚未验证');
  expect(plan.querySelector('li[data-state=declared] code')?.textContent).toBe('L0.skill');
 });
 it('shows declared levels, CLI entry and closed L2/L3 with page authorization note',async()=>{
  const current={...run(),runPlan:{cliVersion:'0.166.0',verified:true,nativeSendEvidence:false,sandboxSource:'inherited-named-permissions',levels:(['L0.skill','L0.mcp','L0.cli','L1','L2','L3'] as const).map(level=>({level,state:['L2','L3'].includes(level)?'unverified' as const:'declared' as const})),applications:[{appId:'zentao',primaryEntry:'cli' as const,effectiveEntry:'cli' as const,fallback:false,reason:null}]},runPlanIssue:null};
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:current})});mount();
  const plan=await screen.findByLabelText('本次运行计划');
  expect(within(plan).getByText(/Codex 0\.166\.0 · 已声明版本/)).toBeTruthy();
  const levels=within(plan).getByLabelText('适配等级').querySelectorAll('li');expect(levels).toHaveLength(6);
  expect([...levels].filter(li=>li.getAttribute('data-state')==='unverified').map(li=>li.querySelector('code')?.textContent)).toEqual(['L2','L3']);
  expect(within(plan).getByText('生效入口 · CLI')).toBeTruthy();expect(within(plan).getByText(/发送使用页面授权/)).toBeTruthy();
 });
 it('shows an undeclared version as degraded with the fallback reason',async()=>{
  const current={...run(),runPlan:{cliVersion:'0.199.0',verified:false,nativeSendEvidence:false,sandboxSource:'unchanged-user-policy',levels:(['L0.skill','L0.mcp','L0.cli','L1','L2','L3'] as const).map(level=>({level,state:['L0.skill','L0.mcp'].includes(level)?'best-effort' as const:'unverified' as const})),applications:[{appId:'zentao',primaryEntry:'cli' as const,effectiveEntry:'mcp' as const,fallback:true,reason:'该 Agent 版本未声明 CLI 交付'}]},runPlanIssue:null};
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:current})});mount();
  const plan=await screen.findByLabelText('本次运行计划');
  expect(within(plan).getByText(/未声明版本，按降级处理/)).toBeTruthy();expect(within(plan).getByText(/已降级为只读 MCP：该 Agent 版本未声明 CLI 交付/)).toBeTruthy();
 });
 it('does not invent a plan for legacy runs and flags an unverifiable plan',async()=>{
  mount();await screen.findByText('原会话');expect(screen.queryByLabelText('本次运行计划')).toBeNull();cleanup();client.clear();
  m.session.mockResolvedValue({ok:true,value:fixture({currentRun:{...run(),runPlan:null,runPlanIssue:'RESOURCE_RECOVERY_REQUIRED'}})});mount();
  expect(await screen.findByText(/本次运行计划无法核验/)).toBeTruthy();
 });
});
