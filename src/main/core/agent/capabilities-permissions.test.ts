import { describe, expect, it } from 'vitest';
import { compareVersions, evaluateCapabilities, parseVersion } from './capabilities';
import { CODEX_TIERS, resolveTier, tiersFor } from './permissions';

// M14-A55 最低版本与能力协商；M14-A03／A12 档位映射；M14-A63 继承 auto_review 时请求批准仍显式 reviewer=user。
describe('能力协商', () => {
  it('按最低已验证版本判定，不要求精确版本相等', () => {
    expect(parseVersion('2.1.326 (Claude Code)')).toEqual([2, 1, 326]);
    expect(parseVersion('codex-cli 0.169.0')).toEqual([0, 169, 0]);
    expect(compareVersions([0, 170, 0], [0, 169, 9])).toBe(1);
    const newer = evaluateCapabilities('codex-app-server', 'codex-cli 0.180.2');
    expect(newer.state).toBe('ready');
    expect(newer.capabilities.goal).toEqual({ state: 'enabled', minVersion: '0.169.0' });
  });
  it('低版本只关闭缺少的可选能力，核心协议不可用才拒绝', () => {
    const old = evaluateCapabilities('codex-app-server', '0.168.0');
    expect(old.state).toBe('limited');
    expect(old.capabilities.basic.state).toBe('enabled');
    expect(old.capabilities.steer).toMatchObject({ state: 'disabled', reason: 'below-minimum' });
    expect(old.capabilities.approvalsReviewer.state).toBe('disabled');
    const tooOld = evaluateCapabilities('claude-sdk', '2.1.300');
    expect(tooOld.state).toBe('unsupported');
    expect(tooOld.reason).toContain('低于最低已验证版本 2.1.321');
  });
  it('无法识别的版本输出不猜测，按核心不可用处理', () => {
    const r = evaluateCapabilities('claude-sdk', 'something weird');
    expect(r.state).toBe('unsupported');
    expect(r.reason).toContain('无法识别版本输出');
  });
  it('探测失败只关闭该项；Claude 不声明的能力明确标未声明', () => {
    const r = evaluateCapabilities('claude-sdk', '2.1.326', name => name !== 'steer');
    expect(r.capabilities.steer).toMatchObject({ state: 'disabled', reason: 'probe-unavailable' });
    expect(r.capabilities.approvalsReviewer).toEqual({ state: 'disabled', reason: 'not-declared' });
    expect(r.state).toBe('limited');
  });
});

describe('三档权限', () => {
  it('Codex 三档逐项参数', () => {
    expect(CODEX_TIERS.ask).toEqual({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(CODEX_TIERS.auto).toEqual({ approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(CODEX_TIERS.full).toEqual({ approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' } });
  });
  it('Claude 没有帮我批准：降为请求批准并说明原因，不映射为绕过', () => {
    const r = resolveTier('claude-sdk', 'auto');
    expect(r).toMatchObject({ ok: true, tier: 'ask', requested: 'auto', downgraded: true, params: { permissionMode: 'default' } });
    expect(resolveTier('claude-sdk', 'full')).toMatchObject({ ok: true, tier: 'full', params: { permissionMode: 'bypassPermissions' } });
  });
  it('旧“自动接受编辑”等三档外输入一律拒绝', () => {
    expect(resolveTier('codex-app-server', 'edits')).toEqual({ ok: false, reason: 'unknown-tier' });
    expect(resolveTier('claude-sdk', 'acceptEdits')).toEqual({ ok: false, reason: 'unknown-tier' });
    expect(resolveTier('kiro', 'ask')).toEqual({ ok: false, reason: 'unknown-driver' });
  });
  it('档位列表按执行器过滤', () => {
    expect(tiersFor('codex-app-server')).toEqual(['ask', 'auto', 'full']);
    expect(tiersFor('claude-sdk')).toEqual(['ask', 'full']);
  });
});
