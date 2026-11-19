import { useEffect, useRef } from 'react';
import { Globe, Mail, ShieldAlert } from 'lucide-react';
import type { MailSendReview } from '@shared/mail-execution';

const MAIL_FIELDS = { to: '收件人', cc: '抄送', bcc: '密送', subject: '主题', text: '正文' } as const;
type MailField = keyof typeof MAIL_FIELDS;
export type MailEdits = Record<MailField, string>;

export function mailEdits(content: MailSendReview['content']): MailEdits {
  return { to: content.to.join(', '), cc: content.cc.join(', '), bcc: content.bcc.join(', '), subject: content.subject, text: content.text };
}

export function MailReviewCard({ review, state, edits, busy, unknownConfirmed, onField, onUnknown, onSave, onCancel }: {
  review: MailSendReview; state: 'loading' | 'ready' | 'error'; edits: MailEdits | null; busy: boolean;
  unknownConfirmed: boolean; onField(field: MailField, value: string): void; onUnknown(value: boolean): void;
  onSave(edits: MailEdits): void; onCancel(): void;
}) {
  const card = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const editing = edits !== null;
  useEffect(() => {
    card.current?.scrollIntoView?.({ block: 'nearest' });
    if (editing) firstField.current?.focus();
  }, [state, editing]);

  const content = review.content;
  return <section className="agent-mail-review" aria-label="邮件审阅" ref={card}>
    <header><Mail size={15} aria-hidden/><b>内置邮件</b><span>请求发送邮件</span>{review.draftRevision > 1 && !editing && <span className="agent-mail-edited" title={`草稿创建后已修改，当前为第 ${review.draftRevision} 版`}>已修改</span>}<small>第 {review.draftRevision} 版 · 需要批准</small></header>
    <dl><div><dt>发件账号</dt><dd>{review.fromAddress}</dd></div></dl>
    {state === 'loading' && <p role="status">正在读取完整邮件审阅…</p>}
    {state === 'error' && <p role="alert">无法读取邮件审阅，不能批准发送。</p>}
    {state === 'ready' && (edits ? <>
      {(Object.keys(MAIL_FIELDS) as MailField[]).map(field => <label key={field}>{MAIL_FIELDS[field]}
        {field === 'text'
          ? <textarea value={edits[field]} rows={5} disabled={busy} onChange={e => onField(field, e.target.value)}/>
          : <input ref={field === 'to' ? firstField : undefined} value={edits[field]} disabled={busy} onChange={e => onField(field, e.target.value)}/>}
      </label>)}
      <footer><button type="button" className="agent-inline-action" disabled={busy} onClick={onCancel}>取消修改</button>
        <button type="button" className="agent-confirm-choice" disabled={busy} onClick={() => onSave(edits)}>保存修改并重新审阅</button></footer>
    </> : <dl>
      <div><dt>收件人</dt><dd>{content.to.join(', ')}</dd></div>
      {!!content.cc.length && <div><dt>抄送</dt><dd>{content.cc.join(', ')}</dd></div>}
      {!!content.bcc.length && <div><dt>密送</dt><dd>{content.bcc.join(', ')}</dd></div>}
      <div><dt>主题</dt><dd>{content.subject}</dd></div>
      <div><dt>正文</dt><dd className="agent-mail-body" tabIndex={0}>{content.text}</dd></div>
    </dl>)}
    {state === 'ready' && <>
      {content.html && <details><summary>HTML 正文源文（不会加载远程内容）</summary><pre>{content.html}</pre></details>}
      {(review.attachments ?? []).map(a => <p key={a.id}>附件：{a.filename} · {a.size} 字节 · {a.contentHash}</p>)}
      {!editing && !!review.priorUnknownExecutionIds?.length && <label className="agent-mail-unknown">
        <input type="checkbox" checked={unknownConfirmed} disabled={busy} onChange={e => onUnknown(e.target.checked)}/>我已核实原未知发送结果，仍明确要发送此修订
      </label>}
    </>}
    <p className="agent-review-hint"><ShieldAlert size={14} aria-hidden/>由 WillYou 邮件插件审阅并执行。Agent 无法代为批准，也不能改用其他账号。</p>
  </section>;
}

export function BrowserAccessReview({ pages, waitingForUser }: { pages: unknown; waitingForUser: boolean }) {
  const urls = Array.isArray(pages) ? pages.flatMap(page => typeof page?.url === 'string' ? [page.url] : []) : [];
  return <div className="agent-browser-access-review" aria-label="网页授权详情">
    <Globe size={16} aria-hidden/>
    <div>
      {urls.length > 0 && <><b>申请访问的页面</b><ul className="agent-browser-access-pages">{urls.map((url, index) => <li key={index}>{url}</li>)}</ul></>}
      <p>仅限同一项目。授权绑定后仅在该次运行内有效，运行结束或你撤销后立即失效。</p>
      {waitingForUser && <p>请求会等你处理，Agent 可以先做别的工作。</p>}
    </div>
  </div>;
}
