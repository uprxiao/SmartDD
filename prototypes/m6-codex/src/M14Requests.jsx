// M14 原型 P0.8：所有待处理请求（命令审批、Agent 提问、插件业务审批、M12 跨任务网页授权、子任务的请求）
// 统一为输入框位置的一种面板：标题＋来源、必要的详情、带编号的选项（数字键选择），多个请求时可 1／N 切换。
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Globe, ListChecks, Mail, MessageSquareReply, ShieldAlert } from 'lucide-react';

// 由演示状态生成请求队列。真实实现中来自宿主的待处理请求表（agent_requests）。
export function buildRequests(scenario, { resolved, childResolved = {}, mailEdited, mailEditing, mailRevision }) {
  const list = [];
  const t = scenario.turns?.[0];
  if (!resolved && scenario.pending === 'approval') {
    const e = t.entries.find(x => x.kind === 'approval');
    list.push({ id: 'own-approval', kind: 'approval', icon: 'shield', title: '需要批准：运行命令', detail: { code: e.command, lines: [`目录 ${e.cwd}`, e.reason] },
      options: [{ key: 'once', label: '批准一次' }, { key: 'session', label: '本会话允许同类命令', desc: '只在这个任务的这次会话内有效' }, { key: 'deny', label: '拒绝', desc: '可在下方写原因，Agent 继续这一轮' }] });
  }
  if (!resolved && scenario.pending === 'question') {
    list.push({ id: 'own-question', kind: 'question', icon: 'question', title: scenario.question.title, allowText: true,
      options: scenario.question.options.map(([label, desc], i) => ({ key: 'opt' + i, label, desc })) });
  }
  if (!resolved && scenario.pending === 'business') {
    const e = t.entries.find(x => x.kind === 'business');
    list.push({ id: 'own-business' + (mailRevision ? '-r' + mailRevision : ''), kind: 'business', icon: 'mail', title: `需要批准：${e.plugin} · ${e.action}`, note: mailEditing ? '正在编辑邮件：保存修改后才能批准发送' : mailEdited ? `已按修改更新邮件（第 ${mailRevision ?? 2} 版），请再次确认` : '邮件内容见上方卡片',
      options: [{ key: 'approve', label: '批准发送', disabled: !!mailEditing, desc: mailEditing ? '先在上方卡片保存修改' : undefined }, { key: 'edit', label: '手动修改', desc: '在上方卡片里直接改收件人、主题、正文' }, { key: 'agentedit', label: '让 Agent 按我的说明修改', desc: '先在下方输入框写要求，Agent 重新起草后会再请你批准', needsText: true }, { key: 'deny', label: '拒绝', desc: '插件不发送；可在下方写原因' }] });
  }
  if (!resolved && scenario.pending === 'access') {
    const a = scenario.access;
    list.push({ id: 'own-access', kind: 'access', icon: 'globe', title: `需要授权：访问任务「${a.target}」的网页`, detail: { lines: ['授权只对本次运行有效，运行结束或撤销后立即失效', '只能访问同一项目里的任务', '这个请求不会超时，一直等你处理；Agent 在等待期间可以先做别的事'] },
      options: [{ key: 'observe', label: '允许观察', desc: '只读：查看页面、截图、读取内容' }, { key: 'control', label: '允许控制', desc: '可点击、输入、执行页面脚本' }, { key: 'deny', label: '拒绝' }] });
  }
  if (!resolved && scenario.pending === 'plan') {
    list.push({ id: 'own-plan', kind: 'plan', icon: 'plan', title: '需要批准：按计划开始修改', source: '来自 Claude Code 计划模式', note: '计划见上方卡片；批准后 Claude 退出计划模式开始修改',
      options: [{ key: 'approve', label: '批准并开始' }, { key: 'revise', label: '继续修改', desc: '在下方写修改意见，Claude 改完计划后再请你确认', needsText: true }, { key: 'deny', label: '拒绝', desc: '不执行，Claude 保持只读' }] });
  }
  for (const c of scenario.childApprovals ?? []) {
    if (childResolved[c.id]) continue;
    list.push({ id: 'child-' + c.id, childId: c.id, kind: 'approval', icon: 'shield', title: `需要批准：${c.approval.title}`, source: `来自子任务「${c.title}」· ${c.target}`, detail: { code: c.approval.command, lines: [c.approval.reason] },
      options: [{ key: 'once', label: '批准一次' }, { key: 'deny', label: '拒绝', desc: '可在下方写原因' }, { key: 'open', label: '打开子任务查看' }] });
  }
  return list;
}

const ICONS = { shield: ShieldAlert, question: MessageSquareReply, mail: Mail, globe: Globe, plan: ListChecks };

export function RequestPanel({ requests, index, setIndex, pick, setPick, inChild }) {
  const r = requests[index];
  if (!r) return null;
  const Icon = ICONS[r.icon] || ShieldAlert;
  return <div className={'m14-req k-' + r.kind} role="group" aria-label={r.title}>
    <div className="m14-req-head">
      <Icon size={14} /><b>{r.title}</b>
      {r.source && <span className="m14-req-source">{r.source}</span>}
      {requests.length > 1 && !inChild && <span className="m14-req-nav"><button type="button" aria-label="上一个请求" disabled={index === 0} onClick={() => { setIndex(index - 1); setPick(null); }}><ChevronLeft size={13} /></button>{index + 1}／{requests.length}<button type="button" aria-label="下一个请求" disabled={index === requests.length - 1} onClick={() => { setIndex(index + 1); setPick(null); }}><ChevronRight size={13} /></button></span>}
    </div>
    {r.detail && <div className="m14-req-detail">{r.detail.code && <pre>{r.detail.code}</pre>}{r.detail.lines?.map(l => <span key={l}>{l}</span>)}</div>}
    {r.note && <p className="m14-req-note">{r.note}</p>}
    <div className="m14-req-options">{r.options.map((o, i) => <button type="button" key={o.key} disabled={!!o.disabled} className={'m14-req-opt' + (pick === o.key ? ' on' : '') + (o.danger ? ' danger' : '')} onClick={() => setPick(o.key)}>
      <span className="m14-opt-key">{i + 1}</span><span><b>{o.label}</b>{o.desc && <small>{o.desc}</small>}</span></button>)}</div>
    <p className="m14-req-hint">{r.kind === 'question' ? '按数字键选择，或直接在下方输入自己的回答' : '按数字键选择，Enter 确认'}</p>
  </div>;
}
