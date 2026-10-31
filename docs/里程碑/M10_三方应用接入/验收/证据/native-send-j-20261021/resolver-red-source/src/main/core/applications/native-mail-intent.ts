import { z } from 'zod';
import type { MailSendReview } from '@shared/mail-execution';
import { applicationReferenceText } from '@shared/application-terminal';
import { digest } from './manifest';
export interface NativeReferencedMailAction { schema: 'native-mail-reference-v1'; draftId: string; revision: number; contentHash: string; referenceHash: string }
/** One implemented semantic path: an explicit imperative sends the exact immutable draft
 * the user referenced. Other natural-language/context paths remain to be implemented.
 * No model-provided approval, inferred recipient, edit, question or quote grants permission.
 */
export function resolveReferencedMailSend(text: string, review: Pick<MailSendReview, 'draftId' | 'draftRevision' | 'draftContentHash' | 'priorUnknownExecutionIds'>): NativeReferencedMailAction | null {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || review.priorUnknownExecutionIds.length) return null;
  if ((text.match(/mail-draft:\/\//g) ?? []).length !== 1) return null;
  const found = /mail-draft:\/\/[^\s\[\]<>"'“”‘’`，。！？；,;!?]+/u.exec(text); if (!found) return null;
  const raw = found[0]; let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const revision = url.searchParams.get('revision'), contentHash = url.searchParams.get('contentHash'), id = url.hostname;
  if (url.protocol !== 'mail-draft:' || !z.uuid().safeParse(id).success || url.username || url.password || url.port || url.hash || !['','/'].includes(url.pathname) || [...url.searchParams.keys()].sort().join(',') !== 'contentHash,revision' || !revision || !/^[1-9][0-9]{0,14}$/.test(revision) || !Number.isSafeInteger(Number(revision)) || !contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) return null;
  if (id !== review.draftId || Number(revision) !== review.draftRevision || contentHash !== review.draftContentHash) return null;
  const source = { kind: 'draft' as const, draftId: id, revision: Number(revision), contentHash }, generated = applicationReferenceText(source);
  let action = text.trim();
  if (action.startsWith(generated)) action = action.slice(generated.length).trim().replace(/^并\s*/, '');
  else action = action.replace(`[邮件草稿 ${raw}]`, '').replace(raw, '').trim();
  action = action.replace(/[。.!]+$/u, '').trim();
  const chinese = action.replace(/\s+/gu, ''), prefix = '(?:请帮我|请|帮我|麻烦你|麻烦)?(?:现在|立即|直接)?', object = '(?:(?:这份|这封|这个|此|该|已确认的|指定的)?(?:邮件草稿|草稿|邮件))?', unchanged = '(?:原样|按当前修订|按此修订)?', verb = '(?:发送|发出|寄出)';
  const direct = new RegExp('^' + prefix + unchanged + verb + object + unchanged + '$').test(chinese);
  const objectFirst = new RegExp('^' + prefix + '(?:把|将)?' + object + unchanged + verb + '$').test(chinese);
  const english = /^(?:please\s+)?(?:send|email|mail)\s+(?:(?:this|the|specified|exact|frozen|approved)\s+)*(?:draft|message|email)(?:\s+(?:as[- ]is|unchanged))?$/i.test(action.replace(/\s+/g, ' '));
  if (!direct && !objectFirst && !english) return null;
  return { schema: 'native-mail-reference-v1', draftId: id, revision: Number(revision), contentHash, referenceHash: digest(raw) };
}
