// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ApplicationActivityDetail,ApplicationActivityItem} from '@shared/application-activity';
import {ActivityWorkspace} from './activity';
const m=vi.hoisted(()=>({activity:vi.fn(),activityDetail:vi.fn(),connections:vi.fn(),projects:vi.fn(),executeSend:vi.fn(),authorizeSend:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m,projects:{list:m.projects}},events:{on:()=>()=>{}}}));
const uid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),at='2026-10-20T12:00:00.000Z';
const item=(over:Partial<ApplicationActivityItem>={}):ApplicationActivityItem=>({id:uid(1),kind:'operation',appId:'mail',projectId:'p1',projectName:'项目一',taskId:null,taskTitle:null,runId:null,jobId:null,parentOperationId:null,callerKind:'ui',action:'ui.mail.send.execute',semantics:'write',state:'succeeded',attemptCount:1,errorCode:null,effectState:null,requestId:null,startedAt:at,endedAt:at,connections:[{id:uid(11),name:'私有发件账号'}],subjects:[],send:null,...over});
const send=item({id:uid(2),kind:'send',state:'unknown',action:'mail.send',send:{intentId:uid(2),draftId:uid(3),draftRevision:2,executionId:uid(4),state:'unknown',executionState:'unknown',authorizationSource:'renderer-confirmation',grantState:'consumed',updatedAt:at}});
const detail:ApplicationActivityDetail={item:send,send:{messageId:'<private-unknown@example.test>',fromAddress:'from@example.test',draftRevision:2,content:{mode:'new',sourceMessageRef:null,senderConnectionId:uid(11),to:['to@example.test'],cc:[],bcc:['private@example.test'],subject:'原冻结主题',text:'原发送正文',html:null,inReplyTo:null,references:[],attachmentIds:[]},attachments:[],result:{state:'unknown',complete:false,accepted:[],rejected:[],errorCode:'TIMEOUT',smtpCode:null,messageId:'<private-unknown@example.test>'},priorUnknownExecutionIds:[]}};
const ok=<T,>(value:T)=>({ok:true as const,value});let client:QueryClient;
function mount(filter={}){client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});render(<QueryClientProvider client={client}><ActivityWorkspace initialFilter={filter}/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();m.activity.mockResolvedValue(ok({items:[item(),send],nextCursor:null,checkedAt:at}));m.activityDetail.mockResolvedValue(ok(detail));m.connections.mockImplementation(async(appId:string)=>ok(appId==='mail'?[{id:uid(11),name:'私有发件账号',appId:'mail'}]:[{id:uid(12),name:'私有禅道',appId:'zentao'}]));m.projects.mockResolvedValue([{id:'p1',name:'项目一'},{id:'p2',name:'项目二'}]);Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:()=>{}});});
afterEach(()=>{cleanup();client?.clear();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});
describe('persistent activity UI',()=>{
 it('shows transport completion separately from actual unknown SMTP outcome and never invokes a send',async()=>{
  mount();await screen.findByText('调用完成');await screen.findByText('结果未知 · 不自动重发');expect(m.activity).toHaveBeenCalledWith({limit:50,cursor:null});fireEvent.click(screen.getByRole('button',{name:'刷新记录'}));await waitFor(()=>expect(m.activity).toHaveBeenCalledTimes(2));expect(m.executeSend).not.toHaveBeenCalled();expect(m.authorizeSend).not.toHaveBeenCalled();
 });
 it('keeps frozen target,body and Message-ID readable without offering replay on the unknown result',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:/邮件发送.*SMTP 发送/}));await screen.findByText('原发送正文');await screen.findByText('private@example.test');await screen.findByText('Message-ID：<private-unknown@example.test>');const dialog=screen.getByRole('dialog');expect(within(dialog).queryByRole('button',{name:/发送此|重新发送|重试发送/})).toBeNull();fireEvent.click(within(dialog).getByRole('button',{name:'刷新原记录'}));await waitFor(()=>expect(m.activityDetail).toHaveBeenCalledTimes(2));expect(m.executeSend).not.toHaveBeenCalled();
 });
 it('binds actual app,connection and project filters and clears a connection when the app changes',async()=>{
  mount();await screen.findByRole('option',{name:'私有发件账号'});fireEvent.change(screen.getByLabelText('按应用筛选记录'),{target:{value:'mail'}});await waitFor(()=>expect(m.activity).toHaveBeenLastCalledWith({appId:'mail',limit:50,cursor:null}));fireEvent.change(screen.getByLabelText('按连接筛选记录'),{target:{value:uid(11)}});fireEvent.change(screen.getByLabelText('按项目筛选记录'),{target:{value:'p1'}});await waitFor(()=>expect(m.activity).toHaveBeenLastCalledWith({appId:'mail',connectionId:uid(11),projectId:'p1',limit:50,cursor:null}));fireEvent.change(screen.getByLabelText('按应用筛选记录'),{target:{value:'zentao'}});await waitFor(()=>expect(m.activity).toHaveBeenLastCalledWith({appId:'zentao',projectId:'p1',limit:50,cursor:null}));
 });
 it('loads older pages with the original host cursor rather than redoing an operation',async()=>{
  m.activity.mockResolvedValueOnce(ok({items:[item()],nextCursor:'host-page-2',checkedAt:at})).mockResolvedValueOnce(ok({items:[send],nextCursor:null,checkedAt:at}));mount({appId:'mail',projectId:'p1'});fireEvent.click(await screen.findByRole('button',{name:'读取更早记录'}));await screen.findByText('结果未知 · 不自动重发');expect(m.activity).toHaveBeenLastCalledWith({appId:'mail',projectId:'p1',limit:50,cursor:'host-page-2'});expect(m.executeSend).not.toHaveBeenCalled();
 });
 it('shows a frozen-history error without substituting another draft or current send configuration',async()=>{
  m.activityDetail.mockResolvedValue({ok:false,code:'RESOURCE_RECOVERY_REQUIRED',message:'原冻结记录已损坏'});mount();fireEvent.click(await screen.findByRole('button',{name:/邮件发送.*SMTP 发送/}));await screen.findByText('原冻结记录已损坏');expect(screen.queryByText('原发送正文')).toBeNull();expect(m.executeSend).not.toHaveBeenCalled();
 });
});
