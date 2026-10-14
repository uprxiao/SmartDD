import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseInput, ServerInput } from '@shared/projects';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore, type SecretCipher } from '../../secrets';
import { ProjectService } from './project-service';

/** Reversible stand-in for safeStorage; `available` toggles like a locked Keychain. */
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
let svc: ProjectService;
let cipherState: { available: boolean };
let tmp: string;
let clock = 1000;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const { cipher, state } = fakeCipher();
  cipherState = state;
  svc = new ProjectService(db, new SecretsStore(db, cipher), () => ++clock);
  tmp = mkdtempSync(join(tmpdir(), 'smartdd-proj-'));
});
afterEach(() => {
  sqlite.close();
  rmSync(tmp, { recursive: true, force: true });
});

const dir = (name: string) => {
  const p = join(tmp, name);
  mkdirSync(p, { recursive: true });
  return p;
};
const secretRows = () => sqlite.prepare('SELECT key, secret FROM app_secrets ORDER BY key').all() as { key: string; secret: string }[];

const dbInput = (over: Partial<DatabaseInput> = {}): DatabaseInput => ({
  env: 'dev',
  label: '开发库',
  aliases: ['devdb'],
  vendor: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  database: 'ais',
  schema: null,
  username: 'ais',
  accessLevel: 'readonly',
  isDefault: false,
  note: '',
  ...over,
});
const serverInput = (over: Partial<ServerInput> = {}): ServerInput => ({
  env: 'dev',
  label: '开发服务器',
  aliases: [],
  host: '10.0.0.1',
  port: 22,
  username: 'deploy',
  authType: 'password',
  privateKeyPath: null,
  defaultRoot: false,
  sudoPolicy: 'none',
  appRoot: null,
  logsPath: null,
  note: '',
  ...over,
});

describe('projects', () => {
  it('creates a project with directories; the first one is the default', () => {
    const p = svc.createProject({ name: ' AIS ', aliases: ['ais', ' ', 'ais'], description: '', rulesPath: '' }, [
      { label: '后端', path: dir('backend') },
      { label: '前端', path: dir('frontend') },
    ]);
    expect(p.name).toBe('AIS');
    expect(p.aliases).toEqual(['ais']);
    expect(p.rulesPath).toBeNull();
    expect(p.configVersion).toBe(1);
    expect(p.dirs.map((d) => [d.label, d.isDefault])).toEqual([
      ['后端', true],
      ['前端', false],
    ]);
    expect(svc.listProjects().map((x) => x.id)).toEqual([p.id]);
  });

  it('bumps config_version on every change, but not when a test result is recorded', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    svc.updateProject(p.id, { name: 'A', aliases: ['a'], description: 'x', rulesPath: null });
    const d = svc.addDir(p.id, { label: '', path: dir('a') });
    const db = svc.createDatabase(p.id, dbInput());
    svc.updateDatabase(db.id, dbInput({ password: 'p1' }));
    svc.setDefaultDir(d.id);
    expect(svc.getProject(p.id).configVersion).toBe(6);
    svc.recordDatabaseTest(db.id, { ok: false, category: 'auth', message: 'denied', ms: 5 });
    expect(svc.getProject(p.id).configVersion).toBe(6);
  });

  it('rejects a second active project with the same name (case-insensitive) but allows it once archived', () => {
    const p = svc.createProject({ name: 'AIS', aliases: [], description: '', rulesPath: null });
    expect(() => svc.createProject({ name: 'ais', aliases: [], description: '', rulesPath: null })).toThrow('已有同名项目');
    svc.setArchived(p.id, true);
    expect(() => svc.createProject({ name: 'ais', aliases: [], description: '', rulesPath: null })).not.toThrow();
    expect(() => svc.setArchived(p.id, false)).toThrow('已有同名项目');
  });

  it('validates input with a readable message', () => {
    expect(() => svc.createProject({ name: '  ', aliases: [], description: '', rulesPath: null })).toThrow(/^输入无效：name/);
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    expect(() => svc.addDir(p.id, { label: '', path: 'relative/path' })).toThrow('必须是绝对路径');
  });

  it('archives and lists archived projects only on request', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const archived = svc.setArchived(p.id, true);
    expect(archived.archivedAt).not.toBeNull();
    expect(svc.listProjects()).toEqual([]);
    expect(svc.listProjects({ includeArchived: true })).toHaveLength(1);
    expect(svc.setArchived(p.id, false).archivedAt).toBeNull();
  });
});

