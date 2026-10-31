import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LAUNCH_HEADROOM, launchArgMax, launchPayloadBytes, launchPayloadFits } from './launch-budget';
import { planLaunchEnv } from './launch-env';

describe('native launch capacity before the managed fork window', () => {
  const payload = () => ({ command: '/usr/bin/true', args: ['原生会话'], ...planLaunchEnv({ HOME: '/private/tmp' }, { TEST_SECRET: 'private-value' }, ['CODEX_HOME']) });
  it('counts UTF-8, terminators, env carriers and the actual login-shell envelope', () => {
    const first = payload(), bytes = launchPayloadBytes(first);
    expect(launchPayloadBytes({ ...first, args: [...first.args, '中文'] }) - bytes).toBe(6 + 1 + 8);
    expect(launchPayloadBytes({ ...first, env: { ...first.env, MORE: 'secret' } }) - bytes).toBe(Buffer.byteLength('MORE=secret') + 1 + 8);
    expect(bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(first)));
    expect(first.env.__SMARTDD_V_TEST_SECRET).toBe('private-value');
    expect(first.scriptArgs.join(' ')).not.toContain('private-value');
  });
  it('makes the conservative boundary inclusive without rewriting argv or env', () => {
    const value = payload(), original = structuredClone(value), limit = launchPayloadBytes(value) + LAUNCH_HEADROOM;
    expect(launchPayloadFits(value, limit)).toBe(true);expect(launchPayloadFits(value, limit - 1)).toBe(false);expect(value).toEqual(original);
  });
  it('rejects embedded NUL before a native child can be armed and never prints values', () => {
    expect(() => launchPayloadBytes({ ...payload(), env: { TOKEN: 'never-log-this\0value' } })).toThrow('无效字符');
    try { launchPayloadBytes({ ...payload(), args: ['private-value\0'] }); } catch (error) { expect(String(error)).not.toContain('private-value'); }
  });
  it('keeps unknown OS capacity explicit instead of claiming it has been verified', () => {
    expect(launchPayloadFits(payload(), null)).toBe(true);
  });
  it.runIf(process.platform === 'darwin')('checks measured macOS capacity against a real harmless exec acceptance and E2BIG rejection', () => {
    const limit = launchArgMax();expect(limit).not.toBeNull();expect(limit!).toBeGreaterThan(LAUNCH_HEADROOM);
    // Many short entries also cover pointer overhead. No profile, credential or GUI.
    const accepted = Array.from({ length: Math.floor((limit! - 2 * LAUNCH_HEADROOM) / 4105) }, () => 'x'.repeat(4096));
    expect(launchPayloadFits({ command: '/usr/bin/true', args: accepted, env: {} }, limit)).toBe(true);
    expect(execFileSync('/usr/bin/true', accepted, { env: {}, timeout: 2000 })).toHaveLength(0);
    const rejected = [...accepted, ...Array.from({ length: 32 }, () => 'x'.repeat(4096))];
    expect(launchPayloadFits({ command: '/usr/bin/true', args: rejected, env: {} }, limit)).toBe(false);
    let failure:unknown;try { execFileSync('/usr/bin/true', rejected, { env: {}, timeout: 2000 }); } catch(error) { failure=error; }
    expect(failure).toMatchObject({ code: 'E2BIG' });
  });
});
