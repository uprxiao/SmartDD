import { join, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HtmlReferenceParser } from './parser';

describe('packaged HTML resource parser worker', () => {
  let directory: string, worker: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'willyou-html-parser-')); worker = join(directory, 'worker.cjs');
    // Use the same build tool dependency as electron-vite; this test must also
    // work before the application build, as in CI.
    const require = createRequire(import.meta.url), build = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    build.buildSync({ entryPoints: [resolve('src/main/core/files/html/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('runs the compiled parser away from main, handles parse errors, and rejects pending work on cancellation', async () => {
    const parser = new HtmlReferenceParser(worker);
    try {
      expect((await parser.parse('<link rel="stylesheet" href="x.css"><script type="module" src="a.js"></script>', 'html')).references).toEqual(['x.css', 'a.js']);
      await expect(parser.parse('a {', 'css')).rejects.toThrow();
      expect((await parser.parse('export {a} from "./b.js"', 'script')).references).toEqual(['./b.js']);
      const pending = parser.parse('<p>cancel</p>', 'html'); parser.close(); await expect(pending).rejects.toThrow('已取消');
      await expect(parser.parse('', 'html')).rejects.toThrow('已结束');
    } finally { parser.close(); }
  });
});
