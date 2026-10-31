// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {AiProfileView} from '@shared/ai-profiles';
import {PROFILE_COLORS} from '@shared/ai-profiles';
import {AiProfilesSection} from './ai-profiles';
// @ts-expect-error Shared isolated prototype is JavaScript.
import {ProfileEditor} from '@root/prototypes/m6-codex/src/ProfileEditor.jsx';
const api=vi.hoisted(()=>({profiles:[] as AiProfileView[],refresh:vi.fn(async()=>{}),aiProfiles:{detectRunners:vi.fn(async()=>[]),update:vi.fn(async(_id:string,_input:unknown)=>{}),create:vi.fn(async(_input:unknown)=>{})}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{aiProfiles:api.aiProfiles},events:{on:()=>()=>undefined}}));
vi.mock('@renderer/lib/hooks/useAiProfiles',()=>({useAiProfiles:()=>({data:api.profiles}),useRefreshAiProfiles:()=>api.refresh}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(k:string)=>k})}));
const clients:QueryClient[]=[];
const profile=(color:string|null):AiProfileView=>({id:'private-one',name:'Private Codex',runner:'codex',executable:'/private/original/codex',env:[{name:'CODEX_HOME',secret:false,value:'/private/original/state',hasValue:true}],args:['--profile','own'],color,isDefault:true,check:null,checking:false,createdAt:1,updatedAt:1});
function actual(color:string|null,create=false){api.profiles=create?[]:[profile(color)];const c=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});clients.push(c);render(<QueryClientProvider client={c}><AiProfilesSection/></QueryClientProvider>);fireEvent.click(screen.getByTestId(create?'profile-new':'profile-edit'));return screen.getByRole('dialog');}
function prototype(color:string|null,create=false){const save=vi.fn(),p=create?null:{id:'own',name:'Private Codex',runner:'codex',command:'/private/original/codex',source:'本机配置',args:'--profile own',color,isDefault:true,env:[]};render(<ProfileEditor profile={p} onSave={save} onClose={()=>{}} onDelete={()=>{}}/>);return save;}
beforeEach(()=>{vi.clearAllMocks();Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute("open","")}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute("open")}})});afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");Reflect.deleteProperty(HTMLDialogElement.prototype,"close")});
describe('PI-01 unrelated AI configuration survives executable edits',()=>{
 it.each([null,'#c59be8'])('actual editor keeps existing %s color and untouched environment/args',async color=>{const dialog=actual(color);fireEvent.change(dialog.querySelector('#profile-exe')!,{target:{value:'/private/replacement/codex'}});fireEvent.click(screen.getByRole('button',{name:'projects.actions.save'}));await waitFor(()=>expect(api.aiProfiles.update).toHaveBeenCalledOnce());expect(api.aiProfiles.update.mock.calls[0]).toEqual(['private-one',{name:'Private Codex',runner:'codex',executable:'/private/replacement/codex',env:[{name:'CODEX_HOME',secret:false,value:'/private/original/state'}],args:['--profile','own'],color,isDefault:true}]);expect(api.aiProfiles.create).not.toHaveBeenCalled()});
 it('actual editor still saves an explicitly selected color',async()=>{actual(null);fireEvent.click(screen.getByTitle(PROFILE_COLORS[2]));fireEvent.click(screen.getByRole('button',{name:'projects.actions.save'}));await waitFor(()=>expect(api.aiProfiles.update).toHaveBeenCalledOnce());expect(api.aiProfiles.update.mock.calls[0][1]).toHaveProperty('color',PROFILE_COLORS[2])});
 it('actual new profile keeps the existing default color',async()=>{const dialog=actual(null,true);fireEvent.change(dialog.querySelector('#profile-name')!,{target:{value:'New private'}});fireEvent.click(screen.getByRole('button',{name:'projects.actions.save'}));await waitFor(()=>expect(api.aiProfiles.create).toHaveBeenCalledOnce());expect(api.aiProfiles.create.mock.calls[0][0]).toHaveProperty('color',PROFILE_COLORS[0])});
 it.each([null,'#c59be8'])('prototype editor keeps existing %s color when command changes',color=>{const save=prototype(color);fireEvent.change(document.querySelector('input[name=command]')!,{target:{value:'/private/replacement/codex'}});fireEvent.click(screen.getByRole('button',{name:'保存配置'}));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toMatchObject({color,command:'/private/replacement/codex',name:'Private Codex',args:'--profile own',isDefault:true})});
 it('prototype new profile keeps its existing orange default',()=>{const save=prototype(null,true);fireEvent.click(screen.getByRole('button',{name:'保存配置'}));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toHaveProperty('color','#f08b55')});
});
