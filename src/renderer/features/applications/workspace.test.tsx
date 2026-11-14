import {applicationMetadata} from '@shared/application-provider-metadata';
// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {toast} from 'sonner';
import type {ApplicationConnection,ApplicationId,ProjectApplicationSelection,VerifiedConnectionCandidate} from '@shared/application-connections';
import {navigation} from '@renderer/core/navigation';
import {ConnectionForm} from './connection-form';
import {ApplicationsWorkspace} from './workspace';
import {APPLICATION_SKILL_EXAMPLES} from '@shared/application-terminal';
import type {CatalogItem} from './api';
import type {PluginPanel} from '@shared/plugins';
const m=vi.hoisted(()=>({sessionChangeImpact:vi.fn(async()=>({ok:true,value:{runningCount:0,globalDisabled:false,checkedAt:"2026-11-13T00:00:00Z"}})),pluginChoose:vi.fn(),pluginSetEnabled:vi.fn(),pluginUninstall:vi.fn(),pluginStartupStatus:vi.fn(async()=>({ok:true,value:null})),pluginCatalog:vi.fn(async()=>({ok:true,value:[]})),impact:vi.fn(),versions:vi.fn(async()=>({ok:true,value:{appId:'mail',items:[],checkedAt:'2026-10-20T00:00:00.000Z',recoveryPending:0}})),catalog:vi.fn(),connections:vi.fn(),projectSettings:vi.fn(),select:vi.fn(),setAdded:vi.fn(),setEnabled:vi.fn(),setConnectionEnabled:vi.fn(),disconnect:vi.fn(),builtinDefaults:vi.fn(),testConnection:vi.fn(),saveConnection:vi.fn(),discardConnectionTest:vi.fn(),projectList:vi.fn(),projectGet:vi.fn(),refreshTasks:vi.fn(),tasks:[] as {id:string;projectId:string;ptyId:string|null;title:string}[]}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m,projects:{list:m.projectList,get:m.projectGet},dialog:{pickDirectory:vi.fn()}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{get tasks(){return m.tasks;},refresh:m.refreshTasks}}));
vi.mock('./plugin-panel',()=>({PluginPages:({onNavigate}:{onNavigate?:()=>void})=><button onClick={()=>{navigation.openTask('fixture-handoff-task');onNavigate?.();}}>Fixture task handoff</button>}));
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const app=(id:ApplicationId,added=true):CatalogItem=>({...applicationMetadata(id),appId:id,added,enabled:added,revision:3,displayName:id==='mail'?'邮件':'禅道',description:id==='mail'?'本机邮件与草稿':'本人 Bug 与研发需求',defaultPackageHash:'a'.repeat(64),version:'1.0.0',skills:[{id:id==='mail'?'work-assistant':'bug-analysis',description:'Private fixture skill'}],tools:[],versions:[],connectionCount:0});
const candidate=(n=1):VerifiedConnectionCandidate=>({operationId:uid(n),connectionId:uid(100+n),candidateHash:'b'.repeat(64),expectedRevision:0,identity:{providerId:'zentao',serviceId:'private-service',accountId:'private-user',contractMajor:1},compatibility:{connectionId:null,expectedRevision:0,configHash:'c'.repeat(64),referenceHash:'d'.repeat(64),impacts:[],planHash:'e'.repeat(64)},expiresAt:new Date(Date.now()+60000).toISOString()});
const connection=(id:number,kind:'foxmail'|'smtp'|'zentao',name:string):ApplicationConnection=>({id:uid(id),appId:kind==='zentao'?'zentao':'mail',providerId:kind,name,config:kind==='zentao'?{kind,baseUrl:'https://private.example.test/',username:'private-user',authMode:'token'}:kind==='foxmail'?{kind,sourcePath:'/private/fixture/'+id,account:name+'@example.test',queryDays:30}:{kind,host:'smtp.private.example.test',port:465,username:name+'@example.test',fromAddress:name+'@example.test',authMode:'password',mode:'implicit-tls'},revision:7,configRevision:1,identityRevision:1,secretRevision:1,policyRevision:1,identity:{providerId:kind,serviceId:'private-service-'+id,accountId:name,contractMajor:1},enabled:true,authorization:'connected',health:'healthy',healthCode:null,healthMessage:null,testedAt:new Date().toISOString(),hasSecret:kind!=='foxmail',cleanupPending:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const project={id:'project-1',name:'隔离项目',archivedAt:null};let catalog:CatalogItem[],connections:ApplicationConnection[],settings:Record<string,ProjectApplicationSelection>,client:QueryClient;
const ok=<T,>(value:T)=>({ok:true as const,value});
function mount(node:React.ReactNode){client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);}
function fill(){fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Private fixture'}});fireEvent.change(screen.getByLabelText('禅道服务地址'),{target:{value:'https://private.example.test/'}});fireEvent.change(screen.getByLabelText('禅道账号'),{target:{value:'private-user'}});fireEvent.change(screen.getByLabelText('认证凭据'),{target:{value:'form-canary-do-not-persist'}});}
beforeEach(()=>{
 vi.clearAllMocks();m.builtinDefaults.mockResolvedValue({ok:true,value:{appId:"mail",slots:[{id:"foxmail",connection_id:uid(11),revision:1,requiresDefault:false},{id:"smtp",connection_id:uid(21),revision:1,requiresDefault:false}]}});m.pluginCatalog.mockResolvedValue({ok:true,value:[]});localStorage.clear();navigation.currentProjectId=null;navigation.openApplications();m.tasks=[];
 catalog=[app('zentao'),app('mail')];connections=[connection(11,'foxmail','来源 A'),connection(12,'foxmail','来源 B'),connection(21,'smtp','发件 A'),connection(22,'smtp','发件 B'),connection(31,'zentao','禅道 A'),connection(32,'zentao','禅道 B')];settings={mail:{projectId:project.id,appId:'mail',enabled:true,revision:1,pendingOperationId:null,connections:{foxmail:uid(11),smtp:uid(21)},slotRevisions:{foxmail:1,smtp:1}},zentao:{projectId:project.id,appId:'zentao',enabled:true,revision:1,pendingOperationId:null,connections:{zentao:uid(31)},slotRevisions:{zentao:1}}};
 m.catalog.mockImplementation(async()=>ok(structuredClone(catalog)));m.connections.mockImplementation(async(id:ApplicationId)=>ok(structuredClone(connections.filter(c=>c.appId===id))));m.projectSettings.mockImplementation(async(_id:string,appId:ApplicationId)=>ok(structuredClone(settings[appId])));m.select.mockImplementation(async input=>{settings[input.appId as ApplicationId]={...settings[input.appId as ApplicationId],...input,revision:input.expectedRevision+1};return ok(structuredClone(settings[input.appId as ApplicationId]));});m.setAdded.mockImplementation(async(id:ApplicationId,added:boolean)=>{catalog=catalog.map(a=>a.appId===id?{...a,added,enabled:added,revision:a.revision+1}:a);return ok(catalog.find(a=>a.appId===id));});
 m.impact.mockImplementation(async input=>ok({kind:input.kind,appId:input.appId??'zentao',checkedAt:'2026-10-22T00:00:00Z',connections:[],projects:[],runs:[]}));
 m.testConnection.mockResolvedValue(ok(candidate()));m.saveConnection.mockResolvedValue(ok(connection(1,'zentao','Saved fixture')));m.discardConnectionTest.mockResolvedValue(ok(undefined));m.projectList.mockResolvedValue([project]);m.projectGet.mockResolvedValue(project);m.refreshTasks.mockResolvedValue(undefined);
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();client?.clear();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');vi.restoreAllMocks();});
describe('actual production application forms with explicit RPC fixtures',()=>{


 it.each([
  {kind:'smtp' as const,mode:'password',existing:false},
  {kind:'zentao' as const,mode:'token',existing:false},
  {kind:'zentao' as const,mode:'password',existing:false},
  {kind:'smtp' as const,mode:'password',existing:true},
 ])('RC missing required credential stays local for $kind/$mode existing=$existing',async scenario=>{
  const original=scenario.existing?{...connection(91,scenario.kind,'RCNoStoredCredential'),hasSecret:false}:undefined;
  mount(<ConnectionForm kind={scenario.kind} connection={original} onClose={vi.fn()} onSaved={vi.fn()}/>);
  if(!original){
   fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'RC required-credential fixture'}});
   if(scenario.kind==='smtp'){
    for(const[label,value]of [['SMTP 服务主机','127.0.0.1'],['SMTP 登录账号','fixture@example.test'],['SMTP 发件地址','fixture@example.test']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
   }else{
    fireEvent.change(screen.getByLabelText('禅道服务地址'),{target:{value:'https://fixture.example.test/biz/'}});fireEvent.change(screen.getByLabelText('禅道账号'),{target:{value:'fixture'}});fireEvent.change(screen.getByLabelText('禅道认证方式'),{target:{value:scenario.mode}});
   }
  }
  expect((screen.getByLabelText('认证凭据')as HTMLInputElement).required).toBe(true);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'测试连接'}));});
  expect(m.testConnection).not.toHaveBeenCalled();expect(m.saveConnection).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('认证');expect((screen.getByRole('button',{name:'保存连接'})as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('认证凭据'),{target:{value:'RC exact credential bytes '}});fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('身份验证通过，可保存连接');expect(m.testConnection).toHaveBeenCalledTimes(1);expect(m.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({secret:'RC exact credential bytes '}));
 });
 it.each([
  {kind:'smtp' as const,label:'SMTP 端口',value:'1.5',message:'端口必须为1–65535之间的整数。'},
  {kind:'foxmail' as const,label:'邮件查询天数',value:'1.5',message:'请输入1–100之间的整数天数。'},
 ])('RC shows actionable local validation for $kind/$label without technical schema output',async scenario=>{
  mount(<ConnectionForm kind={scenario.kind} onClose={vi.fn()} onSaved={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'RC validation copy'}});
  const fields=scenario.kind==='smtp'?[['SMTP 服务主机','127.0.0.1'],['SMTP 登录账号','rc@example.test'],['SMTP 发件地址','rc@example.test'],['认证凭据','RC local memory only']]:[['Foxmail 本地来源','/private/tmp/rc'],['Foxmail 邮箱账号','rc@example.test']];
  for(const[label,value]of fields)fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText(scenario.label),{target:{value:scenario.value}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'测试连接'}));});
  expect(screen.getByRole('alert').textContent).toBe(scenario.message);expect(m.testConnection).not.toHaveBeenCalled();expect(m.saveConnection).not.toHaveBeenCalled();
 });






















 it('invalidates tested credentials after a field edit and saves only the new host receipt',async()=>{
  const onSaved=vi.fn(async()=>{}),onClose=vi.fn();mount(<ConnectionForm kind="zentao" onSaved={onSaved} onClose={onClose}/>);fill();const save=screen.getByRole('button',{name:'保存连接'}) as HTMLButtonElement;expect(save.disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('身份验证通过，可保存连接');expect(save.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Edited fixture'}});expect(save.disabled).toBe(true);await waitFor(()=>expect(m.discardConnectionTest).toHaveBeenCalledWith('zentao',uid(1)));m.testConnection.mockResolvedValueOnce(ok(candidate(2)));fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('身份验证通过，可保存连接');fireEvent.click(save);await waitFor(()=>expect(onClose).toHaveBeenCalledTimes(1));expect(m.saveConnection).toHaveBeenCalledWith('zentao',uid(2),'b'.repeat(64),undefined);expect((screen.getByLabelText('认证凭据') as HTMLInputElement).value).toBe('');expect(localStorage.length).toBe(0);
 });
 it('discards a late successful test after the user cancels and never submits a connection',async()=>{
  let finish!:(value:ReturnType<typeof ok<VerifiedConnectionCandidate>>)=>void;m.testConnection.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const closed=vi.fn(),mounted=mount(<ConnectionForm kind="zentao" onSaved={async()=>{}} onClose={closed}/>);fill();fireEvent.click(screen.getByRole('button',{name:'测试连接'}));expect((screen.getByLabelText('连接名称').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'取消'}));mounted.unmount();finish(ok(candidate()));await waitFor(()=>expect(m.discardConnectionTest).toHaveBeenCalledWith('zentao',uid(1)));expect(closed).toHaveBeenCalledTimes(1);expect(m.saveConnection).not.toHaveBeenCalled();
 });
 it.each(['smtp.example.test?account=fixture','smtp.example.test#fragment'])('RC rejects URL delimiters in an SMTP host before IPC: %s',async host=>{
  mount(<ConnectionForm kind="smtp" onSaved={vi.fn()} onClose={vi.fn()}/>);for(const[label,value]of [['连接名称','RC invalid host'],['SMTP 服务主机',host],['SMTP 登录账号','fixture@example.test'],['SMTP 发件地址','fixture@example.test'],['认证凭据','RC form-only fixture']])fireEvent.change(screen.getByLabelText(label),{target:{value}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'测试连接'}));});expect(m.testConnection).not.toHaveBeenCalled();expect(m.saveConnection).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toBe('请填写邮件服务主机名。');
 });
 it('RC keeps an existing stored SMTP credential usable with an empty replacement field',async()=>{
  const existing=connection(92,'smtp','RCStoredCredential');mount(<ConnectionForm kind="smtp" connection={existing} onSaved={vi.fn()} onClose={vi.fn()}/>);expect((screen.getByLabelText('认证凭据')as HTMLInputElement).required).toBe(false);expect((screen.getByLabelText('认证凭据')as HTMLInputElement).value).toBe('');fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('身份验证通过，可保存连接');expect(m.testConnection).toHaveBeenCalledTimes(1);expect(m.testConnection.mock.calls[0][0]).toMatchObject({id:existing.id,expectedRevision:existing.revision,config:existing.config});expect(m.testConnection.mock.calls[0][0]).not.toHaveProperty('secret');
 });
 it('keeps existing identity fields locked and omits an empty replacement secret',async()=>{
  const existing=connection(31,'zentao','原连接');mount(<ConnectionForm kind="zentao" connection={existing} onSaved={async()=>{}} onClose={()=>{}}/>);expect((screen.getByLabelText('禅道服务地址') as HTMLInputElement).disabled).toBe(true);expect((screen.getByLabelText('禅道账号') as HTMLInputElement).disabled).toBe(true);expect((screen.getByLabelText('认证凭据') as HTMLInputElement).value).toBe('');fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('身份验证通过，可保存连接');expect(m.testConnection.mock.calls[0][0]).toMatchObject({id:existing.id,expectedRevision:7,config:existing.config});expect(m.testConnection.mock.calls[0][0]).not.toHaveProperty('secret');
 });
 it('requires the explicit compatibility impact acknowledgement returned for this candidate',async()=>{
  const value=candidate();value.compatibility.impacts=[{packageHash:'a'.repeat(64),version:'0.9.0',taskId:'old-task',status:'unverified',reason:'旧版本尚未核验'}];m.testConnection.mockResolvedValueOnce(ok(value));mount(<ConnectionForm kind="zentao" onSaved={async()=>{}} onClose={()=>{}}/>);fill();fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('旧版本尚未核验',{exact:false});expect((screen.getByRole('button',{name:'保存连接'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'保存连接'}));await waitFor(()=>expect(m.saveConnection).toHaveBeenCalledWith('zentao',uid(1),'b'.repeat(64),'e'.repeat(64)));
 });
 it('PC keeps distinct historical impacts in an accessible review list and invalidates its acknowledgement after edits',async()=>{
  const value=candidate();value.compatibility.impacts=[{packageHash:'a'.repeat(64),version:'0.9.2',taskId:'historical-incompatible',status:'incompatible',reason:'此版本不能等价使用候选配置'},{packageHash:'c'.repeat(64),version:'0.9.3',taskId:'historical-unverified',status:'unverified',reason:'历史包契约或配置转换器无法核验'}];m.testConnection.mockResolvedValueOnce(ok(value));mount(<ConnectionForm kind="zentao" onSaved={async()=>{}} onClose={()=>{}}/>);fill();fireEvent.click(screen.getByRole('button',{name:'测试连接'}));const review=await screen.findByLabelText('配置兼容预检'),items=within(review).getAllByRole('listitem');expect(items).toHaveLength(2);expect(items[0].textContent).toContain('v0.9.2 · 会话 historical-incompatible');expect(items[0].textContent).toContain('此版本不能等价使用候选配置');expect(items[1].textContent).toContain('v0.9.3 · 会话 historical-unverified');expect(items[1].textContent).toContain('历史包契约或配置转换器无法核验');const save=screen.getByRole('button',{name:'保存连接'})as HTMLButtonElement;expect(save.disabled).toBe(true);fireEvent.click(within(review).getByRole('checkbox'));expect(save.disabled).toBe(false);fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Edited after impact review'}});expect(save.disabled).toBe(true);expect(screen.queryByLabelText('配置兼容预检')).toBeNull();await waitFor(()=>expect(m.discardConnectionTest).toHaveBeenCalledWith('zentao',value.operationId));expect(m.saveConnection).not.toHaveBeenCalled();
 });





});





