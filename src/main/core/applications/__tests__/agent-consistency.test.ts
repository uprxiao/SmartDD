// M11 S12 / design §15.5: one contract suite every Agent evidence parser must pass.
// Negative cases must never yield "discovered"/"read" evidence (fail closed).
import { describe, expect, it } from 'vitest';
import { codexSkillDiscoveryEvidence } from '../codex-skill-discovery-evidence';
import { codexSkillReadEvidence } from '../codex-skill-read-evidence';
import { effectiveLevels } from '../agent-levels';

const target = { id: 'mail', nativeName: 'owned-mail', path: '/private/p/owned-mail/SKILL.md', content: '---\nname: mail\n---\nbody\n' };
const t = (ms: number) => new Date(ms).toISOString();
const catalog = '<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `/private/p`\n### Available skills\n- owned-mail: d (file: r0/owned-mail/SKILL.md)\n</skills_instructions>';
const discovery = (role = 'developer', time = 200) => JSON.stringify({ timestamp: t(time), type: 'response_item', payload: { type: 'message', role, content: [{ type: 'input_text', text: catalog }] } });
const call = JSON.stringify({ type: 'response_item', timestamp: t(200), payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: "/bin/cat '" + target.path + "'", max_output_tokens: 5000 }) } });
const out = (body = target.content, id = 'c1') => JSON.stringify({ type: 'response_item', timestamp: t(300), payload: { type: 'function_call_output', call_id: id, output: 'Chunk ID: ab1\nWall time: 0.01 seconds\nProcess exited with code 0\nOriginal token count: 5\nOutput:\n' + body } });

const parsers = [
  { name: 'discovery', run: (lines: string[]) => codexSkillDiscoveryEvidence(lines, [target], 100, 400), positive: () => [discovery()] },
  { name: 'read', run: (lines: string[]) => codexSkillReadEvidence(lines, [target], 100, 400), positive: () => [call, out()] },
];

describe.each(parsers)('consistency suite: $name parser', ({ run, positive }) => {
  it('positive fixture yields evidence', () => expect(run(positive())).toHaveLength(1));
  it('malformed and truncated records yield nothing', () => {
    expect(run(positive().map((l) => l.slice(0, Math.floor(l.length / 2))))).toEqual([]);
    expect(run(['{not json', '', 'null'])).toEqual([]);
  });
  it('over line-count or byte budget yields nothing', () => {
    expect(run([...positive(), ...Array(8200).fill('{}')])).toEqual([]);
    expect(run([...positive(), 'x'.repeat(4 * 1024 * 1024)])).toEqual([]);
  });
  it('records outside the run window yield nothing', () => {
    const shifted = positive().map((l) => l.replace(/"timestamp":"[^"]+"/, `"timestamp":"${t(50)}"`));
    expect(run(shifted)).toEqual([]);
  });
});

describe('consistency suite: cross-cutting negatives', () => {
  it('user/assistant text pretending to be the developer catalog is not discovery', () => {
    for (const role of ['user', 'assistant']) expect(codexSkillDiscoveryEvidence([discovery(role)], [target], 100, 400)).toEqual([]);
  });
  it('tool output without its matching call, or with altered content, is not a read', () => {
    expect(codexSkillReadEvidence([out()], [target], 100, 400)).toEqual([]);
    expect(codexSkillReadEvidence([call, out(target.content, 'other')], [target], 100, 400)).toEqual([]);
    expect(codexSkillReadEvidence([call, out(target.content + 'tampered')], [target], 100, 400)).toEqual([]);
  });
  it('unknown record shapes from another CLI version are ignored, not trusted', () => {
    const mixed = [JSON.stringify({ type: 'future_item_v9', timestamp: t(250), payload: { role: 'developer' } }), ...[call, out()]];
    expect(codexSkillReadEvidence(mixed, [target], 100, 400)).toHaveLength(1);
    expect(codexSkillDiscoveryEvidence(mixed, [target], 100, 400)).toEqual([]);
  });
  it('an undeclared version gets no L2/L3 and no native send evidence', () => {
    const e = effectiveLevels([]);
    expect(e.levels).not.toContain('L2');
    expect(e.levels).not.toContain('L3');
    expect(e.nativeSendEvidence).toBe(false);
  });
});
