// M11 原型模型（合成数据）：发件身份状态与会话运行计划。
// 依据 docs/里程碑/M11_应用接入标准化/需求.md R0.9（M11-R14、R15）与 技研/架构设计.md §7.2、§9.1。
// 不读取真实账号、日志或配置；仅由原型里的合成连接推导，生产实现另行开发。
import { selectedConnections } from './integration-model.mjs';
export { sanitizeSenderConfirmations } from './m11-sender-confirmations.mjs';

const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const mailboxOf = value => (typeof value === 'string' && MAILBOX.test(value.trim()) ? value.trim().toLowerCase() : null);

/** Foxmail 来源所在账号目录名：原型用合成字段 accountDir，缺省取 account；可由演示开关覆盖为非邮箱目录名。 */
export function foxmailDirectory(local, directoryOverride) {
  if (directoryOverride === 'non-mailbox') return '合成账号目录（非邮箱）';
  return local ? (local.accountDir ?? local.account ?? '') : '';
}

const bindingOf = (smtp, local, directory) => ({
  smtpId: smtp.id, smtpRevision: smtp.revision ?? 1, fromAddress: mailboxOf(smtp.fromAddress ?? smtp.account) ?? '',
  localId: local?.id ?? null, localRevision: local?.revision ?? null, localDirectory: local ? directory : null,
});
const sameBinding = (a, b) => !!a && !!b && ['smtpId', 'smtpRevision', 'fromAddress', 'localId', 'localRevision', 'localDirectory'].every(k => a[k] === b[k]);

/**
 * status：
 *  no-smtp       未选用发件账号（读取与草稿不受影响，不能发送）
 *  auto          Foxmail 账号目录名是邮箱且与发件地址一致，自动确认
 *  mismatch      目录名是邮箱但与发件地址不一致：拒绝，不能用户确认覆盖
 *  needs-confirm 未选用 Foxmail，或目录名不是邮箱：需要用户确认
 *  confirmed     用户已确认且绑定的连接与修订未变化
 *  invalidated   曾确认，但绑定的连接或修订已变化：需重新确认
 */
export function senderIdentity(state, projectId, directoryOverride) {
  const chosen = selectedConnections(state, projectId, 'mail');
  const smtp = chosen.find(c => c.kind === 'smtp'), local = chosen.find(c => c.kind === 'local');
  if (!smtp) return { status: 'no-smtp', sendAllowed: false, label: '未选用发件账号', detail: '读取与草稿不受影响；需要发送时先选用 SMTP 发件账号。', binding: null };
  const directory = foxmailDirectory(local, directoryOverride), from = mailboxOf(smtp.fromAddress ?? smtp.account), dirMailbox = mailboxOf(directory);
  const binding = bindingOf(smtp, local, directory);
  if (local && dirMailbox) {
    if (from && dirMailbox === from) return { status: 'auto', sendAllowed: true, label: '发件身份已自动确认', detail: `Foxmail 账号目录 ${dirMailbox} 与发件地址一致。`, binding };
    return { status: 'mismatch', sendAllowed: false, label: '发件地址与 Foxmail 账号不一致', detail: `Foxmail 账号目录为 ${dirMailbox}，发件地址为 ${from || '（无效）'}。为避免以他人身份发信，不能用确认覆盖；请改选一致的发件账号或来源。`, binding };
  }
  const reason = local ? '账号目录名不是邮箱地址，无法自动比较。' : '未选用 Foxmail 来源，没有可比较的账号。';
  const record = state.senderConfirmations?.[projectId];
  if (record && sameBinding(record.binding, binding)) return { status: 'confirmed', sendAllowed: true, label: '发件身份已由用户确认', detail: `${reason}已确认「${binding.fromAddress}」是你的发件身份；连接或修订变化后需重新确认。`, binding, confirmedAt: record.at };
  if (record) return { status: 'invalidated', sendAllowed: false, label: '发件身份确认已失效', detail: `${reason}所绑定的发件账号、Foxmail 来源或其修订已变化，需重新确认；读取与草稿不受影响。`, binding };
  return { status: 'needs-confirm', sendAllowed: false, label: '需要确认发件身份', detail: `${reason}请确认「${binding.fromAddress || '该发件地址'}」是你的发件身份后才能发送。`, binding };
}

export function confirmSenderIdentity(state, projectId, directoryOverride, at = 'demo-confirmed') {
  const current = senderIdentity(state, projectId, directoryOverride);
  if (!['needs-confirm', 'invalidated'].includes(current.status)) return state;
  return { ...state, senderConfirmations: { ...state.senderConfirmations, [projectId]: { binding: current.binding, at } } };
}

