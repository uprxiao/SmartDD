import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
let build: string, native: string, root: string, writer: Database.Database | undefined;
const schema = 'CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER)';
const insert = (db: Database.Database, id: number) => db.prepare("INSERT INTO mailinfo VALUES(?, 'synthetic fixture', 'sender@example.test', 'to@example.test', '<fixture@example.test>', 1792454400, 1792454400, 1, 0)").run(id);
const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).sort().map(name => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]));
const run = (path: string) => JSON.parse(execFileSync(native, [path], { maxBuffer: 32 * 1024 * 1024 }).toString());
describe.skipIf(process.platform !== 'darwin')('native Foxmail metadata reader source-write boundary', () => {
  beforeAll(() => { build = mkdtempSync(join(tmpdir(), 'willyou-m10-reader-build-')); native = join(build, 'foxmail'); execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O2', '-mmacosx-version-min=12.0', '-framework', 'Foundation', '-lsqlite3', resolve('native/applications/foxmail.mm'), '-o', native]); });
  afterAll(() => rmSync(build, { recursive: true, force: true }));
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'willyou-m10-reader-source-')); });
  afterEach(() => { writer?.close(); writer = undefined; rmSync(root, { recursive: true, force: true }); });
  it('reads a rollback-mode source without changing source files or creating journals', () => {
    const path = join(root, 'messages.db'), db = new Database(path); db.exec(schema); insert(db, 1); db.close(); const before = snapshot(root);
    const result = run(path); expect(result.rows).toHaveLength(1); expect(result.rows[0].id).toBe('1'); expect(result.databaseIdentity).toMatch(/^\d+:/); expect(snapshot(root)).toEqual(before);
  });
  it('includes committed WAL rows and does not change the live source WAL or SHM', () => {
    const path = join(root, 'messages.db'); writer = new Database(path); writer.exec(schema); insert(writer, 1); writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0'); insert(writer, 2);
    const before = snapshot(root), result = run(path);
    expect(result.error).toBeUndefined(); expect(result.rows.map((r: { id: string }) => r.id)).toEqual(['1', '2']); expect(snapshot(root)).toEqual(before);
  });
  it('reads an isolated committed WAL image without creating an SHM file', () => {
    const path = join(root, 'messages.db'); writer = new Database(path); writer.exec(schema); writer.pragma('journal_mode=WAL'); insert(writer, 3);
    const copy = mkdtempSync(join(tmpdir(), 'willyou-m10-wal-image-'));
    try { copyFileSync(path, join(copy, 'messages.db')); copyFileSync(path + '-wal', join(copy, 'messages.db-wal')); const before = snapshot(copy); expect(run(join(copy, 'messages.db')).rows[0].id).toBe('3'); expect(snapshot(copy)).toEqual(before); }
    finally { rmSync(copy, { recursive: true, force: true }); }
  });
  it('rejects missing, unsupported and symbolic-link databases with a controlled diagnostic', () => {
    expect(run(join(root, 'messages.db'))).toMatchObject({ error: { code: 'SOURCE_UNAVAILABLE' } });
    const db = new Database(join(root, 'wrong.db')); db.exec('CREATE TABLE unrelated(id)'); db.close(); symlinkSync(join(root, 'wrong.db'), join(root, 'messages.db'));
    expect(run(join(root, 'messages.db'))).toMatchObject({ error: { code: 'SOURCE_UNAVAILABLE' } }); rmSync(join(root, 'messages.db')); copyFileSync(join(root, 'wrong.db'), join(root, 'messages.db'));
    expect(run(join(root, 'messages.db'))).toMatchObject({ error: { code: 'UNSUPPORTED_FORMAT' } });
  });
});
