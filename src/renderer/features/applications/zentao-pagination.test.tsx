// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ZentaoWorkData,ZentaoWorkInput,ZentaoDetailData} from '@shared/application-zentao';
import {ZentaoPanel} from './zentao-panel';
import {useApplicationEvents,type CatalogItem} from './api';

// Keep the production React Query pagination/state machine; only the IPC
// boundary supplies deterministic per-page outcomes. This is software UI, not
// packaged App, authentication, system focus or real ZenTao evidence.
const m=vi.hoisted(()=>({projectSettings:vi.fn(),connections:vi.fn(),zentaoWork:vi.fn(),zentaoObject:vi.fn(),cancelUiRead:vi.fn(),showTerminal:false,notify:null as null|((value:unknown)=>void)}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m},events:{on:(_event:unknown,callback:(value:unknown)=>void)=>{m.notify=callback;return()=>{m.notify=null;};}}}));
vi.mock('./terminal-insertion',()=>({ApplicationTerminalButton:()=>m.showTerminal?<button>插入当前终端</button>:null}));
const id='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const app:CatalogItem={appId:'zentao',added:true,enabled:true,revision:1,displayName:'禅道',description:'',version:'1.0.0',defaultPackageHash:hash,skills:[],tools:[],versions:[],connectionCount:1};
const ok=<T,>(value:T)=>({ok:true as const,value});
const failed=()=>({ok:false as const,code:'CONNECTION_UNAVAILABLE' as const,message:'本次隔离分页请求失败'});
function page(kind:'bug'|'story',ids:string[],nextCursor:string|null=null):ZentaoWorkData{
 return{kind,items:ids.map(n=>({id:n,title:kind+'-row-'+n,status:'active',assignedTo:'me',reference:{connectionId:id,identityRevision:1,nativeId:n,contentRevision:hash}})),total:3,nextCursor,complete:nextCursor===null,checkedAt:'2026-10-27T00:00:00.000Z',problems:[]};
}
let client:QueryClient;
function WithEvents({projectId}:{projectId:string}){useApplicationEvents();return <ZentaoPanel projectId={projectId} app={app}/>;}
function mount(projectId='p-own'){
 client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
 const tree=(project:string)=><QueryClientProvider client={client}><WithEvents projectId={project}/></QueryClientProvider>;
 const view=render(tree(projectId));return{...view,switchProject:(project:string)=>view.rerender(tree(project))};
}
const cursors=()=>m.zentaoWork.mock.calls.map(([_project,input])=>(input as ZentaoWorkInput).cursor);
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 vi.resetAllMocks();m.showTerminal=false;m.cancelUiRead.mockResolvedValue(ok({canceled:true}));
 m.projectSettings.mockResolvedValue(ok({enabled:true,revision:1,connections:{zentao:id}}));
 m.connections.mockResolvedValue(ok([{id,revision:1,name:'Private source',enabled:true,authorization:'connected',config:{kind:'zentao',username:'me'}}]));
});
afterEach(()=>{cleanup();client?.clear();});

