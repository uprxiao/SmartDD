import { GOAL_CLI_MIN_VERSION } from '@shared/agent-goal';
// M14 能力协商（技术方案 T1.5 §7.1）：最低已验证版本＋已知不兼容列表＋启动探测，不以精确版本相等判定可用性。
// minVersion 指本期研究实测通过的最低版本，不声称是厂商最初引入该能力的版本。

export type DriverId = 'claude-sdk' | 'codex-app-server' | 'antigravity-acp';
export type CapabilityName = 'basic' | 'resume' | 'mcp' | 'skills' | 'nativeSubagents' | 'steer' | 'approvalsReviewer' | 'goal' | 'plan';
export type CapabilityState = 'enabled' | 'disabled';
export type CapabilityReason = 'below-minimum' | 'known-incompatible' | 'unparsed-version' | 'probe-unavailable' | 'not-declared';

export interface CapabilityDeclaration {
  minVersion: string;
  knownIncompatible: readonly string[];
  /** 证据来源（验证账或实验记录），只作记录与展示。 */
  evidence: string;
  /** 核心能力不可用时整个执行器不可运行；可选能力只关闭该项。 */
  core: boolean;
}
export interface CapabilityResult { state: CapabilityState; reason?: CapabilityReason; minVersion?: string }
export interface DriverCapabilities {
  driverId: DriverId;
  version: string | null;
  state: 'ready' | 'limited' | 'unsupported';
  reason?: string;
  capabilities: Record<CapabilityName, CapabilityResult>;
}

const ALL: readonly CapabilityName[] = ['basic', 'resume', 'mcp', 'skills', 'nativeSubagents', 'steer', 'approvalsReviewer', 'goal', 'plan'];

/** 版本指 CLI 版本（Claude Code CLI、Codex CLI）；锁定 SDK 的版本另由依赖锁保证。 */
export const CAPABILITY_TABLE: Record<DriverId, Partial<Record<CapabilityName, CapabilityDeclaration>>> = {
  'antigravity-acp': {
    basic: { minVersion: '1.5.14', knownIncompatible: [], evidence: 'F35 ACP 握手与会话', core: true },
    resume: { minVersion: '1.5.14', knownIncompatible: [], evidence: 'F35 原生恢复', core: false },
    mcp: { minVersion: '1.5.14', knownIncompatible: [], evidence: 'F35 宿主桥', core: false },
    skills: { minVersion: '1.5.14', knownIncompatible: [], evidence: '隔离 ACP 技能加载及续聊验证', core: false },
    goal: { minVersion: GOAL_CLI_MIN_VERSION.antigravity, knownIncompatible: [], evidence: 'agy ACP 公布 goal；原生 Stop hook 回环验证', core: false },
  },
  'claude-sdk': {
    basic: { minVersion: '2.1.321', knownIncompatible: [], evidence: '验证账 Q01–Q05；SDK 0.3.321', core: true },
    resume: { minVersion: '2.1.321', knownIncompatible: [], evidence: '验证账 Q05', core: false },
    mcp: { minVersion: '2.1.322', knownIncompatible: [], evidence: 'M13 业务下限 2.1.322', core: false },
    skills: { minVersion: '2.1.322', knownIncompatible: [], evidence: 'M13 业务下限 2.1.322', core: false },
    nativeSubagents: { minVersion: '2.1.321', knownIncompatible: [], evidence: '按方法与事件探测', core: false },
    steer: { minVersion: '2.1.325', knownIncompatible: [], evidence: 'CLI 2.1.325／SDK 0.3.321 实测中途输入', core: false },
    goal: { minVersion: GOAL_CLI_MIN_VERSION.claude, knownIncompatible: [], evidence: 'V17 Claude 目标（2.1.326）', core: false },
    plan: { minVersion: '2.1.326', knownIncompatible: [], evidence: 'V18 计划截获（2.1.326＋canUseTool）', core: false },
  },
  'codex-app-server': {
    basic: { minVersion: '0.167.1', knownIncompatible: [], evidence: '验证账 Q01–Q05', core: true },
    resume: { minVersion: '0.167.1', knownIncompatible: [], evidence: '验证账 Q05', core: false },
    mcp: { minVersion: '0.167.1', knownIncompatible: [], evidence: 'M13 交付', core: false },
    skills: { minVersion: '0.167.1', knownIncompatible: [], evidence: 'M13 交付', core: false },
    nativeSubagents: { minVersion: '0.167.1', knownIncompatible: [], evidence: '按协议方法探测', core: false },
    steer: { minVersion: '0.169.0', knownIncompatible: [], evidence: '0.169.0 实测 turn/steer', core: false },
    approvalsReviewer: { minVersion: '0.169.0', knownIncompatible: [], evidence: 'V08／V09 继承 auto_review 的覆盖', core: false },
    goal: { minVersion: GOAL_CLI_MIN_VERSION.codex, knownIncompatible: [], evidence: 'V14／V16／V17 thread/goal', core: false },
  },
};

export function parseVersion(text: string | null | undefined): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
const fmt = (v: [number, number, number]) => v.join('.');

/**
 * 按版本与探测结果求每项能力。probe 返回 false 表示该能力的协议方法实际不可用（如 app-server 未公布方法）。
 * 不认识的版本串一律按核心不可用处理，不猜测。
 */
export function evaluateCapabilities(driverId: DriverId, versionText: string | null, probe: (name: CapabilityName) => boolean = () => true): DriverCapabilities {
  const parsed = parseVersion(versionText);
  const table = CAPABILITY_TABLE[driverId];
  const capabilities = {} as Record<CapabilityName, CapabilityResult>;
  for (const name of ALL) {
    const decl = table[name];
    if (!decl) { capabilities[name] = { state: 'disabled', reason: 'not-declared' }; continue; }
    const min = parseVersion(decl.minVersion)!;
    if (driverId === 'antigravity-acp' && name !== 'goal') capabilities[name] = probe(name) ? { state: 'enabled' } : { state: 'disabled', reason: 'probe-unavailable' };
    else if (!parsed) capabilities[name] = { state: 'disabled', reason: 'unparsed-version', minVersion: decl.minVersion };
    else if (compareVersions(parsed, min) < 0) capabilities[name] = { state: 'disabled', reason: 'below-minimum', minVersion: decl.minVersion };
    else if (decl.knownIncompatible.includes(fmt(parsed))) capabilities[name] = { state: 'disabled', reason: 'known-incompatible', minVersion: decl.minVersion };
    else if (!probe(name)) capabilities[name] = { state: 'disabled', reason: 'probe-unavailable', minVersion: decl.minVersion };
    else capabilities[name] = { state: 'enabled', minVersion: decl.minVersion };
  }
  const coreDown = ALL.filter(n => table[n]?.core && capabilities[n].state !== 'enabled');
  const optionalDown = ALL.filter(n => table[n] && !table[n]!.core && capabilities[n].state !== 'enabled');
  const version = parsed ? fmt(parsed) : null;
  if (coreDown.length) {
    const r = capabilities[coreDown[0]];
    const reason = r.reason === 'unparsed-version' ? `无法识别版本输出：${versionText ?? '无'}` : r.reason === 'below-minimum' ? `版本 ${version} 低于最低已验证版本 ${r.minVersion}` : r.reason === 'known-incompatible' ? `版本 ${version} 已知不兼容` : '核心协议探测失败';
    return { driverId, version, state: 'unsupported', reason, capabilities };
  }
  return optionalDown.length
    ? { driverId, version, state: 'limited', reason: `部分能力不可用：${optionalDown.join('、')}`, capabilities }
    : { driverId, version, state: 'ready', capabilities };
}
