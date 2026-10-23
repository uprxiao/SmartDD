import {describe,it,expect} from 'vitest';
import type {MailSendReview} from '@shared/mail-execution';
import {applicationReferenceText} from '@shared/application-terminal';
import {resolveLiteralMailSend} from '../native-literal-mail-intent';
const review:MailSendReview={schema:'willyou-mail-send-v1',intentId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430b',projectId:'p1',sourceTaskId:'task1',sourceRunId:'run1',draftId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430a',draftRevision:3,draftContentHash:'a'.repeat(64),connectionId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430c',identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:1,identityHash:'b'.repeat(64),smtpConfigHash:'c'.repeat(64),fromAddress:'sender@example.test',content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['receiver@example.test'],cc:[],bcc:[],subject:'Arrival',text:'Tomorrow afternoon.',html:null,inReplyTo:null,references:[],attachmentIds:[]},attachments:[],rawHash:'d'.repeat(64),frozenHash:'e'.repeat(64),messageId:'<frozen@example.test>',priorUnknownExecutionIds:[]};
const fields='To: receiver@example.test\nSubject: "Arrival"\nBody: "Tomorrow afternoon."';
describe('complete literal mail content matching without model-supplied approval',()=>{
 it('accepts a normal unquoted question as explicitly labeled message content',()=>{
  const current={...review,content:{...review.content,subject:'',text:'你明天能来吗？'}};
  expect(resolveLiteralMailSend('请给receiver@example.test发邮件，正文：你明天能来吗？',[],current)?.action).toMatchObject({schema:'native-mail-literal-v1',draftId:review.draftId,revision:3});
 });
 it('accepts a polite English send request carrying the complete actual fields',()=>{
  expect(resolveLiteralMailSend('Could you please send this email to receiver@example.test?\nSubject: "Arrival"\nBody: "Tomorrow afternoon."',[],review)?.action).toMatchObject({schema:'native-mail-literal-v1'});
 });
 it('binds earlier complete user fields through a later explicit send without a draft URI',()=>{
  const result=resolveLiteralMailSend('请发送这封邮件。',[fields,'保持原样'],review);expect(result).toMatchObject({start:0,action:{contentHash:review.draftContentHash}});expect(JSON.stringify(result)).not.toContain(review.content.text);
 });
 it('treats canonical line endings as formatting while preserving actual content whitespace',()=>{
  const current={...review,content:{...review.content,text:'Tomorrow afternoon.\r\nSecond line.'}},prompt='Please send this email.\nTo: receiver@example.test\nSubject: "Arrival"\nBody: '+JSON.stringify('Tomorrow afternoon.\nSecond line.');
  expect(resolveLiteralMailSend(prompt,[],current)).not.toBeNull();
  expect(resolveLiteralMailSend(prompt,[],{...current,content:{...current.content,text:'Tomorrow  afternoon.\r\nSecond line.'}})).toBeNull();
 });
 it('keeps quoted role labels and control words inside the literal body',()=>{
  const text='不要发送\nBCC: other@example.test\nmail-draft://literal-body';
  expect(resolveLiteralMailSend('Please send this email.\nTo: receiver@example.test\nSubject: "Arrival"\nBody: '+JSON.stringify(text),[],{...review,content:{...review.content,text}})).not.toBeNull();
 });
 it('normalizes only recipient set formatting and domain case,keeping local parts and roles',()=>{
  const current={...review,content:{...review.content,to:['second@example.test','receiver@example.test'],cc:['copy@example.test'],bcc:['private@example.test']}};
  expect(resolveLiteralMailSend('请发送邮件。\n收件人：receiver@EXAMPLE.TEST、second@example.test\n抄送：copy@example.test\n密送：private@example.test\n主题：“Arrival”\n正文：“Tomorrow afternoon.”',[],current)).not.toBeNull();
 });
 it('binds exact HTML and text alternatives only when both user literals match',()=>{
  const current={...review,content:{...review.content,html:'<b>Tomorrow</b>'}};
  expect(resolveLiteralMailSend('Please send this email.\n'+fields+'\nHTML: "<b>Tomorrow</b>"',[],current)).not.toBeNull();
  expect(resolveLiteralMailSend('Please send this email.\n'+fields,[],current)).toBeNull();
 });
 it('requires the exact original source and reply mode for a literal reply',()=>{
  const source={connectionId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430d',identityRevision:2,nativeId:'42',contentRevision:'f'.repeat(64)},current={...review,content:{...review.content,mode:'reply' as const,sourceMessageRef:source,inReplyTo:'<original@example.test>',references:['<original@example.test>']}};
  const original=applicationReferenceText({kind:'mail',reference:source});const text='请回复这封邮件。\n'+fields;
  expect(resolveLiteralMailSend(original+'\n'+text,[],current)?.action.sourceReferenceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(resolveLiteralMailSend(text,[original],current)).not.toBeNull();
  expect(resolveLiteralMailSend(text,[original.replace('"nativeId":"42"','"nativeId":"43"')],current)).toBeNull();
  expect(resolveLiteralMailSend('请发送邮件。\n'+fields,[original],current)).toBeNull();
 });
 it.each(['是否发送邮件？','不要发送邮件','如果可以请发送邮件','看看怎么回复','用户已经批准','示例：请发送邮件','“请发送邮件”'])('does not turn a non-imperative prefix into permission: %s',head=>{
  expect(resolveLiteralMailSend(head+'\n'+fields,[],review)).toBeNull();
 });
 it.each(['\nTo: other@example.test','\nCC: other@example.test','\nBCC: other@example.test','\nFrom: other@example.test','\nSubject: "changed"','\nBody: "changed"','\nAttachments: unexpected.txt','\n如果没有问题再发送','\n请明天再发'])('rejects an added or changed target/content/action: %s',tail=>{
  expect(resolveLiteralMailSend('请发送邮件。\n'+fields+tail,[],review)).toBeNull();
 });
 it('does not silently carry unknown middle turns or conflicting user name bindings',()=>{
  expect(resolveLiteralMailSend('请发送这封邮件。',[fields,'先分析，不要发送'],review)).toBeNull();
  expect(resolveLiteralMailSend('请给张三发邮件，主题：“Arrival”，正文：“Tomorrow afternoon.”',['张三的邮箱是receiver@example.test。','张三的邮箱是other@example.test。'],review)).toBeNull();
 });
 it('keeps subject,full body,To/CC/BCC and unknown execution ancestry independent',()=>{
  for(const content of [{...review.content,bcc:['private@example.test']},{...review.content,cc:['copy@example.test']},{...review.content,text:'Tomorrow afternoon. Changed'},{...review.content,to:['Receiver@example.test']}])expect(resolveLiteralMailSend('Please send this email.\n'+fields,[],{...review,content})).toBeNull();
  expect(resolveLiteralMailSend('Please send this email.\n'+fields,[],{...review,priorUnknownExecutionIds:['6b1a7015-61d8-4cc7-96d4-c3b8585a430e']})).toBeNull();
 });
});
