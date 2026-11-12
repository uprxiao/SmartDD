// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useRef} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PluginManager,type PluginManagerHandle} from './plugin-manager';
const api=vi.hoisted(()=>({pluginStartupStatus:vi.fn(async()=>({ok:true,value:null})),pluginCatalog:vi.fn(),pluginChoose:vi.fn(),pluginInstall:vi.fn(),pluginDiscard:vi.fn(),pluginSetEnabled:vi.fn(),pluginUninstall:vi.fn(),pluginRestart:vi.fn(),projectList:vi.fn(async()=>[])}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:api,projects:{list:api.projectList}},events:{on:()=>()=>{}}}));
const ok=(value:unknown)=>({ok:true,value});
const plugin={appId:'demo-tracker',hash:'a'.repeat(64),version:'0.1.0',installed:true,enabled:true,revision:4,paused:false,displayName:'Demo Tracker',description:'合成插件说明',author:null,permissions:['network'],capabilities:[{id:'demo-tracker.items.list',title:'列出待办',semantics:'read'}],skills:[],panels:[]};
const review={token:'00000000-0000-4000-8000-000000000001',displayName:'Demo Tracker',description:'合成插件说明',author:{name:'Synthetic QA'},hostApi:1,permissions:['network'],capabilities:[{id:'demo-tracker.items.list',title:'列出待办',semantics:'read'}],skills:['demo'],plan:{appId:'demo-tracker',hash:'b'.repeat(64),kind:'install',expectedRevision:0,previousVersion:null,nextVersion:'0.1.0',enabled:true,addedCapabilities:['demo-tracker.items.list'],removedCapabilities:[],breakingCapabilities:[],addedSkills:['demo'],removedSkills:[],addedPermissions:['network'],removedPermissions:[],planHash:'c'.repeat(64)}};
let client:QueryClient;
function mount(){
  function Harness(){const ref=useRef<PluginManagerHandle>(null);return <div className="m10-shell"><button onClick={()=>ref.current?.choose('directory')}>安装文件夹</button><button onClick={()=>ref.current?.choose('zip')}>安装压缩包</button><PluginManager ref={ref} query=""/></div>;}
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});render(<QueryClientProvider client={client}><Harness/></QueryClientProvider>);
}
beforeEach(()=>{
  vi.clearAllMocks();api.pluginStartupStatus.mockResolvedValue({ok:true,value:null});api.pluginCatalog.mockResolvedValue(ok([]));api.pluginChoose.mockResolvedValue(ok(review));api.pluginInstall.mockResolvedValue(ok({...plugin,revision:1}));api.pluginDiscard.mockResolvedValue(ok({discarded:true}));api.pluginSetEnabled.mockResolvedValue(ok({...plugin,enabled:false}));api.pluginUninstall.mockResolvedValue(ok({installed:false}));api.pluginRestart.mockResolvedValue(ok({restarted:true}));
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();client?.clear();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});