describe('directory ownership', () => {
  it('rejects a path already owned by another active project, including via a symlink', () => {
    const real = dir('code');
    const link = join(tmp, 'link');
    symlinkSync(real, link);
    svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [{ label: '', path: real }]);
    const b = svc.createProject({ name: 'B', aliases: [], description: '', rulesPath: null });
    expect(() => svc.addDir(b.id, { label: '', path: real })).toThrow('目录已属于项目「A」');
    expect(() => svc.addDir(b.id, { label: '', path: link })).toThrow('目录已属于项目「A」');
    expect(() => svc.addDir(b.id, { label: '', path: `${real}/` })).toThrow('目录已属于项目「A」');
  });

  it('rejects the same path twice in one project', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [{ label: '', path: dir('x') }]);
    expect(() => svc.addDir(p.id, { label: 'again', path: join(tmp, 'x') })).toThrow('该项目已登记此目录');
  });

  it('frees the path while the owner is archived and refuses to unarchive into a conflict', () => {
    const shared = dir('shared');
    const a = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [{ label: '', path: shared }]);
    svc.setArchived(a.id, true);
    svc.createProject({ name: 'B', aliases: [], description: '', rulesPath: null }, [{ label: '', path: shared }]);
    expect(() => svc.setArchived(a.id, false)).toThrow('目录已属于项目「B」');
    expect(svc.getProject(a.id).archivedAt).not.toBeNull();
  });

  it('rolls the whole project back when one of its directories is rejected', () => {
    const owned = dir('owned');
    svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [{ label: '', path: owned }]);
    expect(() =>
      svc.createProject({ name: 'B', aliases: [], description: '', rulesPath: null }, [
        { label: '', path: dir('fresh') },
        { label: '', path: owned },
      ])
    ).toThrow();
    expect(svc.listProjects().map((p) => p.name)).toEqual(['A']);
  });

  it('reports missing directories as unavailable and marks SVN working copies', () => {
    const wc = dir('wc');
    mkdirSync(join(wc, '.svn'));
    const sub = dir('wc/src');
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [
      { label: 'missing', path: join(tmp, 'nope') },
      { label: 'svn', path: sub },
    ]);
    const [missing, svn] = p.dirs;
    expect(missing.status).toMatchObject({ exists: false, available: false });
    expect(svn.status).toMatchObject({ exists: true, readable: true, writable: true, vcs: 'svn', available: true });
  });

  it('keeps one default directory when the default is removed', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [
      { label: '1', path: dir('1') },
      { label: '2', path: dir('2') },
    ]);
    svc.removeDir(p.dirs[0].id);
    expect(svc.getProject(p.id).dirs.map((d) => [d.label, d.isDefault])).toEqual([['2', true]]);
  });
});

