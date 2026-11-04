import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { libraryName, syncAgentSkillLibrary, type LibrarySkill } from '../agent-skill-library';

let home: string;
const shared = () => join(home, '.agents', 'skills');
const claude = () => join(home, '.claude', 'skills');
const targets = [{ agentId: 'codex', readsSharedAgentSkills: true }, { agentId: 'claude-code', readsSharedAgentSkills: false, skillDirectory: '.claude/skills' }] as const;
const skill = (name: string, marker: string, extra: Record<string, Buffer> = {}): LibrarySkill => ({ name, files: { 'SKILL.md': Buffer.from(`---\nname: ${name}\ndescription: ${marker}\n---\n`), ...extra }, executables: new Set(Object.keys(extra).filter(p => p.endsWith('.py'))) });
const sync = (skills: LibrarySkill[]) => syncAgentSkillLibrary({ home, targets, skills });
const willyouEntries = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(n => n.startsWith('willyou-') || n.startsWith('.willyou-')).sort() : [];

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'willyou-skill-library-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe('agent skill library keeps exactly one copy of each WillYou skill', () => {
  it('names skills without versions and rejects names agents cannot load', () => {
    expect(libraryName('zentao', 'bug-analysis')).toBe('willyou-zentao-bug-analysis');
    expect(libraryName(undefined, 'remote-password-ssh')).toBe('willyou-remote-password-ssh');
    expect(() => libraryName('Zentao', 'x')).toThrow();
  });

  it('writes one owned directory per skill, links it for agents that do not read the shared directory, and is idempotent', () => {
    const first = sync([skill('willyou-zentao-bug-analysis', 'V1', { 'scripts/run.py': Buffer.from('print(1)\n') })]);
    expect(first).toMatchObject({ written: ['willyou-zentao-bug-analysis'], unchanged: [], removed: [], conflicts: [] });
    expect(willyouEntries(shared())).toEqual(['willyou-zentao-bug-analysis']);
    expect(readFileSync(join(shared(), 'willyou-zentao-bug-analysis', 'SKILL.md'), 'utf8')).toContain('V1');
    expect(JSON.parse(readFileSync(join(shared(), 'willyou-zentao-bug-analysis', '.willyou-owned.json'), 'utf8'))).toMatchObject({ owner: 'WillYou', name: 'willyou-zentao-bug-analysis' });
    expect(statSync(join(shared(), 'willyou-zentao-bug-analysis', 'scripts', 'run.py')).mode & 0o111).not.toBe(0);
    const link = join(claude(), 'willyou-zentao-bug-analysis');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(shared(), 'willyou-zentao-bug-analysis'));
    expect(readFileSync(join(link, 'SKILL.md'), 'utf8')).toContain('V1');
    expect(sync([skill('willyou-zentao-bug-analysis', 'V1', { 'scripts/run.py': Buffer.from('print(1)\n') })])).toMatchObject({ written: [], unchanged: ['willyou-zentao-bug-analysis'] });
  });

  it('replaces an upgraded skill in place, leaving no second version or staging directory behind', () => {
    sync([skill('willyou-ssh', 'V1')]);
    expect(sync([skill('willyou-ssh', 'V2')]).written).toEqual(['willyou-ssh']);
    expect(willyouEntries(shared())).toEqual(['willyou-ssh']);
    expect(readFileSync(join(claude(), 'willyou-ssh', 'SKILL.md'), 'utf8')).toContain('V2');
  });

  it('removes skills that are no longer delivered together with their agent links', () => {
    sync([skill('willyou-ssh', 'V1'), skill('willyou-zentao-bug-analysis', 'V1')]);
    expect(sync([skill('willyou-ssh', 'V1')]).removed).toEqual(['willyou-zentao-bug-analysis']);
    expect(willyouEntries(shared())).toEqual(['willyou-ssh']);
    expect(willyouEntries(claude())).toEqual(['willyou-ssh']);
  });

  it('never overwrites or deletes a same-named skill the user owns, and leaves unrelated skills alone', () => {
    mkdirSync(join(shared(), 'willyou-ssh'), { recursive: true }); writeFileSync(join(shared(), 'willyou-ssh', 'SKILL.md'), 'user owned');
    mkdirSync(join(shared(), 'remote-password-ssh'), { recursive: true }); writeFileSync(join(shared(), 'remote-password-ssh', 'SKILL.md'), 'user skill');
    mkdirSync(join(claude(), 'willyou-mail'), { recursive: true }); writeFileSync(join(claude(), 'willyou-mail', 'SKILL.md'), 'user claude skill');
    const result = sync([skill('willyou-ssh', 'V1'), skill('willyou-mail', 'V1')]);
    expect(result.conflicts).toEqual([{ name: 'willyou-ssh', location: shared() }, { name: 'willyou-mail', location: claude() }]);
    expect(readFileSync(join(shared(), 'willyou-ssh', 'SKILL.md'), 'utf8')).toBe('user owned');
    expect(readFileSync(join(claude(), 'willyou-mail', 'SKILL.md'), 'utf8')).toBe('user claude skill');
    expect(readFileSync(join(shared(), 'remote-password-ssh', 'SKILL.md'), 'utf8')).toBe('user skill');
    expect(sync([]).removed).toEqual(['willyou-mail']);
    expect(readFileSync(join(shared(), 'willyou-ssh', 'SKILL.md'), 'utf8')).toBe('user owned');
  });

  it('repairs a WillYou-owned copy whose files were edited outside WillYou', () => {
    sync([skill('willyou-ssh', 'V1')]);
    writeFileSync(join(shared(), 'willyou-ssh', 'SKILL.md'), 'tampered'); chmodSync(join(shared(), 'willyou-ssh', 'SKILL.md'), 0o644);
    expect(sync([skill('willyou-ssh', 'V1')]).written).toEqual(['willyou-ssh']);
    expect(readFileSync(join(shared(), 'willyou-ssh', 'SKILL.md'), 'utf8')).toContain('V1');
  });
});