describe('ZenTao partial pagination keeps successful pages and retries the missing cursor',()=>{
 it('OZ cancels the in-flight old-kind producer with its own request identity on tab change',async()=>{
  let finish!:(value:ReturnType<typeof ok<ZentaoWorkData>>)=>void;m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>input.kind==='story'?ok(page('story',['9'])):input.cursor?new Promise(resolve=>{finish=resolve;}):ok(page('bug',['1'],'cursor-2')));mount();await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));const request=m.zentaoWork.mock.calls.find(([,v])=>v.cursor==='cursor-2')?.[2];fireEvent.click(screen.getByRole('tab',{name:'研发需求'}));await screen.findByRole('button',{name:/story-row-9/});await waitFor(()=>expect(m.cancelUiRead).toHaveBeenCalledTimes(1));expect(request).toMatch(/^[a-f0-9-]{36}$/);expect(m.cancelUiRead).toHaveBeenCalledWith(request);await act(async()=>finish(ok(page('bug',['2']))));expect(screen.queryByRole('button',{name:/bug-row-/})).toBeNull();expect(screen.getByRole('button',{name:/story-row-9/})).toBeTruthy();
 });
 it('OZ cancels the old project request when its observer leaves while keeping the new request independent',async()=>{
  let finish!:(value:ReturnType<typeof ok<ZentaoWorkData>>)=>void;m.zentaoWork.mockImplementation(async(project:string)=>project==='p-new'?ok(page('bug',['9'])):new Promise(resolve=>{finish=resolve;}));const view=mount();await waitFor(()=>expect(finish).toBeTypeOf('function'));const request=m.zentaoWork.mock.calls[0][2];view.switchProject('p-new');await screen.findByRole('button',{name:/bug-row-9/});await waitFor(()=>expect(m.cancelUiRead).toHaveBeenCalledWith(request));expect(request).toMatch(/^[a-f0-9-]{36}$/);expect(m.zentaoWork.mock.calls.at(-1)?.[2]).not.toBe(request);await act(async()=>finish(ok(page('bug',['1']))));expect(screen.queryByRole('button',{name:/bug-row-1/})).toBeNull();
 });
 it('OY-02 updates health metadata without refreshing the failed page or losing its recovery cursor',async()=>{
  m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>input.cursor?failed():ok(page('bug',['1'],'cursor-2')));mount();await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await screen.findByRole('button',{name:'重试缺失页'});await act(async()=>{m.notify?.({kind:'health',appId:'zentao',connectionId:id});});await waitFor(()=>expect(m.connections).toHaveBeenCalledTimes(2));expect(cursors()).toEqual([null,'cursor-2']);expect(screen.getByRole('button',{name:'重试缺失页'})).toBeTruthy();expect(screen.getByRole('button',{name:/bug-row-1/})).toBeTruthy();
 });
 it('OY-02 does not replace an in-flight next page with page1 after a health update',async()=>{
  let finish!:(value:ReturnType<typeof ok<ZentaoWorkData>>)=>void;m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>input.cursor?new Promise(resolve=>{finish=resolve;}):ok(page('bug',['1'],'cursor-2')));mount();await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));await act(async()=>{m.notify?.({kind:'health',appId:'zentao',connectionId:id});});await waitFor(()=>expect(m.connections).toHaveBeenCalledTimes(2));expect(cursors()).toEqual([null,'cursor-2']);await act(async()=>finish(ok(page('bug',['2']))));await screen.findByRole('button',{name:/bug-row-2/});expect(screen.getByRole('button',{name:/bug-row-1/})).toBeTruthy();
 });
 it('still refreshes project authorization and removes business rows on a management event',async()=>{
  m.zentaoWork.mockResolvedValue(ok(page('bug',['1'])));mount();await screen.findByRole('button',{name:/bug-row-1/});m.projectSettings.mockResolvedValue(ok({enabled:false,revision:2,connections:{zentao:id}}));await act(async()=>{m.notify?.(undefined);});await screen.findByText('当前项目尚未选用可用的禅道连接');expect(screen.queryByRole('button',{name:/bug-row-1/})).toBeNull();
 });
 it.each(['bug','story'] as const)('retains the successful %s page and retries only its failed next cursor',async kind=>{
  m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>{
   if(input.kind!==kind)return ok(page(input.kind,[]));
   if(!input.cursor)return ok(page(kind,['1'],'private-cursor-2'));
   return m.zentaoWork.mock.calls.filter(([,arg])=>arg.cursor===input.cursor).length===1?failed():ok(page(kind,['2']));
  });
  mount();if(kind==='story')fireEvent.click(await screen.findByRole('tab',{name:'研发需求'}));
  await screen.findByRole('button',{name:new RegExp(kind+'-row-1')});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));
  await screen.findByText(/本次隔离分页请求失败/);
  expect(screen.getByRole('button',{name:new RegExp(kind+'-row-1')})).toBeTruthy();
  expect(screen.queryByText(/当前没有指派给你的/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重试缺失页'}));
  await screen.findByRole('button',{name:new RegExp(kind+'-row-2')});
  expect(screen.getByRole('button',{name:new RegExp(kind+'-row-1')})).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(m.zentaoWork.mock.calls.filter(([,input])=>input.kind===kind).map(([,input])=>input.cursor)).toEqual([null,'private-cursor-2','private-cursor-2']);
 });
 it('retains two successful pages when page3 fails and does not refetch either earlier page',async()=>{
  m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>!input.cursor?ok(page('bug',['1'],'cursor-2')):input.cursor==='cursor-2'?ok(page('bug',['2'],'cursor-3')):m.zentaoWork.mock.calls.filter(([,arg])=>arg.cursor==='cursor-3').length===1?failed():ok(page('bug',['3'])));
  mount();await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));
  await screen.findByRole('button',{name:/bug-row-2/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await screen.findByText(/本次隔离分页请求失败/);
  expect(screen.getByRole('button',{name:/bug-row-1/})).toBeTruthy();expect(screen.getByRole('button',{name:/bug-row-2/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'重试缺失页'}));await screen.findByRole('button',{name:/bug-row-3/});
  expect(cursors()).toEqual([null,'cursor-2','cursor-3','cursor-3']);expect(screen.getAllByRole('button',{name:/bug-row-/})).toHaveLength(3);
 });
 it('keeps the initial failure distinct from an empty successful list and retries the first page',async()=>{
  m.zentaoWork.mockResolvedValueOnce(failed()).mockResolvedValue(ok(page('bug',['1'])));mount();
  await screen.findByText('列表读取未完成');expect(screen.queryByText(/当前没有指派给你的/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByRole('button',{name:/bug-row-1/});expect(cursors()).toEqual([null,null]);
 });
 it('labels a failed explicit refresh while retaining prior data and retries refresh rather than next-page',async()=>{
  m.zentaoWork.mockResolvedValueOnce(ok(page('bug',['1']))).mockResolvedValueOnce(failed()).mockResolvedValue(ok(page('bug',['9'])));mount();
  await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'刷新列表'}));await screen.findByText(/列表刷新未完成/);
  expect(screen.getByRole('button',{name:/bug-row-1/})).toBeTruthy();expect(screen.queryByRole('button',{name:'重试缺失页'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重试刷新'}));await screen.findByRole('button',{name:/bug-row-9/});expect(screen.queryByRole('button',{name:/bug-row-1/})).toBeNull();expect(cursors()).toEqual([null,null,null]);
 });
 it('does not label a prior empty list as a current successful empty result after refresh fails',async()=>{
  m.zentaoWork.mockResolvedValueOnce(ok({...page('bug',[]),total:0})).mockResolvedValue(failed());mount();
  await screen.findByText('当前没有指派给你的 Bug');fireEvent.click(screen.getByRole('button',{name:'刷新列表'}));await screen.findByText(/本次隔离分页请求失败/);
  expect(screen.queryByText('当前没有指派给你的 Bug')).toBeNull();expect(screen.getByRole('button',{name:'重试刷新'})).toBeTruthy();
 });
 it('ignores a late old-kind page result after switching from Bug to Story',async()=>{
  let finish!:(value:ReturnType<typeof ok<ZentaoWorkData>>)=>void;
  m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>input.kind==='story'?ok(page('story',['9'])):!input.cursor?ok(page('bug',['1'],'cursor-2')):new Promise(resolve=>{finish=resolve;}));mount();
  await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('tab',{name:'研发需求'}));await screen.findByRole('button',{name:/story-row-9/});
  await act(async()=>{finish(ok(page('bug',['2'])));});
  expect(screen.queryByRole('button',{name:/bug-row-/})).toBeNull();expect(screen.getByRole('button',{name:/story-row-9/})).toBeTruthy();
 });
 it('does not deliver an old project page into the newly selected project',async()=>{
  let finish!:(value:ReturnType<typeof ok<ZentaoWorkData>>)=>void;
  m.zentaoWork.mockImplementation(async(project:string,input:ZentaoWorkInput)=>project==='p-new'?ok(page('bug',['9'])):!input.cursor?ok(page('bug',['1'],'cursor-2')):new Promise(resolve=>{finish=resolve;}));const view=mount();
  await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  view.switchProject('p-new');await screen.findByRole('button',{name:/bug-row-9/});await act(async()=>{finish(ok(page('bug',['2'])));});
  expect(screen.queryByRole('button',{name:/bug-row-1|bug-row-2/})).toBeNull();expect(screen.getByRole('button',{name:/bug-row-9/})).toBeTruthy();expect(m.zentaoWork.mock.calls.at(-1)?.[0]).toBe('p-new');
 });
});


