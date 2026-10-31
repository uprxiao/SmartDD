import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { MailDraftContent } from '@shared/mail-drafts';
import type { MailSourceRef } from '@shared/application-mail-data';
import type { LocalMailContent } from '@shared/application-mail';
const messageId=z.string().max(2000).regex(/^<[^<>\s@]+@[^<>\s@]+>$/);
export function mailReplyHeaders(source:LocalMailContent):{inReplyTo:string;references:string[]}{
 const id=messageId.safeParse(source.messageId);if(!id.success)throw new ApplicationError('INVALID_INPUT','原邮件缺少有效Message-ID，不能确认回复关联，请补齐后再创建回复');
 const parent=source.references.length?source.references:source.inReplyTo?[source.inReplyTo]:[];
 if(parent.some(value=>!messageId.safeParse(value).success))throw new ApplicationError('INVALID_INPUT','原邮件回复链格式不完整，不能伪造回复关联');
 const references=[...new Set([...parent,id.data])];if(references.length>100)throw new ApplicationError('TOO_LARGE','原邮件回复链超过本次契约预算');return{inReplyTo:id.data,references};
}
export function mailReplyContent(source:LocalMailContent,input:{reference:MailSourceRef;mode:'reply'|'reply-all';text:string;html?:string|null},sender:{id:string;address:string}|null):MailDraftContent{
 const self=sender?.address.toLowerCase(),seen=new Set<string>(),to:string[]=[],cc:string[]=[];
 const append=(addresses:string[],target:string[])=>{for(const value of addresses){const parsed=z.email().max(512).safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','原邮件收件地址不完整，请核对实际目标');const key=parsed.data.toLowerCase();if(key===self||seen.has(key))continue;seen.add(key);target.push(parsed.data);}};
 append(source.replyTo.length?source.replyTo:source.fromAddresses,to);
 if(input.mode==='reply-all'){append(source.toAddresses,to);append(source.cc,cc);}
 if(!to.length&&!cc.length)throw new ApplicationError('INVALID_INPUT','回复没有可确认的实际收件人，请先补齐目标');
 if(to.length>100||cc.length>100||to.length+cc.length>100)throw new ApplicationError('TOO_LARGE','回复全部收件人超过100项，未静默省略');
 const subject=/^re\s*:/i.test(source.subject)?source.subject:'Re: '+source.subject;if(subject.length>2000)throw new ApplicationError('TOO_LARGE','回复主题超过本次草稿契约预算');
 return{mode:input.mode,sourceMessageRef:input.reference,senderConnectionId:sender?.id??null,to,cc,bcc:[],subject,text:input.text,html:input.html??null,...mailReplyHeaders(source),attachmentIds:[]};
}
