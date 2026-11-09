// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserAccessStore,browserAccess} from './access-store';
import {BrowserAccessHost,BrowserAccessPanel,BrowserAccessSurface} from './access-dialog';
const f=vi.hoisted(()=>({api:{accessState:vi.fn(),respondAccess:vi.fn(),revokeAccess:vi.fn()},on:vi.fn(()=>()=>{})}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{browser:f.api},events:{on:f.on}}));
const request={id:'request1',runId:'run1',projectId:'P1',requesterTaskId:'T1',targetTaskId:'T2',requesterTitle:'Caller Task',targetTitle:'Target Task',projectName:'Project One',mode:'control' as const,requestedMode:'control' as const,createdAt:Date.now(),expiresAt:Date.now()+60000};
beforeEach(()=>{vi.clearAllMocks();f.api.accessState.mockResolvedValue({requests:[],grants:[]});f.api.respondAccess.mockResolvedValue(undefined);f.api.revokeAccess.mockResolvedValue(undefined);});
afterEach(async()=>{cleanup();vi.useRealTimers();f.api.accessState.mockResolvedValue({requests:[],grants:[]});await browserAccess.refresh();browserAccess.closeGrants();});
async function pending(){const store=new BrowserAccessStore();f.api.accessState.mockResolvedValue({requests:[request],grants:[]});await store.refresh();return store;}
it('does not approve on render, submits only the explicit user-selected scope and awaits host acknowledgement',async()=>{
  const store=await pending();render(<BrowserAccessPanel store={store}/>);expect(f.api.respondAccess).not.toHaveBeenCalled();expect(screen.getByText('Target Task')).toBeTruthy();fireEvent.click(screen.getByRole('radio',{name:'仅观察（快照、截图、读取）'}));f.api.accessState.mockResolvedValue({requests:[],grants:[]});fireEvent.click(screen.getByRole('button',{name:'允许本次运行'}));await waitFor(()=>expect(f.api.respondAccess).toHaveBeenCalledExactlyOnceWith({id:request.id,allow:true,mode:'observe'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(store.snapshot().state.grants).toEqual([]);
});
it('denies through Escape and keeps a host failure visible without fabricating a grant',async()=>{
  const store=await pending();f.api.respondAccess.mockRejectedValueOnce(Error('request no longer current'));render(<BrowserAccessPanel store={store}/>);fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});await screen.findByRole('alert');expect(f.api.respondAccess).toHaveBeenCalledExactlyOnceWith({id:request.id,allow:false,mode:'control'});expect(store.snapshot().state.grants).toEqual([]);
});
it('prevents duplicate decisions while waiting for the host and never renews an expired request',async()=>{
  const store=await pending();let done!:()=>void;f.api.respondAccess.mockImplementationOnce(()=>new Promise<void>(resolve=>{done=resolve;}));render(<BrowserAccessPanel store={store}/>);fireEvent.click(screen.getByRole('button',{name:'允许本次运行'}));fireEvent.click(screen.getByRole('button',{name:'允许本次运行'}));expect(f.api.respondAccess).toHaveBeenCalledOnce();f.api.accessState.mockResolvedValue({requests:[],grants:[]});await act(async()=>done());
  const expired={...request,id:'expired',expiresAt:Date.now()-1};f.api.accessState.mockResolvedValue({requests:[expired],grants:[]});await act(async()=>store.refresh());expect((screen.getByRole('button',{name:'允许本次运行'}) as HTMLButtonElement).disabled).toBe(true);expect(f.api.respondAccess).toHaveBeenCalledOnce();
});
it('displays run-bound grants and sends an explicit revoke without clearing unrelated grants locally',async()=>{
  const store=new BrowserAccessStore(),grant={...request,grantedAt:Date.now()};f.api.accessState.mockResolvedValue({requests:[],grants:[grant]});await store.refresh();store.openGrants();render(<BrowserAccessPanel store={store}/>);expect(screen.getByText('Caller Task → Target Task')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'撤销'}));await waitFor(()=>expect(f.api.revokeAccess).toHaveBeenCalledExactlyOnceWith({id:grant.id}));expect(store.snapshot().state.grants).toHaveLength(1);
});
it('does not let an older refresh replace a more recent authoritative snapshot',async()=>{
  const store=new BrowserAccessStore();let stale!:(value:{requests:typeof request[];grants:[]})=>void;f.api.accessState.mockImplementationOnce(()=>new Promise(resolve=>{stale=resolve;}));const old=store.refresh();f.api.accessState.mockResolvedValue({requests:[],grants:[]});await store.refresh();stale({requests:[request],grants:[]});await old;expect(store.snapshot().state.requests).toEqual([]);
});
it('shows a background request in the right scoped host without stealing terminal focus, and delegates to an existing surface',async()=>{
  f.api.accessState.mockResolvedValue({requests:[request],grants:[]});const terminal=document.createElement('textarea');document.body.append(terminal);terminal.focus();const view=render(<BrowserAccessHost/>);await screen.findByRole('dialog');expect(document.activeElement).toBe(terminal);expect(document.querySelector('.bw-access-floating')).toBeTruthy();
  view.rerender(<><BrowserAccessHost/><div data-testid="browser-region"><BrowserAccessSurface ready={true}/></div></>);await waitFor(()=>expect(document.querySelector('.bw-access-floating')).toBeNull());expect(screen.getByTestId('browser-region').contains(screen.getByRole('dialog'))).toBe(true);expect(document.activeElement).toBe(terminal);terminal.remove();
});
