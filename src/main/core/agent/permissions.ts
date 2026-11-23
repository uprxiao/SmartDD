// M14 三档权限到原生参数的映射（技术方案 T1.5 §7.2；用户 2026-11-17 决定只留三档，去掉“自动接受编辑”）。
import type { DriverId } from './capabilities';

export const TIERS = ['ask', 'auto', 'full'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = { ask: '请求批准', auto: '帮我批准', full: '完全访问' };

export interface CodexTierParams {
  approvalPolicy: 'on-request' | 'never';
  approvalsReviewer: 'user' | 'auto_review';
  sandboxPolicy: { type: 'workspaceWrite' | 'dangerFullAccess' };
}
export interface ClaudeTierParams { permissionMode: 'default' | 'bypassPermissions' }

export const CODEX_TIERS: Record<Tier, CodexTierParams> = {
  // 沿用 M13 已确认定义：工作区内编辑不询问，写 .git、外部文件、联网经提升权限请求用户；reviewer 每轮显式为 user（V08／V09）。
  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite' } },
  auto: { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'workspaceWrite' } },
  full: { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' } },
};
// Claude 不提供“帮我批准”：不能映射为绕过。
export const CLAUDE_TIERS: Partial<Record<Tier, ClaudeTierParams>> = {
  ask: { permissionMode: 'default' },
  full: { permissionMode: 'bypassPermissions' },
};

export type TierResolution =
  | { ok: true; tier: Tier; requested: Tier; downgraded: false; params: CodexTierParams | ClaudeTierParams }
  | { ok: true; tier: 'ask'; requested: Tier; downgraded: true; reason: string; params: CodexTierParams | ClaudeTierParams }
  | { ok: false; reason: 'unknown-tier' | 'unknown-driver' };

export const isTier = (value: unknown): value is Tier => typeof value === 'string' && (TIERS as readonly string[]).includes(value);

/** Business calls use the current user choice; delegated tasks inherit it from the parent. */
export const selectedTaskTier = (selectionJson: string, parentSelectionJson?: string | null): Tier => {
  try {
    const tier = JSON.parse(parentSelectionJson ?? selectionJson)?.tier;
    return isTier(tier) ? tier : 'ask';
  } catch { return 'ask'; }
};

/** Verified native protocol for selecting the host CLI profile in turn/start. */
export const codexSupportsTurnPermissions = (version: string): boolean => version === '0.169.0';

/** 不在三档内的输入（含旧 edits）拒绝；执行器不支持的档位降为请求批准并给出原因。 */
export function resolveTier(driverId: DriverId | string, permission: unknown): TierResolution {
  if (!isTier(permission)) return { ok: false, reason: 'unknown-tier' };
  const table: Partial<Record<Tier, CodexTierParams | ClaudeTierParams>> | null = driverId === 'codex-app-server' ? CODEX_TIERS : driverId === 'claude-sdk' || driverId === 'antigravity-acp' ? CLAUDE_TIERS : null;
  if (!table) return { ok: false, reason: 'unknown-driver' };
  const params = table[permission];
  if (!params) return { ok: true, tier: 'ask', requested: permission, downgraded: true, reason: `${TIER_LABEL[permission]}不适用于该执行器，已按请求批准运行`, params: table.ask! };
  return { ok: true, tier: permission, requested: permission, downgraded: false, params };
}

/** 档位列表按执行器过滤（首页与任务页共用）。 */
export function tiersFor(driverId: DriverId): Tier[] {
  return TIERS.filter(t => driverId === 'codex-app-server' || CLAUDE_TIERS[t]);
}
