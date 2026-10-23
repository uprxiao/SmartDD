import {describe,it,expect} from 'vitest';
import {applicationReferenceText} from '@shared/application-terminal';
import {resolveOrderedContextualMailSend} from '../ordered-native-mail-context';
const review={draftId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430a',draftRevision:3,draftContentHash:'a'.repeat(64),priorUnknownExecutionIds:[] as string[],content:{mode:'new' as const,to:['receiver@example.test'],cc:[] as string[],bcc:[] as string[]}};
const ref=applicationReferenceText({kind:'draft',draftId:review.draftId,revision:3,contentHash:review.draftContentHash});
describe('bounded ordered native mail context interpretation remains separate from source authority',()=>{
 it.each(['不要发送','先分析可能的回复，不要发送','把正文改成另一个内容','如果没问题就发送','张三的邮箱是other@example.test。\n请修改收件人','“保持原样”'])('does not skip unknown or changed intervening user semantics: %s',middle=>{
  expect(resolveOrderedContextualMailSend('请把刚才确认的草稿原样发送。',[ref,middle],review)).toBeNull();
 });
 it('rejects an ambiguous user-bound name even if one mailbox matches the frozen message',()=>{
  expect(resolveOrderedContextualMailSend('请把刚才确认的草稿发给张三。',['张三的邮箱是receiver@example.test。',ref,'张三的邮箱是other@example.test。'],review)).toBeNull();
 });
 it('keeps the complete original CC and BCC set when one name is explicitly requested',()=>{
  expect(resolveOrderedContextualMailSend('请把刚才确认的草稿发给张三。',['张三的邮箱是receiver@example.test。',ref],{...review,content:{...review.content,bcc:['private@example.test']}})).toBeNull();
 });
 it('does not use an older matching reference after the user selected a different revision',()=>{
  expect(resolveOrderedContextualMailSend('请把刚才确认的草稿原样发送。',[ref,ref.replace('revision=3','revision=4')],review)).toBeNull();
 });
 it('rejects excess context rather than dropping an unknown middle or original anchor',()=>{
  expect(resolveOrderedContextualMailSend('请发送它',[ref,...Array(63).fill('保持原样')],review)).toBeNull();
 });
});
