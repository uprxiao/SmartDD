import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OfficeParser } from './parser';

describe('real isolated Office Worker', () => {
  let directory: string, worker: string, bytes: Buffer, hash: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'willyou-office-parser-')); worker = join(directory, 'office.cjs');
    const require = createRequire(import.meta.url), build = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    build.buildSync({ entryPoints: [resolve('src/main/core/files/office/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
    bytes = readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'); hash = createHash('sha256').update(bytes).digest('hex');
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('parses actual input, returns only requested cells and handles validation without killing subsequent reads', async () => {
    const parser = new OfficeParser(worker), signal = new AbortController().signal;
    try {
      expect((await parser.open(bytes, hash, signal)).sheets).toHaveLength(3);
      expect((await parser.window('1', 1, 1, 2, 1, signal)).cells.map((cell) => cell.value)).toEqual(['3', '4']);
      expect((await parser.cell('2', 1, 1, 0, 100, signal)).text).toBe('=Data!$B$2+Data!B3');
      await expect(parser.window('1', 0, 0, 101, 1, signal)).rejects.toThrow();
      expect((await parser.cell('1', 0, 0, 0, 100, signal)).text).toBe('Label');
      await expect(parser.open(bytes, hash, signal)).rejects.toThrow('已打开');
    } finally { parser.close(); }
  });
  it('refuses mismatched source hash and cancels a pending open without late resurrection', async () => {
    const bad = new OfficeParser(worker), active = new OfficeParser(worker), abort = new AbortController();
    try {
      await expect(bad.open(bytes, '0'.repeat(64), abort.signal)).rejects.toThrow('基线');
      const request = active.open(bytes, hash, abort.signal); abort.abort(); await expect(request).rejects.toThrow('取消');
      await expect(active.cell('1', 0, 0, 0, 10, new AbortController().signal)).rejects.toThrow('取消');
    } finally { bad.close(); active.close(); }
  });
  it('terminates a hanging worker and rejects all outstanding callers on deadline or process failure', async () => {
    const hungPath = join(directory, 'hung.cjs'), brokenPath = join(directory, 'broken.cjs');
    writeFileSync(hungPath, 'while(true) {}'); writeFileSync(brokenPath, 'throw new Error("synthetic worker failure")');
    const hung = new OfficeParser(hungPath, 150), broken = new OfficeParser(brokenPath), signal = new AbortController().signal;
    try {
      const open = hung.open(bytes, hash, signal), cell = hung.cell('1', 0, 0, 0, 10, signal);
      const results = await Promise.allSettled([open, cell]); expect(results.every((result) => result.status === 'rejected' && /超过/.test(result.reason.message))).toBe(true);
      await expect(broken.open(bytes, hash, signal)).rejects.toThrow('解析器已退出');
    } finally { hung.close(); broken.close(); }
  });
});
