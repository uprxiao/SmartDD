import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureStoreDirectory } from '../package-files';
import { withResourceLock } from '../resource-lock';
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'willyou-m10-lock-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
describe('resource coordinator ownership and bounded waits', () => {
  it('releases its own lock on success and on a failed transaction', async () => {
    expect(await withResourceLock(root, () => 42)).toBe(42);
    await expect(withResourceLock(root, () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(existsSync(join(root, 'locks/resource.lock'))).toBe(false);
  });
  it('times out without stealing another owner lock even if its timestamp is old', async () => {
    const dir = ensureStoreDirectory(root, 'locks/resource.lock'); const owner = { token: 'other', pid: 1, at: 0 }; writeFileSync(join(dir, 'owner.json'), JSON.stringify(owner));
    await expect(withResourceLock(root, () => 'never', { timeoutMs: 25 })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    expect(JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))).toEqual(owner);
  });
  it('preserves incomplete ownership for recovery and respects cancellation', async () => {
    ensureStoreDirectory(root, 'locks/resource.lock');
    await expect(withResourceLock(root, () => 'never', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' });
    const c = new AbortController(); c.abort(); await expect(withResourceLock(root, () => 'never', { signal: c.signal })).rejects.toMatchObject({ code: 'CANCELED' });
    expect(existsSync(join(root, 'locks/resource.lock'))).toBe(true);
  });
  it('does not remove a lock whose owner changed before release', async () => {
    await expect(withResourceLock(root, () => { writeFileSync(join(root, 'locks/resource.lock/owner.json'), JSON.stringify({ token: 'replacement', pid: process.pid })); })).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' });
    expect(JSON.parse(readFileSync(join(root, 'locks/resource.lock/owner.json'), 'utf8')).token).toBe('replacement');
  });
  it('keeps its gate after a reboot changes the volume device number, but not after an inode change', async () => {
    expect(await withResourceLock(root, () => 1)).toBe(1);
    const gate = new Database(join(root, 'locks/.resource.lock.gate.sqlite'));
    const rewrite = (change: (value: { root: { dev: number; ino: number }; gate: { dev: number; ino: number } }) => void) => { const value = JSON.parse((gate.prepare('SELECT identity FROM coordinator_identity').get() as { identity: string }).identity); change(value); gate.prepare('UPDATE coordinator_identity SET identity=?').run(JSON.stringify(value)); };
    rewrite(value => { value.root.dev += 3; value.gate.dev += 3; });
    expect(await withResourceLock(root, () => 2)).toBe(2);
    rewrite(value => { value.gate.ino += 1; });
    gate.close();
    await expect(withResourceLock(root, () => 3)).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' });
  });
});
