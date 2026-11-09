// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {BrowserWorkspaceState} from '@shared/browser-workspace';
import {TaskBrowserWorkspace} from './workspace';
const f=vi.hoisted(()=>({value:null as unknown as {state:BrowserWorkspaceState;error:string},api:{continueCertificate:vi.fn(),focusChrome:vi.fn(),placement:vi.fn(),overlay:vi.fn(),find:vi.fn()},store:{subscribe:()=>()=>{},snapshot:()=>f.value,refresh:vi.fn(),run:async(work:()=>Promise<unknown>)=>work()}}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{browser:f.api}}));
vi.mock('./store',()=>({browserWorkspaceFor:()=>f.store,openNewBrowserTab:vi.fn()}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:({web}:{web:{view:unknown}})=>web.view}));
vi.mock('@renderer/core/navigation',()=>({navigation:{}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{}}));
beforeEach(()=>{vi.clearAllMocks();f.api.placement.mockResolvedValue(null);f.api.overlay.mockResolvedValue(null);f.api.focusChrome.mockResolvedValue(null);f.value={error:'',state:{taskId:'t1',projectId:'p1',activeId:'page1',recent:[],notice:null,external:null,find:{active:0,total:0},tabs:[{id:'page1',url:'about:blank',title:'新标签页',profileId:'project-p1',favicon:null,loading:false,canGoBack:false,canGoForward:false,failure:{kind:'other',url:'https://outside.example.test/',host:'outside.example.test',title:'无法访问 outside.example.test',errorName:'ERR_CERT_AUTHORITY_INVALID',recovery:null},certificate:{url:'https://outside.example.test/',host:'outside.example.test',error:'ERR_CERT_AUTHORITY_INVALID',challengeId:'nonce1'}}]}};});
afterEach(cleanup);
it('shows an initial failed navigation rather than hiding it behind the blank startup page, and binds approval to its nonce',async()=>{
  render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.queryByRole('heading',{name:'新标签页'})).toBeNull();expect(screen.getByRole('heading',{name:'此网站的证书不受信任'})).toBeTruthy();expect((screen.getByLabelText('网页地址') as HTMLInputElement).value).toBe('https://outside.example.test/');
  fireEvent.click(screen.getByRole('button',{name:'继续访问'}));await waitFor(()=>expect(f.api.continueCertificate).toHaveBeenCalledWith({taskId:'t1',tabId:'page1',challengeId:'nonce1'}));expect(f.api.placement).not.toHaveBeenCalledWith(expect.objectContaining({rect:expect.any(Object)}));
});
it('offers no certificate approval for an ordinary failed navigation',()=>{
  f.value.state.tabs[0].certificate=null;render(<TaskBrowserWorkspace taskId="t1" onClose={()=>{}}/>);expect(screen.queryByRole('button',{name:'继续访问'})).toBeNull();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
});
