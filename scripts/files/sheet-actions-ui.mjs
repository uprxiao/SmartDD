import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { dragElectronElement } from '../lib/electron-drag.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';
const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-sheet-actions-A-'), root = join(scratch, 'project'); await mkdir(root);
const names = ['light-sheet-actions.xlsx', 'dark-sheet-actions.xlsx']; for (const name of names) await copyFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/fixtures-office-preview-f18/rich-merged.xlsx'), join(root, name));
const sha = x => createHash('sha256').update(x).digest('hex');
const inspect = name => JSON.parse(execFileSync('python3', [resolve('scripts/files/inspect-sheet-actions.py'), join(root, name)], { encoding: 'utf8' }));
const r = { at: new Date().toISOString(), caseId: 'M9-T-W22', layer: 'A', scratch, root, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: Object.fromEntries(names.map(name => [name, inspect(name)])), checks: [], status: 'running', boundary: 'Original packaged A and native workbook save/reopen. Drag data is intercepted only from a real pointer-triggered dragstart, delivered unchanged to actual sheet drop target. Double click/rename dialog/invalid-name input/context menus/save/close/reopen use trusted inputs. Original RPC observed only; independent Python ZIP/XML checks order, stable sheet IDs and formula references. No Store/DOM value setters, fake mutation/save result, clipboard, models or external Office app.' };
let app, observed = false, stage = 'setup';
const ev = (f, ...args) => app.evaluate(`(${f.toString()})(...${JSON.stringify(args)})`), wait = (f, ...args) => app.waitFor(`(${f.toString()})(...${JSON.stringify(args)})`, 30000);
const order = () => ev(() => [...document.querySelectorAll('.fw-office-sheets button')].map(e => e.textContent).filter(Boolean));
const waitOrder = names => wait(names => JSON.stringify([...document.querySelectorAll('.fw-office-sheets button')].map(e => e.textContent).filter(Boolean)) === JSON.stringify(names), names);
async function input(text) {
  const selector = '[aria-label="工作表新名称"]'; await app.click(selector);
  for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
  if (text) await app.cdp('Input.insertText', { text }); else for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await wait(text => document.querySelector('[aria-label="工作表新名称"]')?.value === text, text);
}
async function sheetPointer(name, button = 'left', count = 1) {
  const p = await ev(name => { const e = [...document.querySelectorAll('.fw-office-sheets button')].find(e => e.textContent === name); if (!e) throw Error('Missing actual sheet'); e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw Error('Actual sheet occluded'); return { x, y }; }, name);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button, clickCount: count }) });
}
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'W22 sheet sorting and rename A', inspectMain: true });
  await installFileMethodObserver(app, ['openOffice', 'closeOffice', 'officeSheet', 'saveOffice', 'officeCell']); observed = true;
  for (const theme of ['light', 'dark']) {
    stage = theme + ':open'; const name = theme + '-sheet-actions.xlsx'; await app.invoke('appSettings.update', 'theme', 'y' + theme); await app.open(name); await waitOrder(['Data', 'Calc', 'Spare']);
    await wait(() => document.querySelector('.fw-office-header .fw-office-state')?.textContent === '可编辑' && document.querySelector('[data-office-row="0"][data-office-column="0"]')?.textContent === 'Label');
    const opened = (await observeFileMethods(app)).findLast(x => x.method === 'openOffice' && x.delivered).output;
    stage = theme + ':drag'; const drag = await dragElectronElement(app, '.fw-office-sheets button[draggable="true"][aria-current="page"]', '.fw-office-sheets button[draggable="true"]:last-of-type');
    assert(drag.data.items.some(x => x.mimeType === 'application/x-willyou-sheet')); await waitOrder(['Calc', 'Spare', 'Data']);
    stage = theme + ':double-click-and-invalid-names'; await sheetPointer('Data', 'left', 2); await wait(() => document.querySelector('[aria-label="工作表新名称"]')?.value === 'Data');
    await input(''); assert(await ev(() => document.querySelector('.fw-office-sheet-rename button[type=submit]').disabled)); assert.deepEqual(await order(), ['Calc', 'Spare', 'Data']);
    await input('Calc'); await app.click('.fw-office-sheet-rename button[type=submit]'); await wait(() => !!document.querySelector('.fw-office-sheet-rename [role=alert]'));
    assert.deepEqual(await order(), ['Calc', 'Spare', 'Data']); const duplicateError = await ev(() => document.querySelector('.fw-office-sheet-rename [role=alert]').textContent);
    await input('Renamed 中文'); await app.click('.fw-office-sheet-rename button[type=submit]'); await wait(() => !document.querySelector('.fw-office-sheet-rename')); await waitOrder(['Calc', 'Spare', 'Renamed 中文']);
    stage = theme + ':menu-rename'; await sheetPointer('Renamed 中文', 'right'); await wait(() => !!document.querySelector('.fw-office-sheet-menu')); await app.click('.fw-office-sheet-menu [role=menuitem]', '重命名');
    await wait(() => document.querySelector('[aria-label="工作表新名称"]')?.value === 'Renamed 中文'); await input('Final Data'); await app.click('.fw-office-sheet-rename button[type=submit]'); await wait(() => !document.querySelector('.fw-office-sheet-rename')); await waitOrder(['Calc', 'Spare', 'Final Data']);
    stage = theme + ':view-and-formula'; await sheetPointer('Calc', 'right'); await wait(() => !!document.querySelector('.fw-office-sheet-menu')); await app.click('.fw-office-sheet-menu [role=menuitem]', '查看工作表');
    await wait(() => document.querySelector('.fw-office-sheets [aria-current=page]')?.textContent === 'Calc'); await app.click('[data-office-row="1"][data-office-column="1"]');
    const formula = "='Final Data'!$B$2+'Final Data'!B3"; await wait(text => document.querySelector('.fw-office [aria-label="公式栏"]')?.value === text, formula);
    stage = theme + ':save'; await wait(() => !!document.querySelector('[aria-label="保存工作簿"]') && document.querySelector('.fw-office-header .fw-office-state')?.textContent === '可编辑');
    if (await ev(() => !document.querySelector('[aria-label="保存工作簿"]').disabled)) { await app.click('[aria-label="保存工作簿"]'); await wait(() => document.querySelector('.fw-footer [role=status]')?.textContent === '已保存'); }
    const saved = inspect(name); assert.deepEqual(saved.sheets.map(s => s.name), ['Calc', 'Spare', 'Final Data']); assert.equal(saved.sheets[2].sheetId, r.before[name].sheets[0].sheetId); assert.equal(saved.formulaB2, formula.slice(1));
    await app.screenshot(join(scratch, theme + '-saved-rename.png'));
    stage = theme + ':close-reopen'; await app.click('[aria-label=' + JSON.stringify('关闭 ' + name) + ']'); await wait(name => ![...document.querySelectorAll('.fw-tab [role=tab]')].some(e => e.title.endsWith('/' + name)), name);
    await app.open(name); await waitOrder(['Calc', 'Spare', 'Final Data']); const reopened = (await observeFileMethods(app)).findLast(x => x.method === 'openOffice' && x.delivered).output;
    assert.notEqual(reopened.id, opened.id); assert.equal(reopened.hash, saved.sha256); assert.deepEqual(reopened.workbook.sheets.map(s => s.name), ['Calc', 'Spare', 'Final Data']); assert.equal(inspect(name).sha256, saved.sha256);
    r.checks.push({ theme, drag, duplicateError, emptyNameDisabled: true, doubleClickRename: 'Renamed 中文', menuRename: 'Final Data', viewPage: 'Calc', formula, saved, reopenedSession: { id: reopened.id, hash: reopened.hash }, stableSheetIdentity: true });
    await app.click('[aria-label=' + JSON.stringify('关闭 ' + name) + ']');
  }
  r.trace = await observeFileMethods(app); for (const x of r.trace.filter(x => x.delivered)) { assert.equal(x.input, x.inputAfter); assert.equal(x.before, x.after); }
  r.restored = await restoreFileMethodObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean)); assert.deepEqual(app.rendererErrors, []);
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()"); r.exit = await app.waitForExit(); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (observed) try { r.cleanupRestore = await restoreFileMethodObserver(app); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, failedStage: r.failedStage, error: r.error })); }