it.each(['smtp','foxmail'] as const)('RK preserves an empty %s numeric field until valid input is restored;invalid input never reaches IPC',async kind=>{
 mount(<ConnectionForm kind={kind} onSaved={vi.fn()} onClose={vi.fn()}/>);
 const label=kind==='smtp'?'SMTP 端口':'邮件查询天数',value=kind==='smtp'?'465':'30',field=kind==='smtp'?'port':'queryDays';
 const values=kind==='smtp'?[['连接名称','RK numeric'],['SMTP 服务主机','smtp.example.test'],['SMTP 登录账号','rk@example.test'],['SMTP 发件地址','rk@example.test'],['认证凭据','RK public fixture']]:[['连接名称','RK numeric'],['Foxmail 本地来源','/private/tmp/RK_SELF_ONLY'],['Foxmail 邮箱账号','rk@example.test']];
 for(const[name,text]of values)fireEvent.change(screen.getByLabelText(name),{target:{value:text}});
 const input=screen.getByLabelText(label)as HTMLInputElement;fireEvent.change(input,{target:{value:''}});expect(input.value).toBe('');expect(input.validity.valueMissing).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'测试连接'}));expect(screen.getByRole('alert').textContent).toBe(kind==='smtp'?'端口必须为1–65535之间的整数。':'请输入1–100之间的整数天数。');expect(m.testConnection).not.toHaveBeenCalled();expect(m.saveConnection).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value}});expect(input.value).toBe(value);expect(input.validity.valid).toBe(true);expect(screen.queryByRole('alert')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await waitFor(()=>expect(m.testConnection).toHaveBeenCalledOnce());expect(m.testConnection.mock.calls[0][0].config[field]).toBe(Number(value));expect(m.saveConnection).not.toHaveBeenCalled();
});