describe('production external plugin install and lifecycle interface',()=>{
  it('shows a migration failure without hiding other plugins or automatically retrying an installation',async()=>{
    api.pluginStartupStatus.mockResolvedValueOnce(ok({appId:'zentao',state:'failed',fallbackBuiltin:true,errorCode:'CAPABILITY_UNAVAILABLE',message:'禅道迁移未完成，仍保留原内置功能和数据；下次启动会重新尝试。'}) as never);api.pluginCatalog.mockResolvedValue(ok([plugin]));mount();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent','禅道迁移未完成，仍保留原内置功能和数据；下次启动会重新尝试。');expect(await screen.findByText('Demo Tracker')).toBeTruthy();expect(api.pluginInstall).not.toHaveBeenCalled();expect(api.pluginChoose).not.toHaveBeenCalled();
  });
  it('shows the real inspection review and safety boundaries before committing the opaque confirmation token',async()=>{
    mount();fireEvent.click(screen.getByRole('button',{name:'安装文件夹'}));const dialog=await screen.findByRole('dialog',{name:'安装 Demo Tracker'});
    expect(api.pluginChoose).toHaveBeenCalledWith('directory',undefined);expect(within(dialog).getByText('Synthetic QA')).toBeTruthy();expect(within(dialog).getByText('network')).toBeTruthy();expect(within(dialog).getByText(/其他用户文件不在保护范围/)).toBeTruthy();expect(api.pluginInstall).not.toHaveBeenCalled();
    api.pluginCatalog.mockResolvedValue(ok([plugin]));fireEvent.click(within(dialog).getByRole('button',{name:'安装'}));await waitFor(()=>expect(api.pluginInstall).toHaveBeenCalledWith(review.token));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(await screen.findByText('Demo Tracker')).toBeTruthy();
  });
  it('discards a cancelled review and does not turn a cancelled native picker into an install',async()=>{
    mount();fireEvent.click(screen.getByRole('button',{name:'安装压缩包'}));const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));await waitFor(()=>expect(api.pluginDiscard).toHaveBeenCalledWith(review.token));expect(api.pluginInstall).not.toHaveBeenCalled();
    api.pluginChoose.mockResolvedValueOnce(ok(null));fireEvent.click(screen.getByRole('button',{name:'安装文件夹'}));await waitFor(()=>expect(api.pluginChoose).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows update permission changes and preserves the disabled state on the review',async()=>{
    api.pluginCatalog.mockResolvedValue(ok([plugin]));api.pluginChoose.mockResolvedValue(ok({...review,plan:{...review.plan,kind:'update',enabled:false,previousVersion:'0.1.0',nextVersion:'0.2.0',breakingCapabilities:['demo-tracker.old.read']}}));
    mount();await screen.findByText('Demo Tracker');fireEvent.click(screen.getByRole('button',{name:'管理插件Demo Tracker'}));fireEvent.click(screen.getByRole('menuitem',{name:'从 .zip 更新…'}));const dialog=await screen.findByRole('dialog',{name:'更新 Demo Tracker'});
    expect(api.pluginChoose).toHaveBeenCalledWith('zip','demo-tracker');expect(within(dialog).getByText('0.1.0 → 0.2.0')).toBeTruthy();expect(within(dialog).getByText(/更新后仍保持停用/)).toBeTruthy();expect(within(dialog).getByText(/老任务调用这些能力会失败/)).toBeTruthy();expect(within(dialog).getByText('新增权限')).toBeTruthy();
  });
  it.each([false,true])('requires an explicit uninstall decision; deleteData=%s is sent with the displayed revision',async deleteData=>{
    api.pluginCatalog.mockResolvedValue(ok([plugin]));mount();await screen.findByText('Demo Tracker');fireEvent.click(screen.getByRole('button',{name:'管理插件Demo Tracker'}));fireEvent.click(screen.getByRole('menuitem',{name:'卸载…'}));const dialog=await screen.findByRole('dialog',{name:'卸载 Demo Tracker'});
    const keep=within(dialog).getByRole('radio',{name:'保留数据'}) as HTMLInputElement;expect(keep.checked).toBe(true);expect(api.pluginUninstall).not.toHaveBeenCalled();if(deleteData)fireEvent.click(within(dialog).getByRole('radio',{name:'删除数据'}));
    fireEvent.click(within(dialog).getByRole('button',{name:'卸载'}));await waitFor(()=>expect(api.pluginUninstall).toHaveBeenCalledWith(plugin.appId,deleteData,plugin.revision));
  });
  it('keeps crash status and explicit restart available inside the opened plugin page',async()=>{
    const paused={...plugin,paused:true,panels:[{id:'work',title:'待办',kind:'list',refresh:false,source:{capability:'demo-tracker.items.list',input:{},items:'items'},rowKey:'id',columns:[],details:{},rowActions:[]}]};
    api.pluginCatalog.mockResolvedValue(ok([paused]));api.pluginRestart.mockImplementationOnce(async()=>{api.pluginCatalog.mockResolvedValue(ok([{...paused,paused:false}]));return ok({restarted:true});});mount();
    fireEvent.click(await screen.findByRole('button',{name:'打开插件页面'}));const dialog=await screen.findByRole('dialog',{name:'Demo Tracker'});
    expect(within(dialog).getByRole('status')).toHaveProperty('textContent','插件进程异常退出，请重新启动。');expect(api.pluginRestart).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button',{name:'重新启动'}));await waitFor(()=>expect(api.pluginRestart).toHaveBeenCalledWith('demo-tracker'));await waitFor(()=>expect(within(dialog).queryByRole('button',{name:'重新启动'})).toBeNull());expect(api.pluginRestart).toHaveBeenCalledTimes(1);
  });
  it('shows a restart failure in the same plugin page without silently retrying',async()=>{
    api.pluginCatalog.mockResolvedValue(ok([{...plugin,paused:true,panels:[{id:'work',title:'待办',kind:'list',refresh:false,source:{capability:'demo-tracker.items.list',input:{},items:'items'},rowKey:'id',columns:[],details:{},rowActions:[]}]}]));api.pluginRestart.mockResolvedValueOnce({ok:false,code:'RESOURCE_RECOVERY_REQUIRED',message:'原插件进程仍未确认退出'});mount();
    fireEvent.click(await screen.findByRole('button',{name:'打开插件页面'}));const dialog=await screen.findByRole('dialog',{name:'Demo Tracker'});fireEvent.click(within(dialog).getByRole('button',{name:'重新启动'}));expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent','原插件进程仍未确认退出');expect(within(dialog).getByRole('button',{name:'重新启动'})).toBeTruthy();expect(api.pluginRestart).toHaveBeenCalledTimes(1);
  });
  it('keeps an install failure visible without displaying a successful catalog entry',async()=>{
    api.pluginInstall.mockResolvedValueOnce({ok:false,code:'CONFIG_PLAN_STALE',message:'插件检查结果已变化，请重新确认'});mount();fireEvent.click(screen.getByRole('button',{name:'安装文件夹'}));const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'安装'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','插件检查结果已变化，请重新确认');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.queryByText('Demo Tracker')).toBeNull();
  });
});