describe('SI pending retries never present an old failure as the current read result',()=>{
 it.each(['bug','story']as const)('%s initial list failure retry has one loading state and no duplicate action',async kind=>{
  let finish!:(v:ReturnType<typeof ok<ZentaoWorkData>>)=>void;m.zentaoWork.mockImplementation(async(_project:string,input:ZentaoWorkInput)=>input.kind!==kind?ok(page(input.kind,[])):failed());mount();if(kind==='story'){await screen.findByText('当前没有指派给你的 Bug');fireEvent.click(screen.getByRole('tab',{name:'研发需求'}));}await screen.findByText('列表读取未完成');m.zentaoWork.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const before=m.zentaoWork.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'重试'}));await waitFor(()=>expect(m.zentaoWork).toHaveBeenCalledTimes(before+1));expect(screen.queryByText('列表读取未完成')).toBeNull();expect(screen.getByText('正在读取本人列表')).toBeTruthy();expect(screen.queryByRole('button',{name:'重试'})).toBeNull();expect(screen.getByRole('button',{name:'刷新列表'})).toHaveProperty('disabled',true);await act(async()=>finish(ok(page(kind,['1']))));await screen.findByRole('button',{name:new RegExp(kind+'-row-1')});expect(cursors().at(-1)).toBeNull();
 });
 it.each([false,true])('detail retry replaces failure with loading, cached success=%s',async cached=>{
  m.zentaoWork.mockResolvedValue(ok(page('bug',['1'])));const detail:ZentaoDetailData={kind:'bug',id:'1',reference:page('bug',['1']).items[0].reference,fields:{title:'SI original detail'},body:null,history:null,attachments:[],complete:true,missing:[]};m.zentaoObject.mockResolvedValue(cached?ok(detail):failed());mount();await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('button',{name:/bug-row-1/}));if(cached){await screen.findByText('SI original detail');fireEvent.click(screen.getByRole('button',{name:/^关闭$/}));m.zentaoObject.mockResolvedValue(failed());fireEvent.click(screen.getByRole('button',{name:/bug-row-1/}));}await screen.findByText('详情不可用');let finish!:(v:ReturnType<typeof ok<ZentaoDetailData>>)=>void;m.zentaoObject.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const before=m.zentaoObject.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'重试'}));await waitFor(()=>expect(m.zentaoObject).toHaveBeenCalledTimes(before+1));expect(screen.queryByText('详情不可用')).toBeNull();expect(screen.queryByText('SI original detail')).toBeNull();expect(screen.queryByRole('button',{name:'重试'})).toBeNull();expect(screen.getByText('正在核对原对象')).toBeTruthy();await act(async()=>finish(ok(detail)));await screen.findByText('SI original detail');expect(m.zentaoObject.mock.calls.at(-1)?.[1].reference).toEqual(detail.reference);
 });
});


