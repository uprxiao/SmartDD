import { z } from 'zod';
import type { MailSendReview } from '@shared/mail-execution';
import { applicationReferenceText } from '@shared/application-terminal';
import { canonicalJson, digest } from './manifest';
export interface NativeReferencedMailAction { schema: 'native-mail-reference-v1'; draftId: string; revision: number; contentHash: string; referenceHash: string }
type DraftReview = Pick<MailSendReview, 'draftId' | 'draftRevision' | 'draftContentHash' | 'priorUnknownExecutionIds'>;
type ContextReview = DraftReview & {content: Pick<MailSendReview['content'], 'mode' | 'to' | 'cc' | 'bcc'>};
interface ParsedDraftReference { identity: Omit<NativeReferencedMailAction,'schema'>; action: string }
function reference(text: string, review: DraftReview): ParsedDraftReference | null {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || review.priorUnknownExecutionIds.length || (text.match(/mail-draft:\/\//g) ?? []).length !== 1) return null;
  const found = /mail-draft:\/\/[^\s\[\]<>"'“”‘’`，。！？；,;!]+/u.exec(text); if (!found) return null;
  const raw = found[0]; let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const revision = url.searchParams.get('revision'), contentHash = url.searchParams.get('contentHash'), id = url.hostname;
  if (url.protocol !== 'mail-draft:' || !z.uuid().safeParse(id).success || url.username || url.password || url.port || url.hash || !['','/'].includes(url.pathname) || [...url.searchParams.keys()].sort().join(',') !== 'contentHash,revision' || !revision || !/^[1-9][0-9]{0,14}$/.test(revision) || !Number.isSafeInteger(Number(revision)) || !contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) return null;
  if (id !== review.draftId || Number(revision) !== review.draftRevision || contentHash !== review.draftContentHash) return null;
  const generated = applicationReferenceText({kind:'draft',draftId:id,revision:Number(revision),contentHash});let action = text.trim();
  if (action.startsWith(generated)) action = action.slice(generated.length).trim().replace(/^并\s*/, '');
  else action = action.replace(`[邮件草稿 ${raw}]`, '').replace(raw, '').trim();
  return {identity:{draftId:id,revision:Number(revision),contentHash,referenceHash:digest(raw)},action:action.replace(/[。.!！]+$/u,'').trim()};
}
/** An explicit imperative on one exact immutable reference. No model assertion grants authority. */
export function resolveReferencedMailSend(text: string, review: DraftReview): NativeReferencedMailAction | null {
  const parsed=reference(text,review);if(!parsed)return null;const action=parsed.action;
  const chinese = action.replace(/\s+/gu, ''), prefix = '(?:请帮我|请|帮我|麻烦你|麻烦)?(?:现在|立即|直接)?', object = '(?:(?:这份|这封|这个|此|该|已确认的|指定的)?(?:邮件草稿|草稿|邮件))?', unchanged = '(?:原样|按当前修订|按此修订)?', verb = '(?:发送|发出|寄出)';
  const direct = new RegExp('^' + prefix + unchanged + verb + object + unchanged + '$').test(chinese);
  const objectFirst = new RegExp('^' + prefix + '(?:把|将)?' + object + unchanged + verb + '$').test(chinese);
  const english = /^(?:please\s+)?(?:send|email|mail)\s+(?:(?:this|the|specified|exact|frozen|approved)\s+)*(?:draft|message|email)(?:\s+(?:as[- ]is|unchanged))?$/i.test(action.replace(/\s+/g, ' '));
  return direct||objectFirst||english?{schema:'native-mail-reference-v1',...parsed.identity}:null;
}
export interface NativeContextualMailAction extends Omit<NativeReferencedMailAction,'schema'> {schema:'native-mail-context-v1';recipientSetHash:string|null}
/** Resolve the next actual user turn against one exact preceding reference-only turn.
 * The caller must authenticate both turns, their adjacency, scope, policy and original rows.
 * This is an implemented conversational path, not a claim of complete language understanding.
 */
export function resolveContextualMailSend(text:string,previousText:string,review:ContextReview):NativeContextualMailAction|null{
  if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024||text.includes('mail-draft://'))return null;
  const parsed=reference(previousText,review);if(!parsed||parsed.action)return null;
  let action=text.trim().replace(/[。.!！]+$/u,'').trim(),recipientSetHash:string|null=null;
  const recipients=(value:string)=>{
    const addresses=value.split(/[,，、;；]/u).map(v=>v.trim());if(!addresses.length||addresses.length>100||addresses.some(v=>!z.email().safeParse(v).success))return false;
    const actual=[...new Set(addresses)].sort(),expected=[...new Set([...review.content.to,...review.content.cc,...review.content.bcc])].sort();
    if(canonicalJson(actual)!==canonicalJson(expected))return false;recipientSetHash=digest(canonicalJson(actual));return true;
  };
  const prefix='(?:请帮我|请|帮我|麻烦你|麻烦)?(?:那就|就)?(?:现在|立即|直接)?',unchanged='(?:原样|按当前修订|按此修订)?';
  const object='(?:(?:刚才|刚刚|之前)?(?:(?:已经|已)?(?:确认(?:过)?|确定(?:好)?|查看过)的?)?(?:(?:那份|那封|那条|这份|这封|这条|这个|那个|此|该)?(?:邮件草稿|草稿|邮件|回复)|它))';
  let chinese=action.replace(/\s+/gu,'');
  const explicitTo=/^(.*?)(?:发送给|发给|寄给)(.+)$/u.exec(chinese);
  if(explicitTo){if(!recipients(explicitTo[2]))return null;chinese=explicitTo[1]+'发送';}
  const verb='(?:发送|发出|寄出|发)',patterns=[new RegExp('^'+prefix+unchanged+verb+'(?<object>'+object+')?'+unchanged+'(?:吧)?$'),new RegExp('^'+prefix+'(?:把|将)?(?<object>'+object+')'+unchanged+verb+'(?:吧)?$')];
  let matched=patterns.map(pattern=>pattern.exec(chinese)).find(value=>!!value),reply=matched?.groups?.object?.includes('回复')??false;
  let accepted=!!matched;
  if(!accepted&&new RegExp('^'+prefix+'按(?:刚才|刚刚)?(?:确认|确定)的(?:内容|修订)(?:原样)?发送(?:吧)?$').test(chinese))accepted=true;
  if(!accepted&&!explicitTo){
    action=action.replace(/\s+/gu,' ').replace(/\s+(?:as[- ]is|unchanged)$/i,'');
    const english=/^(?:please )?(?:send|email|mail) (?<object>it|that|this|(?:the |that |this )?(?:previous(?:ly confirmed)? |last |approved )?(?:draft|message|email|reply)|the (?:draft|reply) we just (?:reviewed|confirmed))(?: (?:as[- ]is|unchanged))?(?: to (?<recipients>.+))?$/i.exec(action);
    if(english){if(english.groups?.recipients&&!recipients(english.groups.recipients))return null;accepted=true;reply=/\breply\b/i.test(english.groups?.object??'');}
  }
  if(!accepted||reply&&review.content.mode==='new')return null;
  return{schema:'native-mail-context-v1',...parsed.identity,recipientSetHash};
}

export interface NativeMailSendScope { readonly connectionHash: string; readonly policyHash: string }
/** Same non-secret identity at the actual user input and at frozen preparation. */
export function nativeMailConnectionHash(value: Pick<MailSendReview, 'connectionId' | 'identityRevision' | 'configRevision' | 'policyRevision' | 'bindingRevision' | 'identityHash' | 'smtpConfigHash'>): string {
  return digest(canonicalJson({connectionId:value.connectionId,identityRevision:value.identityRevision,configRevision:value.configRevision,policyRevision:value.policyRevision,bindingRevision:value.bindingRevision,identityHash:value.identityHash,smtpConfigHash:value.smtpConfigHash}));
}
