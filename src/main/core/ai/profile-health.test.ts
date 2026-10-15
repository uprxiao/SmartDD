import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiProfileInput } from '@shared/ai-profiles';
import type { AiProfilesChange } from '@shared/events';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore, type SecretCipher } from '../../secrets';
import { AiProfileService } from './ai-profile-service';
import { OK_REFRESH_MS, ProfileHealth } from './profile-health';
import type { ProfileTestResult } from './profile-tester';

const cipher: SecretCipher = { isAvailable: () => true, encrypt: (p) => Buffer.from(p), decrypt: (b) => b.toString() };

let sqlite: Database.Database;
let svc: AiProfileService;
let health: ProfileHealth;
let clock: number;
let changes: AiProfilesChange[];
let calls: { secrets: string[]; env: Record<string, string> }[];
let next: () => Promise<ProfileTestResult>;

beforeEach(() => {
  sqlite = new Database(':memory:');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  clock = 1_000_000;
  svc = new AiProfileService(db, new SecretsStore(db, cipher), () => clock);
  changes = [];
  calls = [];
  next = async () => ({ category: 'ok', message: '', ms: 1200 });
  health = new ProfileHealth({
    profiles: svc,
    baseEnv: () => ({ HOME: '/h' }),
    onChanged: (c) => changes.push(c),
    now: () => clock,
    runTest: async (p, secrets) => {
      calls.push({ secrets, env: p.env });
      return next();
    },
  });
});
afterEach(() => sqlite.close());

const input = (over: Partial<AiProfileInput> = {}): AiProfileInput => ({
  name: 'CC',
  runner: 'claude',
  executable: null,
  env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'tok-1' }],
  args: [],
  color: '#3b82f6',
  isDefault: false,
  ...over,
});
const failed = () => changes.filter((c) => c.failed).map((c) => c.failed);

describe('ProfileHealth.test', () => {
  it('runs the resolved profile, stores the result and shows checking meanwhile', async () => {
    const p = svc.create(input());
    let release!: (r: ProfileTestResult) => void;
    next = () => new Promise((r) => (release = r));
    const a = health.test(p.id, 'manual');
    const b = health.test(p.id, 'auto');
    expect(health.withChecking(svc.get(p.id)).checking).toBe(true);
    release({ category: 'ok', message: '', ms: 900 });
    expect(await a).toMatchObject({ status: 'ok', source: 'manual', ms: 900 });
    expect(await b).toBe(await a); // the second request joined the first
    expect(calls).toHaveLength(1);
    expect(calls[0].secrets).toEqual(['tok-1']);
    expect(health.isChecking(p.id)).toBe(false);
    expect(svc.checkOf(p.id)?.status).toBe('ok');
    expect(changes.length).toBeGreaterThanOrEqual(2); // started, finished
  });

  it('records a profile that cannot even launch as a config failure', async () => {
    const p = svc.create(input());
    svc.update(p.id, input({ env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: null }] }));
    const c = await health.test(p.id, 'auto');
    expect(c).toMatchObject({ status: 'failed', category: 'config' });
    expect(calls).toHaveLength(0);
    expect(failed()).toHaveLength(1);
  });

  it('announces a failure from an auto test but not from a manual one', async () => {
    const p = svc.create(input());
    next = async () => ({ category: 'auth', message: 'Invalid API key', ms: 300 });
    await health.test(p.id, 'manual');
    expect(failed()).toHaveLength(0);
    svc.recordCheck(p.id, { category: 'ok', source: 'manual', message: '', ms: 1 });
    await health.test(p.id, 'auto');
    expect(failed()).toEqual([{ profileId: p.id, name: 'CC', source: 'auto', message: 'Invalid API key' }]);
  });
});

describe('ProfileHealth.report', () => {
  it('lets the latest task answer win and announces only the flip to failed', () => {
    const p = svc.create(input());
    svc.recordCheck(p.id, { category: 'ok', source: 'auto', message: '', ms: 1000 });
    health.report(p.id, { category: 'billing', message: '402 Insufficient Balance' }, 'task:t1');
    expect(svc.checkOf(p.id)).toMatchObject({ status: 'failed', category: 'billing', source: 'task:t1', ms: null });
    expect(failed()).toEqual([{ profileId: p.id, name: 'CC', source: 'task:t1', message: '402 Insufficient Balance' }]);
    clock += 120_000;
    health.report(p.id, { category: 'auth', message: '401' }, 'task:t2');
    expect(svc.checkOf(p.id)?.category).toBe('auth');
    expect(failed()).toHaveLength(1); // already failed
    health.report(p.id, { category: 'ok', message: '' }, 'task:t2');
    expect(svc.checkOf(p.id)).toMatchObject({ status: 'ok', source: 'task:t2' });
  });

  it('does not rewrite a fresh ok or the same error again and again', () => {
    const p = svc.create(input());
    health.report(p.id, { category: 'ok', message: '' }, 'task:t1');
    const at = svc.checkOf(p.id)!.at;
    clock += 1000;
    health.report(p.id, { category: 'ok', message: '' }, 'task:t1');
    expect(svc.checkOf(p.id)!.at).toBe(at);
    clock += OK_REFRESH_MS;
    health.report(p.id, { category: 'ok', message: '' }, 'task:t1');
    expect(svc.checkOf(p.id)!.at).toBe(clock);

    health.report(p.id, { category: 'rate_limit', message: '429' }, 'task:t1');
    const errAt = svc.checkOf(p.id)!.at;
    clock += 5000;
    health.report(p.id, { category: 'rate_limit', message: '429' }, 'task:t1');
    expect(svc.checkOf(p.id)!.at).toBe(errAt);
  });

  it('ignores a profile that was deleted', () => {
    const p = svc.create(input());
    svc.delete(p.id);
    health.report(p.id, { category: 'auth', message: '401' }, 'task:t1');
    expect(changes).toHaveLength(0);
  });
});
