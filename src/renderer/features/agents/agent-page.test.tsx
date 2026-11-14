// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor,within,act } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import type { CodeAgentTool,ProviderView,RunConfigView } from '@shared/ai-agents';
import type { AiProfileView } from '@shared/ai-profiles';
import { ProviderCatalogDialog } from './provider-catalog';
import { ProviderDetail } from './provider-detail';
import { LegacyAgentEditor } from './legacy-editor';
import { AgentEditor } from './agent-editor';
import { AgentsSection } from './index';
import { SettingsView } from '@renderer/views/settings-view';
import { toast } from 'sonner';
const api=vi.hoisted(()=>{
 const fn=()=>vi.fn<(...args:any[])=>Promise<any>>();
 return {query:{data:{configs:[] as RunConfigView[],providers:[] as ProviderView[],tools:[] as CodeAgentTool[]},isPending:false,error:null as Error|null},refresh:fn(),save:fn(),saveProvider:fn(),check:fn(),refreshModels:fn(),deleteProvider:fn(),setDefault:fn(),visible:fn(),reorder:fn(),remove:fn(),detect:fn(),models:fn(),probe:fn(),connect:fn(),cancel:fn(),getLegacy:fn(),updateLegacy:fn(),nav:{settingsSection:'aiProfiles',openSettings:vi.fn(),openApplications:vi.fn(),agentProviderRequest:null as {id:string;seq:number}|null,consumeAgentProviderRequest:vi.fn()}};
});
vi.mock('@renderer/lib/ipc',()=>({rpc:{tasks:{codexGlobalNotices:async()=>[]},agents:{save:api.save,saveProvider:api.saveProvider,checkProviderModel:api.check,refreshProviderModels:api.refreshModels,deleteProvider:api.deleteProvider,setDefault:api.setDefault,homeVisible:api.visible,reorder:api.reorder,delete:api.remove,refreshTools:api.detect,updateLegacy:api.updateLegacy},providerSetup:{models:api.models,probe:api.probe,connect:api.connect,cancel:api.cancel},aiProfiles:{get:api.getLegacy}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/lib/hooks/useAgents',()=>({useAgents:()=>api.query,useRefreshAgents:()=>api.refresh}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
// Unrelated Settings branches are outside this test; the AI branch and its labels are real.
vi.mock('@renderer/views/settings/voice',()=>({VoiceSettingsSection:()=>null,readableVoiceKey:()=>''}));
vi.mock('@renderer/views/capabilities',()=>({CapabilitiesSection:()=>null}));
vi.mock('@renderer/core/voice-store',()=>({voiceStore:{inspection:null}}));
vi.mock('@renderer/core/navigation',()=>({navigation:api.nav}));
vi.mock('@renderer/lib/hooks/useAppSettingsKey',()=>({useAppSettingsKey:()=>({value:{},update:()=>{}})}));
vi.mock('@renderer/lib/theme',()=>({useTheme:()=>({effectiveTheme:'light'})}));
vi.mock('react-i18next',async()=>{const {zhCN}=await import('@renderer/lib/i18n/locales');return {useTranslation:()=>({t:(key:string)=>key.split('.').reduce<any>((v,k)=>v?.[k],zhCN)??key})};});
const clients:QueryClient[]=[];
function mountQuery(node:React.ReactNode){const c=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});clients.push(c);return render(<QueryClientProvider client={c}>{node}</QueryClientProvider>);}

beforeEach(()=>{vi.clearAllMocks();for(const fn of [api.refresh,api.save,api.saveProvider,api.check,api.refreshModels,api.deleteProvider,api.setDefault,api.visible,api.reorder,api.remove,api.detect,api.cancel,api.updateLegacy])fn.mockResolvedValue(undefined);api.models.mockResolvedValue({ok:true,value:{models:[model('a'),model('b')],recommended:{claude:'a',codex:'a'},note:null}});api.probe.mockResolvedValue({ok:true,value:{state:'candidate',message:'候选协议'}});api.connect.mockResolvedValue({ok:true,value:provider()});api.query.data={configs:[],providers:[],tools:[tool('claude'),tool('codex')]};api.query.isPending=false;api.query.error=null;api.nav.settingsSection='aiProfiles';});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});
function model(id:string){return {id,name:'Model '+id.toUpperCase(),contextWindow:128000,offline:false,availability:{claude:'available' as const,codex:'available' as const}};}
function provider(changes:Partial<ProviderView>={}):ProviderView{return {id:'p',name:'Private Provider',preset:null,endpoints:{responses:'https://provider.example.invalid/v1',anthropic:'https://provider.example.invalid/anthropic'},authType:'bearer',hasKey:true,identityRevision:1,models:[model('a'),model('b')],recommended:{claude:'a',codex:'b'},refreshedAt:1,...changes};}
function tool(kind:'claude'|'codex',installed=true):CodeAgentTool{return {id:kind,kind,executable:'/synthetic/'+kind,version:kind==='claude'?'2.1.322':'0.167.1',installed,login:'api'};}
function config(changes:Partial<RunConfigView>={}):RunConfigView{return {id:'c',name:'Agent One',toolId:'codex',kind:'codex',source:'provider',providerId:'p',models:['a','b'],defaultModel:'a',homeVisible:true,isDefault:false,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null,...changes};}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function catalog(extra:Partial<Parameters<typeof ProviderCatalogDialog>[0]>={}){const props={providers:[],onClose:vi.fn(),onConnected:vi.fn(async()=>{}),onNewAgent:vi.fn(),...extra};return {props,...render(<ProviderCatalogDialog {...props}/>)};}
function detail(p=provider(),configs:RunConfigView[]=[]){const props={provider:p,configs,onClose:vi.fn(),onRefresh:vi.fn(async()=>{}),onNewAgent:vi.fn()};return {props,...render(<ProviderDetail {...props}/>)};}
const footer=()=>document.querySelector('.m13-dialog-foot') as HTMLElement;
function custom(){fireEvent.click(screen.getByRole('button',{name:/^自定义供应商/}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'Custom Provider'}});fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://custom.example.invalid/v1'}});fireEvent.change(screen.getByLabelText('API 密钥'),{target:{value:'PUBLIC_UI_KEY_ONLY'}});}
function profile():AiProfileView{return {id:'legacy',name:'Old Agent',runner:'codex',executable:'/synthetic/legacy/bin/codex',env:[{name:'MODE',secret:false,value:'old-value',hasValue:true},{name:'OPENAI_API_KEY',secret:true,value:'PUBLIC_SECRET_NEVER_RENDER',hasValue:true}],args:['--label','two words','--flag'],color:'#c59be8',isDefault:false,check:null,checking:false,createdAt:1,updatedAt:2};}
function legacy(){const c=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});clients.push(c);const props={config:config({id:'legacy',name:'Old Agent',source:'legacy',providerId:null,legacyReason:'保留配置'}),onClose:vi.fn(),onSaved:vi.fn(async()=>{})};return {props,...render(<QueryClientProvider client={c}><LegacyAgentEditor {...props}/></QueryClientProvider>)};}

