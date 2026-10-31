import {z} from 'zod';
import type {MailSendReview} from '@shared/mail-execution';
import {resolveContextualMailSend} from './native-mail-intent';

type Review=Pick<MailSendReview,'draftId'|'draftRevision'|'draftContentHash'|'priorUnknownExecutionIds'> & {content:Pick<MailSendReview['content'],'mode'|'to'|'cc'|'bcc'>};
const normalizeName=(value:string)=>value.replace(/\s+/gu,'');
function bindings(text:string):[string,string][]|null{
 if(Buffer.byteLength(text)>65536)return null;
 const lines=text.trim().split(/\n/u),result:[string,string][]=[];
 if(!lines.length||lines.length>100)return null;
 for(const line of lines){
  const value=/^([\p{L}\p{N}· _-]{1,64})的邮箱(?:地址)?(?:是|为|[:：])\s*([^\s。！!]+)[。！!]?$/u.exec(line.trim());
  if(!value||!z.email().safeParse(value[2]).success||/[和与、，,；;]/u.test(value[1])||/\band\b/iu.test(value[1]))return null;
  const at=value[2].lastIndexOf('@');result.push([normalizeName(value[1]),value[2].slice(0,at+1)+value[2].slice(at+1).toLowerCase()]);
 }
 return result;
}
function unchanged(text:string):boolean{
 return /^(?:这份|这封|该)?(?:草稿|邮件)?(?:保持当前收件人、正文和附件，不作修改|保持原样|保持当前修订|不修改收件人、正文和附件)[。.!！]?$/u.test(text.trim())||/^(?:keep (?:this|the) (?:draft|message) unchanged|keep the current recipients, body and attachments unchanged)[.!]?$/iu.test(text.trim());
}
/** Text interpretation only. The host must supply a complete ordered suffix of
 * authenticated user turns and reverify all used rows before claim/execution.
 * Unknown intervening semantics never silently carry a former reference forward.
 */
export function resolveOrderedContextualMailSend(text:string,previous:readonly string[],review:Review):{action:NonNullable<ReturnType<typeof resolveContextualMailSend>>;start:number}|null{
 if(previous.length>63)return null;
 let anchor=-1;for(let index=previous.length-1;index>=0;index--)if(previous[index].includes('mail-draft://')){anchor=index;break;}
 if(anchor<0)return null;
 let start=anchor;
 while(start>0&&(bindings(previous[start-1])||unchanged(previous[start-1])))start--;
 const names=new Map<string,Set<string>>();
 for(let index=start;index<previous.length;index++){
  if(index===anchor)continue;
  const found=bindings(previous[index]);
  if(!found&&!unchanged(previous[index]))return null;
  for(const [name,address]of found??[]){const addresses=names.get(name)??new Set<string>();addresses.add(address);names.set(name,addresses);}
 }
 const aliases=new Map<string,string>();
 for(const [name,addresses]of names)if(addresses.size===1)aliases.set(name,[...addresses][0]);
 const action=resolveContextualMailSend(text,previous[anchor],review,aliases);
 return action?{action,start}:null;
}
