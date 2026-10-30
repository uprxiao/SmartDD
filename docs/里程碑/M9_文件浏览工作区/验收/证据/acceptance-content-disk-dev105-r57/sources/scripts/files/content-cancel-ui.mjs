import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openTaskFileFixture } from '../lib/task-file-fixture.mjs';
import { installContentSearchObserver, setContentSearchHold, observeContentSearch, deliverContentProgress, deliverContentCompletion, restoreContentSearchObserver } from '../lib/content-search-observer.mjs';
import { pause } from '../lib/electron-harness.mjs';
const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-content-cancel-app-'), a = join(scratch, 'A'), b = join(scratch, 'B'); await mkdir(a); await mkdir(b);
const files = new Map(); for (const [directory, name] of [[a, 'A'], [b, 'B']]) { files.set(join(directory, 'stream.txt'), `oldStream first ${name}\noldStream second ${name}\nfreshToken ${name}\n`); files.set(join(directory, 'sentinel.txt'), `SENTINEL ${name}\n`); } for (const [path, text] of files) await writeFile(path, text);
const sha = value => createHash('sha256').update(value).digest('hex'), resources = resolve(dirname(executable), '../Resources');
const r = { at: new Date().toISOString(), executable, scratch, asarSha256: sha(await readFile(join(resources, 'app.asar'))), checks: [], status: 'running', boundary: 'A: packaged App, original native content stream and completion held unchanged; first original match delivered before real dialog close, then actual task/root navigation, then new real search, then remaining old original notifications/completion. Modal requires close before sidebar/root actions; direct task/root lifecycle is additionally verified in I. Isolated Python PTYs only, no model, commands, clipboard, Store or editor injection.' };
let fixture, app, installed = false, stage = 'setup';
const poll = async (fn, label) => { const end = Date.now() + 12000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(15); } throw Error('Timed out: ' + label); };
try {
 fixture = await openTaskFileFixture({ executable, scratch, root: a, extraRoot: b, name: 'M9 R11 content cancellation' }); app = fixture.app; await app.cdp('Page.bringToFront'); await installContentSearchObserver(app); installed = true;
 await app.evaluate("window.__contentInputs=[];document.addEventListener('input',e=>{if(e.target.matches('[aria-label=全文搜索内容]'))window.__contentInputs.push({value:e.target.value,trusted:e.isTrusted,at:performance.now()})},true);true");
 const selectRoot = async directory => { if (await app.evaluate(`document.querySelector('.fw-root-trigger')?.title===${JSON.stringify(directory)}`)) return; await app.click('[aria-label=文件目录来源]'); await app.click(`.fw-file-menu [role=menuitem][title=${JSON.stringify(directory)}]`); await app.waitFor(`document.querySelector('.fw-root-trigger')?.title===${JSON.stringify(directory)}`); };
 const search = async query => { await app.click('[aria-label="在文件中搜索"]'); await app.click('[aria-label="全文搜索内容"]'); await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] }); await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 }); await app.cdp('Input.insertText', { text: query }); };
 for (const action of ['close', 'task', 'root']) {
  stage = action; console.log('R11 stage', stage); await fixture.show('T1'); await selectRoot(a); await setContentSearchHold(app, true); const before = (await observeContentSearch(app)).slots.length;
  await search('oldStream'); const old = await poll(async () => (await observeContentSearch(app)).slots.slice(before).find(x => x.input.query === 'oldStream' && x.waiting && x.progress.length === 2), 'original native stream and completion');
  await deliverContentProgress(app, old.id, 0); await app.waitFor("document.querySelectorAll('.fw-search-results [role=option]').length===1&&document.querySelector('.fw-search-results').getAttribute('aria-busy')==='true'");
  await app.screenshot(join(scratch, action + '-partial.png')); await app.click('[aria-label="关闭全文搜索"]'); await app.waitFor('!document.querySelector(".fw-search-dialog")');
  await poll(async () => (await observeContentSearch(app)).cancels.some(x => x.id === old.id), 'original cancellation');
  if (action === 'task') await fixture.show('T2'); if (action === 'root') await selectRoot(b);
  await setContentSearchHold(app, false); const freshAt = (await observeContentSearch(app)).slots.length; await search('freshToken');
  await app.waitFor("document.querySelectorAll('.fw-search-results [role=option]').length===1&&document.querySelector('.fw-search-results').getAttribute('aria-busy')==='false'");
  const fresh = await poll(async () => (await observeContentSearch(app)).slots.slice(freshAt).find(x => x.input.query === 'freshToken' && x.delivered), 'independent fresh completion'); assert.notEqual(fresh.id, old.id);
  const text = await app.evaluate("document.querySelector('.fw-search-results').innerText"); assert(text.includes('freshToken')); assert(!text.includes('oldStream'));
  await deliverContentProgress(app, old.id, 1); await deliverContentCompletion(app, old.id); await poll(async () => (await observeContentSearch(app)).slots.find(x => x.id === old.id)?.delivered, 'late original completion'); await pause(60);
  assert.equal(await app.evaluate("document.querySelector('.fw-search-results').innerText"), text); assert.equal(await app.evaluate("document.querySelectorAll('.fw-search-results [role=option]').length"), 1);
  const selectedRoot = await app.evaluate("document.querySelector('.fw-root-trigger').title"); assert.equal(selectedRoot, action === 'root' ? b : a);
  await app.screenshot(join(scratch, action + '-fresh-after-late.png')); r.checks.push({ caseId: 'M9-T-R11', action, old, fresh, selectedRoot, text, partialRows: 1, latePacketsDelivered: 1, oldSessionCancelled: true, pass: true }); await app.click('[aria-label="关闭全文搜索"]');
 }
 r.trace = await observeContentSearch(app); for (const row of r.trace.slots) { assert(!row.waiting); if (row.before) assert.equal(row.before, row.after); assert.equal(row.inputBefore, row.inputAfter); for (const packet of row.progress) if (packet.delivered) assert.equal(packet.before, packet.after); }
 r.inputs = await app.evaluate('window.__contentInputs'); assert(r.inputs.length >= 6 && r.inputs.every(x => x.trusted)); r.receivers = {};
 for (const label of ['T1', 'T2']) { const state = await fixture.receiver(label); assert.equal(state.bytes, 0); assert.equal(state.executedCommands, 0); r.receivers[label] = state; }
 for (const [path, text] of files) assert.equal(await readFile(path, 'utf8'), text); assert.deepEqual(app.rendererErrors, []); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.failureDom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (installed) try { r.trace ??= await observeContentSearch(app); r.restored = await restoreContentSearchObserver(app); assert(r.restored.start && r.restored.cancel && r.restored.send); assert.deepEqual(r.restored.listeners, r.restored.baseline); } catch (error) { r.restoreError = String(error); r.status = 'failed'; process.exitCode = 1; } await writeFile(join(scratch, 'electron.log'), app.logs()); await fixture.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, failedStage: r.failedStage, error: r.error, artifacts: scratch })); }