it('catalog three-step flow waits for real models/connect RPC, never saves Provider directly or automatically creates an Agent',async()=>{
 const pending=deferred<any>();api.models.mockReturnValue(pending.promise);const {props}=catalog({forTool:'codex'});expect(screen.getByRole('list',{name:'步骤'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:/^DeepSeek/}));fireEvent.change(screen.getByLabelText('DeepSeek API Key'),{target:{value:'PUBLIC_UI_KEY_ONLY'}});fireEvent.click(within(footer()).getByRole('button',{name:'获取模型'}));expect(api.models).toHaveBeenCalledOnce();expect(screen.queryByText('已获取 2 个模型')).toBeNull();expect(api.connect).not.toHaveBeenCalled();
 await act(async()=>pending.resolve({ok:true,value:{models:[model('a'),model('b')],recommended:{claude:'a',codex:'b'},note:null}}));await waitFor(()=>expect(screen.getByRole('checkbox',{name:/Model A/})).toBeTruthy());fireEvent.click(screen.getByRole('checkbox',{name:/Model B/}));fireEvent.click(screen.getByRole('button',{name:'接入'}));await waitFor(()=>expect(screen.getByRole('heading',{name:'已添加'})).toBeTruthy());expect(api.connect.mock.calls[0][0]).toMatchObject({preset:'deepseek',key:'PUBLIC_UI_KEY_ONLY',models:[expect.objectContaining({id:'a'})]});expect(api.saveProvider).not.toHaveBeenCalled();expect(api.save).not.toHaveBeenCalled();expect(props.onConnected).toHaveBeenCalledOnce();expect(props.onNewAgent).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'创建智能体'}));expect(props.onNewAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'p'}),'codex');
});
it('custom probe is readonly candidate RPC; empty models permits manual selected IDs and does not manufacture availability',async()=>{
 api.models.mockResolvedValue({ok:true,value:{models:[],recommended:{},note:'请手动填写'}});catalog();custom();fireEvent.click(screen.getByRole('button',{name:'检测协议'}));await waitFor(()=>expect(api.probe).toHaveBeenCalledOnce());expect(api.probe.mock.calls[0][1]).toBe('codex');expect(api.saveProvider).not.toHaveBeenCalled();fireEvent.click(within(footer()).getByRole('button',{name:'获取模型'}));await waitFor(()=>expect(screen.getByText(/请手动填写.*模型 ID/)).toBeTruthy());fireEvent.change(screen.getByLabelText('模型'),{target:{value:'a, b a'}});fireEvent.click(screen.getByRole('button',{name:'接入'}));await waitFor(()=>expect(api.connect).toHaveBeenCalledOnce());expect(api.connect.mock.calls[0][0].models.map((m:any)=>[m.id,m.availability])).toEqual([['a',{claude:'untested',codex:'untested'}],['b',{claude:'untested',codex:'untested'}]]);
});
it('catalog real RPC errors preserve address/Key/manual data and cancellation delegates to owner cleanup',async()=>{
 api.models.mockResolvedValue({ok:false,code:'INVALID_DRAFT',message:'服务不可达'});const rendered=catalog();custom();fireEvent.click(within(footer()).getByRole('button',{name:'获取模型'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('服务不可达'));expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toContain('custom.example.invalid');expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe('PUBLIC_UI_KEY_ONLY');expect(api.connect).not.toHaveBeenCalled();rendered.unmount();expect(api.cancel).toHaveBeenCalledOnce();
});
it('catalog missing Key refuses before any RPC and never shows timed success',()=>{
 catalog();fireEvent.click(screen.getByRole('button',{name:/^DeepSeek/}));fireEvent.click(within(footer()).getByRole('button',{name:'获取模型'}));expect(screen.getByRole('alert').textContent).toContain('请填写');expect(api.models).not.toHaveBeenCalled();expect(api.connect).not.toHaveBeenCalled();expect(screen.queryByRole('heading',{name:'已添加'})).toBeNull();
});
it('provider address save omits Key entirely; explicit replacement sends only new Key',async()=>{
 const rendered=detail();expect(screen.queryByLabelText('新的 Key')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'编辑地址'}));fireEvent.change(screen.getByLabelText('OpenAI Responses 地址'),{target:{value:'https://changed.example.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'保存地址'}));await waitFor(()=>expect(api.saveProvider).toHaveBeenCalledOnce());expect(api.saveProvider.mock.calls[0][0]).not.toHaveProperty('key');expect(api.saveProvider.mock.calls[0]).toEqual([expect.objectContaining({endpoints:{responses:'https://changed.example.invalid/v1',anthropic:'https://provider.example.invalid/anthropic'}}),'p']);await waitFor(()=>expect(rendered.props.onRefresh).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'更换'}));expect((screen.getByLabelText('新的 Key') as HTMLInputElement).value).toBe('');fireEvent.change(screen.getByLabelText('新的 Key'),{target:{value:'PUBLIC_NEW_KEY_ONLY'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(api.saveProvider).toHaveBeenCalledTimes(2));expect(api.saveProvider.mock.calls[1]).toEqual([expect.objectContaining({key:'PUBLIC_NEW_KEY_ONLY'}),'p']);
});
it('provider failed address save preserves typed addresses and displays real RPC error rather than fake success',async()=>{
 api.saveProvider.mockRejectedValue(new Error("Error invoking remote method 'agents.saveProvider': Error: 地址无效"));const {props}=detail();fireEvent.click(screen.getByRole('button',{name:'编辑地址'}));fireEvent.change(screen.getByLabelText('OpenAI Responses 地址'),{target:{value:'https://typed.example.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'保存地址'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('地址无效'));expect((screen.getByLabelText('OpenAI Responses 地址') as HTMLInputElement).value).toContain('typed.example.invalid');expect(props.onRefresh).not.toHaveBeenCalled();expect(props.onClose).not.toHaveBeenCalled();
});
it('provider refresh uses saved ID then incoming query state; single recheck targets exact model/tool and keeps failure visible',async()=>{
 const {props,rerender}=detail();fireEvent.click(screen.getByRole('button',{name:'刷新模型'}));await waitFor(()=>expect(props.onRefresh).toHaveBeenCalledOnce());expect(api.refreshModels).toHaveBeenCalledExactlyOnceWith('p');const changed=provider();changed.models[0].availability.codex='unavailable' as any;rerender(<ProviderDetail {...props} provider={changed}/>);const cell=document.querySelector('[data-model="a"] [data-tool="codex"]') as HTMLElement;expect(cell.getAttribute('data-avail')).toBe('unavailable');api.check.mockRejectedValue(new Error('模型拒绝工具调用'));fireEvent.click(within(cell).getByRole('button',{name:'重测'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('模型拒绝工具调用'));expect(api.check).toHaveBeenCalledExactlyOnceWith('p','codex','a');expect(cell.getAttribute('data-avail')).toBe('unavailable');
});
it('test-all checks only untested endpoint-compatible online model/tool pairs, not available/offline ones',async()=>{
 const p=provider();p.models[0].availability.codex='untested' as any;p.models[1].availability.claude='untested' as any;p.models.push({...model('offline'),offline:true,availability:{claude:'untested',codex:'untested'}});detail(p);fireEvent.click(screen.getByRole('button',{name:'测试全部未测试（2）'}));await waitFor(()=>expect(api.check).toHaveBeenCalledTimes(2));expect(api.check.mock.calls).toEqual([['p','codex','a'],['p','claude','b']]);expect(api.saveProvider).not.toHaveBeenCalled();
});
it('provider delete previews dependent default agent and only deletes after explicit confirmation',async()=>{
 const props={provider:provider(),configs:[config({isDefault:true})],onClose:vi.fn(),onRefresh:vi.fn(async()=>{}),onNewAgent:vi.fn()};render(<ProviderDetail {...props}/>);fireEvent.click(screen.getByRole('button',{name:'删除'}));expect(screen.getByText(/默认改为首页显示中的下一个/)).toBeTruthy();expect(api.deleteProvider).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'删除'}));await waitFor(()=>expect(api.deleteProvider).toHaveBeenCalledExactlyOnceWith('p'));expect(props.onClose).toHaveBeenCalledOnce();
});
it('preset Code Agent creation preserves Codex intent when only Claude is installed; it cannot silently submit a Claude config',()=>{
 render(<AgentEditor preset={{kind:'codex',providerId:'p'}} configs={[]} providers={[provider()]} tools={[tool('claude')]} onClose={vi.fn()} onSaved={vi.fn()} onEditExisting={vi.fn()} onAddProvider={vi.fn()} onToolPath={vi.fn()} onRedetect={vi.fn()} onRefresh={async()=>{}}/>);expect(screen.getByRole('radio',{name:/^Claude Code/}).getAttribute('aria-checked')).toBe('false');expect((screen.getByRole('button',{name:'创建'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'创建'}));expect(api.save).not.toHaveBeenCalled();
});
it('page initial detection of logged-in native tools never auto-creates an Agent',async()=>{
 mountQuery(<AgentsSection/>);await waitFor(()=>expect(api.detect).toHaveBeenCalledOnce());expect(api.save).not.toHaveBeenCalled();expect(api.saveProvider).not.toHaveBeenCalled();expect(document.querySelectorAll('[data-agent]')).toHaveLength(0);
});
it('newly detected CLI announces availability after refresh without generating an Agent',async()=>{
 api.query.data.tools=[tool('claude'),tool('codex',false)];
 const pending=deferred<any>();api.detect.mockReturnValue(pending.promise);mountQuery(<AgentsSection/>);
 expect(toast.success).not.toHaveBeenCalled();
 await act(async()=>pending.resolve([{tool:tool('claude'),error:null},{tool:tool('codex'),error:null}]));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('检测到 Codex，新建智能体时可以选择它'));
 expect(api.refresh).toHaveBeenCalledOnce();expect(api.save).not.toHaveBeenCalled();expect(api.saveProvider).not.toHaveBeenCalled();
});
it('manual redetection reports no change and preserves the open creation step',async()=>{
 api.detect.mockResolvedValue([{tool:tool('claude'),error:null},{tool:tool('codex'),error:null}]);
 mountQuery(<AgentsSection/>);await waitFor(()=>expect(api.refresh).toHaveBeenCalledOnce());expect(toast.success).not.toHaveBeenCalled();
 fireEvent.click(within(document.querySelector('.m10-head-actions') as HTMLElement).getByRole('button',{name:'新建智能体'}));fireEvent.click(screen.getByRole('button',{name:'重新检测'}));
 await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('已重新检测：没有变化'));expect(screen.getByRole('dialog')).toBeTruthy();expect(api.save).not.toHaveBeenCalled();
});
it('missing CLI reports unavailable existing agents; failed detection never announces success',async()=>{
 api.detect.mockResolvedValue([{tool:tool('claude'),error:null},{tool:tool('codex',false),error:null}]);
 mountQuery(<AgentsSection/>);await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('没有检测到 Codex：它的智能体暂时不能使用，也不在首页显示'));
 vi.mocked(toast.success).mockClear();api.detect.mockRejectedValue(new Error('检测失败'));
 fireEvent.click(within(document.querySelector('.m10-head-actions') as HTMLElement).getByRole('button',{name:'新建智能体'}));fireEvent.click(screen.getByRole('button',{name:'重新检测'}));
 await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('检测失败'));expect(toast.success).not.toHaveBeenCalled();
});
it('page list visibility and default actions target exact IDs and surface RPC failures',async()=>{
 api.query.data={configs:[config({id:'d',name:'Default',isDefault:true}),config({id:'two',name:'Agent Two',order:1})],providers:[provider()],tools:[tool('codex')]};mountQuery(<AgentsSection/>);expect((screen.getByRole('switch',{name:'不在首页显示 Default'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('switch',{name:'不在首页显示 Agent Two'}));await waitFor(()=>expect(api.visible).toHaveBeenCalledExactlyOnceWith('two',false));api.setDefault.mockRejectedValue(new Error('不能设为默认'));fireEvent.click(screen.getByRole('button',{name:'Agent Two 更多操作'}));await waitFor(()=>expect(screen.getByRole('menuitem',{name:'设为默认'})).toBeTruthy());fireEvent.click(screen.getByRole('menuitem',{name:'设为默认'}));await waitFor(()=>expect(api.setDefault).toHaveBeenCalledExactlyOnceWith('two'));expect(screen.getByRole('alert').textContent).toBe('不能设为默认');
});
it('page list reorder and confirmed deletion send APIs without modifying other profiles',async()=>{
 api.query.data={configs:[config({id:'d',name:'Default',isDefault:true}),config({id:'two',name:'Agent Two',order:1}),config({id:'three',name:'Agent Three',order:2})],providers:[provider()],tools:[tool('codex')]};mountQuery(<AgentsSection/>);fireEvent.click(screen.getByRole('button',{name:'Agent Two 更多操作'}));await waitFor(()=>expect(screen.getByRole('menuitem',{name:'下移'})).toBeTruthy());fireEvent.click(screen.getByRole('menuitem',{name:'下移'}));await waitFor(()=>expect(api.reorder).toHaveBeenCalledExactlyOnceWith('two',2));fireEvent.click(screen.getByRole('button',{name:'Agent Two 更多操作'}));await waitFor(()=>expect(screen.getByRole('menuitem',{name:'删除'})).toBeTruthy());fireEvent.click(screen.getByRole('menuitem',{name:'删除'}));await waitFor(()=>expect(screen.getByRole('heading',{name:'删除 Agent Two？'})).toBeTruthy());expect(api.remove).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'删除'}));await waitFor(()=>expect(api.remove).toHaveBeenCalledExactlyOnceWith('two'));expect(api.save).not.toHaveBeenCalled();
});
it('legacy name-only edit preserves original env/args and does not send replacement executable/color or reveal an existing secret',async()=>{
 const old=profile(),before=JSON.stringify(old);api.getLegacy.mockResolvedValue(old);const {props}=legacy();await waitFor(()=>expect(screen.getByLabelText('名称')).toBeTruthy());expect(document.body.textContent).not.toContain('PUBLIC_SECRET_NEVER_RENDER');const values=screen.getAllByLabelText('变量值') as HTMLInputElement[];expect(values[1].value).toBe('');fireEvent.change(screen.getByLabelText('名称'),{target:{value:'Renamed Legacy'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(api.updateLegacy).toHaveBeenCalledOnce());expect(api.updateLegacy.mock.calls[0]).toEqual(['legacy',{name:'Renamed Legacy',env:[{name:'MODE',secret:false,value:'old-value'},{name:'OPENAI_API_KEY',secret:true,value:undefined}],args:['--label','two words','--flag'],homeVisible:true}]);expect(api.updateLegacy.mock.calls[0][1]).not.toHaveProperty('executable');expect(api.updateLegacy.mock.calls[0][1]).not.toHaveProperty('color');expect(JSON.stringify(old)).toBe(before);await waitFor(()=>expect(props.onClose).toHaveBeenCalledOnce());
});
it('legacy save failure retains unsaved env/args and no secret replacement is sent for an unchanged blank secret',async()=>{
 api.getLegacy.mockResolvedValue(profile());api.updateLegacy.mockRejectedValue(new Error('旧配置保存失败'));const {props}=legacy();await waitFor(()=>expect(screen.getByLabelText('附加启动参数')).toBeTruthy());fireEvent.change(screen.getByLabelText('附加启动参数'),{target:{value:'--new "two words"'}});fireEvent.change(screen.getAllByLabelText('变量值')[0],{target:{value:'new-value'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('旧配置保存失败'));expect((screen.getByLabelText('附加启动参数') as HTMLInputElement).value).toBe('--new "two words"');expect(api.updateLegacy.mock.calls[0][1]).toMatchObject({args:['--new','two words'],env:[{name:'MODE',secret:false,value:'new-value'},{name:'OPENAI_API_KEY',secret:true,value:undefined}]});expect(props.onClose).not.toHaveBeenCalled();
});
it('actual SettingsView mounts the new AgentsSection and does not expose old AI/zshrc entry',async()=>{
 mountQuery(<SettingsView/>);await waitFor(()=>expect(screen.getByTestId('agents-settings')).toBeTruthy());expect(screen.getByRole('heading',{name:'智能体'})).toBeTruthy();expect(screen.queryByText('AI 配置')).toBeNull();expect(screen.queryByText(/从.*\.zshrc.*导入/)).toBeNull();expect(document.body.textContent).not.toContain('本机工具与登录');
});

it('closing catalog while connect is pending cancels owner and unmounts; canceled reply never announces completion',async()=>{
 const pending=deferred<any>(),connected=vi.fn(async()=>{});api.connect.mockReturnValue(pending.promise);function Parent(){const [open,setOpen]=useState(true);return open?<ProviderCatalogDialog providers={[]} onClose={()=>setOpen(false)} onConnected={connected} onNewAgent={vi.fn()}/>:<p>Closed</p>;}render(<Parent/>);custom();fireEvent.change(screen.getByLabelText('模型'),{target:{value:'manual-model'}});fireEvent.click(screen.getByRole('button',{name:'接入'}));expect(api.connect).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(screen.getByText('Closed')).toBeTruthy();expect(api.cancel).toHaveBeenCalledOnce();await act(async()=>pending.resolve({ok:false,code:'INVALID_DRAFT',message:'请求已取消'}));expect(connected).not.toHaveBeenCalled();expect(screen.queryByRole('heading',{name:'已添加'})).toBeNull();
});

it('Provider create entry offers a missing combination',()=>{
 const {props}=detail();fireEvent.click(screen.getByRole('tab',{name:/智能体/}));
 fireEvent.click(screen.getByRole('button',{name:'用它创建 Codex 智能体'}));expect(props.onNewAgent).toHaveBeenCalledExactlyOnceWith(props.provider,'codex');
});
it('Provider details offer creation only for tools without an existing combination',()=>{
 const {props}=detail(provider(),[config()]);fireEvent.click(screen.getByRole('tab',{name:/智能体/}));
 expect(screen.getByText('Agent One')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'用它创建 Codex 智能体'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'用它创建 Claude Code 智能体'}));
 expect(props.onNewAgent).toHaveBeenCalledExactlyOnceWith(props.provider,'claude');
});
it('Provider details retain existing agents and show an edit hint when every compatible tool is configured',()=>{
 detail(provider(),[config(),config({id:'claude-config',kind:'claude',toolId:'claude',name:'Claude Existing'})]);
 fireEvent.click(screen.getByRole('tab',{name:/智能体/}));
 expect(screen.getByText('Agent One')).toBeTruthy();expect(screen.getByText('Claude Existing')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/用它创建/})).toBeNull();
 expect(screen.getByText(/适用的 Code Agent 都已经有智能体/)).toBeTruthy();
});

it('preflight repair opens exactly the requested Provider detail and consumes the request',async()=>{
 api.query.data={configs:[],providers:[provider()],tools:[tool('codex')]};api.nav.agentProviderRequest={id:'p',seq:99};
 mountQuery(<AgentsSection/>);await screen.findByRole('dialog');
 await waitFor(()=>expect(api.nav.consumeAgentProviderRequest).toHaveBeenCalledExactlyOnceWith(99));
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByRole('button',{name:'编辑地址'})).toBeTruthy();
 api.nav.agentProviderRequest=null;
});


it('marks successful retries in the per-tool model tooltip while retaining the original failure',()=>{
 const check={status:'available' as const,attempts:2,durationMs:12,message:'流式工具调用验证通过',failures:[{status:503,message:'Synthetic temporary failure'}],checkedAt:1};
 const p=provider({models:[{...model('a'),checks:{claude:check}}]});
 detail(p);
 const cell=document.querySelector('[data-model="a"] [data-tool="claude"]')!;
 expect(cell.textContent).toContain('可用');
 expect(cell.getAttribute('title')).toContain('首次失败后重试成功');
 expect(check.failures).toEqual([{status:503,message:'Synthetic temporary failure'}]);
 expect(document.querySelector('[data-model="a"] [data-tool="codex"]')?.getAttribute('title')).not.toContain('重试');
});

it('T088 installed Codex login becomes selectable without implicitly creating an agent', async () => {
 const before = {...tool('codex'), login:'none' as const};
 const after = {...before, login:'subscription' as const};
 api.query.data={configs:[],providers:[],tools:[before]};
 api.detect.mockResolvedValueOnce([{tool:before,error:null}]);
 mountQuery(<AgentsSection/>);
 await waitFor(()=>expect(api.refresh).toHaveBeenCalledOnce());
 vi.mocked(toast.success).mockClear();
 fireEvent.click(within(document.querySelector('.m10-head-actions') as HTMLElement)
   .getByRole('button',{name:'新建智能体'}));
 api.detect.mockResolvedValueOnce([{tool:after,error:null}]);
 api.refresh.mockImplementationOnce(async()=>{api.query.data.tools=[after];});
 fireEvent.click(screen.getByRole('button',{name:'重新检测'}));
 await waitFor(()=>expect(api.detect).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(vi.mocked(toast.success).mock.calls.some(([message])=>
   String(message).includes('Codex') && String(message).includes('新建智能体') &&
   String(message).includes('选择'))).toBe(true));
 expect(api.save).not.toHaveBeenCalled();
 expect(api.saveProvider).not.toHaveBeenCalled();
 expect(api.query.data.configs).toEqual([]);
 const source=within(screen.getByRole('radiogroup',{name:'订阅或供应商'}));
 expect(source.getByRole('radio',{name:/订阅/})).toBeTruthy();
});
