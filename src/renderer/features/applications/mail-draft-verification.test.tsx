// @vitest-environment jsdom
import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {MailDraftDataView} from '@shared/application-data';
import {DraftDetail} from './mail-panel';
const m=vi.hoisted(()=>({draft:vi.fn(),resource:vi.fn(),prepareSend:vi.fn(),reviewSend:vi.fn(),authorizeSend:vi.fn(),executeSend:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:m},events:{on:()=>()=>{}}}));
vi.mock('./terminal-insertion',()=>({ApplicationTerminalButton:()=> <button>交给 Agent 继续处理</button>}));
const resource={id:'body',revision:'a'.repeat(64),mediaType:'text/plain',size:9};
const draft:MailDraftDataView={id:'draft',revision:2,state:'draft',contentHash:'b'.repeat(64),content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['private@example.test'],cc:[],bcc:[],subject:'必须重新核验的主题',text:resource,html:null,inReplyTo:null,references:[],attachmentIds:[]},attachments:[],activeIntentId:null,lastExecutionId:null,sourceTaskId:null,copiedFromDraftId:null,createdAt:'2026-10-28T00:00:00Z',updatedAt:'2026-10-28T00:00:00Z'};
const ok=<T,>(value:T)=>({ok:true as const,value});let client:QueryClient;
const key=['applications','draft','project','draft',2];
function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});client.setQueryData(key,{draft});render(<QueryClientProvider client={client}><DraftDetail projectId="project" id="draft" revision={2} onClose={()=>{}}/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();m.resource.mockResolvedValue(ok({resourceId:resource.id,revision:resource.revision,offset:0,length:9,encoding:'utf8',data:'旧缓存正文',nextOffset:null,eof:true}));Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:()=>{}});});
afterEach(()=>{cleanup();client.clear();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});
describe('fresh verification of an immutable saved draft',()=>{
 it('OW-01 hides cached recipients,body and review/terminal actions until the original draft read finishes',async()=>{
  m.draft.mockImplementation(()=>new Promise(()=>{}));mount();await waitFor(()=>expect(m.draft).toHaveBeenCalledWith('project','draft',2));expect(screen.queryByText(draft.content.subject)).toBeNull();expect(screen.queryByText('private@example.test')).toBeNull();expect(screen.queryByText('旧缓存正文')).toBeNull();expect(screen.getByText('正在读取草稿')).toBeTruthy();expect(screen.queryByRole('button',{name:'审阅发送内容'})).toBeNull();expect(screen.queryByRole('button',{name:'交给 Agent 继续处理'})).toBeNull();expect(m.resource).not.toHaveBeenCalled();expect(m.prepareSend).not.toHaveBeenCalled();
 });
 it('OW-01 removes cached actions on permission failure and restores them only after the same read succeeds',async()=>{
  m.draft.mockResolvedValue({ok:false,code:'APPLICATION_DISABLED',message:'项目邮件应用已停用'});mount();await screen.findByText('项目邮件应用已停用');expect(screen.queryByRole('button',{name:'审阅发送内容'})).toBeNull();expect(screen.queryByRole('button',{name:'交给 Agent 继续处理'})).toBeNull();expect(screen.queryByText(draft.content.subject)).toBeNull();expect(m.prepareSend).not.toHaveBeenCalled();m.draft.mockResolvedValue(ok({draft}));await client.invalidateQueries({queryKey:key});await screen.findByText(draft.content.subject);await screen.findByText('旧缓存正文');expect(screen.getByRole('button',{name:'交给 Agent 继续处理'})).toBeTruthy();expect(screen.getByRole('button',{name:'审阅发送内容'})).toBeTruthy();expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();
 });
 it('keeps explicit review available after a fresh verified read',async()=>{
  m.draft.mockResolvedValue(ok({draft}));m.prepareSend.mockResolvedValue({ok:false,code:'CONNECTION_UNAVAILABLE',message:'未选择发件连接'});mount();fireEvent.click(await screen.findByRole('button',{name:'审阅发送内容'}));await screen.findByText('未选择发件连接');expect(m.prepareSend).toHaveBeenCalledWith('project',{draftId:'draft',expectedRevision:2,expectedContentHash:draft.contentHash});expect(m.reviewSend).not.toHaveBeenCalled();expect(m.authorizeSend).not.toHaveBeenCalled();expect(m.executeSend).not.toHaveBeenCalled();
 });
});
