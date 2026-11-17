import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listProjectFiles, rankFiles } from './file-search';

// M14-A52 @文件（服务层）。
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
describe('@文件查找', () => {
  it('非 Git 目录按受限遍历，跳过 node_modules 与 .git', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-fs-'))); dirs.push(root);
    for (const d of ['src/lib', 'node_modules/x', '.git']) mkdirSync(join(root, d), { recursive: true });
    for (const f of ['src/main.ts', 'src/lib/util.ts', 'node_modules/x/i.js', '.git/HEAD', 'README.md']) writeFileSync(join(root, f), '');
    expect((await listProjectFiles(root)).sort()).toEqual(['README.md', 'src/lib/util.ts', 'src/main.ts']);
  });
  it('文件名命中优先于路径中的子序列', () => {
    expect(rankFiles(['docs/main-notes.md', 'src/main.ts', 'src/maintain/x.ts'], 'main.ts')[0]).toBe('src/main.ts');
    expect(rankFiles(['a/util.ts', 'u/t/i/l.ts'], 'util')[0]).toBe('a/util.ts');
    expect(rankFiles(['a.ts', 'b.ts'], '')).toEqual(['a.ts', 'b.ts']);
  });
});
