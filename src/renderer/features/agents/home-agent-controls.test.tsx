// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor,within,act } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentPermission } from '@shared/agent-permissions';
import type { RunConfigView,ProviderView } from '@shared/ai-agents';
import { homeAgents,homeAgentId,HomePermissionPicker } from './home-agent-controls';
import { AgentModelPicker } from '../agent-tasks/agent-model-picker';
const api=vi.hoisted(()=>({store:{selected:'ask' as AgentPermission,fullConfirmed:false},get:vi.fn<(...args:any[])=>Promise<any>>(),update:vi.fn<(...args:any[])=>Promise<any>>(),reset:vi.fn<(...args:any[])=>Promise<any>>(),settings:vi.fn(),toastError:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{appSettings:{getWithMeta:api.get,update:api.update,reset:api.reset}}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{openSettings:api.settings}}));
vi.mock('sonner',()=>({toast:{error:api.toastError,success:vi.fn()}}));
const clients:QueryClient[]=[];
beforeEach(()=>{vi.clearAllMocks();api.store={selected:'ask',fullConfirmed:false};api.get.mockImplementation(async()=>({value:{...api.store},defaults:{selected:'ask',fullConfirmed:false},overrides:{...api.store}}));api.update.mockImplementation(async(_key,patch)=>{api.store={...api.store,...patch};return {...api.store};});api.reset.mockResolvedValue(undefined);});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});
const config=(changes:Partial<RunConfigView>={}):RunConfigView=>({id:'c',name:'Codex Test',toolId:'codex',kind:'codex',source:'provider',providerId:'p',models:['a'],defaultModel:'a',homeVisible:true,isDefault:false,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null,...changes});
const provider=(changes:Partial<ProviderView>={}):ProviderView=>({id:'p',name:'DeepSeek',preset:'deepseek',endpoints:{responses:'https://api.deepseek.com/'},authType:'bearer',hasKey:true,identityRevision:1,models:[{id:'a',name:'A',contextWindow:128000,offline:false,availability:{codex:'available',claude:'available'}}],recommended:{codex:'a'},refreshedAt:1,...changes});
function permission(kind='codex',disabled=false){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});clients.push(client);const wrap=(k:string,d=false)=><QueryClientProvider client={client}><HomePermissionPicker kind={k} disabled={d}/></QueryClientProvider>;const view=render(wrap(kind,disabled));return {...view,client,kind:(k:string)=>view.rerender(wrap(k,disabled))};}
async function openPermission(){const button=screen.getByTestId('home-permission');await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));fireEvent.click(button);await waitFor(()=>expect(screen.getByRole('menu',{name:'权限'})).toBeTruthy());return screen.getByRole('menu',{name:'权限'});}
const fullItem=()=>screen.getByRole('menuitemradio',{name:/^完全访问权限/});
function deferred<T>(){let resolve!:(x:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}

it('home filtering preserves service order, fixed default and excludes legacy, hidden, logged-out and missing tools',()=>{
 const rows=[config({id:'d',name:'Default',isDefault:true,order:0}),config({id:'h',homeVisible:false}),config({id:'out',loggedOut:true}),config({id:'missing',available:false}),config({id:'later',order:99}),config({id:'legacy',source:'legacy',providerId:null,order:2})];expect(homeAgents(rows).map(c=>c.id)).toEqual(['d','later']);expect(rows.map(c=>c.id)).toEqual(['d','h','out','missing','later','legacy']);
});
it('initial selection prioritizes eligible default then remembered ID then first, with empty list null',()=>{
 const rows=homeAgents([config({id:'hidden-default',isDefault:true,homeVisible:false}),config({id:'a'}),config({id:'d',isDefault:true})]);expect(homeAgentId(rows,'a')).toBe('d');expect(homeAgentId(rows.filter(c=>!c.isDefault),'a')).toBe('a');expect(homeAgentId([config({id:'first'})],'gone')).toBe('first');expect(homeAgentId([],'gone')).toBeNull();
});
it('keeps a missing-key provider config eligible so launch preflight can explain repairs',()=>{
 const p=provider({hasKey:false});
 const c=config({id:'no-key',providerId:p.id});
 expect(homeAgentId(homeAgents([c]))).toBe('no-key');
});
it('Claude hides auto, remembered auto falls back without a settings write and returns when switched to Codex',async()=>{
 api.store={selected:'auto',fullConfirmed:false};const view=permission('claude');await waitFor(()=>expect(screen.getByTestId('home-permission').textContent).toBe('请求批准'));await openPermission();expect(screen.queryByRole('menuitemradio',{name:/^帮我批准/})).toBeNull();expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);expect(api.update).not.toHaveBeenCalled();fireEvent.keyDown(screen.getByRole('menu',{name:'权限'}),{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('menu',{name:'权限'})).toBeNull());view.kind('codex');await waitFor(()=>expect(screen.getByTestId('home-permission').textContent).toBe('帮我批准'));await openPermission();expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);expect(screen.getByRole('menuitemradio',{name:/^帮我批准/}).getAttribute('aria-checked')).toBe('true');expect(api.store.selected).toBe('auto');expect(api.update).not.toHaveBeenCalled();
});
it.each(['button','Escape'])('first full-access confirmation %s cancellation does not change selected/confirmed preferences',async cancel=>{
 permission();await openPermission();fireEvent.click(fullItem());await waitFor(()=>expect(screen.getByRole('dialog',{name:'使用完全访问权限？'})).toBeTruthy());expect(api.update).not.toHaveBeenCalled();if(cancel==='button')fireEvent.click(screen.getByRole('button',{name:'取消'}));else fireEvent.keyDown(screen.getByRole('dialog',{name:'使用完全访问权限？'}),{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog',{name:'使用完全访问权限？'})).toBeNull());expect(api.store).toEqual({selected:'ask',fullConfirmed:false});expect(api.update).not.toHaveBeenCalled();expect(screen.getByTestId('home-permission').textContent).toBe('请求批准');
});
it('confirmed full access persists via real settings hook/RPC boundary across remount; returning to full does not reconfirm',async()=>{
 const first=permission();await openPermission();fireEvent.click(fullItem());await waitFor(()=>expect(screen.getByRole('button',{name:'继续使用完全访问'})).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'继续使用完全访问'}));await waitFor(()=>expect(api.update).toHaveBeenCalledExactlyOnceWith('agentPermissions',{selected:'full',fullConfirmed:true}));await waitFor(()=>expect(api.store).toEqual({selected:'full',fullConfirmed:true}));first.unmount();
 permission();await waitFor(()=>expect(screen.getByTestId('home-permission').textContent).toBe('完全访问权限'));expect(screen.getByTestId('home-permission').classList.contains('danger')).toBe(true);await openPermission();fireEvent.click(screen.getByRole('menuitemradio',{name:/^请求批准/}));await waitFor(()=>expect(api.store.selected).toBe('ask'));await openPermission();fireEvent.click(fullItem());await waitFor(()=>expect(api.update).toHaveBeenCalledTimes(3));expect(api.update.mock.calls[2]).toEqual(['agentPermissions',{selected:'full'}]);expect(screen.queryByRole('dialog',{name:'使用完全访问权限？'})).toBeNull();expect(api.store.fullConfirmed).toBe(true);
});
it('real settings hook rolls optimistic permission back when main update fails, without falsely marking confirmation',async()=>{
 api.update.mockRejectedValue(new Error('SYNTHETIC_SETTINGS_WRITE_FAILED'));permission();await openPermission();fireEvent.click(fullItem());await waitFor(()=>expect(screen.getByRole('button',{name:'继续使用完全访问'})).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'继续使用完全访问'}));await waitFor(()=>expect(api.toastError).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByTestId('home-permission').textContent).toBe('请求批准'));expect(api.store).toEqual({selected:'ask',fullConfirmed:false});await openPermission();fireEvent.click(fullItem());await waitFor(()=>expect(screen.getByRole('dialog',{name:'使用完全访问权限？'})).toBeTruthy());
});
it('loading or explicitly disabled permission control cannot invoke mutation',async()=>{
 const pending=deferred<any>();api.get.mockReturnValue(pending.promise);const view=permission();expect((screen.getByTestId('home-permission') as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByTestId('home-permission'));expect(screen.queryByRole('menu',{name:'权限'})).toBeNull();await act(async()=>pending.resolve({value:{selected:'ask',fullConfirmed:false},defaults:{selected:'ask',fullConfirmed:false},overrides:{}}));view.unmount();permission('codex',true);await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(2));expect((screen.getByTestId('home-permission') as HTMLButtonElement).disabled).toBe(true);expect(api.update).not.toHaveBeenCalled();
});
it('lets Escape close the current model picker without changing the selected Agent',async()=>{
 const pick=vi.fn();
 const client=new QueryClient({defaultOptions:{queries:{gcTime:0}}});
 clients.push(client);
 render(<QueryClientProvider client={client}><AgentModelPicker profiles={[{profileId:'a',kind:'codex',source:'login',name:'Agent A',models:[],available:true}]} profileId="a" onPick={pick} onExtensions={()=>{}} /></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'选择智能体与模型'}));
 expect(screen.getByRole('dialog')).toBeTruthy();
 fireEvent.keyDown(document,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(pick).not.toHaveBeenCalled();
});
it('permission popup keyboard Escape dismisses without mutating the remembered choice',async()=>{
 permission();const trigger=screen.getByTestId('home-permission');await waitFor(()=>expect((trigger as HTMLButtonElement).disabled).toBe(false));trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown',code:'ArrowDown'});await waitFor(()=>expect(screen.getByRole('menu',{name:'权限'})).toBeTruthy());fireEvent.keyDown(screen.getByRole('menu',{name:'权限'}),{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('menu',{name:'权限'})).toBeNull());expect(api.update).not.toHaveBeenCalled();
});
it('explicit file-build BASE_URL context produces relative icon hrefs beside file renderer HTML; no packaged loading claim',async()=>{
 vi.stubEnv('BASE_URL','./');vi.resetModules();
 try {
  const icons=await import('./icons');expect(import.meta.env.BASE_URL).toBe('./');render(<><icons.ToolIcon tool="codex"/><icons.ProviderIcon catalog="deepseek" name="DeepSeek"/><icons.PluginIcon id="zentao" name="禅道"/></>);
  const hrefs=[...document.querySelectorAll('image')].map(e=>e.getAttribute('href')!);expect(hrefs).toHaveLength(3);const base='file:///private/tmp/Synthetic.app/Contents/Resources/app.asar/out/renderer/index.html';
  for(const href of hrefs){expect(href.startsWith('./assets/')).toBe(true);const resolved=new URL(href,base);expect(resolved.href).toContain('/out/renderer/assets/');expect(resolved.pathname.startsWith('/assets/')).toBe(false);expect(existsSync(resolve('src/renderer/public',href.replace(/^\.\//,'')))).toBe(true);}
 }finally{vi.unstubAllEnvs();}
});
it('A12 home full-access confirmation states plugin writes no longer ask and mail still asks, the same as the task page (D06-67)',async()=>{
 permission();await openPermission();fireEvent.click(fullItem());
 const dialog=await screen.findByRole('dialog',{name:'使用完全访问权限？'});
 expect(dialog.textContent).toContain('插件的写操作也不再询问，发送邮件仍会每次询问');
 expect(dialog.textContent).not.toContain('插件写操作仍会单独询问');
});
