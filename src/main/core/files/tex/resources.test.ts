import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileError } from '@shared/files';
import { TEX_LIMITS } from '@shared/file-tex';
import { FileHeavyJobs } from '../heavy-jobs';
import { texReferences } from './references';
import { TexParser } from './parser';
import { texSnapshot, type TexSource } from './resources';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const memory = (files: Record<string, string>, entry = 'main.tex'): TexSource => ({ path: entry, hash: digest(files[entry]), signal: new AbortController().signal, assert: () => {},
  stat: async (path) => { if (!(path in files)) throw new FileError('MISSING', path); return { size: Buffer.byteLength(files[path]), hash: digest(files[path]), device: '1', inode: '2', modifiedNs: '1', changedNs: '1' }; },
  read: async (path) => ({ bytes: Buffer.from(files[path]), hash: digest(files[path]) }),
});
const parse = async (source: string) => texReferences(source);
describe('bounded TeX dependency snapshot', () => {
  it('collects literal inputs, local packages, graphics paths, bibliographies and imported relative inputs; ignores comments and verbatim', async () => {
    const source = memory({ 'docs/main.tex': String.raw`\documentclass{article}
% \input{secret}
\usepackage{local,graphicx}\graphicspath{{images/}}\includegraphics[width=1cm]{pixel}\input{parts/中文.tex}\bibliography{refs}\import{sections/}{intro.tex}
\verb|\input{hidden}|\begin{verbatim}\input{also-hidden}\end{verbatim}`,
      'docs/local.sty': '\\RequirePackage{amsmath}', 'docs/images/pixel.png': 'png', 'docs/parts/中文.tex': '本地章节', 'docs/refs.bib': '@book{}', 'docs/sections/intro.tex': '\\input{child}', 'docs/sections/child.tex': 'imported',
    }, 'docs/main.tex');
    const result = await texSnapshot(source, parse, new AbortController().signal);
    expect(result.files.map((item) => item.path).sort()).toEqual(['docs/main.tex', 'docs/local.sty', 'docs/images/pixel.png', 'docs/parts/中文.tex', 'docs/refs.bib', 'docs/sections/intro.tex', 'docs/sections/child.tex'].sort());
    expect(result.warnings).toEqual([]); expect(result.bytes).toBeGreaterThan(100);
  });
  it('does not broaden scope for absolute, URL, escaping or dynamic filenames; missing packages remain compiler diagnostics', async () => {
    for (const path of ['/private/canary', '../outside', 'https://fixture.invalid/a']) await expect(texSnapshot(memory({ 'main.tex': `\\input{${path}}` }), parse, new AbortController().signal)).rejects.toThrow();
    const found = await texSnapshot(memory({ 'main.tex': String.raw`\input{\dynamic}\usepackage{notInOfflineBundle}\input{missing}` }), parse, new AbortController().signal);
    expect(found.files).toHaveLength(1); expect(found.warnings).toHaveLength(2);
    expect(texReferences(String.raw`\input simple.tex \include{nested}`).references.map((item) => item.names)).toEqual([['simple.tex'], ['nested']]);
  });
  it('retains source revision, rejects changed dependencies, cancels and enforces source/snapshot/reference budgets', async () => {
    const changed = memory({ 'main.tex': '\\input{part}', 'part.tex': 'initial' }); changed.read = async (path) => ({ bytes: Buffer.from(path === 'main.tex' ? '\\input{part}' : 'changed'), hash: digest(path === 'main.tex' ? '\\input{part}' : 'changed') });
    await expect(texSnapshot(changed, parse, new AbortController().signal)).rejects.toThrow('CHANGED');
    const tooBig = memory({ 'main.tex': 'x' }); tooBig.stat = async () => ({ size: TEX_LIMITS.sourceBytes + 1, hash: tooBig.hash, device: '1', inode: '2', modifiedNs: '1', changedNs: '1' });
    await expect(texSnapshot(tooBig, parse, new AbortController().signal)).rejects.toThrow('10 MiB');
    tooBig.stat = async () => ({ size: TEX_LIMITS.snapshotBytes + 1, hash: tooBig.hash, device: '1', inode: '2', modifiedNs: '1', changedNs: '1' });
    await expect(texSnapshot(tooBig, parse, new AbortController().signal)).rejects.toThrow('128 MiB');
    expect(() => texReferences('\\input{x}'.repeat(4097))).toThrow('预算');
    const abort = new AbortController(); abort.abort(); await expect(texSnapshot(memory({ 'main.tex': 'x' }), parse, abort.signal)).rejects.toThrow();
  });
  it('serializes heavy Office/TeX work and removes cancelled queued work without entering it', async () => {
    const queue = new FileHeavyJobs(), abort = new AbortController(), order: string[] = []; let finish!: () => void;
    const first = queue.run(new AbortController().signal, async () => { order.push('first'); await new Promise<void>((resolve) => { finish = resolve; }); return 1; });
    const second = queue.run(abort.signal, async () => { order.push('cancelled'); });
    const third = queue.run(new AbortController().signal, async () => { order.push('third'); return 3; });
    await Promise.resolve(); abort.abort(); await expect(second).rejects.toThrow('CANCELLED'); expect(order).toEqual(['first']); finish(); expect(await first).toBe(1); expect(await third).toBe(3); expect(order).toEqual(['first', 'third']);
  });
});

describe('real isolated TeX parser', () => {
  let directory: string, worker: string;
  beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'willyou-tex-parser-')); worker = join(directory, 'worker.cjs'); const require = createRequire(import.meta.url), build = createRequire(require.resolve('electron-vite/package.json'))('esbuild'); build.buildSync({ entryPoints: [resolve('src/main/core/files/tex/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } }); });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('parses with a real worker and terminates a pending parse on cancellation', async () => {
    const parser = new TexParser(worker), abort = new AbortController();
    try { expect((await parser.parse('\\input{中文.tex}', abort.signal)).references[0].names).toEqual(['中文.tex']); const pending = parser.parse('x'.repeat(TEX_LIMITS.sourceBytes), abort.signal); abort.abort(); await expect(pending).rejects.toThrow('CANCELLED'); await expect(parser.parse('', new AbortController().signal)).rejects.toThrow('CANCELLED'); } finally { parser.close(); }
  });
});
