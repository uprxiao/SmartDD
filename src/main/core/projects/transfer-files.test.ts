import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDbClient, type DbClient } from '../../db/client';
import { runBundledMigrations } from '../../db/migrations';
import { atomicWrite, ImportedKeyFiles, readLimited } from './transfer-files';

let root: string, client: DbClient, keys: ImportedKeyFiles;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'willyou-m8-files-'));
  client = openDbClient(join(root, 'test.db')); runBundledMigrations(client.sqlite);
  keys = new ImportedKeyFiles(client.db, join(root, 'receiver')); keys.recover();
});
afterEach(() => { client.close(); rmSync(root, { recursive: true, force: true }); });

describe('M8 owned files and atomic ciphertext', () => {
  it('S06 never accepts caller-supplied paths as managed key identities', () => {
    for (const value of ['../outside', '/tmp/key', '', 'arbitrary']) expect(() => keys.path(value)).toThrow();
  });
  it('S06 preserves a pre-existing directory when exclusive key creation fails', () => {
    const request = randomUUID(), id = randomUUID(), dir = dirname(keys.path(id));
    mkdirSync(dir); writeFileSync(join(dir, 'key'), 'pre-existing-key');
    keys.begin(request, [id]); expect(() => keys.write(request, id, Buffer.from('new-key'))).toThrow();
    keys.rollback(request, [id]); expect(readFileSync(join(dir, 'key'), 'utf8')).toBe('pre-existing-key');
  });
  it('S06 refuses a symlink destination and leaves the external target intact', () => {
    const external = join(root, 'external'), request = randomUUID(), id = randomUUID();
    mkdirSync(external); writeFileSync(join(external, 'key'), 'external-key');
    keys.begin(request, [id]); symlinkSync(external, dirname(keys.path(id)));
    expect(() => keys.write(request, id, Buffer.from('new-key'))).toThrow(); keys.rollback(request, [id]);
    expect(readFileSync(join(external, 'key'), 'utf8')).toBe('external-key');
  });
  it('S06 rechecks the root before recovery/cleanup and never follows a replaced root', () => {
    const outside = join(root, 'outside'), moved = join(root, 'old-owned'); mkdirSync(outside);
    const request = randomUUID(), id = randomUUID(); keys.begin(request, [id]); keys.write(request, id, Buffer.from('owned-key'));
    renameSync(keys.root, moved); symlinkSync(outside, keys.root);
    expect(() => keys.rollback(request, [id])).toThrow('目录不可用'); expect(() => keys.cleanup()).toThrow('目录不可用');
    expect(readdirSync(outside)).toEqual([]); expect(readFileSync(join(moved, id, 'key'), 'utf8')).toBe('owned-key');
  });
  it('S02/F03 restores strict modes and recovers only a matching owned operation', () => {
    chmodSync(keys.root, 0o755); const request = randomUUID(), id = randomUUID(); keys.begin(request, [id]); keys.write(request, id, Buffer.from('key'));
    expect(statSync(keys.root).mode & 0o777).toBe(0o700); expect(statSync(keys.path(id)).mode & 0o777).toBe(0o600);
    keys.rollback(randomUUID(), [id]); expect(existsSync(keys.path(id))).toBe(true);
    keys.recover(); expect(existsSync(keys.path(id))).toBe(false);
  });
  it('I05/S06 bounded reads reject symlinks, directories and oversized files', () => {
    const path = join(root, 'data'), link = join(root, 'link'); writeFileSync(path, '123456'); symlinkSync(path, link);
    expect(() => readLimited(path, 5)).toThrow('大小'); expect(() => readLimited(root)).toThrow('普通文件'); expect(() => readLimited(link)).toThrow('读取');
    expect(readLimited(path, 6).toString()).toBe('123456');
  });
  it('E06/F02 failed rename leaves prior bytes and no intermediate file, then permits retry', () => {
    const target = join(root, 'target'); mkdirSync(target); writeFileSync(join(target, 'keep'), 'prior');
    expect(() => atomicWrite(target, Buffer.from('encrypted'))).toThrow();
    expect(readFileSync(join(target, 'keep'), 'utf8')).toBe('prior'); expect(readdirSync(root).some(n => n.endsWith('.tmp'))).toBe(false);
    const success = join(root, 'success.willyou'); atomicWrite(success, Buffer.from('ciphertext')); expect(readFileSync(success, 'utf8')).toBe('ciphertext');
  });
});
