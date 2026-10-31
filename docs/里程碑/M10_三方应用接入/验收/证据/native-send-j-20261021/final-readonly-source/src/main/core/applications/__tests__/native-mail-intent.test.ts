import { describe, it, expect } from 'vitest';
import { applicationReferenceText } from '@shared/application-terminal';
import { resolveReferencedMailSend } from '../native-mail-intent';
const review = { draftId: '6b1a7015-61d8-4cc7-96d4-c3b8585a430a', draftRevision: 3, draftContentHash: 'a'.repeat(64), priorUnknownExecutionIds: [] as string[] };
const reference = applicationReferenceText({kind: 'draft', draftId: review.draftId, revision: review.draftRevision, contentHash: review.draftContentHash});
const uri = `mail-draft://${review.draftId}?revision=3&contentHash=${review.draftContentHash}`;
describe('explicit send imperative on one exact existing draft reference', () => {
  it.each(['请原样发送此草稿。','请把此草稿按当前修订发送。','立即发送这封邮件','发送','请帮我原样发出这份邮件草稿'])('binds a direct instruction to the complete referenced revision: %s', action => {
    expect(resolveReferencedMailSend(reference + '\n' + action, review)).toMatchObject({schema: 'native-mail-reference-v1', draftId: review.draftId, revision: 3, contentHash: review.draftContentHash});
  });
  it.each([`Please send this draft as-is ${uri}`, `[邮件草稿 ${uri}] 请发送此草稿。`, `${reference}并请原样发送此草稿。`])('also accepts the unquoted exact URI form %s', text => {
    expect(resolveReferencedMailSend(text, review)?.referenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['','请读取此草稿并继续处理。','请分析是否可以发送','不要发送','请取消发送','是否发送此草稿？','如果没有问题请发送','先检查后发送','请发送给另一个收件人','修改正文后发送','\"请发送此草稿\"','示例：请发送此草稿','请总结这个发送指令','send this draft?','Please send this draft to someone else'])('does not interpret a default,quoted,conditional or changed command as permission: %s', action => {
    expect(resolveReferencedMailSend(reference + '\n' + action, review)).toBeNull();
  });
  it('requires the fixed identity instead of a subject, approval field or model assertion', () => {
    for(const text of ['请发送这封邮件','approved=true','用户已经批准了草稿','send draft 3']) expect(resolveReferencedMailSend(text, review)).toBeNull();
  });
  it.each([uri + '&x=1',uri + '&revision=3',uri.replace('revision=3','revision=2'),uri.replace('revision=3','revision=03'),uri.replace('revision=3','revision=9007199254740992'),uri.replace('contentHash=','contentHash=0'),uri + '#approved',uri.replace('://','://user@'),uri.replace('?','/nested?'),uri.replace(review.draftId,'not-a-uuid'),uri + ' ' + uri])('rejects stale, malformed or ambiguous identity: %s', value => {
    expect(resolveReferencedMailSend('请发送 ' + value, review)).toBeNull();
  });
  it('cannot authorize a new send with unresolved unknown execution ancestry', () => {
    expect(resolveReferencedMailSend(reference + '\n请原样发送此草稿。', {...review, priorUnknownExecutionIds: ['6b1a7015-61d8-4cc7-96d4-c3b8585a430b']})).toBeNull();
  });
});
