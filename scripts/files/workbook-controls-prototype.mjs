import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openElectron } from '../lib/electron-harness.mjs';
import { dragElectronElement } from '../lib/electron-drag.mjs';
const scratch = await mkdtemp('/private/tmp/willyou-workbook-controls-P-');
const r = { caseIds: ['W19','W21'].includes(process.env.WILLYOU_CONTROLS_CASES) ? ['M9-T-' + process.env.WILLYOU_CONTROLS_CASES] : ['M9-T-W19', 'M9-T-W23'], layer: 'P', at: new Date().toISOString(), scratch, checks: [], boundary: 'Original shared FileOfficePreview and model, synthetic two-sheet JSON. Explicit readonly/interactionsDisabled fixture props. Pointer/key inputs exercise actual controls; onDraft/onStateChange only observe original component callbacks. Not native IO/Office bytes or full App A.' };
let app, stage = 'setup';
const ev = (f, ...args) => app.evaluate(`(${f.toString()})(...${JSON.stringify(args)})`), wait = (f, ...args) => app.waitFor(`(${f.toString()})(...${JSON.stringify(args)})`);
async function point(s, text) { return ev((s, t) => { const e = [...document.querySelectorAll(s)].find(e => t == null || e.textContent.trim() === t); if (!e) throw Error('Missing prototype control'); e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw Error('Prototype control occluded'); return { x, y }; }, s, text ?? null); }
async function click(s, text, right = false, count = 1) { const p = await point(s, text); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: right ? 'right' : 'left', clickCount: count }) }); }
async function scene(theme, mode) {
  await ev(async (theme, mode) => {
    window.__controlsUnmount?.(); document.getElementById('office-controls-p')?.remove(); document.documentElement.dataset.theme = theme;
    const [f, react, dom] = await Promise.all([import('/src/FileOfficePreview.jsx'), import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js')]);
    document.getElementById('root').style.display = 'none'; document.title = 'P W19/W23 synthetic Office controls · file region only';
    const host = document.createElement('section'); host.id = 'office-controls-p'; host.style.cssText = 'position:fixed;inset:0;z-index:999;width:1200px;height:900px;display:flex;background:var(--bg)'; document.body.append(host);
    const root = (dom.createRoot ?? dom.default.createRoot)(host), React = react.default ?? react; window.__controlsUnmount = () => root.unmount(); window.__controlsDrafts = []; window.__controlsState = null;
    const initialValue = JSON.stringify({ sheets: [{ id: 'Data', name: 'Data', cells: [['Label', 'Value'], ['A', '3'], ['B', '4']] }, { id: 'Calc', name: 'Calc', cells: [['Formula'], ['=3+4']] }] });
    root.render(React.createElement(f.FileOfficePreview, { kind: 'xlsx', path: 'synthetic-' + mode + '.xlsx', readOnly: mode === 'readonly', initialValue, hostOptions: { interactionsDisabled: mode === 'locked' }, onDraft: text => window.__controlsDrafts.push(text), onStateChange: state => { window.__controlsState = JSON.parse(JSON.stringify(state)); } }));
  }, theme, mode);
  await wait(() => !!document.querySelector('#office-controls-p [aria-label="单元格 A1"]') && !!window.__controlsState);
}
const cell = name => '#office-controls-p [aria-label=' + JSON.stringify('单元格 ' + name) + ']';
try {
  app = await openElectron({ executable: process.env.WILLYOU_FILES_APP, userData: join(scratch, 'userdata') }); await app.cdp('Page.navigate', { url: 'http://127.0.0.1:5179/?preview=m9' }); await wait(() => !!document.querySelector('.file-workspace'));
  for (const theme of ['light', 'dark']) {
    if (process.env.WILLYOU_CONTROLS_CASES === 'W21') {
      stage = theme + ':W21-readonly'; await scene(theme, 'readonly'); const initial = await ev(() => window.__controlsDrafts.slice());
      await click('#office-controls-p .fo-sheet-tabs button', 'Calc'); await wait(() => document.querySelector('#office-controls-p .fo-sheet-tabs [aria-current=page]')?.textContent === 'Calc');
      assert.equal(await ev(() => document.querySelector('#office-controls-p .fo-sheet-tabs>div.active').draggable), false);
      const readonlyDrag = await dragElectronElement(app, '#office-controls-p .fo-sheet-tabs>div.active', '#office-controls-p .fo-sheet-tabs>div:first-of-type', { allowNoDrag: true });
      await click('#office-controls-p .fo-sheet-tabs button', 'Calc', false, 2); assert.equal(await ev(() => !!document.querySelector('#office-controls-p .fo-rename')), false);
      await click('#office-controls-p .fo-sheet-tabs button', 'Calc', true); assert.equal(await ev(() => !!document.querySelector('#office-controls-p .fo-context-menu')), false);
      await click('#office-controls-p [aria-label="新增工作表"]'); assert.deepEqual(await ev(() => window.__controlsDrafts), initial);
      stage = theme + ':W21-live'; await scene(theme, 'editable'); await click('#office-controls-p [aria-label="新增工作表"]');
      await wait(() => document.querySelectorAll('#office-controls-p .fo-sheet-tabs>div').length === 3);
      const added = await ev(() => document.querySelector('#office-controls-p .fo-sheet-tabs [aria-current=page]').textContent);
      await click('#office-controls-p .fo-sheet-tabs button', 'Data'); const liveDrag = await dragElectronElement(app, '#office-controls-p .fo-sheet-tabs>div.active', '#office-controls-p .fo-sheet-tabs>div:last-of-type');
      await wait(() => document.querySelector('#office-controls-p .fo-sheet-tabs>div:last-of-type button')?.textContent === 'Data');
      await click('#office-controls-p .fo-sheet-tabs button', 'Data', false, 2); await wait(() => !!document.querySelector('#office-controls-p .fo-rename'));
      await click('#office-controls-p [aria-label="工作表新名称"]'); for (const type of ['keyDown','keyUp']) await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,commands:['selectAll']}); await app.cdp('Input.insertText',{text:'P Renamed'});
      await click('#office-controls-p .fo-rename button[type=submit]'); await wait(() => !document.querySelector('#office-controls-p .fo-rename'));
      await click('#office-controls-p .fo-sheet-tabs button', 'P Renamed', true); await wait(() => !!document.querySelector('#office-controls-p .fo-context-menu'));
      assert.deepEqual(await ev(() => [...document.querySelectorAll('#office-controls-p .fo-context-menu [role=menuitem]')].map(e=>e.textContent)), ['查看工作表','重命名','删除']);
      await click('#office-controls-p .fo-context-menu [role=menuitem]', '查看工作表');
      stage = theme + ':W21-locked'; await scene(theme, 'locked'); const locked = await ev(() => window.__controlsDrafts.slice());
      assert.equal(await ev(() => document.querySelector('#office-controls-p .fo-sheet-tabs>div.active').draggable), false);
      const lockedDrag = await dragElectronElement(app, '#office-controls-p .fo-sheet-tabs>div.active', '#office-controls-p .fo-sheet-tabs>div:last-of-type', { allowNoDrag: true });
      await click('#office-controls-p .fo-sheet-tabs button','Data',false,2); await click('#office-controls-p .fo-sheet-tabs button','Data',true); await click('#office-controls-p [aria-label="新增工作表"]');
      assert.equal(await ev(() => !!document.querySelector('#office-controls-p .fo-rename,#office-controls-p .fo-context-menu')),false); assert.deepEqual(await ev(() => window.__controlsDrafts),locked);
      await app.screenshot(join(scratch,theme+'-W21-locked.png')); r.checks.push({caseId:'M9-T-W21',theme,readonlyDrag,readonlySelectOnly:true,liveDrag,added,liveRenameAndMenu:true,lockedDrag,lockedControlsNoMutation:true});
      continue;
    }
    stage = theme + ':W19'; await scene(theme, 'readonly'); const initial = await ev(() => window.__controlsDrafts.slice());
    await click(cell('A1')); const start = await point(cell('A1')), end = await point(cell('B3'));
    await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start }); await app.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, button: 'left', buttons: 1 });
    await app.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
    await wait(() => document.querySelector('#office-controls-p [aria-label="当前选区"]')?.textContent === 'A1:B3');
    assert.equal(await ev(() => document.querySelector('#office-controls-p [aria-label="当前选区"]').tagName), 'SPAN');
    assert(await ev(() => document.querySelector('#office-controls-p [aria-label="Insert function"]').disabled));
    await click('#office-controls-p [aria-label="Insert function"]');
    const before = await ev(() => document.querySelector('#office-controls-p [aria-label="公式栏"]').value);
    await click('#office-controls-p [aria-label="当前选区"]'); await click('#office-controls-p [aria-label="公式栏"]'); await app.cdp('Input.insertText', { text: 'MUST_NOT_CHANGE' });
    assert.equal(await ev(() => document.querySelector('#office-controls-p [aria-label="公式栏"]').value), before);
    await click('#office-controls-p .fo-sheet-tabs button', 'Calc'); await wait(() => document.querySelector('#office-controls-p .fo-sheet-tabs [aria-current=page]')?.textContent === 'Calc');
    await click(cell('A2')); await wait(() => document.querySelector('#office-controls-p [aria-label="公式栏"]')?.value === '=3+4');
    assert.deepEqual(await ev(() => window.__controlsDrafts), initial); assert.equal(await ev(() => window.__controlsState.dirty), false);
    await app.screenshot(join(scratch, theme + '-W19-readonly.png')); r.checks.push({ caseId: 'M9-T-W19', theme, dragRange: 'A1:B3', labelNotInput: true, readonlyFormulaAndFx: true, typingNoChange: true, sheetSelectable: true, noDraftMutation: true });
    if (process.env.WILLYOU_CONTROLS_CASES === 'W19') continue;
    stage = theme + ':W23-delete'; await scene(theme, 'editable'); await click('#office-controls-p .fo-sheet-tabs button', 'Calc'); await click('#office-controls-p .fo-sheet-tabs button', 'Calc', true);
    await wait(() => !!document.querySelector('#office-controls-p .fo-context-menu')); await click('#office-controls-p .fo-context-menu [role=menuitem]', '删除');
    await wait(() => ![...document.querySelectorAll('#office-controls-p .fo-sheet-tabs button')].some(e => e.textContent === 'Calc'));
    assert.equal(await ev(() => document.querySelector('#office-controls-p .fo-sheet-tabs [aria-current=page]')?.textContent), 'Data');
    await click('#office-controls-p .fo-sheet-tabs button', 'Data', true); await wait(() => [...document.querySelectorAll('#office-controls-p .fo-context-menu [role=menuitem]')].some(e => e.textContent === '删除' && e.disabled));
    const beforeLast = await ev(() => window.__controlsDrafts.slice()); await click('#office-controls-p .fo-context-menu [role=menuitem]', '删除'); assert.deepEqual(await ev(() => window.__controlsDrafts), beforeLast);
    await app.screenshot(join(scratch, theme + '-W23-last-sheet.png'));
    stage = theme + ':W23-locked'; await scene(theme, 'locked'); const locked = await ev(() => window.__controlsDrafts.slice());
    await click('#office-controls-p .fo-sheet-tabs button', 'Calc', true); assert.equal(await ev(() => !!document.querySelector('#office-controls-p .fo-context-menu')), false);
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 });
    assert.equal(await ev(() => !!document.querySelector('#office-controls-p .fo-context-menu')), false); assert.deepEqual(await ev(() => window.__controlsDrafts), locked);
    assert.equal(await ev(() => window.__controlsState.canEdit), false); r.checks.push({ caseId: 'M9-T-W23', theme, activeSheetDeletion: true, lastSheetProtected: true, lockedPointerAndKeyboardNoMutation: true });
  }
  assert.deepEqual(app.rendererErrors, []); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, failedStage: r.failedStage, error: r.error })); }