describe('SM current reads cannot present old success as fresh availability',()=>{
 it.each(['bug','story']as const)('%s pending refresh cannot claim the prior empty list is the current result',async kind=>{
  m.zentaoWork.mockImplementation(async(_p:string,input:ZentaoWorkInput)=>ok({...page(input.kind,[]),total:0}));mount();if(kind==='story'){await screen.findByText('当前没有指派给你的 Bug');fireEvent.click(screen.getByRole('tab',{name:'研发需求'}));}
  const label=kind==='bug'?'当前没有指派给你的 Bug':'当前没有指派给你的研发需求';await screen.findByText(label);let finish!:(v:ReturnType<typeof ok<ZentaoWorkData>>)=>void;m.zentaoWork.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const before=m.zentaoWork.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'刷新列表'}));await waitFor(()=>expect(m.zentaoWork).toHaveBeenCalledTimes(before+1));
  try{expect(screen.queryByText(label)).toBeNull();expect(screen.getByText('正在读取本人列表')).toBeTruthy();expect(screen.getByRole('button',{name:'刷新列表'})).toHaveProperty('disabled',true);}finally{await act(async()=>finish(ok({...page(kind,[]),total:0})));}
  await screen.findByText(label);expect(cursors().at(-1)).toBeNull();
 });
 it.each(['bug','story']as const)('%s cached detail cannot offer its old terminal reference while checking or after failure',async kind=>{
  m.showTerminal=true;m.zentaoWork.mockImplementation(async(_p:string,input:ZentaoWorkInput)=>ok(page(input.kind,['1'])));const detail:ZentaoDetailData={kind,id:'1',reference:page(kind,['1']).items[0].reference,fields:{title:'SM original detail'},body:null,history:null,attachments:[],complete:true,missing:[]};m.zentaoObject.mockResolvedValue(ok(detail));mount();if(kind==='story'){await screen.findByRole('button',{name:/bug-row-1/});fireEvent.click(screen.getByRole('tab',{name:'研发需求'}));}const row=()=>screen.getByRole('button',{name:new RegExp(kind+'-row-1')});await screen.findByRole('button',{name:new RegExp(kind+'-row-1')});fireEvent.click(row());await screen.findByText('SM original detail');await screen.findByRole('button',{name:'插入当前终端'});fireEvent.click(screen.getByRole('button',{name:/^关闭$/}));
  let finish!:(v:ReturnType<typeof ok<ZentaoDetailData>>|ReturnType<typeof failed>)=>void;m.zentaoObject.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(row());await waitFor(()=>expect(m.zentaoObject).toHaveBeenCalledTimes(2));
  try{expect(screen.queryByRole('button',{name:'插入当前终端'})).toBeNull();}finally{await act(async()=>finish(failed()));}
  await screen.findByText('详情不可用');expect(screen.queryByRole('button',{name:'插入当前终端'})).toBeNull();
  m.zentaoObject.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('正在核对原对象');expect(screen.queryByRole('button',{name:'插入当前终端'})).toBeNull();await act(async()=>finish(ok(detail)));await screen.findByRole('button',{name:'插入当前终端'});expect(m.zentaoObject.mock.calls.at(-1)?.[1]).toEqual({kind,reference:detail.reference});
 });
});
