import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installContentSearchObserver, observeContentSearch, restoreContentSearchObserver } from '../lib/content-search-observer.mjs';
import { pause } from '../lib/electron-harness.mjs';
const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-search-input-limit-app-'), root = join(scratch, 'project'); await mkdir(root);
const body = 'steadyToken stable\n' + 'q'.repeat(260) + '\n' + '中'.repeat(260) + '\n' + 'q'.repeat(254) + '🙂\n' + '中'.repeat(254) + '🙂\n'; await writeFile(join(root, 'source.ts'), body); await writeFile(join(root, 'sentinel.txt'), 'Sentinel selection unchanged\n');
const sha = value => createHash('sha256').update(value).digest('hex'), resources = resolve(dirname(executable), '../Resources');
const r = { at: new Date().toISOString(), executable, scratch, asarSha256: sha(await readFile(join(resources, 'app.asar'))), checks: [], status: 'running', boundary: 'A actual packaged App, original native authenticated search, trusted CDP text/key/input plus Chromium Input.imeSetComposition then browser commit. Chromium protocol compositionend may carry isTrusted=false; it is recorded and never claimed as physical OS evidence. This is browser IME pipeline, not physical system candidate/keyboard validation. Read-only event/model observation, no dispatched DOM events or Store/editor/result writes. Private fixture only, no model/clipboard/daily data.' };
let app, installed = false, stage = 'setup';
const clamp = text => { let out = ''; for (const ch of text) { if (out.length + ch.length > 256) break; out += ch; } return out; };
const poll = async (fn, label) => { const end = Date.now() + 10000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(15); } throw Error('Timed out: ' + label); };
try {
 app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'M9 R08 search input limits', inspectMain: true }); await app.cdp('Page.bringToFront'); await app.open('sentinel.txt'); await app.waitFor("document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='Sentinel selection unchanged\\n'"); await installContentSearchObserver(app); installed = true;
 const query = '[aria-label="全文搜索内容"]', mask = '[aria-label="搜索文件掩码"]';
 await app.evaluate("window.__limitEvents=[];for(const name of ['compositionstart','compositionupdate','compositionend','input','keydown'])document.addEventListener(name,e=>{if(e.target.matches('[aria-label=全文搜索内容],[aria-label=搜索文件掩码]'))window.__limitEvents.push({name,field:e.target.getAttribute('aria-label'),value:e.target.value,data:e.data,key:e.key,composing:e.isComposing,trusted:e.isTrusted,at:performance.now()})},true);true");
 const replace = async (selector, text) => { await app.click(selector); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) }); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); if (text) await app.cdp('Input.insertText', { text }); };
 const value = selector => app.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`);
 const native = async (from, q, m) => poll(async () => (await observeContentSearch(app)).slots.slice(from).findLast(x => x.input.query === q && x.input.mask === m && x.delivered), 'fresh native query/mask');
 for (const theme of ['light', 'dark']) {
  if (await app.evaluate("document.documentElement.classList.contains('ydark')") !== (theme === 'dark')) await app.click('.topbar-actions .icon-button'); await app.click('[aria-label="在文件中搜索"]');
  stage = theme + ':attributes'; r.attributes = await app.evaluate("[...document.querySelectorAll('[aria-label=全文搜索内容],[aria-label=搜索文件掩码]')].map(x=>({label:x.getAttribute('aria-label'),maxLength:x.maxLength}))"); assert(r.attributes.every(x => x.maxLength === 256), 'Both query and mask must have maxLength256');
  for (const field of ['query', 'mask']) for (const mode of ['text', 'browser composition']) {
   const unit = mode === 'text' ? 'q' : '中', samples = [unit.repeat(255), unit.repeat(256), unit.repeat(257), unit.repeat(254) + '🙂', unit.repeat(255) + '🙂', unit.repeat(254) + '🙂x'];
   for (const [index, text] of samples.entries()) {
    stage = `${theme}:${field}:${mode}:${index}`; console.log('R08 stage', stage);
    await replace(mask, ''); await replace(query, 'steadyToken'); await app.waitFor("document.querySelector('.fw-search-results')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('.fw-search-results [role=option]').length===1"); await pause(70);
    const selector = field === 'query' ? query : mask; await app.click(selector); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) });
    const from = (await observeContentSearch(app)).slots.length, eventAt = await app.evaluate('window.__limitEvents.length'); let during;
    if (mode === 'browser composition') {
     await app.cdp('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); await pause(90); during = { value: await value(selector), slots: (await observeContentSearch(app)).slots.length }; assert.equal(during.slots, from, 'Composition must not submit early');
     await app.key('Enter', 'Enter'); assert(await app.evaluate(app.exists('.fw-search-dialog')), 'Composition Enter must not open an old result');
    }
    await app.cdp('Input.insertText', { text }); const expected = clamp(text); await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(expected)}`); const actual = await value(selector); assert(actual.isWellFormed());
    const slot = await native(from, field === 'query' ? expected : 'steadyToken', field === 'mask' ? expected : ''); assert.equal(slot.input.query.length <= 256, true); assert.equal(slot.input.mask.length <= 256, true); assert(slot.input.query.isWellFormed() && slot.input.mask.isWellFormed());
    const events = await app.evaluate(`window.__limitEvents.slice(${eventAt})`); assert(events.filter(x => x.name !== 'compositionend').every(x => x.trusted)); if (mode === 'browser composition') { assert(events.some(x => x.name === 'compositionstart')); assert(events.some(x => x.name === 'compositionend')); }
    assert(await app.evaluate(app.exists('.fw-search-dialog'))); assert.equal(await app.evaluate("document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()"), 'Sentinel selection unchanged\n');
    r.checks.push({ caseId: 'M9-T-R08', theme, field, mode, index, inputUnits: text.length, expected, actual, during, slot, events, browserCompositionEndTrust: events.filter(x => x.name === 'compositionend').map(x => x.trusted), pass: true });
   }
  }
  assert(!await app.evaluate("[...document.querySelectorAll('.fw-search-dialog button')].some(x=>/正则|大小写|whole.word|regex/i.test(x.title+' '+x.innerText))")); await app.screenshot(join(scratch, theme + '-input-limit.png')); await app.click('[aria-label="关闭全文搜索"]');
 }
 assert.equal(await readFile(join(root, 'source.ts'), 'utf8'), body); assert.equal(await readFile(join(root, 'sentinel.txt'), 'utf8'), 'Sentinel selection unchanged\n'); assert.deepEqual(app.rendererErrors, []); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.dom = await app.evaluate('document.body.innerText'); r.events = await app.evaluate('window.__limitEvents'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (installed) { r.trace = await observeContentSearch(app); r.restored = await restoreContentSearchObserver(app); assert(r.restored.start && r.restored.cancel && r.restored.send); } await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, failedStage: r.failedStage, error: r.error, artifacts: scratch })); }
