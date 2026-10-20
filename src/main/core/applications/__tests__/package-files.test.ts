import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateBundle } from '../manifest';
import { ensureStoreDirectory, verifyPackageTree, writePackageTree } from '../package-files';
import { fixtureBundle } from './fixtures';
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'willyou-m10-package-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
describe('private immutable application trees', () => {
  it('materializes and verifies complete resources without modifying bundle inputs', () => {
    const bundle = validateBundle(fixtureBundle()), dir = join(root, 'staging');
    writePackageTree(dir, bundle, 'store'); verifyPackageTree(dir, bundle, 'store');
    expect(readFileSync(join(dir, 'adapter/index.cjs'))).toEqual(bundle.files['adapter/index.cjs']);
    expect(() => writePackageTree(dir, bundle, 'store')).toThrow(/已存在/);
  });
  it('detects an altered resource, extra file and changed execute permission', () => {
    const bundle = validateBundle(fixtureBundle());
    for (const variant of ['bytes', 'extra', 'mode']) {
      const dir = join(root, variant); writePackageTree(dir, bundle, 'store');
      if (variant === 'bytes') writeFileSync(join(dir, 'adapter/index.cjs'), 'changed');
      if (variant === 'extra') writeFileSync(join(dir, 'extra.cjs'), 'extra');
      if (variant === 'mode') chmodSync(join(dir, 'adapter/index.cjs'), 0o700);
      expect(() => verifyPackageTree(dir, bundle, 'store')).toThrow(/摘要|集合|权限/);
    }
  });
  it('preserves a foreign owner and rejects directory or file symlinks', () => {
    const bundle = validateBundle(fixtureBundle()), dir = join(root, 'owned'); writePackageTree(dir, bundle, 'other-store');
    expect(() => verifyPackageTree(dir, bundle, 'store')).toThrow(/归属/);
    const out = ensureStoreDirectory(root, 'external'); writeFileSync(join(out, 'keep'), 'keep');
    symlinkSync(out, join(root, 'link')); expect(() => ensureStoreDirectory(root, 'link/child')).toThrow(/链接/); expect(existsSync(join(out, 'child'))).toBe(false);
    const own = join(root, 'own'); writePackageTree(own, bundle, 'store'); rmSync(join(own, 'adapter/index.cjs')); symlinkSync(join(out, 'keep'), join(own, 'adapter/index.cjs'));
    expect(() => verifyPackageTree(own, bundle, 'store')).toThrow(/链接/); expect(readFileSync(join(out, 'keep'), 'utf8')).toBe('keep');
  });
});
