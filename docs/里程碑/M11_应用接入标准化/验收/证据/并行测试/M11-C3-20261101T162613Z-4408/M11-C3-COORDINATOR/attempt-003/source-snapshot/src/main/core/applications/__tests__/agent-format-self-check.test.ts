import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentAdapterRegistry } from '../agent-adapter-registry';
import { builtinNativeEvidenceAdapters, NativeEvidenceAdapterRegistry } from '../native-evidence-adapters';
import type { NativeFormatCheckFixtures } from '../agent-format-self-check';
import { agentFixture } from './agent-fixture';

let f: Awaited<ReturnType<typeof agentFixture>>;
beforeEach(async () => { f = await agentFixture(); });
afterEach(() => f.cleanup());
function fixtures(): NativeFormatCheckFixtures {
  const target = { id: 'mail', nativeName: 'owned-mail', path: '/private/p/owned-mail/SKILL.md', content: '---\nname: mail\n---\nbody\n' };
  const line = (payload: unknown) => JSON.stringify({ timestamp: new Date(200).toISOString(), type: 'response_item', payload });
  const header = JSON.stringify({ type: 'session_meta', payload: { id: 'session', cwd: '/private/p' } });
  const catalog = '<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `/private/p`\n### Available skills\n- owned-mail: d (file: r0/owned-mail/SKILL.md)\n</skills_instructions>';
  const call = line({ type: 'function_call', name: 'exec_command', call_id: 'call', arguments: JSON.stringify({ cmd: `/bin/cat '${target.path}'`, max_output_tokens: 5000 }) });
  const output = line({ type: 'function_call_output', call_id: 'call', output: 'Chunk ID: ab1\nWall time: 0.01 seconds\nProcess exited with code 0\nOriginal token count: 5\nOutput:\n' + target.content });
  const discovery = line({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: catalog }] });
  const positive = [header, call, output, discovery].join('\n') + '\n';
  return { identity: { root: '/private', sessionId: 'session', cwd: '/private/p', realCwd: '/private/p' }, target, since: 100, through: 400, positive,
    negatives: { malformed: '{bad\n', 'role-spoof': header + '\n' + line({ type: 'message', role: 'assistant', content: [{ type: 'input_text', text: catalog }] }) + '\n', truncated: positive.slice(0, -1), 'mixed-version': positive.replaceAll('response_item', 'future_item_v9'), 'over-budget': positive + '{}\n'.repeat(8200) },
    userMessage: JSON.parse(line({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'synthetic user text' }] })) };
}
describe('host-only version format checks (M11 T26 I)', () => {
  it('binds compatible native logs to exact adapter/version, persists L2 only and never grants CLI or L3', () => {
    const hash = f.plan('codex').adapterBinding.hash, version = '0.166.99', input = fixtures();
    expect(f.adapters.effective(hash, version)).toEqual({ levels: ['L0.skill', 'L0.mcp'], verified: false, nativeSendEvidence: false });
    const check = f.adapters.selfCheck(hash, version, input);
    expect(check.status).toBe('passed');expect(check.proven).toEqual(['L2']);expect(check.userMessageParsed).toBe(true);
    const reopened = new AgentAdapterRegistry(f.store);
    expect(reopened.levels(hash, version)).toEqual(['L2']);
    expect(reopened.effective(hash, version)).toEqual({ levels: ['L0.skill', 'L0.mcp', 'L2'], verified: false, nativeSendEvidence: false });
    expect(reopened.levels(hash, '0.166.98')).toEqual([]);
    expect(reopened.selfCheckResult(hash, version)?.sourceHash).toBe(check.sourceHash);
    const other = f.plan('claude-code').adapterBinding.hash;expect(reopened.selfCheckResult(other, version)).toBeNull();
    const journal = f.sqlite.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='agent-format-self-check'").all() as {plan_json:string}[];
    expect(journal).toHaveLength(1);expect(journal[0].plan_json).not.toContain(input.target.path);expect(journal[0].plan_json).not.toContain('synthetic user text');
  });
  it('changed logs revoke an earlier local check, retaining both original attempts and no authorization', () => {
    const hash = f.plan('codex').adapterBinding.hash, version = '0.166.99';f.adapters.selfCheck(hash, version, fixtures());
    const changed = fixtures();changed.positive = changed.positive.replaceAll('response_item', 'unknown_future_item');
    expect(f.adapters.selfCheck(hash, version, changed).status).toBe('failed');
    expect(f.adapters.effective(hash, version).levels).not.toContain('L2');expect(f.adapters.effective(hash, version).nativeSendEvidence).toBe(false);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM capability_resource_operations WHERE kind='agent-format-self-check'").get()).toEqual({ n: 2 });
  });
  it('a single negative producing just one observation fails; a missing negative cannot certify compatibility', () => {
    const hash = f.plan('codex').adapterBinding.hash, adapter = builtinNativeEvidenceAdapters.get('codex');
    const formats = new NativeEvidenceAdapterRegistry([{ ...adapter, observeSkillReads(lines, targets, since, through) {
      if (lines[0] === '{bad') return [{ skillId: targets[0].id, observedAt: new Date(200).toISOString(), recordHash: 'a'.repeat(64), callId: 'bad' }];
      return adapter.observeSkillReads!(lines, targets, since, through);
    }, validateHeader: undefined }]);
    expect(new AgentAdapterRegistry(f.store, formats).selfCheck(hash, '0.166.99', fixtures()).status).toBe('failed');
    const missing = fixtures();delete (missing.negatives as Partial<typeof missing.negatives>)['role-spoof'];
    expect(f.adapters.selfCheck(hash, '0.166.99', missing).status).toBe('failed');
  });
  it('published L3 remains a published fact; local checks cannot add L3 or raise native send evidence', () => {
    const hash = f.plan('codex').adapterBinding.hash, declared = f.adapters.effective(hash, '0.162.1');
    expect(declared.nativeSendEvidence).toBe(true);
    expect(f.adapters.selfCheck(hash, '0.162.1', fixtures()).proven).toEqual(['L2']);
    expect(f.adapters.effective(hash, '0.162.1')).toEqual(declared);
  });
  it('a corrupt or cross-platform current receipt cannot resurrect an older green or mint L3', () => {
    const hash = f.plan('codex').adapterBinding.hash, version = '0.166.99';f.adapters.selfCheck(hash, version, fixtures());
    f.sqlite.prepare("UPDATE capability_resource_operations SET plan_json=? WHERE kind='agent-format-self-check'").run(JSON.stringify({ ...f.adapters.selfCheckResult(hash, version), proven: ['L3'] }));
    expect(f.adapters.effective(hash, version).levels).not.toContain('L2');expect(f.adapters.effective(hash, version).levels).not.toContain('L3');
  });
  it('a receipt whose status contradicts its checks cannot certify compatibility after restart', () => {
    const hash = f.plan('codex').adapterBinding.hash, version = '0.166.99';
    const check = f.adapters.selfCheck(hash, version, fixtures());
    f.sqlite.prepare("UPDATE capability_resource_operations SET plan_json=? WHERE kind='agent-format-self-check'").run(JSON.stringify({ ...check, checks: { ...check.checks, positive: false } }));
    expect(new AgentAdapterRegistry(f.store).effective(hash, version).levels).not.toContain('L2');
    f.sqlite.prepare("UPDATE capability_resource_operations SET plan_json=? WHERE kind='agent-format-self-check'").run(JSON.stringify({ ...check, checks: {} }));
    expect(new AgentAdapterRegistry(f.store).effective(hash, version).levels).not.toContain('L2');
  });
});
