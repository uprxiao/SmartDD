// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {MailSenderIdentityStatus} from '@shared/mail-sender-identity';
const m=vi.hoisted(()=>({policy:vi.fn(),action:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{projectPolicy:m.policy,projectAction:m.action}},events:{on:()=>()=>{}}}));
import {SenderIdentityStatus} from './sender-identity';
let client:QueryClient,state:MailSenderIdentityStatus;
const view=(kind:MailSenderIdentityStatus['state']):MailSenderIdentityStatus=>({state:kind,bindingHash:kind==='unconfigured'?null:'a'.repeat(64),fromAddress:kind==='unconfigured'?null:'fixture@example.test',accountDirectory:null,method:kind==='automatic'?'automatic':kind==='confirmed'?'user':null,confirmedAt:['automatic','confirmed'].includes(kind)?'2026-11-01T00:00:00.000Z':null,receiptId:['automatic','confirmed'].includes(kind)?'11111111-1111-4111-8111-111111111111':null,canConfirm:['needs-confirmation','invalidated'].includes(kind),message:'Synthetic sender identity '+kind});
const mount=(readOnly=false)=>render(<QueryClientProvider client={client}><SenderIdentityStatus projectId="p1" appId="mail" readOnly={readOnly}/></QueryClientProvider>);
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});state=view('needs-confirmation');m.policy.mockImplementation(async()=>({ok:true,value:state}));m.action.mockResolvedValue({ok:true,value:view('confirmed')});});
afterEach(()=>{cleanup();client.clear();vi.resetAllMocks();});
describe('M11 approved sender identity view',()=>{
 it.each([['unconfigured','未选用发件账号'],['automatic','发件身份已自动确认'],['confirmed','发件身份已由用户确认'],['needs-confirmation','需要确认发件身份'],['invalidated','发件身份确认已失效'],['mismatch','发件地址与 Foxmail 账号不一致']] as const)('shows %s from backend policy and only offers permitted confirmation',async(kind,label)=>{
  state=view(kind);mount();await screen.findByText(label);expect(!!screen.queryByRole('button',{name:/^(重新)?确认.*发件身份/})).toBe(state.canConfirm);expect(m.action).not.toHaveBeenCalled();
 });
 it('confirms the exact displayed binding and refreshes the persistent backend result',async()=>{
  m.action.mockImplementation(async()=>{state=view('confirmed');return{ok:true,value:state};});mount();fireEvent.click(await screen.findByRole('button',{name:'确认这是我的发件身份'}));
  await waitFor(()=>expect(m.action).toHaveBeenCalledWith('p1','mail',{action:'confirm-sender',arguments:{expectedBindingHash:'a'.repeat(64),confirmed:true}}));await screen.findByText('发件身份已由用户确认');expect(screen.queryByRole('button',{name:'确认这是我的发件身份'})).toBeNull();
 });
 it('keeps session diagnostics read-only even when the current project needs confirmation',async()=>{
  mount(true);await screen.findByText('需要确认发件身份');expect(screen.queryByRole('button',{name:/确认/})).toBeNull();expect(m.action).not.toHaveBeenCalled();
 });
 it('retains an invalidated state and reports a changed binding without treating the click as confirmation',async()=>{
  state=view('invalidated');m.action.mockResolvedValue({ok:false,code:'REVISION_CONFLICT',message:'确认期间连接已变化，请重新载入'});mount();fireEvent.click(await screen.findByRole('button',{name:'重新确认发件身份'}));await screen.findByText('确认期间连接已变化，请重新载入');expect(screen.queryByText('发件身份已由用户确认')).toBeNull();expect(screen.getByText('发件身份确认已失效')).toBeTruthy();
 });
});