// M13 R1.0 intentionally replaces the retired M10 catalog/added/disclosure/
// activity routes. Form validation and project authorization tests above stay;
// these exercise their replacement routes against current lifecycle contracts.
const pluginFixture=(id='zentao',enabled=true)=>({appId:id,hash:'b'.repeat(64),installed:true,enabled,revision:4,version:'2.0.0',paused:false,displayName:id==='zentao'?'禅道':'Demo Tracker',description:'读取本人 Bug 与研发需求',author:{name:'Plugin fixture publisher'},hostApi:1,category:'研发协作',examples:[{title:'示例',prompt:'  approved example\nsecond line'}],providers:[],icons:null,packageDirectory:'/private/fixture/plugins/'+id,dataDirectory:'/private/fixture/data/'+id,permissions:['network'],capabilities:[{id:'bug-list',title:'查询 Bug',semantics:'read'}],skills:[{id:'bug-analysis'}],panels:[] as PluginPanel[]});
function externalCatalog(items:ReturnType<typeof pluginFixture>[]){
 m.pluginCatalog.mockImplementation(async()=>ok(structuredClone(items)) as never);
 m.pluginSetEnabled.mockImplementation(async(id:string,enabled:boolean,revision:number)=>{const p=items.find(x=>x.appId===id)!;expect(p.revision).toBe(revision);p.enabled=enabled;p.revision++;return ok({...p});});
 m.pluginUninstall.mockImplementation(async(id:string,deleteData:boolean,revision:number)=>{const p=items.find(x=>x.appId===id)!;expect(p.revision).toBe(revision);items.splice(items.indexOf(p),1);return ok(undefined);});
 return items;
}
describe('M13 plugin routes and retained interaction boundaries',()=>{
 it('uses an external plugin declared page title without a host application-name branch',async()=>{
  const p=pluginFixture('demo-tracker');p.panels.push({id:'work',title:'待办查询',kind:'list',refresh:false,tabs:[],source:{capability:'tracker-list',items:'items'},rowKey:'id',columns:[],details:{},rowActions:[]});externalCatalog([p]);navigation.openApplications('plugin:demo-tracker');mount(<ApplicationsWorkspace/>);
  await screen.findByRole('heading',{name:'Demo Tracker'});
  expect(screen.getAllByRole('button',{name:'待办查询'})).toHaveLength(2);
  expect(screen.queryByRole('button',{name:'插件页面'})).toBeNull();
 });

 it('does not navigate back to plugin detail after a business page hands off to an actual task',async()=>{
  const p=pluginFixture();p.panels.push({id:'work',title:'我的工作',kind:'list',refresh:false,tabs:[],source:{capability:'zentao-list',input:{},items:'items'},rowKey:'id',columns:[],details:{},rowActions:[]});externalCatalog([p]);navigation.openApplications('plugin:zentao/work');mount(<ApplicationsWorkspace/>);
  fireEvent.click(await screen.findByRole('button',{name:'Fixture task handoff'}));expect(navigation.currentViewId).toBe('task');expect(navigation.currentTaskId).toBe('fixture-handoff-task');
 });
 it('filters builtin and external plugins together, keeps exact groups and exposes no retired navigation',async()=>{
  externalCatalog([pluginFixture(),pluginFixture('demo-tracker',false)]);catalog=[app('mail'),{...app('browser'),displayName:'浏览器'}];mount(<ApplicationsWorkspace/>);
  await screen.findByRole('heading',{name:'外部插件'});const main=screen.getByRole('heading',{name:'插件'}).closest('.m10-content')!;
  expect(within(main as HTMLElement).getAllByRole('article')).toHaveLength(4);
  fireEvent.click(screen.getByRole('tab',{name:'已停用'}));expect(within(main as HTMLElement).getAllByRole('article')).toHaveLength(1);expect(within(main as HTMLElement).getByText('Demo Tracker')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'已启用'}));expect(within(main as HTMLElement).getAllByRole('article')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('搜索插件'),{target:{value:'邮件'}});expect(within(main as HTMLElement).getAllByRole('article')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('搜索插件'),{target:{value:'never-match-public-fixture'}});expect(screen.getByText('没有匹配的插件')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'项目选用'})).toBeNull();expect(screen.queryByRole('button',{name:'调用记录'})).toBeNull();expect(screen.queryByText('连接一次，在项目中使用')).toBeNull();expect(m.select).not.toHaveBeenCalled();
 });
 it('uses the same external detail from catalog and sidebar and toggles real revisions through the main button',async()=>{
  externalCatalog([pluginFixture()]);mount(<ApplicationsWorkspace/>);await screen.findByRole('heading',{name:'外部插件'});
  fireEvent.click(screen.getByRole('button',{name:'禅道 更多操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'查看详情'}));await screen.findByRole('heading',{name:'禅道'});
  expect(screen.getByText(/版本 2.0.0 · 由 Plugin fixture publisher 发布/)).toBeTruthy();expect(screen.getByRole('button',{name:'立即试用'})).toBeTruthy();expect(screen.queryByText('立即安装')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'插件更多操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'停用'}));await waitFor(()=>expect(m.pluginSetEnabled).toHaveBeenLastCalledWith('zentao',false,4));await screen.findByRole('button',{name:'启用'});
  fireEvent.click(screen.getByRole('button',{name:'启用'}));await waitFor(()=>expect(m.pluginSetEnabled).toHaveBeenLastCalledWith('zentao',true,5));await screen.findByRole('button',{name:'立即试用'});
  const sidebar=screen.getByRole('heading',{name:'自定义'}).closest('aside')!;fireEvent.click(within(sidebar).getByRole('button',{name:'插件'}));await screen.findByRole('heading',{name:'插件'});fireEvent.click(within(sidebar).getByRole('button',{name:'禅道'}));await screen.findByRole('heading',{name:'禅道'});expect(navigation.applicationPage).toBe('plugin:zentao');expect(screen.queryByRole('dialog',{name:'禅道'})).toBeNull();
 });
 it('binds the unified update page to the chosen plugin and uninstalls with the latest revision',async()=>{
  externalCatalog([pluginFixture()]);mount(<ApplicationsWorkspace/>);await screen.findByRole('heading',{name:'外部插件'});
  fireEvent.click(screen.getByRole('button',{name:'禅道 更多操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'更新…'}));const update=await screen.findByRole('dialog',{name:'更新 禅道'});expect(within(update).getByText(/当前版本 2.0.0/)).toBeTruthy();expect(m.pluginChoose).not.toHaveBeenCalled();fireEvent.click(within(update).getByRole('button',{name:'关闭弹窗'}));
  fireEvent.click(screen.getByRole('button',{name:'禅道 更多操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'卸载…'}));const remove=await screen.findByRole('dialog',{name:'卸载 禅道'});fireEvent.click(within(remove).getByRole('button',{name:'卸载'}));await waitFor(()=>expect(m.pluginUninstall).toHaveBeenCalledWith('zentao',false,4));await waitFor(()=>expect(screen.queryByRole('button',{name:'禅道 更多操作'})).toBeNull());expect(m.select).not.toHaveBeenCalled();
 });
 it('never offers update or uninstall for builtin plugins and does not write project authorization on global toggle',async()=>{
  m.setEnabled.mockImplementation(async(id:string,enabled:boolean,revision:number)=>{catalog=catalog.map(p=>p.appId===id?{...p,enabled,revision:revision+1}:p);return ok(catalog.find(p=>p.appId===id));});mount(<ApplicationsWorkspace/>);await screen.findByRole('button',{name:'邮件 更多操作'});
  fireEvent.click(screen.getByRole('button',{name:'邮件 更多操作'}));expect(screen.queryByRole('menuitem',{name:'更新…'})).toBeNull();expect(screen.queryByRole('menuitem',{name:'卸载…'})).toBeNull();fireEvent.click(screen.getByRole('menuitem',{name:'停用'}));await waitFor(()=>expect(m.setEnabled).toHaveBeenCalledWith('mail',false,3));expect(m.setAdded).not.toHaveBeenCalled();expect(m.select).not.toHaveBeenCalled();
 });
 it.each(['directory','zip'] as const)('opens only the chosen %s installation flow from Add',async kind=>{
  m.pluginChoose.mockResolvedValue(ok(null));mount(<ApplicationsWorkspace/>);await screen.findByRole('heading',{name:'内置'});fireEvent.click(screen.getByRole('button',{name:'添加'}));fireEvent.click(screen.getByRole('menuitem',{name:kind==='directory'?'从本地文件夹安装…':'从 .zip 文件安装…'}));await waitFor(()=>expect(m.pluginChoose).toHaveBeenCalledWith(kind,undefined));expect(m.setAdded).not.toHaveBeenCalled();
 });
 it('passes the exact manifest example once to editable Home without executing a task',async()=>{
  externalCatalog([pluginFixture()]);navigation.openApplications('plugin:zentao');mount(<ApplicationsWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:'立即试用'}));expect(navigation.currentViewId).toBe('home');expect(navigation.pluginPromptRequest?.prompt).toBe('  approved example\nsecond line');expect(m.select).not.toHaveBeenCalled();expect(m.pluginSetEnabled).not.toHaveBeenCalled();navigation.pluginPromptRequest=null;
 });
 it('removes an uninstalled external detail and does not fall back to retired builtin ZenTao controls',async()=>{
  const items=externalCatalog([pluginFixture()]);navigation.openApplications('plugin:zentao');mount(<ApplicationsWorkspace/>);await screen.findByRole('heading',{name:'禅道'});items.length=0;await act(async()=>{await client.invalidateQueries({queryKey:['applications','plugins']});});await screen.findByText('插件不存在或已卸载');expect(screen.queryByRole('button',{name:'添加应用'})).toBeNull();expect(m.connections).not.toHaveBeenCalled();
 });
 it.each([{code:'AUTH_FAILED',health:'unavailable',label:'需要重新连接'},{code:'AUTH_REQUIRED',health:'unavailable',label:'需要重新连接'},{code:'REMOTE_UNAVAILABLE',health:'unavailable',label:'当前不可用'},{code:null,health:'healthy',label:'已验证连接'}] as const)('retains connection identity and distinct $code state at the new builtin detail',async scenario=>{
  connections=connections.map(c=>c.id===uid(11)?{...c,health:scenario.health,healthCode:scenario.code}:c);navigation.openApplications('mail');mount(<ApplicationsWorkspace/>);const row=(await screen.findByTitle('来源 A')).closest('.m13-row')!;expect(within(row as HTMLElement).getByText(scenario.label)).toBeTruthy();fireEvent.click(within(row as HTMLElement).getByRole('button',{name:'来源 A 更多操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'编辑／重新连接'}));expect(await screen.findByLabelText('连接名称')).toHaveProperty('value','来源 A');expect(m.testConnection).not.toHaveBeenCalled();expect(m.select).not.toHaveBeenCalled();
 });
 it('shows a list retry as pending until its original response settles and never retries business writes',async()=>{
  navigation.openApplications('mail');mount(<ApplicationsWorkspace/>);await screen.findByTitle('来源 A');m.connections.mockResolvedValueOnce({ok:false,code:'RESOURCE_BUSY',message:'list-read-failed'});await act(async()=>{await client.invalidateQueries({queryKey:['applications','connections','mail']});});const error=await screen.findByText('连接加载失败');let finish!:(v:unknown)=>void;m.connections.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(within(error.closest('.m10-empty')! as HTMLElement).getByRole('button',{name:'重试'}));await screen.findByText('正在读取连接…');expect(screen.queryByText('连接加载失败')).toBeNull();expect(screen.queryByRole('button',{name:'重试'})).toBeNull();await act(async()=>finish(ok(connections.filter(c=>c.appId==='mail'))));await screen.findByTitle('来源 A');expect(m.connections).toHaveBeenCalledTimes(3);expect(m.saveConnection).not.toHaveBeenCalled();
 });

 it('keeps failed catalog data distinct from no-results and a refresh performs only reads',async()=>{
  m.catalog.mockResolvedValueOnce({ok:false,code:'RESOURCE_BUSY',message:'catalog-read-failed'});mount(<ApplicationsWorkspace/>);await screen.findByText('插件暂时无法加载');expect(screen.queryByText('没有匹配的插件')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'重新读取插件'}));await screen.findByRole('heading',{name:'内置'});expect(m.catalog).toHaveBeenCalledTimes(2);expect(m.setAdded).not.toHaveBeenCalled();expect(m.pluginChoose).not.toHaveBeenCalled();
 });
 it('T098 waits for both passive reads before reporting refresh completion and never performs a lifecycle write',async()=>{
  externalCatalog([pluginFixture()]);mount(<ApplicationsWorkspace/>);await screen.findByRole('heading',{name:'内置'});let finish!:(value:unknown)=>void;m.catalog.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(screen.getByRole('button',{name:'重新读取插件'}));await waitFor(()=>expect(screen.getByRole('button',{name:'重新读取插件'})).toHaveProperty('disabled',true));expect(screen.queryByText('插件状态已刷新')).toBeNull();await act(async()=>finish(ok(catalog)));await screen.findByText('插件状态已刷新');expect(m.catalog).toHaveBeenCalledTimes(2);expect(m.pluginCatalog).toHaveBeenCalledTimes(2);expect(m.pluginSetEnabled).not.toHaveBeenCalled();expect(m.pluginUninstall).not.toHaveBeenCalled();expect(m.pluginChoose).not.toHaveBeenCalled();
 });
 it('T098 reports a failed passive read instead of announcing successful refresh',async()=>{
  externalCatalog([pluginFixture()]);mount(<ApplicationsWorkspace/>);await screen.findByRole('heading',{name:'内置'});m.pluginCatalog.mockRejectedValueOnce(new Error('catalog temporarily unavailable'));fireEvent.click(screen.getByRole('button',{name:'重新读取插件'}));await screen.findByText('插件状态读取未完成，请重试');expect(screen.queryByText('插件状态已刷新')).toBeNull();expect(m.pluginSetEnabled).not.toHaveBeenCalled();expect(m.pluginUninstall).not.toHaveBeenCalled();
 });

});

it.each([0,2])('shows a floating global plugin change notice with %i affected live sessions',async count=>{
 const success=vi.spyOn(toast,'success');
 m.sessionChangeImpact.mockResolvedValueOnce(ok({runningCount:count,globalDisabled:false,checkedAt:'2026-11-13T00:00:00Z'}));
 m.setEnabled.mockImplementation(async(id:ApplicationId,enabled:boolean)=>{catalog=catalog.map(a=>a.appId===id?{...a,enabled,revision:a.revision+1}:a);return ok(catalog.find(a=>a.appId===id));});
 mount(<ApplicationsWorkspace/>);fireEvent.click(await screen.findByRole('button',{name:'邮件 更多操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'停用'}));
 const message='邮件 已停用：运行中的会话即刻不能再调用它，新建或恢复的会话不再加载'+(count?`；${count} 个运行中的会话重启后完全生效`:'')+'；连接与数据保留';
 await waitFor(()=>expect(m.setEnabled).toHaveBeenCalledWith('mail',false,3));
 await waitFor(()=>expect(success).toHaveBeenCalledExactlyOnceWith(message));
 expect(screen.queryByText(message)).toBeNull();
});
