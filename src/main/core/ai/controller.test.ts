import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiProfileInput } from '@shared/ai-profiles';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore, type SecretCipher } from '../../secrets';
import { AiProfileService } from './ai-profile-service';
import { createAiProfileController } from './controller';
import type { ProfileHealth } from './profile-health';

const cipher: SecretCipher = { isAvailable: () => true, encrypt: (p) => Buffer.from(p), decrypt: (b) => b.toString() };

let sqlite: Database.Database;
let dir: string;
let tested: [string, string][];
let ctl: ReturnType<typeof createAiProfileController>['aiProfiles'];

beforeEach(() => {
  sqlite = new Database(':memory:');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const svc = new AiProfileService(db, new SecretsStore(db, cipher));
  dir = mkdtempSync(join(tmpdir(), 'smartdd-ctl-'));
  tested = [];
  // Only the wiring is under test here: which calls start a background test.
  const health = {
    testInBackground: (id: string, source: string) => void tested.push([id, source]),
    test: async (id: string, source: string) => (tested.push([id, source]), null),
    withChecking: (v: { id: string }) => ({ ...v, checking: tested.some(([id]) => id === v.id) }),
  } as unknown as ProfileHealth;
  ctl = createAiProfileController(svc, health, () => ({})).aiProfiles;
});
afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const input = (over: Partial<AiProfileInput> = {}): AiProfileInput => ({
  name: 'CC',
  runner: 'claude',
  executable: null,
  env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'tok' }],
  args: [],
  color: null,
  isDefault: false,
  ...over,
});

describe('aiProfiles controller', () => {
  it('tests after create and after an edit of how the CLI starts, not after a rename', () => {
    const p = ctl.create(input());
    expect(tested).toEqual([[p.id, 'auto']]);
    expect(p.checking).toBe(true);
    ctl.update(p.id, input({ name: 'renamed', color: '#ef4444', env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true }] }));
    expect(tested).toHaveLength(1);
    ctl.update(p.id, input({ name: 'renamed', args: ['--model', 'x'], env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true }] }));
    expect(tested).toEqual([[p.id, 'auto'], [p.id, 'auto']]);
  });

  it('tests every imported profile; the manual test is its own source', async () => {
    const rc = join(dir, 'zshrc');
    writeFileSync(rc, 'claude_with_account() {\n case $1 in\n  a) export ANTHROPIC_AUTH_TOKEN=ta;;\n  b) export ANTHROPIC_AUTH_TOKEN=tb;;\n esac\n}\n');
    const r = await ctl.importZshrc(rc, ['a', 'b']);
    expect(tested).toEqual(r.created.map((p) => [p.id, 'auto']));
    expect(r.created.every((p) => p.checking)).toBe(true);
    await ctl.test(r.created[0].id);
    expect(tested[2]).toEqual([r.created[0].id, 'manual']);
  });

  it('never tests on its own: listing does not start anything', () => {
    ctl.list();
    expect(tested).toEqual([]);
  });
});
