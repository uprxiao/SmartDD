import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExternalMetadataImport } from './module-metadata-imports.mjs';

test('keeps Windows drive and UNC module source paths in the metadata bundle', () => {
  for (const id of [
    'D:\\a\\SmartDD\\SmartDD\\src\\main\\core\\applications\\modules\\index.ts',
    'D:/a/SmartDD/SmartDD/src/main/core/applications/modules/index.ts',
    'C:\\项目 空格\\src\\main\\index.ts',
    '\\\\server\\share\\project\\src\\main\\index.ts',
    '//server/share/project/src/main/index.ts',
  ]) assert.equal(isExternalMetadataImport(id), false, id);
});

test('keeps POSIX source paths, relative imports and project aliases in the bundle', () => {
  for (const id of [
    '/tmp/project/src/main/index.ts', './module.ts', '../module.ts',
    '.\\module.ts', '@shared/applications', '@main/core/applications', '@root/package.json',
  ]) assert.equal(isExternalMetadataImport(id), false, id);
});

test('continues externalizing Node builtins and third-party packages', () => {
  for (const id of ['node:fs', 'fs', 'path', 'fs/promises', 'zod', 'nodemailer', '@scope/package', 'zod/validation'])
    assert.equal(isExternalMetadataImport(id), true, id);
});