// ---------------- 会话运行计划（合成）----------------
export const RUN_PLAN_SCENARIOS = [
  { id: 'declared', label: 'Codex 0.166.0 · 已声明版本' },
  { id: 'l2', label: 'Codex 0.166.0 · Skill 发现／读取已验证（S10 增量）' },
  { id: 'fallback', label: 'Codex 未声明版本 · CLI 不交付，只读降级 MCP' },
  { id: 'sandbox', label: '用户沙箱无法证明等价 · 不注入 CLI' },
];
export const LEVELS = ['L0.skill', 'L0.mcp', 'L0.cli', 'L1', 'L2', 'L3'];
const LEVEL_TITLE = { 'L0.skill': 'Skill 已交付', 'L0.mcp': 'MCP 可交付', 'L0.cli': 'CLI 可交付（含沙箱放行）', L1: '调用身份可核验', L2: '已验证发现／读取', L3: '聊天原话授权' };
export const levelTitle = level => LEVEL_TITLE[level];

/** 保留 R0.9 评审场景；l2 对应 S10 已验证读取、L3 仍关闭的增量。 */
export function adapterLevels(scenarioId) {
  const declared = scenarioId === 'declared' || scenarioId === 'l2';
  const on = new Set(declared ? ['L0.skill', 'L0.mcp', 'L0.cli', 'L1', ...(scenarioId === 'l2' ? ['L2'] : [])] : ['L0.skill', 'L0.mcp', 'L1']);
  return LEVELS.map(level => ({ level, title: LEVEL_TITLE[level], state: on.has(level) ? (declared ? 'declared' : 'best-effort') : 'unverified' }));
}

const APP_ENTRY = { zentao: { primary: 'cli', fallback: 'mcp', fallbackAllowed: true }, mail: { primary: 'mcp', fallback: null, fallbackAllowed: false } };
const ENTRY_NAME = { mcp: 'MCP', cli: 'CLI' };

/** 每个应用在本次运行启动时确定的生效入口、降级原因与不可用提示。 */
export function runPlanForApp(appId, scenarioId) {
  const spec = APP_ENTRY[appId];
  if (!spec) return null;
  const cliDelivered = scenarioId === 'declared' || scenarioId === 'l2';
  const reasons = { declared: '', fallback: '该 Agent 版本未声明 CLI 交付，启动时按降级入口处理。', sandbox: '无法证明用户沙箱策略等价，不注入 CLI 放行，启动时按降级入口处理。' };
  if (spec.primary === 'mcp') return { appId, active: 'mcp', activeName: 'MCP', degraded: false, available: true, reason: '', note: '邮件主入口为 MCP；写能力不允许降级入口。' };
  if (cliDelivered) return { appId, active: 'cli', activeName: 'CLI', degraded: false, available: true, reason: '', note: '主入口 CLI；只读能力另声明降级入口 MCP，仅在启动时 CLI 不可交付才使用。' };
  if (spec.fallbackAllowed) return { appId, active: spec.fallback, activeName: ENTRY_NAME[spec.fallback], degraded: true, available: true, reason: reasons[scenarioId], note: '降级入口只在启动时确定；运行期间不切换，也不在一次调用中切换。' };
  return { appId, active: null, activeName: '无', degraded: false, available: false, reason: reasons[scenarioId], note: '该能力无降级入口，本次运行不可用。' };
}

/** 邮件按能力的可用性（必需槽＋条件槽）；依据架构设计 §7.1。 */
export function mailCapabilityRows(state, projectId, directoryOverride) {
  const chosen = selectedConnections(state, projectId, 'mail');
  const hasFox = chosen.some(c => c.kind === 'local'), hasSmtp = chosen.some(c => c.kind === 'smtp');
  const sender = senderIdentity(state, projectId, directoryOverride);
  return [
    { id: 'read', title: '查询与读取原邮件', needs: 'Foxmail 来源', ok: hasFox, why: hasFox ? '' : '未选用 Foxmail 来源' },
    { id: 'resource', title: '读取草稿、附件与审阅资源', needs: '无（原邮件资源才需要 Foxmail）', ok: true, why: '' },
    { id: 'draft', title: '草稿创建、修改、查询', needs: '无（回复草稿需要 Foxmail）', ok: true, why: '' },
    { id: 'reply', title: '回复草稿', needs: 'Foxmail 来源', ok: hasFox, why: hasFox ? '' : '未选用 Foxmail 来源' },
    { id: 'send', title: '冻结与发送', needs: 'SMTP 发件账号＋已确认的发件身份', ok: hasSmtp && sender.sendAllowed, why: !hasSmtp ? '未选用 SMTP 发件账号' : sender.sendAllowed ? '' : sender.label },
    { id: 'query-send', title: '查询发送结果／停止等待', needs: '无', ok: true, why: '' },
  ];
}
