import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { NativeFileBroker, type RootDescriptor } from '../native-broker';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { FileService } from '../file-service';
import { texSnapshot } from './resources';
import { texReferences } from './references';
import { texEngineResources } from './engine-resources';
import type { TexNativeResult } from './service';
import { TexWorkspaces, type TexCleanupReport } from './workspaces';

const engineDirectory = resolve('out/native/tex');
const enabled = process.platform === 'darwin' && process.env.SMARTDD_M9_TEX_NATIVE === '1';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const descriptor = (path: string): RootDescriptor => { const value = statSync(path, { bigint: true }); return { path: realpathSync(path), identity: { device: String(value.dev), inode: String(value.ino) } }; };
// Explicit opt-in: requires the pinned offline resources and the ability to run
// macOS Seatbelt. A skipped run is not native/packaged acceptance evidence.
describe.skipIf(!enabled)('real offline TeX compilation through the production file service', () => {
  let build: string, worker: string, fixture: string, project: string, userData: string, broker: NativeFileBroker, service: FileService;
  beforeAll(() => {
    expect(existsSync(join(engineDirectory, 'resources.json'))).toBe(true);
    build = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-tex-native-build-'))); worker = join(build, 'tex-worker.cjs');
    const executable = join(build, 'willyou-files-test');
    execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O1', '-Wno-deprecated-declarations', '-DWILLYOU_FILE_BROKER_TEST=1', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', resolve('native/files/broker.mm'), '-o', executable]);
    broker = new NativeFileBroker(executable);
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild'); esbuild.buildSync({ entryPoints: [resolve('src/main/core/files/tex/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
  }, 30_000);
  it('compiles an image PDF with a missing Contents stream only after private compatibility processing, leaving the original unchanged', async () => {
    const blank = await PDFDocument.create(); blank.addPage([120, 60]);
    const bytes = Buffer.from(await blank.save({ useObjectStreams: false })); writeFileSync(join(project, 'blank.pdf'), bytes);
    const document = await file(String.raw`\documentclass{article}\usepackage{graphicx}\begin{document}Blank PDF accepted.\includegraphics[width=2cm]{blank.pdf}\end{document}`);
    const request = input(document), result = await service.tex.open('window', request);
    expect(result.warnings.join('\n')).toContain('仅编译副本');
    expect(pdfText(Buffer.from(service.tex.chunk('window', request.id, 0, result.bytes), 'base64'))).toContain('Blank PDF accepted');
    expect(hash(readFileSync(join(project, 'blank.pdf')))).toBe(hash(bytes)); expect(readdirSync(join(userData, 'm9-tex-jobs'))).toEqual([]);
  }, 30_000);
  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-tex-production-'))); project = join(fixture, '项目 含空格'); userData = join(fixture, 'user-data'); mkdirSync(project); mkdirSync(userData);
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'dir', path: project, projectId: 'project', label: 'Synthetic TeX' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver), undefined, undefined, { userData, directory: engineDirectory, workerPath: worker });
  });
  afterEach(() => { service.closeOwner('window'); broker.dispose(); rmSync(fixture, { recursive: true, force: true }); });
  afterAll(() => rmSync(build, { recursive: true, force: true }));
  const file = async (source: string) => { writeFileSync(join(project, 'main.tex'), source); const root = (await service.openScope('window', { kind: 'project', projectId: 'project' })).roots[0]; return service.open('window', { lease: root.lease, generation: root.generation, relativePath: 'main.tex' }); };
  const input = (document: Awaited<ReturnType<typeof file>>) => ({ id: randomUUID(), ref: document.ref, baseHash: document.revision.hash });
  const marker = (job: RootDescriptor, ownerPid = process.pid) => writeFileSync(join(job.path, '.willyou-tex-job.json'), JSON.stringify({ schema: 1, ownerPid, identity: job.identity }), { mode: 0o600 });
  const exitedPid = () => Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }));
  const pdfText = (bytes: Buffer) => { const pdf = join(fixture, 'result.pdf'), result = join(fixture, 'text.json'); writeFileSync(pdf, bytes); execFileSync('node', [resolve('scripts/files/inspect-pdf.mjs'), pdf, result], { stdio: 'pipe', timeout: 15_000 }); return JSON.parse(readFileSync(result, 'utf8')).pages.map((page: { text: string }) => page.text).join('\n'); };
  it('compiles real Chinese, math, local input and PNG, validates the PDF independently and releases its private workspace', async () => {
    mkdirSync(join(project, 'parts')); writeFileSync(join(project, 'parts/中文.tex'), '本地章节内容。'); writeFileSync(join(project, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const source = String.raw`\documentclass[fontset=fandol]{ctexart}\usepackage{amsmath,graphicx}\begin{document}\section{中文离线排版}中文、English 与数学混排。$a^2+b^2=c^2$\input{parts/中文.tex}\includegraphics[width=1cm]{pixel.png}\end{document}`;
    const document = await file(source), request = input(document), result = await service.tex.open('window', request);
    const bytes = Buffer.from(service.tex.chunk('window', request.id, 0, result.bytes), 'base64'); expect(hash(bytes)).toBe(result.hash); expect(result.pages).toBe(1); expect(pdfText(bytes)).toContain('本地章节内容'); expect(pdfText(bytes)).toContain('中文离线排版');
    expect(readFileSync(join(project, 'main.tex'), 'utf8')).toBe(source); expect(readdirSync(join(userData, 'm9-tex-jobs'))).toEqual([]);
    expect(() => service.tex.chunk('foreign', request.id, 0, 1)).toThrow('UNTRUSTED'); service.tex.release('window', request.id); expect(() => service.tex.chunk('window', request.id, 0, 1)).toThrow();
  }, 30_000);
  it('reports missing packages and refuses out-of-root input; shell escape stays disabled and source bytes stay intact', async () => {
    const missing = await file(String.raw`\documentclass{article}\usepackage{willyouMissingPackage}\begin{document}x\end{document}`);
    await expect(service.tex.open('window', input(missing))).rejects.toThrow('willyouMissingPackage'); expect(readdirSync(join(userData, 'm9-tex-jobs'))).toEqual([]);
    const secret = join(fixture, 'outside.tex'); writeFileSync(secret, 'PRIVATE-TEX-CANARY');
    const outside = await file(`\\documentclass{article}\\begin{document}\\input{${secret}}\\end{document}`); await expect(service.tex.open('window', input(outside))).rejects.toThrow('OUTSIDE_ROOT');
    const marker = join(fixture, 'must-not-exist');
    const guarded = await file(String.raw`\documentclass{article}\begin{document}Before.\immediate\write18{touch ` + marker + String.raw`}\newread\f\openin\f=` + secret + String.raw`\relax\ifeof\f BLOCKED\else\read\f to\line\line\fi\closein\f After.\end{document}`);
    const request = input(guarded), result = await service.tex.open('window', request), bytes = Buffer.from(service.tex.chunk('window', request.id, 0, result.bytes), 'base64');
    const text = pdfText(bytes); expect(text).toContain('BLOCKED'); expect(text).not.toContain('PRIVATE-TEX-CANARY'); expect(existsSync(marker)).toBe(false);
  }, 30_000);
  it('cancels real looping compilation, rejects late/foreign access and permits retry after cleanup', async () => {
    const document = await file(String.raw`\documentclass{article}\begin{document}\newcount\n\loop\advance\n by1\iftrue\repeat\end{document}`), request = input(document);
    const pending = service.tex.open('window', request); const rejected = expect(pending).rejects.toThrow();
    const started = Date.now(); while (!existsSync(join(userData, 'm9-tex-jobs')) && Date.now() - started < 5000) await new Promise((done) => setTimeout(done, 20));
    await new Promise((done) => setTimeout(done, 500)); const cancelled = Date.now(); service.tex.release('window', request.id); await rejected;
    expect(Date.now() - cancelled).toBeLessThan(2000); expect(broker.activeProcesses).toBe(0); expect(readdirSync(join(userData, 'm9-tex-jobs'))).toEqual([]);
    await expect(service.tex.open('window', request)).rejects.toThrow('CANCELLED');
    const good = await file(String.raw`\documentclass{article}\begin{document}Retry succeeded\end{document}`); expect((await service.tex.open('window', input(good))).pages).toBe(1);
  }, 30_000);
  it('enforces native timeout and catches source replacement after copying instead of publishing an obsolete PDF', async () => {
    const document = await file(String.raw`\documentclass{article}\begin{document}\newcount\n\loop\advance\n by1\iftrue\repeat\end{document}`), source = service.texSource('window', document.ref), snapshot = await texSnapshot(source, async (text) => texReferences(text), new AbortController().signal), resources = await texEngineResources(engineDirectory);
    const timeoutPath = join(fixture, 'timeout-job'); mkdirSync(timeoutPath, { mode: 0o700 });
    marker(descriptor(timeoutPath));
    const request = { operation: 'tex-compile', root: descriptor(project), entry: snapshot.entry, baseHash: source.hash, files: snapshot.files, ...resources, job: descriptor(timeoutPath), wallMs: 15000, testWallMs: 200 };
    await expect(broker.request(request, { timeoutMs: 5000 })).rejects.toThrow('TIMEOUT'); expect(broker.activeProcesses).toBe(0);
    const clean = await file(String.raw`\documentclass{article}\begin{document}Old snapshot\end{document}`), cleanSource = service.texSource('window', clean.ref), cleanSnapshot = await texSnapshot(cleanSource, async (text) => texReferences(text), new AbortController().signal);
    const path = join(fixture, 'race-job'); mkdirSync(path, { mode: 0o700 });
    marker(descriptor(path));
    await expect(broker.request<TexNativeResult>({ ...request, entry: cleanSnapshot.entry, baseHash: cleanSource.hash, files: cleanSnapshot.files, job: descriptor(path), testWallMs: undefined, testStopAt: 'tex-snapshot' }, { timeoutMs: 20_000, onTestStop: (_phase, child) => { writeFileSync(join(project, 'main.tex'), 'New user bytes'); child.kill('SIGCONT'); } })).rejects.toThrow('CHANGED');
    expect(readFileSync(join(project, 'main.tex'), 'utf8')).toBe('New user bytes');
  }, 30_000);
  it('recovers only descriptor-identified orphan jobs, preserves live jobs and rejects unknown/symlink content before deletion', async () => {
    const jobs = new TexWorkspaces(userData, broker), dead = exitedPid();
    const orphan = await jobs.create(), live = await jobs.create(), unsafe = await jobs.create(), unknown = await jobs.create();
    marker(orphan, dead); marker(unsafe, dead); writeFileSync(join(unknown.path, '.willyou-tex-job.json'), 'broken');
    mkdirSync(join(orphan.path, 'input')); writeFileSync(join(orphan.path, 'input/source.tex'), 'owned copy');
    const outside = join(fixture, 'outside-canary'); writeFileSync(outside, 'must remain');
    writeFileSync(join(unsafe.path, 'keep.txt'), 'must also remain'); symlinkSync(outside, join(unsafe.path, 'link'));
    const report = await jobs.recover();
    expect(report.removed).toEqual([orphan.path.split('/').at(-1)]); expect(report.issues).toHaveLength(2);
    expect(existsSync(orphan.path)).toBe(false); expect(existsSync(live.path)).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe('must remain'); expect(readFileSync(join(unsafe.path, 'keep.txt'), 'utf8')).toBe('must also remain');
    await jobs.clean(live); expect(existsSync(live.path)).toBe(false);
  });
  it('keeps an orphan snapshot locked by a surviving compiler, then reaps it after cancellation closes the lock', async () => {
    const document = await file(String.raw`\documentclass{article}\begin{document}Locked snapshot\end{document}`), source = service.texSource('window', document.ref);
    const snapshot = await texSnapshot(source, async (text) => texReferences(text), new AbortController().signal), resources = await texEngineResources(engineDirectory);
    const jobs = new TexWorkspaces(userData, broker), job = await jobs.create(), dead = exitedPid(), abort = new AbortController();
    let inspection!: Promise<TexCleanupReport>;
    const pending = broker.request({ operation: 'tex-compile', root: descriptor(project), entry: snapshot.entry, baseHash: source.hash, files: snapshot.files, ...resources, job, wallMs: 30000, testStopAt: 'tex-snapshot' }, {
      signal: abort.signal, timeoutMs: 10_000,
      onTestStop: () => { marker(job, dead); inspection = jobs.recover(); void inspection.finally(() => abort.abort()).catch(() => undefined); },
    });
    await expect(pending).rejects.toThrow('CANCELLED');
    expect((await inspection).busy).toEqual([job.path.split('/').at(-1)]); expect(existsSync(job.path)).toBe(true);
    expect((await jobs.recover()).removed).toEqual([job.path.split('/').at(-1)]); expect(existsSync(job.path)).toBe(false);
  }, 15_000);
});
