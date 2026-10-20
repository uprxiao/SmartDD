import {randomUUID} from 'node:crypto';
import {beforeEach,describe,it,expect} from 'vitest';
import {capabilitySessionSnapshotSchema,applicationNativeSkillName} from '@shared/application-session';
import type {ApplicationUiSender} from '../execution-context';
import type {RunContext} from '../run-registry';
import {NativeUserInputs} from '../native-user-inputs';
const hash='a'.repeat(64),target={taskId:'task-one',ptyId:'pty-one'};
let ledger:NativeUserInputs,current:RunContext,abort:AbortController,now:number;
const sender={sender:{id:101},senderFrame:{processId:9,routingId:1}} as unknown as ApplicationUiSender;
function context(runId=randomUUID()):RunContext{
 const snapshot=capabilitySessionSnapshotSchema.parse({schema:2,taskId:target.taskId,projectId:'project-one',createdAt:new Date(now).toISOString(),runner:'codex',adapterBinding:{id:'codex',version:'1.0.0',hash,projectionFormatVersion:1,nativeToolNames:{}},native:{sessionId:'native-one',stateRoot:'/private/native',cwd:'/private/project'},agentAtCreation:{version:'0.162.1',adapterRevision:1},catalogGeneration:'generation',packages:[{appId:'mail',version:'1.0.0',packageHash:hash,hashAlgorithm:'app-manifest-v1',hostApi:{min:1,max:1},dataApi:1,runtimeHash:hash,toolContractMajors:{},skills:[{skillId:'assistant',nativeName:applicationNativeSkillName('mail','assistant',hash),contentHash:hash,sourceRelativePath:'skills/assistant',projectionPath:'/private/skill/SKILL.md'}],bindings:[],allowedOperations:['mail.send']}],standardSkills:[],mcp:[{kind:'applications',serverName:'wy_one',protocolMajor:1,runtimeHash:hash}],provenance:'created'});
 return{run:{runId,taskId:target.taskId,projectId:snapshot.projectId,runner:snapshot.runner,state:'active',snapshotHash:hash,pid:90101,processStartedAt:'darwin-proc-v1:200:1',startedAt:new Date(now).toISOString(),endedAt:null},snapshot,bindings:[],signal:abort.signal};
}
const make=(options:Partial<ConstructorParameters<typeof NativeUserInputs>[0]>={})=>new NativeUserInputs({requireSender:value=>{if(value!==sender)throw new Error('untrusted sender');},current:value=>value.taskId===target.taskId&&value.ptyId===target.ptyId?current:null,now:()=>now,...options});
const input=(text:string)=>ledger.observe(sender,target,text),match=(text:string,time=now)=>ledger.match(current,text,time);
beforeEach(()=>{now=1792488000000;abort=new AbortController();current=context();ledger=make();});
describe('bounded host-observed native user input origin; no send grant',()=>{
 it('captures only submitted lines with exact text,scope,frame,time and digest;unsubmitted input cannot match',()=>{
  input('发送这封邮件');expect(match('发送这封邮件')).toBeNull();input('\r');const receipt=match('发送这封邮件')!;expect(receipt).toMatchObject({projectId:'project-one',taskId:target.taskId,ptyId:target.ptyId,runId:current.run.runId,senderId:101,frameProcessId:9,frameRoutingId:1,observedAt:now});expect(receipt.textHash).toMatch(/^[a-f0-9]{64}$/);expect(Object.keys(receipt)).not.toContain('text');expect(Object.isFrozen(receipt)).toBe(true);expect(match('发送另一封邮件')).toBeNull();
 });
 it('does not certify a partially accepted controlled paste or a suffix on its unknown line',()=>{input('known prefix');ledger.uncertain(sender,target);input('approved-looking suffix\r');expect(match('approved-looking suffix')).toBeNull();expect(match('known prefixapproved-looking suffix')).toBeNull();input('new fully observed line\r');expect(match('new fully observed line')).not.toBeNull();});
 it('handles Unicode editing and CRLF without manufacturing a duplicate receipt',()=>{
  input('send😀\x7f字\bmessage\r\n');const first=match('sendmessage');expect(first).not.toBeNull();input('\n');expect(match('sendmessage')).toBe(first);input('do not send\x15发送指定草稿\r');expect(match('发送指定草稿')).not.toBeNull();input('send wrong\x17right\r');expect(match('send right')).not.toBeNull();
 });
 it('assembles split bracketed paste with multiline text and requires a separate submit key',()=>{
  for(const chunk of ['\x1b[20','0~To: user@example.test\r','\n正文\r','\x1b[201','~'])input(chunk);expect(match('To: user@example.test\n正文\n')).toBeNull();input('\n');expect(match('To: user@example.test\n正文\n')).not.toBeNull();
 });
 it('refuses cursor/history/unknown control reconstruction and recovers only after clear or submission',()=>{
  input('send original\x1b[A\r');expect(match('send original')).toBeNull();input('send after reset\r');expect(match('send after reset')).not.toBeNull();input('hidden\tchange\x15known exact\r');expect(match('known exact')).not.toBeNull();input('canceled\x03replacement\r');expect(match('canceled')).toBeNull();expect(match('replacement')).not.toBeNull();
 });
 it('never treats another window or a mismatched PTY as observed authority',()=>{
  expect(()=>ledger.observe({...sender},target,'send\r')).toThrow('untrusted sender');ledger.observe(sender,{...target,ptyId:'other'},'send\r');expect(match('send')).toBeNull();
 });
 it('does not collect an unselected/disabled mail permission or a non-active run',()=>{
  current.snapshot.packages[0].allowedOperations=['mail.draft'];input('send\r');expect(match('send')).toBeNull();current.snapshot.packages[0].allowedOperations=['mail.send'];current.run.state='prepared';input('send\r');expect(match('send')).toBeNull();
 });
 it('supports the first native ID binding without changing the selected capability identity',()=>{
  current.snapshot.native.sessionId=null;input('send exact\r');expect(match('send exact')).toBeNull();current={...current,run:{...current.run,snapshotHash:'b'.repeat(64)},snapshot:{...current.snapshot,native:{...current.snapshot.native,sessionId:'native-new'}}};expect(match('send exact')).not.toBeNull();const original=match('send exact')!;current.snapshot.native.sessionId='other-native';expect(match('send exact')).toBeNull();expect(()=>ledger.claim(original,current,randomUUID())).toThrow(/来源/);
 });
 it('invalidates old observations on run replacement,selection changes,abort and dispose',()=>{
  input('old\r');const previous=current;current=context();input('new\r');expect(ledger.match(previous,'old',now)).toBeNull();expect(match('new')).not.toBeNull();current.snapshot.native.cwd='/different';expect(match('new')).toBeNull();input('current\r');expect(match('current')).not.toBeNull();abort.abort();expect(match('current')).toBeNull();ledger.dispose();expect(match('new')).toBeNull();
 });
 it('bounds native timestamp matching and expires captured text',()=>{
  input('send\r');expect(match('send',now-5001)).toBeNull();expect(match('send',now+5001)).toBeNull();now+=120001;expect(match('send',now)).toBeNull();expect(match('send',now-120001)).not.toBeNull();now+=480000;expect(match('send',now-600001)).toBeNull();
 });
 it('requires the original receipt object and cannot claim it for two different intents',()=>{
  input('send\r');const receipt=match('send')!,intent=randomUUID();expect(()=>ledger.claim({...receipt},current,intent)).toThrow(/来源/);ledger.claim(receipt,current,intent);ledger.claim(receipt,current,intent);expect(()=>ledger.claim(receipt,current,randomUUID())).toThrow(/来源/);abort.abort();expect(()=>ledger.claim(receipt,current,intent)).toThrow(/来源/);
 });
 it('evicts oldest text under count and combined pending-editor byte budgets',()=>{
  ledger=make({maxReceipts:2,maxBytes:12});input('one\rtwo\rthree\r');expect(match('one')).toBeNull();expect(match('two')).not.toBeNull();expect(match('three')).not.toBeNull();input('1234567890');expect(match('two')).toBeNull();expect(match('three')).toBeNull();
 });
 it('preserves split UTF-16 pairs and byte bounds through backspace',()=>{
  ledger=make({maxBytes:4});input('\ud83d');input('\ude00');input('\r');expect(match('😀')).not.toBeNull();input('\ud83d');input('\ude00');input('\x7fx\r');expect(match('x')).not.toBeNull();
 });
 it('keeps the most recent bounded submissions when one accepted transport chunk contains many lines',()=>{
  input(Array.from({length:20000},(_,index)=>'line-'+index+'\r').join(''));expect(match('line-0')).toBeNull();expect(match('line-19743')).toBeNull();expect(match('line-19744')).not.toBeNull();expect(match('line-19999')).not.toBeNull();
 });
 it('handles a large complete paste with linear byte accounting and rejects transport overflow',()=>{
  const large='正文'.repeat(60000);input('\x1b[200~'+large+'\x1b[201~\r');expect(match(large)).not.toBeNull();input('x'.repeat(1024*1024+1)+'\r');expect(match('x')).toBeNull();
 });
});
