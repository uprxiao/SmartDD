import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-workbook-preview-A-'), root = join(scratch, 'project'); await mkdir(root);
const fixtures = resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/fixtures-office-preview-f18');
const names = ['rich-merged.xlsx', 'SimpleMacro.xlsm']; for (const name of names) await copyFile(join(fixtures, name), join(root, name));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprints = async () => Object.fromEntries(await Promise.all(names.map(async name => { const file = join(root, name), s = await stat(file, { bigint: true }); return [name, { sha256: sha(await readFile(file)), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }]; })));
const r = { caseId: 'M9-T-F18', layer: 'A', at: new Date().toISOString(), scratch, root, executable, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), fixtures: JSON.parse(await readFile(join(fixtures, 'manifest.json'), 'utf8')), before: await fingerprints(), checks: [], status: 'running', boundary: 'Original packaged A, actual file tree/source routing, Office Worker/native read and DOM pointer/keyboard events. Public fixtures only. XLSM opened solely in WillYou; no external Office handoff or macro runner. Source bytes/parts and macro project preserved by read-only preview, not a claim of XLSM writeback. No clipboard, direct Store mutation or fabricated renderer/worker results.' };
let app, observed = false, stage = 'setup';
const ev = (fn, ...args) => app.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = (fn, ...args) => app.waitFor(`(${fn.toString()})(...${JSON.stringify(args)})`, 30000);
const cell = (row, col) => `.fw-office [role=gridcell][data-office-row="${row}"][data-office-column="${col}"]`;
const formula = () => ev(() => ({ text: document.querySelector('.fw-office [aria-label="公式栏"]')?.value, readOnly: document.querySelector('.fw-office [aria-label="公式栏"]')?.readOnly, address: document.querySelector('.fw-office [aria-label="当前选区"]')?.textContent }));
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'F18 XLSX and XLSM preview A', inspectMain: true });
  await installFileMethodObserver(app, ['openOffice', 'officeWindow', 'officeCell', 'closeOffice', 'saveOffice', 'editOffice', 'officeSheet']); observed = true;
  for (const theme of ['light', 'dark']) {
    await app.invoke('appSettings.update', 'theme', 'y' + theme); stage = theme + ':xlsx';
    await app.open('rich-merged.xlsx'); await wait(s => document.querySelector(s)?.textContent === 'Label', cell(0, 0));
    // Keep the workbook for explicit close checks; opening another file would
    // otherwise correctly replace this unpinned preview slot.
    const tabPoint = await ev(() => { const e = document.querySelector('.fw-tab [role=tab][aria-selected=true]'), b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...tabPoint, button: 'left', clickCount: 2 });
    await wait(() => !document.querySelector('.fw-tab [role=tab][aria-selected=true]').closest('.fw-tab').classList.contains('preview'));
    assert.equal(await ev(() => !!document.querySelector('.fw-unsupported')), false);
    assert.deepEqual(await ev(() => [...document.querySelectorAll('.fw-office-sheets button')].map(e => e.textContent).filter(Boolean)), ['Data', 'Calc', 'Spare']);
    await wait(s => document.querySelector(s)?.getAttribute('aria-colspan') === '2' && document.querySelector(s)?.textContent === 'MERGED_PREVIEW_中文', cell(4, 0));
    const merge = await ev(s => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return { text: e.textContent, colspan: e.getAttribute('aria-colspan'), rowspan: e.getAttribute('aria-rowspan'), width: b.width }; }, cell(4, 0));
    await app.screenshot(join(scratch, theme + '-xlsx-merged.png'));
    await app.click('.fw-office-sheets button', 'Calc');
    await wait(s => document.querySelector(s)?.textContent === 'B2', cell(1, 0));
    await app.click(cell(1, 1)); await wait(() => document.querySelector('.fw-office [aria-label="公式栏"]')?.value === '=Data!$B$2+Data!B3');
    const equation = await formula(); assert.equal(equation.address, 'B2');
    await app.click('.fw-office-sheets button', 'Spare'); await wait(() => [...document.querySelectorAll('.fw-office-sheets button')].some(e => e.textContent === 'Spare' && e.getAttribute('aria-current') === 'page'));
    await app.click('.fw-office-sheets button', 'Data'); await wait(s => document.querySelector(s)?.textContent === 'Label', cell(0, 0));
    assert.equal(await ev(() => !!document.querySelector('.fw-dirty')), false);
    r.checks.push({ theme, file: 'rich-merged.xlsx', sheets: ['Data', 'Calc', 'Spare'], merge, equation, noUnsupportedFallback: true });
    stage = theme + ':xlsm'; await app.open('SimpleMacro.xlsm'); await wait(s => document.querySelector(s)?.textContent === 'This is a macro workbook', cell(0, 0));
    await wait(() => document.querySelector('.fw-office-header .fw-office-state')?.textContent === '只读');
    assert(await ev(() => [...document.querySelectorAll('.fw-office [role=status]')].some(e => e.textContent.includes('不执行宏'))));
    assert(await ev(() => document.querySelector('.fw-office [aria-label="Insert function"]').disabled));
    assert.equal(await ev(() => !!document.querySelector('[aria-label="保存工作簿"]')), false);
    await app.click(cell(0, 0)); await wait(() => document.querySelector('.fw-office [aria-label="公式栏"]')?.value === 'This is a macro workbook');
    const beforeInput = await formula(); assert(beforeInput.readOnly);
    await app.click('.fw-office [aria-label="公式栏"]'); await app.cdp('Input.insertText', { text: 'M9_MUST_NOT_WRITE' }); assert.deepEqual(await formula(), beforeInput);
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'F2', code: 'F2', windowsVirtualKeyCode: 113 });
    assert.equal(await ev(() => !!document.querySelector('.fw-office-cell input')), false);
    for (const name of ['Sheet2', 'Sheet3', 'Sheet1']) { await app.click('.fw-office-sheets button', name); await wait(n => [...document.querySelectorAll('.fw-office-sheets button')].some(e => e.textContent === n && e.getAttribute('aria-current') === 'page'), name); }
    await wait(s => document.querySelector(s)?.textContent === 'This is a macro workbook', cell(0, 0));
    await app.screenshot(join(scratch, theme + '-xlsm-readonly.png'));
    r.checks.push({ theme, file: 'SimpleMacro.xlsm', readonlyFormula: beforeInput, macroNotice: await ev(() => [...document.querySelectorAll('.fw-office [role=status]')].map(e => e.textContent)), noWriteFromKeyboard: true, threeSheetsReachable: true });
    await app.click('[aria-label="关闭 SimpleMacro.xlsm"]'); await app.click('[aria-label="关闭 rich-merged.xlsx"]');
  }
  r.trace = await observeFileMethods(app); assert.equal(r.trace.filter(x => ['saveOffice', 'editOffice', 'officeSheet'].includes(x.method)).length, 0);
  for (const x of r.trace.filter(x => x.delivered)) { assert.equal(x.input, x.inputAfter); assert.equal(x.before, x.after); }
  const macroLoads = r.trace.filter(x => x.method === 'openOffice' && x.delivered && x.output.workbook.kind === 'xlsm'); assert.equal(macroLoads.length, 2); assert(macroLoads.every(x => x.output.calculation.message.includes('不执行宏')));
  r.after = await fingerprints(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []);
  r.restored = await restoreFileMethodObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean));
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()"); r.exit = await app.waitForExit(); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.error = String(error); r.failedStage = stage; process.exitCode = 1; if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (observed) try { r.cleanupRestore = await restoreFileMethodObserver(app); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, failedStage: r.failedStage, error: r.error })); }