describe('secrets', () => {
  it('stores only ciphertext and never returns the password in a view', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const view = svc.createDatabase(p.id, dbInput({ password: 'S3cret-pw' }));
    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain('S3cret-pw');
    expect(JSON.stringify(svc.getProject(p.id))).not.toContain('S3cret-pw');
    const rows = secretRows();
    expect(rows.map((r) => r.key)).toEqual([`db:${view.id}:password`]);
    expect(rows[0].secret).not.toContain('S3cret-pw');
    expect(Buffer.from(rows[0].secret, 'base64').toString()).not.toContain('S3cret-pw');
  });

  it('keeps the password when the field is omitted, clears on null or empty, replaces on a value', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const { id } = svc.createDatabase(p.id, dbInput({ password: 'one' }));
    svc.updateDatabase(id, dbInput());
    expect(svc.databaseTarget(dbInput(), id).password).toBe('one');
    svc.updateDatabase(id, dbInput({ password: 'two' }));
    expect(svc.databaseTarget(dbInput(), id).password).toBe('two');
    expect(svc.updateDatabase(id, dbInput({ password: null })).hasPassword).toBe(false);
    svc.updateDatabase(id, dbInput({ password: 'three' }));
    expect(svc.updateDatabase(id, dbInput({ password: '' })).hasPassword).toBe(false);
    expect(secretRows()).toEqual([]);
  });

  it('tests a draft with the typed password, falling back to the saved one', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const { id } = svc.createDatabase(p.id, dbInput({ password: 'saved' }));
    expect(svc.databaseTarget(dbInput({ password: 'typed' }), id).password).toBe('typed');
    expect(svc.databaseTarget(dbInput(), id).password).toBe('saved');
    expect(svc.databaseTarget(dbInput()).password).toBe('');
  });

  it('refuses to save when safeStorage is unavailable and leaves no half-written row', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    cipherState.available = false;
    expect(() => svc.createDatabase(p.id, dbInput({ password: 'x' }))).toThrow('拒绝以明文保存密钥');
    expect(svc.getProject(p.id).databases).toEqual([]);
    expect(svc.getProject(p.id).configVersion).toBe(1);
    expect(secretRows()).toEqual([]);
  });

  it('deletes a database with or without its secret, as the user chose', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const a = svc.createDatabase(p.id, dbInput({ password: 'a' }));
    const b = svc.createDatabase(p.id, dbInput({ password: 'b' }));
    svc.deleteDatabase(a.id, { deleteSecrets: true });
    svc.deleteDatabase(b.id, { deleteSecrets: false });
    expect(svc.getProject(p.id).databases).toEqual([]);
    expect(secretRows().map((r) => r.key)).toEqual([`db:${b.id}:password`]);
  });

  it('deleting a project removes its resources and, if asked, all of their secrets', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null }, [{ label: '', path: dir('a') }]);
    svc.createDatabase(p.id, dbInput({ password: 'a' }));
    svc.createServer(p.id, serverInput({ password: 'b', sudoPolicy: 'separate', sudoPassword: 'c' }));
    const keep = svc.createProject({ name: 'B', aliases: [], description: '', rulesPath: null });
    const kept = svc.createDatabase(keep.id, dbInput({ password: 'k' }));
    svc.deleteProject(p.id, { deleteSecrets: true });
    expect(svc.listProjects({ includeArchived: true }).map((x) => x.name)).toEqual(['B']);
    for (const t of ['project_dirs', 'project_databases', 'project_servers']) {
      expect((sqlite.prepare(`SELECT COUNT(*) n FROM ${t} WHERE project_id = ?`).get(p.id) as { n: number }).n).toBe(0);
    }
    expect(secretRows().map((r) => r.key)).toEqual([`db:${kept.id}:password`]);
  });
});

describe('databases and servers', () => {
  it('allows only one default database per project', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const a = svc.createDatabase(p.id, dbInput({ isDefault: true }));
    const b = svc.createDatabase(p.id, dbInput({ isDefault: true, env: 'test' }));
    const other = svc.createProject({ name: 'B', aliases: [], description: '', rulesPath: null });
    const c = svc.createDatabase(other.id, dbInput({ isDefault: true }));
    const flags = Object.fromEntries(
      [...svc.getProject(p.id).databases, ...svc.getProject(other.id).databases].map((d) => [d.id, d.isDefault])
    );
    expect(flags).toEqual({ [a.id]: false, [b.id]: true, [c.id]: true });
  });

  it('records the last test result on the card', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    const d = svc.createDatabase(p.id, dbInput());
    expect(d.lastTest).toBeNull();
    const after = svc.recordDatabaseTest(d.id, { ok: false, category: 'network', message: 'connect ECONNREFUSED', ms: 3 });
    expect(after.lastTest).toMatchObject({ ok: false, category: 'network', message: 'connect ECONNREFUSED', ms: 3 });
    const ok = svc.recordDatabaseTest(d.id, { ok: true, category: 'ok', message: '', ms: 9, detail: 'MySQL 8.0' });
    expect(ok.lastTest).toMatchObject({ ok: true, category: 'ok', message: 'MySQL 8.0' });
  });

  it('requires a private key path for key authentication and keeps three separate server secrets', () => {
    const p = svc.createProject({ name: 'A', aliases: [], description: '', rulesPath: null });
    expect(() => svc.createServer(p.id, serverInput({ authType: 'key' }))).toThrow('密钥认证需要填写私钥路径');
    const s = svc.createServer(
      p.id,
      serverInput({ authType: 'key', privateKeyPath: '/k', password: 'pw', passphrase: 'pp', sudoPolicy: 'separate', sudoPassword: 'sp' })
    );
    expect(s).toMatchObject({ hasPassword: true, hasPassphrase: true, hasSudoPassword: true });
    expect(svc.serverTarget(serverInput({ authType: 'key', privateKeyPath: '/k' }), s.id)).toMatchObject({ password: 'pw', passphrase: 'pp' });
    svc.deleteServer(s.id, { deleteSecrets: true });
    expect(secretRows()).toEqual([]);
  });
});
