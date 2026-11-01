import {applicationMetadata} from '@shared/application-provider-metadata';
// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ZentaoPanel} from './zentao-panel';
import type {CatalogItem} from './api';
import {parseZentaoPresentation} from '@shared/zentao-presentation';
const m=vi.hoisted(()=>({projectSettings:vi.fn(),connections:vi.fn(),zentaoWork:vi.fn(),zentaoObject:vi.fn(),cancelUiRead:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m},events:{on:()=>()=>{}}}));
vi.mock('./terminal-insertion',()=>({ApplicationTerminalButton:()=>null}));
const connection='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64),reference={connectionId:connection,identityRevision:1,nativeId:'7',contentRevision:hash};
const presentation=parseZentaoPresentation({bug:{pri:'优先级',priList:['','P0','P1','P2'],severityList:{3:'较大'},typeList:{codeerror:'代码错误'},statusList:{active:'激活'}}},'bug')!;
const fields={title:'字段显示用例',project:'1521',projectName:'示例项目',product:'96',productName:'示例产品',module:'7773',moduleTitle:'测试模块',openedBuild:[{id:'1579',title:'dev-beta'}],pri:'3',severity:'3',type:'codeerror',status:'active'};
const detail=(ready=true)=>({kind:'bug',id:'7',reference,fields,body:null,history:null,attachments:[],complete:true,missing:[],presentation:ready?presentation:{available:false,labels:{},choices:{}}});
const app:CatalogItem={...applicationMetadata('zentao'),appId:'zentao',added:true,enabled:true,revision:1,displayName:'禅道',description:'',version:'1.0.0',defaultPackageHash:hash,skills:[],tools:[],versions:[],connectionCount:1};
const ok=<T,>(value:T)=>({ok:true as const,value});let client:QueryClient;
async function open(){client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><ZentaoPanel projectId="own" app={app}/></QueryClientProvider>);fireEvent.click(await screen.findByRole('button',{name:/字段显示用例/}));return screen.findByRole('dialog');}
beforeEach(()=>{
 vi.resetAllMocks();Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 m.projectSettings.mockResolvedValue(ok({enabled:true,revision:1,connections:{zentao:connection}}));m.connections.mockResolvedValue(ok([{id:connection,enabled:true,authorization:'connected',name:'隔离连接',config:{kind:'zentao',username:'me'}}]));
 m.zentaoWork.mockResolvedValue(ok({kind:'bug',items:[{id:'7',title:'字段显示用例',assignedTo:'me',status:'active',reference}],total:1,complete:true,nextCursor:null,checkedAt:'2026-10-31T00:00:00Z',problems:[],presentation}));m.zentaoObject.mockResolvedValue(ok(detail()));m.cancelUiRead.mockResolvedValue(ok({canceled:true}));
});
afterEach(()=>{cleanup();client?.clear();});
describe('real ZenTao detail component display contract',()=>{
 it('renders server choices and supplied names instead of raw IDs and object coercion',async()=>{
  const dialog=await open();await within(dialog).findByText('示例产品（#96）');
  for(const text of ['示例项目（#1521）','测试模块（#7773）','dev-beta','P2','较大','代码错误','激活'])expect(within(dialog).getByText(text)).toBeTruthy();
  expect(dialog.textContent).not.toContain('[object Object]');expect(within(dialog).queryByText('codeerror')).toBeNull();expect(m.zentaoObject.mock.calls[0][1]).toEqual({kind:'bug',reference});
 });
 it('keeps source values on dictionary failure and retries without changing source identity',async()=>{
  m.zentaoObject.mockResolvedValueOnce(ok(detail(false))).mockResolvedValue(ok(detail()));const dialog=await open();
  expect(await within(dialog).findByText('codeerror')).toBeTruthy();fireEvent.click(within(dialog).getByRole('button',{name:'重试字段说明'}));await within(dialog).findByText('代码错误');
  await waitFor(()=>expect(m.zentaoObject).toHaveBeenCalledTimes(2));for(const call of m.zentaoObject.mock.calls)expect(call[1]).toEqual({kind:'bug',reference});
 });
});
