import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { observePdfWorkers } from '../lib/pdf-worker-targets.mjs';
import { startPdfPageRenderGate } from '../lib/pdf-page-render-gate.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
import { installFileResourceObserver, observeFileResources, restoreFileResourceObserver } from '../lib/file-resource-observer.mjs';
import { pause } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_FILES_APP, root = process.env.SMARTDD_PDF_LIFECYCLE_PROJECT; assert(executable && root);
const scratch = await mkdtemp('/private/tmp/willyou-pdf-retry-A-'), manifest = join(dirname(root), 'fixtures.json'), f = JSON.parse(await readFile(manifest, 'utf8')), sha = x => createHash('sha256').update(x).digest('hex');
const assets = (await readdir('out/renderer/assets')).filter(n => /^index-.*\.js$/.test(n)); let indexName, line;
for (const n of assets) { const lines = (await readFile(join('out/renderer/assets', n), 'utf8')).split('\n'), i = lines.findIndex(s => s.includes('render = page.render(')); if (i >= 0) { indexName = n; line = i + 1; } }
assert(indexName && line);
async function fingerprint() { return Object.fromEntries(await Promise.all(['normal.pdf', 'alternate200.pdf'].map(async n => { const p = join(root, n), s = await stat(p, { bigint: true }); return [n, { sha256: sha(await readFile(p)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }]; }))); }
const r = { at: new Date().toISOString(), scratch, manifest, root, before: await fingerprint(), asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), hook: { indexName, line }, checks: [], boundary: 'A own packaged App/original PDF.js/native Worker/protected bytes. Genuine Worker thrown error; page failure and main-thread render-result delivery latency explicitly injected through a Proxy forwarding original RenderTask/cancel. Held value is actual original native render success, no fake canvas/document/worker success or source/store/DOM value change. Retry/source switch through trusted original UI. No clipboard/picker/model/external App/current Codex access.' };
let app, targets, gate, observed = false, stage = 'setup', installed = false;
const body = '.fw-pdf-page:not(.fw-pdf-thumb)[data-page="1"]';
const ready = label => app.waitFor(`document.querySelector(${JSON.stringify(body + ' canvas')})?.dataset.rendered==='true'&&document.querySelector(${JSON.stringify(body + ' .fw-pdf-text')})?.textContent.includes(${JSON.stringify(label)})`, 20000);
const active = () => targets.rows.filter(x => /pdf\.worker\.min-/.test(x.url) && !x.destroyedAt && !x.detachedAt).at(-1);
async function poll(fn, name, ms = 10000) { const end = Date.now() + ms; for (;;) { const x = await fn(); if (x) return x; assert(Date.now() < end, name); await pause(20); } }
const snapshot = () => app.evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(body)}),c=p?.querySelector('canvas'),text=p?.querySelector('.fw-pdf-text')?.textContent;let pixels=null;if(c?.width&&c.height){const o=new OffscreenCanvas(64,64),g=o.getContext('2d');g.drawImage(c,0,0,64,64);const a=g.getImageData(0,0,64,64).data;let n=2166136261;for(const v of a)n=Math.imul(n^v,16777619);pixels=n>>>0}return{at:Date.now(),source:document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.title,text,rendered:c?.dataset.rendered,width:c?.width,height:c?.height,pixels,error:document.querySelector('.fw-pdf [role=alert]')?.textContent,status:document.querySelector('.fw-pdf-status')?.textContent}})()`);
const record = data => { r.checks.push({ caseId: 'M9-T-T15', ...data }); console.log(JSON.stringify({ theme: data.theme, scenario: data.scenario, checks: r.checks.length })); };
async function closeB() { await app.click('[aria-label="关闭 alternate200.pdf"]'); await app.waitFor('!document.querySelector(".fw-pdf")'); await poll(() => !active(), 'Old actual PDF worker must exit'); }
async function retryRace(theme, kind, previous) {
  await gate.arm('hold'); const start = Date.now();
  await app.click(kind === 'page' ? '.fw-pdf-page-error button' : '.fw-pdf [role=alert] button', kind === 'page' ? '重试此页' : '重试');
  await app.waitFor('window.__pdfPageRenderGate.gates.size===1'); const held = await gate.snapshot(), row = held.rows.find(x => x.id === held.held[0]);
  assert.equal(row.mode, 'hold'); assert(row.originalSettledAt >= start && row.originalUndefined && !row.deliveredAt); if (kind === 'page') assert(row.id > previous.id);
  const retriedWorker = active(); assert(retriedWorker); if (kind === 'worker') assert.notEqual(retriedWorker.targetId, previous.targetId);
  const pending = await snapshot(); assert.notEqual(pending.rendered, 'true');
  const input = await app.evaluate(`window.__pdfRetryFrames.inputs.filter(x=>x.at>=${start}&&x.text===${JSON.stringify(kind === 'page' ? '重试此页' : '重试')}).at(-1)`); assert(input?.trusted);
  record({ theme, scenario: kind + ' retry creates fresh original task but held native success is not declared ready', held, pending, input, retriedWorker: { ...retriedWorker } });
  await app.click(app.tree('alternate200.pdf')); await ready('DEV137_ALTERNATE'); await poll(() => retriedWorker.destroyedAt, 'Replaced original PDF Worker destroyed');
  const before = await snapshot(); assert.equal(before.source, join(root, 'alternate200.pdf')); assert(!before.text.includes('文件浏览工作区')); assert(!before.error);
  const cancelled = await gate.snapshot(), old = cancelled.rows.find(x => x.id === row.id); assert.equal(old.canvas?.connected, false); assert.equal(old.canvas?.width, 0); assert.equal(old.canvas?.height, 0); assert(old.cancelCalls >= 1);
  const releasedAt = Date.now(); await gate.release(row.id); await app.waitFor(`window.__pdfRetryFrames.rows.filter(x=>x.at>${releasedAt}).length>=4`);
  const after = await snapshot(), delivered = await gate.snapshot(), result = delivered.rows.find(x => x.id === row.id);
  assert(result.deliveredAt >= releasedAt && result.originalUndefined && result.deliveredUndefined); assert.equal(after.source, before.source); assert.equal(after.text, before.text); assert.equal(after.pixels, before.pixels); assert.equal(after.rendered, 'true'); assert(!after.error);
  const frames = await app.evaluate(`window.__pdfRetryFrames.rows.filter(x=>x.at>=${start}&&x.source===${JSON.stringify(join(root, 'alternate200.pdf'))})`); assert(frames.length >= 4); assert(frames.every(x => !x.text.includes('文件浏览工作区')));
  record({ theme, scenario: kind + ' old original success delivered after new document ready cannot repaint or replace new document', before, after, old, result, releasedAt, frames });
  await app.screenshot(join(scratch, theme + '-' + kind + '-after-late.png')); await closeB();
}
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'M9 PDF retry original results', inspectMain: true }); r.pid = app.processId;
  await installFileRpcObserver(app); await installFileResourceObserver(app); observed = true; targets = await observePdfWorkers(app);
  r.hook.scriptUrl = await app.evaluate(`Array.from(document.scripts).find(s=>s.src.endsWith(${JSON.stringify('/' + indexName)}))?.src`); assert(r.hook.scriptUrl);
  gate = startPdfPageRenderGate(app, { scriptUrl: r.hook.scriptUrl, line, first: 'reject' }); await gate.setup;
  await app.evaluate("(()=>{const s={rows:[],inputs:[],running:true};s.input=e=>s.inputs.push({at:Date.now(),trusted:e.isTrusted,text:e.target.closest('button')?.textContent.trim(),source:e.target.closest('[role=treeitem]')?.title});document.addEventListener('pointerdown',s.input,true);const tick=()=>{if(!s.running)return;s.rows.push({at:Date.now(),source:document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.title,text:[...document.querySelectorAll('.fw-pdf-page:not(.fw-pdf-thumb) .fw-pdf-text')].map(x=>x.textContent).join('\\n')});s.raf=requestAnimationFrame(tick)};s.raf=requestAnimationFrame(tick);window.__pdfRetryFrames=s;return true})()"); installed = true;
  for (const theme of ['light', 'dark']) {
    await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }); stage = theme + ':page-failure';
    if (theme === 'dark') await gate.arm('reject');
    await app.open('normal.pdf'); await app.waitFor('!!document.querySelector(".fw-pdf-page-error")'); r.hook.installed ??= await gate.ready;
    const failed = await snapshot(), rows = await gate.snapshot(), error = rows.rows.findLast(x => x.mode === 'reject');
    assert(failed.error.includes('DEV180 explicit page-render result failure')); assert.equal(failed.rendered, 'error'); assert.equal(failed.width, 0); assert.equal(failed.height, 0); assert(error.originalUndefined && error.originalSettledAt && error.injectedFailureAt);
    record({ theme, scenario: 'explicit page-result failure clears canvas and offers original page retry', failed, error });
    stage = theme + ':page-retry-race'; await retryRace(theme, 'page', error);
    stage = theme + ':worker-failure'; await app.open('normal.pdf'); await ready('文件浏览工作区'); const previous = { ...active() }; assert(previous.targetId);
    await targets.crash(active()); await app.waitFor('document.querySelector(".fw-pdf [role=alert]")?.textContent.includes("工作进程意外退出")'); await poll(() => targets.rows.find(x => x.targetId === previous.targetId).destroyedAt, 'Crashed actual Worker exits'); const failedWorker = await snapshot(); assert(!await app.evaluate('!!document.querySelector(".fw-pdf canvas[data-rendered=true]")'));
    record({ theme, scenario: 'actual native Worker thrown error clears loaded document and exposes host retry', previous, failed: failedWorker });
    stage = theme + ':worker-retry-race'; await retryRace(theme, 'worker', previous);
  }
  r.renderGate = await gate.snapshot(); assert.equal(r.renderGate.held.length, 0); r.gateCleanup = await gate.close(); gate = null; assert(r.gateCleanup.restored);
  r.frames = await app.evaluate('window.__pdfRetryFrames.rows'); r.inputs = await app.evaluate('window.__pdfRetryFrames.inputs'); assert(r.inputs.every(x => x.trusted));
  await app.evaluate('(()=>{const s=window.__pdfRetryFrames;s.running=false;cancelAnimationFrame(s.raf);document.removeEventListener("pointerdown",s.input,true);delete window.__pdfRetryFrames;return true})()'); installed = false;
  r.targets = await targets.close(); targets = null; assert(r.targets.restored && !r.targets.errors.length); assert(r.targets.rows.filter(x => /pdf\.worker\.min-/.test(x.url)).every(x => x.destroyedAt));
  r.rpc = await observeFileRpcs(app); r.resources = await observeFileResources(app); r.restored = { ...await restoreFileRpcObserver(app), ...await restoreFileResourceObserver(app) }; observed = false; assert(Object.values(r.restored).every(Boolean));
  r.after = await fingerprint(); assert.deepEqual(r.before, r.after); assert.deepEqual(app.rendererErrors, []); r.rendererErrors = []; assert.deepEqual(await app.invoke('tasks.list'), []);
  await writeFile(join(scratch, 'electron.log'), app.logs()); await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()"); r.exit = await app.waitForExit(20000); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); await app.close(); app = null; r.status = 'passed';
} catch (error) {
  r.status = 'failed'; r.stage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1;
  if (app) try { r.failure = await snapshot(); r.gate = await gate?.snapshot(); r.dom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {}
} finally {
  if (app) {
    if (gate) try { r.gateCleanup = await gate.close(); } catch (e) { r.gateCleanupError = String(e); }
    if (targets) try { r.targetsCleanup = await targets.close(); } catch {}
    if (installed) try { await app.evaluate('(()=>{const s=window.__pdfRetryFrames;s.running=false;cancelAnimationFrame(s.raf);document.removeEventListener("pointerdown",s.input,true);delete window.__pdfRetryFrames;return true})()'); } catch {}
    if (observed) try { r.failedRestore = { ...await restoreFileRpcObserver(app), ...await restoreFileResourceObserver(app) }; } catch {}
    await writeFile(join(scratch, 'failure-electron.log'), app.logs()); await app.close();
  }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, artifacts: scratch, error: r.error, stage: r.stage }));
}
