// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup,fireEvent,render,screen,waitFor,within,act } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentPermission } from '@shared/agent-permissions';
import type { RunConfigView,ProviderView } from '@shared/ai-agents';
import { homeAgents,homeAgentId,HomeAgentPicker,HomePermissionPicker } from './home-agent-controls';
import { AgentList } from './agent-list';
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

it('home filtering preserves service order, fixed default and eligible legacy while excluding hidden/logout/uninstalled',()=>{
 const rows=[config({id:'d',name:'Default',isDefault:true,order:0}),config({id:'h',homeVisible:false}),config({id:'out',loggedOut:true}),config({id:'missing',available:false}),config({id:'later',order:99}),config({id:'legacy',source:'legacy',providerId:null,order:2})];expect(homeAgents(rows).map(c=>c.id)).toEqual(['d','later','legacy']);expect(rows.map(c=>c.id)).toEqual(['d','h','out','missing','later','legacy']);
});
it('initial selection prioritizes eligible default then remembered ID then first, with empty list null',()=>{
 const rows=homeAgents([config({id:'hidden-default',isDefault:true,homeVisible:false}),config({id:'a'}),config({id:'d',isDefault:true})]);expect(homeAgentId(rows,'a')).toBe('d');expect(homeAgentId(rows.filter(c=>!c.isDefault),'a')).toBe('a');expect(homeAgentId([config({id:'first'})],'gone')).toBe('first');expect(homeAgentId([],'gone')).toBeNull();
});
it('missing Key and offline-model configs remain selectable so launch preflight can explain repairs',async()=>{
 const a=config({id:'no-key',name:'Missing Key'}),b=config({id:'offline',name:'Offline Model'}),p=provider({hasKey:false});p.models[0].offline=true;const change=vi.fn();render(<HomeAgentPicker configs={homeAgents([a,b])} providers={[p]} value={a.id} onChange={change}/>);fireEvent.click(screen.getByRole('button',{name:'选择智能体'}));await waitFor(()=>expect(screen.getByRole('menuitem',{name:'Offline Model'})).toBeTruthy());fireEvent.click(screen.getByRole('menuitem',{name:'Offline Model'}));expect(change).toHaveBeenCalledExactlyOnceWith('offline');
});
it('home and settings share actual AgentIcon asset identities, Provider badge and legacy terminal fallback',async()=>{
 const rows=[config({id:'native',name:'Native Login',source:'login',providerId:null}),config({id:'provider',name:'Provider Agent'}),config({id:'legacy',name:'Legacy Agent',source:'legacy',providerId:null})],p=provider();
 const actions={edit:vi.fn(),remove:vi.fn(),setDefault:vi.fn(),toggleVisible:vi.fn(),reorder:vi.fn(),create:vi.fn()};
 function Parent(){const [value,setValue]=useState('native');return <><AgentList configs={rows} providers={[p]} tools={[{id:'codex',kind:'codex',installed:true,login:'api',executable:'/synthetic/codex',version:'synthetic'}]} actions={actions}/><HomeAgentPicker configs={rows} providers={[p]} value={value} onChange={setValue}/></>;}
 render(<Parent/>);const trigger=screen.getByTestId('home-profile');expect(trigger.querySelector('.m13-agent-badge')).toBeNull();fireEvent.click(trigger);await waitFor(()=>expect(screen.getByRole('menuitem',{name:'Provider Agent'})).toBeTruthy());const homeItem=screen.getByRole('menuitem',{name:'Provider Agent'}),list=document.querySelector('[data-agent="provider"] [data-agent-icon]')!;const assets=(e:Element)=>[...e.querySelectorAll('image')].map(x=>x.getAttribute('href'));expect(assets(homeItem)).toEqual(assets(list));expect(homeItem.querySelector('.m13-agent-badge')).toBeTruthy();fireEvent.click(homeItem);expect(trigger.textContent).toContain('Provider Agent');expect(trigger.querySelector('.m13-agent-badge')).toBeTruthy();fireEvent.click(trigger);await waitFor(()=>expect(screen.getByRole('menuitem',{name:'Legacy Agent'})).toBeTruthy());fireEvent.click(screen.getByRole('menuitem',{name:'Legacy Agent'}));expect(trigger.querySelector('.m13-agent-badge')).toBeNull();expect(trigger.querySelector('polyline')).toBeTruthy();
});
it('manage menu navigates to actual aiProfiles settings only',async()=>{
 render(<HomeAgentPicker configs={[config()]} providers={[provider()]} value="c" onChange={vi.fn()}/>);fireEvent.click(screen.getByTestId('home-profile'));await waitFor(()=>expect(screen.getByRole('menuitem',{name:'管理智能体'})).toBeTruthy());fireEvent.click(screen.getByRole('menuitem',{name:'管理智能体'}));expect(api.settings).toHaveBeenCalledExactlyOnceWith('aiProfiles');
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
it('agent popup opens with keyboard, accepts focused item by Enter, and Escape dismisses without a second selection',async()=>{
 const change=vi.fn();render(<HomeAgentPicker configs={[config({id:'a',name:'Agent A'}),config({id:'b',name:'Agent B'})]} providers={[provider()]} value="a" onChange={change}/>);const trigger=screen.getByTestId('home-profile');trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown',code:'ArrowDown'});await waitFor(()=>expect(screen.getByRole('menu',{name:'智能体'})).toBeTruthy());const target=screen.getByRole('menuitem',{name:'Agent B'});target.focus();fireEvent.keyDown(target,{key:'Enter',code:'Enter'});await waitFor(()=>expect(change).toHaveBeenCalledExactlyOnceWith('b'));fireEvent.click(trigger);await waitFor(()=>expect(screen.getByRole('menu',{name:'智能体'})).toBeTruthy());fireEvent.keyDown(screen.getByRole('menu',{name:'智能体'}),{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('menu',{name:'智能体'})).toBeNull());expect(change).toHaveBeenCalledOnce();
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
