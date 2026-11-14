// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {pluginPanelSchema} from '@shared/plugins';
import {PluginPages} from './plugin-panel';
import {useApplicationEvents} from './api';
const notifications=vi.hoisted(()=>({listener:undefined as ((value:unknown)=>void)|undefined}));
const api=vi.hoisted(()=>({pluginRead:vi.fn(),pluginCancelRead:vi.fn(),pluginPageContext:vi.fn(),pluginPrepareAction:vi.fn(),pluginOpenAction:vi.fn(),pluginReleaseAction:vi.fn(),list:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:api,projects:{list:api.list}},events:{on:(_event:unknown,listener:(value:unknown)=>void)=>{notifications.listener=listener;return()=>{notifications.listener=undefined;};}}}));
const ok=<T,>(value:T)=>({ok:true as const,value});
const panel=pluginPanelSchema.parse({id:'work',title:'我的工作',subtitle:'当前账号 {connection.summary.username}',kind:'list',refresh:true,tabs:[{id:'bug',title:'Bug',input:{kind:'bug'}},{id:'story',title:'需求',input:{kind:'story'}}],source:{capability:'demo-tracker.work.list',input:{account:'{connection.summary.username}'},items:'items',pagination:{type:'cursor',inputField:'cursor',nextField:'nextCursor',pageSize:20},partial:{completeField:'complete',problemsField:'problems'}},rowKey:'id',columns:[{field:'id',title:'编号'},{field:'title',title:'标题'}],onRowOpen:{detail:'object'},details:{object:{titleTemplate:'对象 {value.id}',source:{capability:'demo-tracker.object.get',input:{reference:'{row.reference}'}},sections:[{kind:'fields',from:'fields',labels:'labels'},{kind:'resource',title:'正文',from:'body',read:'demo-tracker.resource.read',render:'markdown-or-text'}]}}});
const plugin={appId:'demo-tracker',hash:'a'.repeat(64),enabled:true,panels:[panel]};
const list=(items:unknown[]=[{id:'1',title:'<img src=x onerror=alert(1)>',reference:{opaque:'R1'}}],nextCursor:string|null=null,complete=true)=>({items,nextCursor,complete,problems:complete?[]:[{code:'PARTIAL_SOURCE'}]});
const reply=(input:Record<string,unknown>,value:unknown)=>ok({requestId:input.requestId,operationId:'op',packageHash:plugin.hash,connectionScope:'c'.repeat(64),connectionSummary:{username:'qa'},value});
let client:QueryClient;
function mount(value=plugin){function Harness(){useApplicationEvents();return <PluginPages plugin={value}/>;}client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><Harness/></QueryClientProvider>);}
async function project(id='p1'){await screen.findByRole('option',{name:id==='p1'?'项目一':'项目二'});fireEvent.change(screen.getByRole('combobox',{name:'插件数据项目'}),{target:{value:id}});}
beforeEach(()=>{
  vi.clearAllMocks();api.list.mockResolvedValue([{id:'p1',name:'项目一'},{id:'p2',name:'项目二'}]);api.pluginCancelRead.mockResolvedValue(ok({cancelled:true}));api.pluginPageContext.mockResolvedValue(ok({connectionSummary:{username:'qa'},connectionScope:'c'.repeat(64)}));api.pluginRead.mockImplementation(input=>Promise.resolve(reply(input,list())));
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();client?.clear();vi.restoreAllMocks();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});
describe('real renderer for data-only plugin declarations',()=>{
it('T077 page switches host connection name/mode across projects with the same username without mixing sources',async()=>{
 const selection=(projectId:string)=>({mode:projectId==='p1'?'follow':'individual',connections:[{slot:'tracker-api',connectionId:projectId==='p1'?'connection-A':'connection-B',name:projectId==='p1'?'T077 connection A':'T077 connection B'}]});
 api.pluginPageContext.mockImplementation(input=>Promise.resolve(ok({connectionScope:input.projectId==='p1'?'c'.repeat(64):'d'.repeat(64),connectionSummary:{username:'qa',name:'SPOOF_FROM_PLUGIN_CONFIG',mode:'untrusted'},connectionSelection:selection(input.projectId)})));
 api.pluginRead.mockImplementation(input=>{const r=reply(input,list());return Promise.resolve({...r,value:{...r.value,connectionScope:input.projectId==='p1'?'c'.repeat(64):'d'.repeat(64),connectionSelection:selection(input.projectId)}});});
 mount();await project('p1');await screen.findByRole('button',{name:'1'});
 await waitFor(()=>expect(document.querySelector('.m13-plugin-pages')?.textContent).toContain('使用连接：T077 connection A'));
 expect(document.querySelector('.m13-plugin-pages')?.textContent).toContain('跟随全局默认');
 await project('p2');await screen.findByRole('button',{name:'1'});
 await waitFor(()=>expect(document.querySelector('.m13-plugin-pages')?.textContent).toContain('使用连接：T077 connection B'));
 expect(document.querySelector('.m13-plugin-pages')?.textContent).toContain('本项目个性化');
 expect(document.querySelector('.m13-plugin-pages')?.textContent).not.toContain('T077 connection A');
 expect(document.querySelector('.m13-plugin-pages')?.textContent).not.toContain('SPOOF_FROM_PLUGIN_CONFIG');
 expect(document.querySelector('.m13-plugin-pages')?.textContent).not.toContain('跟随全局默认');
});
it('T077 next-page timeout uses approved unfinished-list notice and retains previous rows',async()=>{
 api.pluginRead.mockImplementation(input=>Promise.resolve(input.input.cursor?{ok:false,code:'SOURCE_UNAVAILABLE',message:'第 2 页读取超时'}:reply(input,list(undefined,'cursor2',false))));
 mount();await project();await screen.findByRole('button',{name:'1'});fireEvent.click(screen.getByRole('button',{name:/^(加载更多|读取下一页)$/}));
 await screen.findByText(/列表读取未完成/);
 expect(screen.getByRole('button',{name:'1'})).toBeTruthy();
 expect(screen.getByText(/第 2 页读取超时/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});

  it('does not restart page reads when a child runtime closes or updates its health',async()=>{
    mount();await project();await screen.findByRole('button',{name:'1'});client.setQueryData(['applications','plugins'],[]);
    await act(async()=>{notifications.listener?.({kind:'plugin-runtime',appId:'demo-tracker'});await Promise.resolve();});
    expect(client.getQueryState(['applications','plugins'])?.isInvalidated).toBe(true);expect(api.pluginRead).toHaveBeenCalledTimes(1);expect(api.pluginPageContext).toHaveBeenCalledTimes(1);
  });
  it('requires explicit project selection and sends the typed tab input plus public connection summary',async()=>{
    mount();await screen.findByText('项目一');expect(api.pluginRead).not.toHaveBeenCalled();await project();await screen.findByRole('button',{name:'1'});
    expect(api.pluginRead).toHaveBeenCalledWith(expect.objectContaining({projectId:'p1',panelId:'work',packageHash:plugin.hash,connectionScope:'c'.repeat(64),capability:'demo-tracker.work.list',input:{kind:'bug',account:'qa'}}));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('当前账号 qa')).toBeTruthy();
  });
  it('preserves partial rows, uses the source cursor, and keeps previous rows when the next page fails',async()=>{
    api.pluginRead.mockImplementation(input=>Promise.resolve(input.input.cursor?{ok:false,code:'SOURCE_UNAVAILABLE',message:'第二页离线'}:reply(input,list(undefined,'cursor2',false))));
    mount();await project();await screen.findByText(/PARTIAL_SOURCE/);fireEvent.click(screen.getByRole('button',{name:'读取下一页'}));await screen.findByText(/第二页离线/);
    expect(screen.getByRole('button',{name:'1'})).toBeTruthy();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();expect(api.pluginRead).toHaveBeenLastCalledWith(expect.objectContaining({input:{kind:'bug',account:'qa',cursor:'cursor2'},connectionScope:'c'.repeat(64)}));
  });
  it('opens details using the opaque reference object and reads inert resource text under the same account scope',async()=>{
    api.pluginRead.mockImplementation(input=>Promise.resolve(reply(input,input.capability==='demo-tracker.object.get'?{id:'1',fields:{status:'open'},labels:{status:'状态'},body:{opaque:'BODY1'}}:input.capability==='demo-tracker.resource.read'?{mediaType:'text/html',encoding:'utf8',data:'<script>alert(1)</script><p>正文安全内容</p><img src="https://example.invalid/tracker">'}:list())));
    mount();await project();fireEvent.click(await screen.findByRole('button',{name:'1'}));const dialog=await screen.findByRole('dialog',{name:'对象 1'});expect(within(dialog).getByText('状态')).toBeTruthy();
    expect(api.pluginRead).toHaveBeenCalledWith(expect.objectContaining({capability:'demo-tracker.object.get',input:{reference:{opaque:'R1'}},connectionScope:'c'.repeat(64)}));
    fireEvent.click(within(dialog).getByRole('button',{name:'读取内容'}));await screen.findByText('正文安全内容');expect(document.querySelector('img')).toBeNull();expect(document.querySelector('script')).toBeNull();expect(api.pluginRead).toHaveBeenLastCalledWith(expect.objectContaining({capability:'demo-tracker.resource.read',input:{resource:{opaque:'BODY1'}},connectionScope:'c'.repeat(64)}));
  });
  it('routes row and detail actions using their exact host read receipts and page-local row identity',async()=>{
    const declared=pluginPanelSchema.parse({...panel,rowActions:[{kind:'openUrl',title:'打开行链接',field:'url'}],details:{object:{...panel.details.object,actions:[{kind:'openUrl',title:'打开详情链接',field:'url'}]}}});
    api.pluginRead.mockImplementation(input=>{
      const value=input.capability==='demo-tracker.object.get'?{id:'1',url:'https://example.invalid/detail',fields:{},labels:{}}:list([{id:'1',title:'Original',url:'https://example.invalid/list',reference:{opaque:'R1'}}]);
      const response=reply(input,value);return Promise.resolve({...response,value:{...response.value,actionReceipt:input.requestId}});
    });
    api.pluginPrepareAction.mockResolvedValue(ok({id:'action1',kind:'openUrl',projectId:'p1',appId:'demo-tracker',title:'Open',url:'https://example.invalid/host',closeOnDone:false,expiresAt:9999999999999}));api.pluginOpenAction.mockResolvedValue(ok({opened:true}));api.pluginReleaseAction.mockResolvedValue(ok({released:true}));
    mount({...plugin,panels:[declared]});await project();fireEvent.click(await screen.findByRole('button',{name:'打开行链接'}));await waitFor(()=>expect(api.pluginOpenAction).toHaveBeenCalledTimes(1));const original=api.pluginRead.mock.calls[0][0].requestId;expect(api.pluginPrepareAction).toHaveBeenLastCalledWith({receiptId:original,actionIndex:0,row:{receiptId:original,index:0,tabId:'bug'}});
    fireEvent.click(screen.getByRole('button',{name:'1'}));const dialog=await screen.findByRole('dialog',{name:'对象 1'});fireEvent.click(within(dialog).getByRole('button',{name:'打开详情链接'}));await waitFor(()=>expect(api.pluginOpenAction).toHaveBeenCalledTimes(2));const detail=api.pluginRead.mock.calls[1][0].requestId;expect(api.pluginPrepareAction).toHaveBeenLastCalledWith({receiptId:detail,actionIndex:0,detailId:'object',row:{receiptId:original,index:0,tabId:'bug'}});
  });
  it('cancels the old read on project switch and never renders its late response',async()=>{
    let finish!:(value:unknown)=>void;api.pluginRead.mockImplementation(input=>input.projectId==='p1'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(reply(input,list([{id:'2',title:'新项目',reference:{opaque:'R2'}}]))));
    mount();await project();await waitFor(()=>expect(api.pluginRead).toHaveBeenCalledTimes(1));const first=api.pluginRead.mock.calls[0][0];await project('p2');await screen.findByText('新项目');await waitFor(()=>expect(api.pluginCancelRead).toHaveBeenCalledWith(first.requestId));
    await act(async()=>finish(reply(first,list([{id:'OLD',title:'旧项目结果',reference:{}}]))));expect(screen.queryByText('旧项目结果')).toBeNull();
  });
  it('rejects malformed result shapes and renders an error instead of a false empty list',async()=>{
    api.pluginRead.mockImplementation(input=>Promise.resolve(reply(input,{items:null,nextCursor:null,complete:true,problems:[]})));mount();await project();await screen.findByText('插件数据读取未完成');expect(screen.queryByText('当前列表为空。')).toBeNull();
  });
  it('does not read a disabled plugin or a project whose current authorization failed',async()=>{
    const view=mount({...plugin,enabled:false});expect(await screen.findByText(/插件已停用/)).toBeTruthy();expect(api.pluginPageContext).not.toHaveBeenCalled();expect(api.pluginRead).not.toHaveBeenCalled();view.unmount();
    api.pluginPageContext.mockResolvedValue({ok:false,code:'AUTH_REQUIRED',message:'请先配置此项目连接'});mount();await project();await screen.findByText('请先配置此项目连接');expect(api.pluginRead).not.toHaveBeenCalled();
  });
  it('shows missing detail template data as a read error and preserves the parent list',async()=>{
    api.pluginRead.mockImplementation(input=>Promise.resolve(reply(input,list([{id:'1',title:'未提供引用'}]))));mount();await project();fireEvent.click(await screen.findByRole('button',{name:'1'}));await screen.findByText('详情读取未完成');expect(screen.getByText('未提供引用')).toBeTruthy();expect(api.pluginRead).toHaveBeenCalledTimes(1);
  });
  it.each(['image/png','application/pdf'])('previews %s through a bounded blob URL, isolates PDF and revokes the URL on close',async mediaType=>{
    const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:synthetic-plugin-preview'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
    api.pluginRead.mockImplementation(input=>Promise.resolve(reply(input,input.capability==='demo-tracker.object.get'?{id:'1',fields:{},labels:{},body:{opaque:'RESOURCE1',mediaType}}:input.capability==='demo-tracker.resource.read'?{mediaType,encoding:'base64',data:mediaType==='image/png'?image:btoa('%PDF-1.4\n%%EOF')}:list())));
    mount();await project();fireEvent.click(await screen.findByRole('button',{name:'1'}));const dialog=await screen.findByRole('dialog',{name:'对象 1'});fireEvent.click(within(dialog).getByRole('button',{name:'读取内容'}));
    if(mediaType==='image/png'){const img=await screen.findByAltText('插件附件预览');expect(img.getAttribute('src')).toBe('blob:synthetic-plugin-preview');}
    else{const frame=await screen.findByTitle('PDF 附件预览');expect(frame.getAttribute('sandbox')).toBe('');expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');expect(frame.getAttribute('src')).toBe('blob:synthetic-plugin-preview');}
    expect(create).toHaveBeenCalledTimes(1);fireEvent.click(within(dialog).getByRole('button',{name:'关闭'}));await waitFor(()=>expect(revoke).toHaveBeenCalledWith('blob:synthetic-plugin-preview'));
  });
  it('uses declared enum presentation and MIME preview patterns instead of filename extensions',async()=>{
    const declared=pluginPanelSchema.parse({...panel,source:{...panel.source,presentationField:'presentation'},columns:[...panel.columns,{field:'status',title:'状态',enum:'status'}],details:{object:{...panel.details.object,sections:[{kind:'resourceList',from:'attachments',nameField:'filename',resourceField:'resource',read:'demo-tracker.resource.read',preview:['text/*','application/pdf']}]}}});
    api.pluginRead.mockImplementation(input=>Promise.resolve(reply(input,input.capability==='demo-tracker.object.get'?{id:'1',attachments:[{filename:'无扩展名',resource:{opaque:'TEXT',mediaType:'text/plain'}},{filename:'blocked.txt',resource:{opaque:'ZIP',mediaType:'application/zip'}}]}:input.capability==='demo-tracker.resource.read'?{mediaType:'text/plain',encoding:'utf8',data:'无扩展名的实际文本'}:{...list([{id:'1',title:'原对象',status:'active',reference:{opaque:'R1'}}]),presentation:{choices:{status:{active:'激活'}}}})));
    mount({...plugin,panels:[declared]});await project();await screen.findByText('激活');fireEvent.click(screen.getByRole('button',{name:'1'}));const dialog=await screen.findByRole('dialog',{name:'对象 1'});
    expect(within(dialog).getAllByRole('button',{name:'读取内容'})).toHaveLength(1);fireEvent.click(within(dialog).getByRole('button',{name:'读取内容'}));await screen.findByText('无扩展名的实际文本');expect(api.pluginRead).toHaveBeenLastCalledWith(expect.objectContaining({input:{resource:{opaque:'TEXT',mediaType:'text/plain'}}}));
  });
});
