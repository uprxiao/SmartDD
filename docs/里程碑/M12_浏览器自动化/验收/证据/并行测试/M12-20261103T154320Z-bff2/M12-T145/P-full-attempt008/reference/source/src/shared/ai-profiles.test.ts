import { describe, expect, it } from 'vitest';
import { profileModel, type AiProfileEnvView } from './ai-profiles';

const env = (name: string, value: string | null, secret = false): AiProfileEnvView => ({ name, secret, value, hasValue: value !== null });

describe('profileModel', () => {
  it('reads the model variable of a Claude profile', () => {
    expect(profileModel({ runner: 'claude', env: [env('ANTHROPIC_MODEL', 'deepseek-v4')], args: [] })).toBe('deepseek-v4');
  });

  it('prefers --model in the launch arguments, last one wins', () => {
    const p = { runner: 'claude' as const, env: [env('ANTHROPIC_MODEL', 'a')] };
    expect(profileModel({ ...p, args: ['--model', 'b'] })).toBe('b');
    expect(profileModel({ ...p, args: ['--model=b', '--model', 'c'] })).toBe('c');
    expect(profileModel({ ...p, args: ['--model', 'b', '--model=c'] })).toBe('c');
  });

  it('knows Codex -m and ignores ANTHROPIC_MODEL there', () => {
    expect(profileModel({ runner: 'codex', env: [], args: ['-m', 'gpt-5'] })).toBe('gpt-5');
    expect(profileModel({ runner: 'codex', env: [env('ANTHROPIC_MODEL', 'x')], args: [] })).toBeNull();
    expect(profileModel({ runner: 'claude', env: [], args: ['-m', 'x'] })).toBeNull();
  });

  it('gives null when nothing is set, empty, dangling or secret', () => {
    expect(profileModel({ runner: 'claude', env: [], args: [] })).toBeNull();
    expect(profileModel({ runner: 'claude', env: [env('ANTHROPIC_MODEL', '')], args: ['--model'] })).toBeNull();
    expect(profileModel({ runner: 'claude', env: [env('ANTHROPIC_MODEL', null, true)], args: ['--model='] })).toBeNull();
  });
});
