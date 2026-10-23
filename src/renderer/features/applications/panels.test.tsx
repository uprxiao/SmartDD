// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ZentaoPanel} from './zentao-panel';
import {MailPanel} from './mail-panel';
import {ResourceView,formatZentaoResource} from './resource-view';
import type {CatalogItem} from './api';
const m=vi.hoisted(()=>({projectSettings:vi.fn(),connections:vi.fn(),zentaoWork:vi.fn(),zentaoObject:vi.fn(),zentaoResource:vi.fn(),mailStatus:vi.fn(),mailCacheStatus:vi.fn(),clearMailCache:vi.fn(),drafts:vi.fn(),draft:vi.fn(),resource:vi.fn(),prepareSend:vi.fn(),reviewSend:vi.fn(),authorizeSend:vi.fn(),executeSend:vi.fn(),send:vi.fn(),cancelSend:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m},events:{on:()=>()=>{}}}));
const ok=<T,>(value:T)=>({ok:true as const,value}),id='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64),now='2026-10-20T00:00:00Z';
const app=(appId:'mail'|'zentao'):CatalogItem=>({appId,added:true,enabled:true,revision:1,displayName:appId,description:'',version:'1.0.0',defaultPackageHash:hash,skills:[],tools:[],versions:[],connectionCount:1});
const source={connectionId:id,identityRevision:1,nativeId:'12',contentRevision:hash};
const resource={id,revision:hash,mediaType:'text/plain',size:7};
const content={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['to@example.test'],cc:['cc@example.test'],bcc:['private@example.test'],subject:'Private draft',text:resource,html:null,inReplyTo:null,references:[],attachmentIds:[]};
const draft={id,revision:2,state:'draft',contentHash:hash,content,attachments:[],activeIntentId:null,lastExecutionId:null,sourceTaskId:null,copiedFromDraftId:null,createdAt:now,updatedAt:now};
const intent={id,draftId:id,draftRevision:2,state:'awaiting-authorization',reviewHash:hash,review:null,authorized:false,executionId:null,result:null,errorCode:null,createdAt:now,updatedAt:now};
let client:QueryClient;
function mount(node:React.ReactNode){client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);}
beforeEach(()=>{
 vi.clearAllMocks();Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:()=>{}});
 m.projectSettings.mockResolvedValue(ok({enabled:true,revision:1,connections:{zentao:id,foxmail:id,smtp:null}}));m.connections.mockImplementation(async(appId:string)=>ok([{id,revision:1,name:'Private source',enabled:true,authorization:'connected',config:appId==='zentao'?{kind:'zentao',username:'me'}:{kind:'foxmail',queryDays:30}}]));
 m.zentaoWork.mockResolvedValue(ok({kind:'bug',items:[{id:'12',title:'Private Bug',status:'active',assignedTo:'me',reference:source}],total:1,nextCursor:null,complete:true,checkedAt:now,problems:[]}));m.zentaoObject.mockResolvedValue(ok({kind:'bug',id:'12',reference:source,fields:{title:'Actual detail',status:'active'},body:resource,history:null,attachments:[],complete:true,missing:[]}));
 const chunk={resourceId:id,revision:hash,offset:0,length:7,encoding:'utf8',data:'正文',nextOffset:null,eof:true};m.zentaoResource.mockResolvedValue(ok(chunk));m.resource.mockResolvedValue(ok(chunk));
 m.mailStatus.mockResolvedValue(ok({query:{items:[],matched:0,nextCursor:null,complete:true,range:{days:30,startDate:'2026-09-21',endDate:'2026-10-20',timeZone:'Asia/Shanghai'},checkedAt:now,problems:[]},refresh:{scanned:0,total:0,finished:true,problemCount:0,lastSuccessfulRefreshAt:now}}));
 m.mailCacheStatus.mockResolvedValue(ok({limit:500000000,actual:{total:100,index:20,objects:30,auxiliary:50,staging:0},activeLeases:0,unrecognized:[],overBudget:false,storage:{business:{files:{bytes:0,complete:true},sharedDatabase:{bytes:0,complete:true},drafts:0,sends:0},versions:{items:[]}}}));m.clearMailCache.mockResolvedValue(ok({activeLeases:0}));m.drafts.mockResolvedValue(ok({items:[],nextCursor:null}));m.draft.mockResolvedValue(ok({draft}));m.prepareSend.mockResolvedValue(ok({intent}));m.reviewSend.mockResolvedValue(ok({intent,displayReceiptId:id,review:{projectId:'p-own',sourceTaskId:null,sourceRunId:null,draftId:id,draftContentHash:hash,fromAddress:'from@example.test',draftRevision:2,content:{...content,text:'正文',html:null},attachments:[],priorUnknownExecutionIds:[]}}));m.authorizeSend.mockResolvedValue(ok({intent:{...intent,state:'authorized',authorized:true}}));m.executeSend.mockResolvedValue(ok({intent:{...intent,state:'unknown',result:{accepted:[],rejected:[],errorCode:'RECEIPT_LOST'}}}));m.cancelSend.mockResolvedValue(ok({intent:{...intent,state:'canceled'}}));
});
afterEach(()=>{cleanup();client?.clear();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');vi.restoreAllMocks();});
describe('real application business panels with scoped RPC fixtures',()=>{
 it('keeps partial business and version inventory distinct from a successful cache measurement',async()=>{
  m.mailCacheStatus.mockResolvedValue(ok({limit:500000000,actual:{total:12000000,index:100,objects:11999900,auxiliary:0,staging:0},activeLeases:0,unrecognized:[],overBudget:false,storage:{business:{files:{bytes:null,complete:false},sharedDatabase:{bytes:null,complete:false},drafts:2,sends:3},versions:null}}));
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByText('本地占用与缓存'));await screen.findByText(/邮件业务文件：统计未完成/);expect(screen.getByText(/共享业务数据库：统计未完成/)).toBeTruthy();expect(screen.getByText('应用版本占用统计未完成')).toBeTruthy();expect(screen.getByText(/可重建缓存：12 MB \/ 500 MB/)).toBeTruthy();
 });
 it('shows actual persistent mail files and shared database separately from cache and each retained app version',async()=>{
  m.mailCacheStatus.mockResolvedValue(ok({limit:500000000,actual:{total:12000000,index:100,objects:11999900,auxiliary:0,staging:0},activeLeases:0,unrecognized:[],overBudget:false,storage:{business:{files:{bytes:34000000,complete:true},sharedDatabase:{bytes:56000000,complete:true},drafts:2,sends:3},versions:{items:[{packageHash:hash,version:'1.0.0',sourceBytes:78000000,projectionBytes:9000000,retentionReasons:['历史会话引用']}]}}}));
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByText('本地占用与缓存'));
  await screen.findByText(/邮件业务文件：34 MB/);expect(screen.getByText(/共享业务数据库：56 MB/)).toBeTruthy();expect(screen.getByText(/2 个草稿.*3 条发送记录/)).toBeTruthy();expect(screen.getByText(/v1.0.0.*原件 78 MB.*派生 9 MB/)).toBeTruthy();expect(screen.getByText(/共享数据库.*不单独归属于邮件/)).toBeTruthy();
 });
 it('renders actual ZenTao structured bodies and history as inert readable text',()=>{
  expect(formatZentaoResource(JSON.stringify({steps:'<p>第一步</p><script>bad()</script><p>第二步</p>'}),'zentao-body')).toBe('重现步骤与说明\n第一步\n第二步');expect(formatZentaoResource(JSON.stringify([{date:'today',actor:'tester',action:'opened',comment:'<p>已登记</p>'}]),'zentao-history')).toBe('today · tester · opened\n已登记');
 });
 it('reads only the selected project and keeps list summaries separate from actual detail resources',async()=>{
  mount(<ZentaoPanel projectId="p-own" app={app('zentao')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private Bug/}));await screen.findByText('Actual detail');await screen.findByText('正文');expect(m.zentaoWork).toHaveBeenCalledWith('p-own',{kind:'bug',cursor:null,limit:50});expect(m.zentaoObject).toHaveBeenCalledWith('p-own',{kind:'bug',reference:source});expect(m.zentaoResource).toHaveBeenCalledWith('p-own',{resource,offset:0,length:65536});
 });
 it('reports a detail failure without substituting the list body',async()=>{
  m.zentaoObject.mockResolvedValue(ok(null));m.zentaoObject.mockResolvedValue({ok:false,code:'SCOPE_DENIED',message:'原对象已不属于本人'});mount(<ZentaoPanel projectId="p-own" app={app('zentao')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private Bug/}));await screen.findByText('原对象已不属于本人');expect(m.zentaoResource).not.toHaveBeenCalled();
 });
 it('does not fetch business data when the project preference is disabled',async()=>{
  m.projectSettings.mockResolvedValue(ok({enabled:false,revision:1,connections:{zentao:id}}));mount(<ZentaoPanel projectId="p-own" app={app('zentao')}/>);await screen.findByText('当前项目尚未选用可用的禅道连接');expect(m.zentaoWork).not.toHaveBeenCalled();
 });
 it('shows incomplete scanning distinctly from zero matches and resumes the same cursor',async()=>{
  m.mailStatus.mockResolvedValueOnce(ok({query:{items:[],matched:0,nextCursor:'own-cursor',complete:false,range:{days:30,startDate:'2026-09-21',endDate:'2026-10-20',timeZone:'Asia/Shanghai'},checkedAt:now,problems:[]},refresh:{scanned:50,total:100,finished:false,problemCount:0,lastSuccessfulRefreshAt:null}}));mount(<MailPanel projectId="p-own" app={app('mail')}/>);await screen.findByText('正在分批读取，仍有未检查数据');expect(screen.queryByText(/查询成功，范围内没有匹配邮件/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'继续检查剩余数据'}));await screen.findByText(/查询成功，范围内没有匹配邮件/);expect(m.mailStatus).toHaveBeenLastCalledWith('p-own',{limit:1,cursor:'own-cursor'});
 });
 it('requires the cache confirmation and leaves a busy cleanup error visible',async()=>{
  m.clearMailCache.mockResolvedValue({ok:false,code:'RESOURCE_BUSY',message:'缓存仍被原进程占用'});mount(<MailPanel projectId="p-own" app={app('mail')}/>);await screen.findByText('暂无草稿。可让项目 Agent 准备内容。');fireEvent.click(screen.getByText('本地占用与缓存'));fireEvent.click(screen.getByRole('button',{name:'清理可重建缓存'}));expect(m.clearMailCache).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'清理缓存'}));await screen.findByText('缓存仍被原进程占用');expect(m.clearMailCache).toHaveBeenCalledTimes(1);
 });
 it('requires a concrete frozen review before sending and never retries an unknown SMTP result',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));await screen.findByText('private@example.test');expect(m.prepareSend).not.toHaveBeenCalled();fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('from@example.test');expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'发送此修订'}));await screen.findByText('结果未知 · 不自动重发');expect(m.authorizeSend).toHaveBeenCalledWith('p-own',{intentId:id,expectedReviewHash:hash,displayReceiptId:id,reviewedUnknownExecutionIds:[]});expect(m.executeSend).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'发送此修订'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'关闭'}));fireEvent.click(screen.getByRole('button',{name:'刷新草稿'}));expect(m.executeSend).toHaveBeenCalledTimes(1);
 });
 it('reviews an existing Agent intent and confirms without creating or impersonating a send run',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));
  m.draft.mockResolvedValue(ok({draft:{...draft,activeIntentId:id}}));m.send.mockResolvedValue(ok({intent}));
  m.prepareSend.mockResolvedValue({ok:false,code:'DRAFT_LOCKED',message:'原Agent意图已占用草稿'});
  const shown={intent,displayReceiptId:id,review:{projectId:'p-own',sourceTaskId:'agent-task',sourceRunId:'agent-run',draftId:id,draftRevision:2,draftContentHash:hash,fromAddress:'from@example.test',content:{...content,text:'正文',html:null},attachments:[],priorUnknownExecutionIds:[]}};
  m.reviewSend.mockResolvedValue(ok(shown));
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));await screen.findByText('private@example.test');
  fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('from@example.test');
  expect(m.prepareSend).not.toHaveBeenCalled();expect(m.reviewSend).toHaveBeenCalledWith('p-own',id);
  fireEvent.click(screen.getByRole('button',{name:'确认此修订，交回 Agent'}));await screen.findByText('已获本次授权');
  expect(m.authorizeSend).toHaveBeenCalledTimes(1);expect(m.executeSend).not.toHaveBeenCalled();expect(m.cancelSend).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'审阅发送内容'})).toBeNull();expect(screen.queryByText('服务器已接受')).toBeNull();
  m.send.mockResolvedValue(ok({intent:{...intent,state:'server-accepted',executionId:'original-execution'}}));await client.invalidateQueries({queryKey:['applications','send','p-own',id]});await screen.findByText('服务器已接受');expect(screen.queryByText('已获本次授权')).toBeNull();expect(m.executeSend).not.toHaveBeenCalled();
 });
 it('closing an existing Agent review leaves its original intent intact',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));m.draft.mockResolvedValue(ok({draft:{...draft,activeIntentId:id}}));m.send.mockResolvedValue(ok({intent}));
  m.reviewSend.mockResolvedValue(ok({intent,displayReceiptId:id,review:{projectId:'p-own',sourceTaskId:'agent-task',sourceRunId:'agent-run',draftId:id,draftRevision:2,draftContentHash:hash,fromAddress:'from@example.test',content:{...content,text:'正文'},attachments:[],priorUnknownExecutionIds:[]}}));
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));await screen.findByText('private@example.test');fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('from@example.test');fireEvent.click(screen.getByRole('button',{name:'关闭'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(m.cancelSend).not.toHaveBeenCalled();expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();
 });
 it('rejects a mismatched existing review before minting confirmation',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));m.draft.mockResolvedValue(ok({draft:{...draft,activeIntentId:id}}));m.send.mockResolvedValue(ok({intent}));
  m.reviewSend.mockResolvedValue(ok({intent,displayReceiptId:id,review:{projectId:'p-own',sourceTaskId:'agent-task',sourceRunId:'agent-run',draftId:id,draftRevision:3,draftContentHash:hash,fromAddress:'from@example.test',content:{...content,text:'正文'},attachments:[],priorUnknownExecutionIds:[]}}));
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));await screen.findByText('private@example.test');fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('发送审阅与当前草稿修订不符，请重新打开草稿');
  expect(m.prepareSend).not.toHaveBeenCalled();expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'确认此修订，交回 Agent'})).toBeNull();
 });
 it('keeps an unavailable original Agent intent without preparing a replacement',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));m.draft.mockResolvedValue(ok({draft:{...draft,activeIntentId:id}}));m.send.mockResolvedValue(ok({intent}));m.reviewSend.mockResolvedValue({ok:false,code:'RESOURCE_RECOVERY_REQUIRED',message:'原发送意图需要恢复核对'});
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('原发送意图需要恢复核对');
  expect(m.prepareSend).not.toHaveBeenCalled();expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();expect(m.cancelSend).not.toHaveBeenCalled();
 });
 it('does not execute or report authorization when the original run rejects confirmation',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));m.draft.mockResolvedValue(ok({draft:{...draft,activeIntentId:id}}));m.send.mockResolvedValue(ok({intent}));m.reviewSend.mockResolvedValue(ok({intent,displayReceiptId:id,review:{projectId:'p-own',sourceTaskId:'agent-task',sourceRunId:'agent-run',draftId:id,draftRevision:2,draftContentHash:hash,fromAddress:'from@example.test',content:{...content,text:'正文'},attachments:[],priorUnknownExecutionIds:[]}}));m.authorizeSend.mockResolvedValue({ok:false,code:'SCOPE_DENIED',message:'原发送运行已结束'});
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));fireEvent.click(await screen.findByRole('button',{name:'确认此修订，交回 Agent'}));await screen.findByText('原发送运行已结束');
  expect(screen.queryByText('已获本次授权')).toBeNull();expect(m.executeSend).not.toHaveBeenCalled();expect(m.prepareSend).not.toHaveBeenCalled();expect(m.cancelSend).not.toHaveBeenCalled();
 });
 it('still cancels a new UI-owned review when the user closes it',async()=>{
  m.drafts.mockResolvedValue(ok({items:[{id,revision:2,state:'draft',subject:'Private draft',attachmentCount:0,updatedAt:now}],nextCursor:null}));
  mount(<MailPanel projectId="p-own" app={app('mail')}/>);fireEvent.click(await screen.findByRole('button',{name:/Private draft/}));fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('from@example.test');fireEvent.click(screen.getByRole('button',{name:'关闭'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(m.cancelSend).toHaveBeenCalledWith('p-own',id);expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();
 });
 it('decodes split UTF-8 resource bytes without executing source markup',async()=>{
  const read=vi.fn().mockResolvedValueOnce({encoding:'base64',data:btoa(String.fromCharCode(0xe4)),length:1,nextOffset:1,eof:false}).mockResolvedValueOnce({encoding:'base64',data:btoa(String.fromCharCode(0xb8,0xad)),length:2,nextOffset:null,eof:true});mount(<ResourceView resource={{...resource,size:3}} scope="p-own" read={read}/>);fireEvent.click(await screen.findByRole('button',{name:'继续读取内容'}));await screen.findByText('中');expect(read).toHaveBeenNthCalledWith(2,1);
 });
});
