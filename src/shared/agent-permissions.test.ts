import { expect, it } from 'vitest';
import { agentPermission, expandCodexPermissionShorthands } from './agent-permissions';

it('generates only the approved per-Agent permission choices and keeps returned args independent', () => {
  expect(agentPermission('claude', 'auto')).toEqual({ id: 'ask', args: ['--permission-mode', 'default'] });
  expect(agentPermission('claude', 'full').args).toEqual(['--permission-mode', 'bypassPermissions']);
  expect(agentPermission('codex', 'auto').args).toEqual(['--approve-for-me']);
  const first = agentPermission('codex', 'ask'); first.args.length = 0;
  expect(agentPermission('codex', 'ask').args).toEqual(['-s', 'workspace-write', '-a', 'on-request', '-c', 'approvals_reviewer="user"']);
});
it('never interprets values, TOML literals or feature names as a permission shorthand', () => {
  const values = ['-m', '--approve-for-me', '-c', 'name="--approve-for-me"', '--disable', '--dangerously-bypass-approvals-and-sandbox'];
  expect(expandCodexPermissionShorthands(values)).toEqual(values);
});
it('rejects conflicting shorthand/dedicated choices in both orders instead of changing native semantics', () => {
  expect(() => expandCodexPermissionShorthands(['-s', 'read-only', '--approve-for-me'])).toThrow('冲突');
  expect(() => expandCodexPermissionShorthands(['--approve-for-me', '-a=never'])).toThrow('冲突');
});
