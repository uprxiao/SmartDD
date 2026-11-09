import { describe, expect, it } from 'vitest';
import type { AiProfileView, RunnerInfo } from './ai-profiles';
import { inputForDetectedRunner, profileForRunner } from './detected-profile';

const info: RunnerInfo = { runner: 'codex', command: 'codex', path: '/opt/homebrew/bin/codex', version: 'codex test', error: null };
const saved = (name: string, runner: 'claude' | 'codex', isDefault = false): AiProfileView => ({
  id: name, name, runner, isDefault, executable: '/custom/tool', args: ['--model', 'custom'],
  env: [{ name: 'LOCAL_SETTING', secret: false, value: 'retained', hasValue: true }], color: '#123456',
  check: null, checking: false, createdAt: 1, updatedAt: 1,
});

describe('detected CLI → saved profile', () => {
  it('creates a native-login profile with the detected executable without inheriting another runner’s secrets or defaults', () => {
    const existing = saved('CC-work', 'claude', true);
    expect(profileForRunner([existing], 'codex')).toBeUndefined();
    expect(inputForDetectedRunner(info, [existing])).toEqual({ name: 'Codex', runner: 'codex', executable: info.path, env: [], args: [], color: null, isDefault: false });
  });
  it('returns the actual edited existing profile on repeated detection, preserving arguments, path, environment and default', () => {
    const userProfile = saved('My renamed profile', 'codex', true);
    const before = structuredClone(userProfile);
    expect(profileForRunner([saved('Codex', 'codex'), userProfile], 'codex')).toBe(userProfile);
    expect(userProfile).toEqual(before);
    expect(profileForRunner([userProfile], 'codex')).toBe(userProfile);
  });
  it('avoids case-insensitive name collisions without changing existing profiles', () => {
    const profiles = [saved('codex', 'claude'), saved('CODEX 2', 'claude')];
    expect(inputForDetectedRunner(info, profiles).name).toBe('Codex 3');
    expect(profiles.map((p) => p.name)).toEqual(['codex', 'CODEX 2']);
  });
  it('does not create a profile for an absent executable', () => {
    expect(() => inputForDetectedRunner({ ...info, path: null }, [])).toThrow('not found');
  });
});
