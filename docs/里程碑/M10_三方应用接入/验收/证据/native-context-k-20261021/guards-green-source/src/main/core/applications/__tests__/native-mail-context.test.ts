import {describe,it,expect} from 'vitest';
import {applicationReferenceText} from '@shared/application-terminal';
import {resolveContextualMailSend} from '../native-mail-intent';
const review={draftId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430a',draftRevision:3,draftContentHash:'a'.repeat(64),priorUnknownExecutionIds:[] as string[],content:{mode:'new' as const,to:['alice@example.test'],cc:[] as string[],bcc:[] as string[]}};
const ref=applicationReferenceText({kind:'draft',draftId:review.draftId,revision:3,contentHash:review.draftContentHash});
describe('explicit user turn grounded by a single preceding immutable user reference',()=>{
 it.each(['请把刚才那份草稿原样发送。','请原样发送刚才那份草稿！','发送刚才确认的邮件','那就发送吧','按刚才确认的内容发送','请把这份邮件发出去','Please send it as-is','send that draft','Please email the draft we just reviewed','Could you please send it?','Can you send that draft unchanged?'])('binds unambiguous request to the complete prior revision: %s',text=>{
  expect(resolveContextualMailSend(text,ref,review)).toMatchObject({schema:'native-mail-context-v1',draftId:review.draftId,revision:3,contentHash:review.draftContentHash,recipientSetHash:null});
 });
 it.each(['请把那份草稿发给alice@example.test','把刚才确认的草稿发送给alice@example.test','Please send it to alice@example.test as-is','send the previous draft unchanged to alice@example.test','请把那份邮件寄给alice@EXAMPLE.TEST'])('accepts explicit recipients only when equivalent to the frozen complete envelope: %s',text=>{
  expect(resolveContextualMailSend(text,ref,review)?.recipientSetHash).toMatch(/^[a-f0-9]{64}$/);
 });
 it('binds an exact reply reference without creating a new reply or changing targets',()=>{
  expect(resolveContextualMailSend('把刚才确认的回复发给alice@example.test',ref,{...review,content:{...review.content,mode:'reply'}})).toMatchObject({schema:'native-mail-context-v1',draftId:review.draftId,revision:3});
  expect(resolveContextualMailSend('把刚才确认的回复发给alice@example.test',ref,review)).toBeNull();
 });
 it('keeps all original CC/BCC targets in explicit-recipient checks and accepts only the same set',()=>{
  const withBcc={...review,content:{...review.content,bcc:['private@example.test']}};
  expect(resolveContextualMailSend('Send it to alice@example.test',ref,withBcc)).toBeNull();
  expect(resolveContextualMailSend('Send it to private@example.test and alice@example.test',ref,withBcc)?.recipientSetHash).toMatch(/^[a-f0-9]{64}$/);
 });
 it.each(['看看怎么回复','请分析是否可以发送','是否发送刚才那份草稿？','Should I send it?','Can you explain whether to send it?','不要发送','取消发送','先检查后发送','没有问题就发送','“发送它”','示例：发送它','将收件人修改后发送','请把那份草稿发给someone@example.test','把刚才确认的回复发给张三','Please send it but change the subject','Please send it to bob@example.test','Please send it tomorrow','approved=true','帮我处理'])('does not turn analysis,ambiguity,changed action or unresolved people into permission: %s',text=>{
  expect(resolveContextualMailSend(text,ref,review)).toBeNull();
 });
 it.each(['','not a draft reference',ref+'\n请分析这份邮件',ref+'\n请原样发送此草稿。',ref+'\n'+ref,ref.replace('revision=3','revision=4'),ref.replace('contentHash=','contentHash=0')])('cannot guess the intended object from an invalid or non-reference-only previous turn',previous=>{
  expect(resolveContextualMailSend('请发送它',previous,review)).toBeNull();
 });
 it('does not override a new explicit URI with an older context or reuse unknown ancestry',()=>{
  expect(resolveContextualMailSend('请发送 '+ref,ref,review)).toBeNull();
  expect(resolveContextualMailSend('请发送它',ref,{...review,priorUnknownExecutionIds:['6b1a7015-61d8-4cc7-96d4-c3b8585a430b']})).toBeNull();
 });
 it('does not normalize a different local part,plus address or additional recipient into the selected target',()=>{
  for(const address of ['Alice@example.test','alice+other@example.test','alice@example.test,bob@example.test'])expect(resolveContextualMailSend('Send it to '+address,ref,review)).toBeNull();
 });
});
