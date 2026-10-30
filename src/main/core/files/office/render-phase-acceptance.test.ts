import { createHash } from 'node:crypto';
import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NativeFileBroker, type BrokerOptions } from '../native-broker';
import { FileHeavyJobs } from '../heavy-jobs';
import { LibreOfficeEngine } from './libreoffice-engine';
import { libreOfficeResources } from './libreoffice-resources';

const run = promisify(execFile), sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_RENDER_PHASE_APP || !process.env.SMARTDD_RENDER_PHASE_EVIDENCE)('W26 original native rendering phase observation (I diagnostic)', () => {
  it('times a separate complete resource verification without caching or changing its signature/hash checks', async () => {
    const app = process.env.SMARTDD_RENDER_PHASE_APP!, out = process.env.SMARTDD_RENDER_PHASE_EVIDENCE!; mkdirSync(out, { recursive: true });
    const directory = join(app, 'Contents/Resources/native/libreoffice'), start = performance.now();
    const result = await libreOfficeResources(directory, app, AbortSignal.timeout(60000));
    const elapsed = performance.now() - start;
    expect(result.files.length + result.links.length).toBeGreaterThan(10000); expect(result.runtime.path).toBe(realpathSync(directory));
    writeFileSync(join(out, 'resource-prepare.json'), JSON.stringify({ at: new Date().toISOString(), app, implementation: process.env.SMARTDD_RENDER_PHASE_IMPLEMENTATION ?? 'current-source', elapsedMs: elapsed, regularFiles: result.files.length, links: result.links.length, bytes: result.bytes, sealHash: sha(JSON.stringify({ runtime: result.runtime, files: result.files, links: result.links })), boundary: 'One full libreOfficeResources invocation using the explicitly identified source of this run, with all walks/link checks, both actual codesign verifications and every regular file hash. Warm current machine;not proof of W26 root cause. No source/job/vendor writes,cache/budget/verification bypass.' }, null, 2) + '\n');
  }, 65000);
  it('keeps original render budgets and shared queue while observing four predeclared normal jobs', async () => {
    const app = process.env.SMARTDD_RENDER_PHASE_APP!, out = process.env.SMARTDD_RENDER_PHASE_EVIDENCE!;
    mkdirSync(out, { recursive: true }); const base = realpathSync(mkdtempSync('/private/tmp/willyou-render-phase-I-')), userdata = join(base, 'userdata'); mkdirSync(userdata);
    const resources = join(app, 'Contents/Resources'), executable = join(resources, 'native/willyou-files'), vendor = join(resources, 'native/libreoffice/LibreOffice.app/Contents/MacOS/soffice');
    const sources = { docx: '/private/tmp/willyou-office-preservation-A-EdqZNs/project/light.docx', pptx: '/private/tmp/willyou-office-preservation-A-EdqZNs/project/light.pptx' };
    const state = (path: string) => { const s = statSync(path, { bigint: true }); return { hash: sha(readFileSync(path)), inode: String(s.ino), size: String(s.size), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) }; };
    const before = Object.fromEntries(Object.entries(sources).map(([kind, path]) => [kind, state(path)]));
    const jobs: any[] = [], results: any[] = [], observationWork: Promise<void>[] = [];
    const evidence: any = { at: new Date().toISOString(), layer: 'I diagnostic', caseId: 'M9-T-W26', app, base, nativeHash: sha(readFileSync(executable)), asarHash: sha(createRequire(import.meta.url)('original-fs').readFileSync(join(resources, 'app.asar'))), sources, before, jobs, results, boundary: 'Normal r138 broker/vendor/sandbox and20/30/60s deadlines. Existing LibreOfficeEngine with one real shared FileHeavyJobs. Serial DOCX/PPTX controls followed by two concurrently submitted jobs through that same serial queue;not two synthetic independent queues. Only own process pipes/events, private job output metadata and optional9s exact group/executable stack sample. Explicit diagnostic overhead;no original full W26 or GUI/performance pass claim. No global/user preferences, vendor bytes,auth/results or source content changed.' };
    const save = () => writeFileSync(join(out, 'progress.json'), JSON.stringify(evidence, null, 2) + '\n');
    class ObservedBroker extends NativeFileBroker {
      override request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
        if (input.operation !== 'office-render') return super.request<T>(input, options);
        const oldChildren = new Set((this as unknown as { children: Set<ChildProcessWithoutNullStreams> }).children), started = Date.now(), inputHash = sha(JSON.stringify(input));
        const row: any = { format: input.format, requestAt: started, inputHash, job: input.job, phase: [], io: [] }; jobs.push(row); save();
        const pending = super.request<T>(input, options), child = [...(this as unknown as { children: Set<ChildProcessWithoutNullStreams> }).children].find(c => !oldChildren.has(c));
        row.nativePid = child?.pid;
        const job = (input.job as { path: string }).path; expect(realpathSync(job).startsWith(base + '/')).toBe(true);
        const inspect = () => {
          try {
            const root = lstatSync(job); if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o077)) throw Error('Private job identity changed');
            const path = join(job, 'out'); const entries = readdirSync(path).slice(0, 8).map(name => { const s = lstatSync(join(path, name)); return { name, bytes: s.size, mtime: s.mtimeMs, regular: s.isFile(), symlink: s.isSymbolicLink() }; });
            row.phase.push({ ms: Date.now() - started, outputs: entries });
          } catch (error) { row.phase.push({ ms: Date.now() - started, metadataError: String(error) }); }
          save();
        };
        const timers = [0, 500, 1500, 3000, 5000, 7000, 11000, 15000, 19000, 23000, 27000].map(ms => setTimeout(inspect, ms));
        const onData = (stream: string) => (bytes: Buffer) => { row.io.push({ stream, event: 'data', ms: Date.now() - started, bytes: bytes.length }); };
        const stdout = onData('stdout'), stderr = onData('stderr');
        child?.stdout.on('data', stdout); child?.stderr.on('data', stderr);
        child?.stdout.once('end', () => row.io.push({ stream: 'stdout', event: 'end', ms: Date.now() - started })); child?.stderr.once('end', () => row.io.push({ stream: 'stderr', event: 'end', ms: Date.now() - started }));
        child?.once('exit', (code, signal) => { row.exit = { code, signal, ms: Date.now() - started }; save(); }); child?.once('close', (code, signal) => { row.close = { code, signal, ms: Date.now() - started }; save(); });
        const late = setTimeout(() => {
          const work = (async () => {
            try {
              if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
              const native = (await run('/bin/ps', ['-p', String(child.pid), '-o', 'ppid=,pgid=,comm='], { timeout: 1500 })).stdout.trim();
              const m = /^(\d+)\s+(\d+)\s+(.+)$/.exec(native); if (!m || Number(m[1]) !== process.pid || Number(m[2]) !== child.pid || m[3] !== executable) throw Error('Own native identity mismatch');
              row.lateNative = { native, ms: Date.now() - started };
              try { const result = await run('/usr/sbin/lsof', ['-n', '-P', '-a', '-p', String(child.pid), '-d', '0-64'], { timeout: 2500, maxBuffer: 512 * 1024 }); writeFileSync(join(out, 'native-' + child.pid + '-fds.txt'), result.stdout); row.lateNative.fds = result.stderr; } catch (error) { row.lateNative.fdsError = String(error); }
              let ids: string[] = []; try { ids = (await run('/usr/bin/pgrep', ['-g', String(child.pid)], { timeout: 1500 })).stdout.trim().split(/\s+/); } catch { /* Empty verified group is evidence too. */ }
              row.lateNative.group = [];
              for (const id of ids.filter(x => /^\d+$/.test(x) && Number(x) !== child.pid)) {
                let actual; try { actual = (await run('/bin/ps', ['-ww', '-p', id, '-o', 'ppid=,pgid=,comm=,args='], { timeout: 1500 })).stdout.trim(); } catch { continue; }
                row.lateNative.group.push({ pid: Number(id), actual });
                const pattern = /^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/; const fields = pattern.exec(actual);
                if (!fields || Number(fields[2]) !== child.pid || fields[3] !== vendor || !fields[4].includes(job)) continue;
                const path = join(out, 'vendor-' + child.pid + '-' + id + '.txt'); row.lateNative.sample = { pid: Number(id), atMs: Date.now() - started, path };
                const result = await run('/usr/bin/sample', [id, '1', '1', '-file', path], { timeout: 5000, maxBuffer: 512 * 1024 }); row.lateNative.sample.stderr = result.stderr; break;
              }
            } catch (error) { row.lateError = String(error); } finally { save(); }
          })(); observationWork.push(work);
        }, 9000);
        return pending.then(value => { row.result = { hash: sha(JSON.stringify(value)), ...(value as Record<string, unknown>), base64: undefined }; row.successAtMs = Date.now() - started; return value; }, error => { row.error = { code: error.code, message: error.message, ms: Date.now() - started }; throw error; }).finally(() => {
          for (const timer of timers) clearTimeout(timer); clearTimeout(late); inspect(); child?.stdout.off('data', stdout); child?.stderr.off('data', stderr); row.inputAfter = sha(JSON.stringify(input)); expect(row.inputAfter).toBe(inputHash); save();
        });
      }
    }
    const broker = new ObservedBroker(executable), queue = new FileHeavyJobs(), engine = new LibreOfficeEngine(broker, { directory: join(resources, 'native/libreoffice'), userData: userdata, packagePath: app }, queue);
    const render = async (kind: 'docx' | 'pptx', label: string) => {
      const began = Date.now(); evidence.current = label; save();
      try { const r = await engine.render(readFileSync(sources[kind]), kind, new AbortController().signal); const pdf = join(out, label + '.pdf'); writeFileSync(pdf, r.bytes); results.push({ label, kind, status: 'ready', totalMs: Date.now() - began, nativeMs: r.elapsedMs, pages: r.pages, hash: r.hash, bytes: r.bytes.length, peakRss: r.peakRssBytes, diagnostic: r.diagnostic }); expect(r.pages).toBeGreaterThan(0); expect(sha(r.bytes)).toBe(r.hash); }
      catch (error) { results.push({ label, kind, status: 'failed', totalMs: Date.now() - began, error: String(error) }); } finally { save(); }
    };
    try {
      await render('docx', 'serial-docx'); await render('pptx', 'serial-pptx');
      await Promise.all([render('docx', 'queued-docx'), render('pptx', 'queued-pptx')]);
      await Promise.allSettled(observationWork); expect(results).toHaveLength(4); expect(jobs).toHaveLength(4); expect(results.filter(r => r.status !== 'ready')).toEqual([]);
      for (let i = 1; i < jobs.length; i++) expect(jobs[i].requestAt).toBeGreaterThanOrEqual(jobs[i - 1].requestAt + (jobs[i - 1].close?.ms ?? 0));
      evidence.status = 'four-selected-normal-render-diagnostic-jobs-passed;original-W26-failure-not-cleared';
    } finally {
      await Promise.allSettled(observationWork); engine.dispose(); broker.dispose(); evidence.activeNativeProcesses = broker.activeProcesses; evidence.after = Object.fromEntries(Object.entries(sources).map(([kind, path]) => [kind, state(path)])); expect(evidence.after).toEqual(before); evidence.finishedAt = new Date().toISOString(); writeFileSync(join(out, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
      for (const [kind, path] of Object.entries(sources)) copyFileSync(path, join(out, 'original.' + kind)); rmSync(base, { recursive: true, force: true });
    }
  }, 180000);
});
