import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiProfileInput } from '@shared/ai-profiles';
import { splitArgs, joinArgs } from '@shared/ai-profiles';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore, type SecretCipher } from '../../secrets';
import { AiProfileService } from './ai-profile-service';

function fakeCipher() {
  const state = { available: true };
  const cipher: SecretCipher = {
    isAvailable: () => state.available,
    encrypt: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
    decrypt: (buf) => [...buf.toString().slice(4)].reverse().join(''),
  };
  return { cipher, state };
}

let sqlite: Database.Database;
let svc: AiProfileService;
let cipherState: { available: boolean };
let clock = 1000;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const { cipher, state } = fakeCipher();
  cipherState = state;
  svc = new AiProfileService(db, new SecretsStore(db, cipher), () => ++clock);
});
afterEach(() => sqlite.close());

const input = (over: Partial<AiProfileInput> = {}): AiProfileInput => ({
  name: 'CC-DS',
  runner: 'claude',
  executable: null,
  env: [
    { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://ds.invalid' },
    { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'tok-ds-123' },
  ],
  args: [],
  color: '#3b82f6',
  isDefault: false,
  ...over,
});

const secretRows = () => sqlite.prepare('SELECT key, secret FROM app_secrets ORDER BY key').all() as { key: string; secret: string }[];

describe('AiProfileService', () => {
  it('stores secret values encrypted and never returns them in views', () => {
    const p = svc.create(input());
    expect(p.env).toEqual([
      { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://ds.invalid', hasValue: true },
      { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: null, hasValue: true },
    ]);
    expect(JSON.stringify(svc.list())).not.toContain('tok-ds-123');
    const raw = JSON.stringify(sqlite.prepare('SELECT * FROM ai_profiles').all()) + JSON.stringify(secretRows());
    expect(raw).not.toContain('tok-ds-123');
    expect(secretRows().map((r) => r.key)).toEqual([`ai:${p.id}:env:ANTHROPIC_AUTH_TOKEN`]);
  });

  it('resolves plaintext values for a launch, with the runner command and isolation prefixes', () => {
    const p = svc.create(input({ args: ['--model', 'x y'] }));
    expect(svc.resolve(p.id)).toEqual({
      id: p.id,
      name: 'CC-DS',
      runner: 'claude',
      command: 'claude',
      args: ['--model', 'x y'],
      env: { ANTHROPIC_BASE_URL: 'https://ds.invalid', ANTHROPIC_AUTH_TOKEN: 'tok-ds-123' },
      isolatePrefixes: ['ANTHROPIC_'],
    });
    const codex = svc.create(input({ name: 'Codex', runner: 'codex', env: [], executable: '/opt/bin/codex' }));
    expect(svc.resolve(codex.id)).toMatchObject({ command: '/opt/bin/codex', isolatePrefixes: [] });
  });

  it('refuses to launch when a token is missing instead of falling back', () => {
    const p = svc.create(input({ env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true }] }));
    expect(p.env[0].hasValue).toBe(false);
    expect(() => svc.resolve(p.id)).toThrow('缺少令牌：ANTHROPIC_AUTH_TOKEN');
  });

  it('keeps, replaces and clears secrets on update; drops secrets of removed variables', () => {
    const p = svc.create(input());
    const key = `ai:${p.id}:env:ANTHROPIC_AUTH_TOKEN`;
    const kept = secretRows()[0].secret;
    svc.update(p.id, input({ env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true }] }));
    expect(secretRows()).toEqual([{ key, secret: kept }]);
    svc.update(p.id, input({ env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'new' }] }));
    expect(svc.resolve(p.id).env.ANTHROPIC_AUTH_TOKEN).toBe('new');
    svc.update(p.id, input({ env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: null }] }));
    expect(secretRows()).toEqual([]);
    svc.update(p.id, input());
    svc.update(p.id, input({ env: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: 'k' }] }));
    expect(secretRows().map((r) => r.key)).toEqual([`ai:${p.id}:env:ANTHROPIC_API_KEY`]);
    // Turning a secret into a plain variable removes the encrypted copy.
    svc.update(p.id, input({ env: [{ name: 'ANTHROPIC_API_KEY', secret: false, value: 'plain' }] }));
    expect(secretRows()).toEqual([]);
  });

  it('refuses to save secrets when safeStorage is unavailable and leaves nothing behind', () => {
    cipherState.available = false;
    expect(() => svc.create(input())).toThrow('系统安全存储不可用');
    expect(svc.list()).toEqual([]);
    expect(secretRows()).toEqual([]);
  });

  it('keeps exactly one default: the first profile, then whichever is chosen, then the next oldest', () => {
    const a = svc.create(input({ name: 'A' }));
    const b = svc.create(input({ name: 'B' }));
    expect(svc.defaultProfileId()).toBe(a.id);
    svc.setDefault(b.id);
    expect(svc.list().map((p) => p.isDefault)).toEqual([false, true]);
    const c = svc.create(input({ name: 'C', isDefault: true }));
    expect(svc.defaultProfileId()).toBe(c.id);
    svc.delete(c.id);
    expect(svc.defaultProfileId()).toBe(a.id);
  });

  it('deletes the profile with its secrets; names are unique regardless of case', () => {
    const p = svc.create(input());
    expect(() => svc.create(input({ name: 'cc-ds' }))).toThrow('已存在名为「cc-ds」的 AI 配置');
    svc.delete(p.id);
    expect(svc.list()).toEqual([]);
    expect(secretRows()).toEqual([]);
  });

  it('explains invalid input in Chinese', () => {
    expect(() => svc.create(input({ name: ' ' }))).toThrow('输入无效：配置名称不能为空');
    expect(() => svc.create(input({ env: [{ name: '1BAD', secret: false, value: '' }] }))).toThrow(
      '输入无效：环境变量：变量名只能包含字母'
    );
    expect(() =>
      svc.create(input({ env: [{ name: 'A', secret: false, value: '' }, { name: 'A', secret: false, value: '' }] }))
    ).toThrow('变量 A 重复');
    expect(() => svc.create(input({ executable: 'claude; rm -rf /' }))).toThrow('输入无效：可执行文件：只能是命令名或路径');
  });

  it('imports .zshrc accounts with a masked preview and skips existing names', () => {
    const text = `claude_with_account() {\n case $1 in\n  ds) export ANTHROPIC_BASE_URL=https://ds.invalid; export ANTHROPIC_AUTH_TOKEN="sk-abcdefghijklmnopqrstu";;\n  w) export ANTHROPIC_AUTH_TOKEN=tok;;\n esac\n}\n`;
    svc.create(input({ name: 'CC-w' }));
    const preview = svc.previewZshrc(text);
    expect(JSON.stringify(preview)).not.toContain('sk-abc');
    expect(preview.candidates.map((c) => [c.suggestedName, c.exists])).toEqual([
      ['CC-ds', false],
      ['CC-w', true],
    ]);
    const r = svc.importZshrc(text, ['ds', 'w', 'gone']);
    expect(r.created.map((p) => p.name)).toEqual(['CC-ds']);
    expect(r.skipped).toEqual(['CC-w（已存在）', 'gone（文件中已找不到该账号）']);
    expect(svc.resolve(r.created[0].id).env).toEqual({
      ANTHROPIC_BASE_URL: 'https://ds.invalid',
      ANTHROPIC_AUTH_TOKEN: 'sk-abcdefghijklmnopqrstu',
    });
  });
});

describe('splitArgs / joinArgs', () => {
  it('splits like a shell without expansion', () => {
    expect(splitArgs(`--model "a b" --x='c d' e\\ f $HOME`)).toEqual(['--model', 'a b', '--x=c d', 'e f', '$HOME']);
    expect(splitArgs('  ')).toEqual([]);
    expect(splitArgs(`""`)).toEqual(['']);
    expect(() => splitArgs('"open')).toThrow('引号没有闭合');
  });

  it('round-trips', () => {
    const args = ['--model', 'a b', "it's", '', '--flag=1'];
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});
