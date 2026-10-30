// W19/W23: original packaged controls; shared native-focus input is serial.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, chmod, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { dragElectronElement } from '../lib/electron-drag.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';
const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-workbook-controls-A-'), root = join(scratch, 'project'); await mkdir(root);
const source = resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/fixtures-office-preview-f18/rich-merged.xlsx'), names = [];
for (const theme of ['light', 'dark']) for (const mode of ['readonly', 'structure']) {
  const name = theme + '-' + mode + '.xlsx'; names.push(name); const path = join(root, name); await copyFile(source, path);
  if (mode === 'readonly') {
    // Distinct visible content prevents a previous workbook's ready grid from
    // satisfying the next file's wait while its actual window is still loading.
    execFileSync('python3', ['-c', 'import sys,zipfile,os\np=sys.argv[1]\nwith zipfile.ZipFile(p) as z: rows=[(i,z.read(i.filename)) for i in z.infolist()]\nwith zipfile.ZipFile(p+".new","w") as z:\n for i,b in rows:\n  if i.filename=="xl/worksheets/sheet1.xml": b=b.replace(b">Label<",(">"+sys.argv[2]+"<").encode())\n  z.writestr(i,b)\nos.replace(p+".new",p)', path, 'W19 ' + theme + ' readonly']);
    await chmod(path, 0o444);
  }
}
const sha = x => createHash('sha256').update(x).digest('hex'), fp = async name => { const p = join(root, name), s = await stat(p, { bigint: true }); return { sha256: sha(await readFile(p)), inode: String(s.ino), mtimeNs: String(s.mtimeNs), mode: Number(s.mode) }; };
const inspect = name => JSON.parse(execFileSync('python3', ['-c', 'import sys,json,zipfile,xml.etree.ElementTree as E\nwith zipfile.ZipFile(sys.argv[1]) as z:\n r=E.fromstring(z.read("xl/workbook.xml")); print(json.dumps({"sheets":[n.attrib for n in r.iter() if n.tag.endswith("}sheet")],"parts":z.namelist()}))', join(root, name)], { encoding: 'utf8' }));
const r = { at: new Date().toISOString(), caseIds: ['W19','W21'].includes(process.env.WILLYOU_CONTROLS_CASES) ? ['M9-T-' + process.env.WILLYOU_CONTROLS_CASES] : ['M9-T-W19', 'M9-T-W23'], layer: 'A', scratch, root, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: Object.fromEntries(await Promise.all(names.map(async n => [n, await fp(n)]))), checks: [], status: 'running', boundary: 'A original packaged workbook and native source. Readonly is actual chmod0444; readonly text/keyboard, range pointer drag, sheet context menus and save use trusted CDP inputs. Busy uses a gate only after an original authenticated sheet RPC completed; unchanged result delivered later. No synthetic sheet results, direct Store mutation, clipboard or external Office app. Real structure save is independently checked with Python ZIP/XML.' };
let app, observed = false, gated = false, stage = 'setup';
const ev = (f, ...args) => app.evaluate(`(${f.toString()})(...${JSON.stringify(args)})`), wait = (f, ...args) => app.waitFor(`(${f.toString()})(...${JSON.stringify(args)})`, 30000);
const cell = (r, c) => `.fw-office [role=gridcell][data-office-row="${r}"][data-office-column="${c}"]`;
const button = name => '.fw-office-sheets button';
const poll = async fn => { const end = Date.now() + 15000; for (;;) { const x = await fn(); if (x) return x; assert(Date.now() < end, 'Timed out: ' + stage); await pause(30); } };
async function point(selector, text) { return ev((s, t) => { const e = [...document.querySelectorAll(s)].find(e => t == null || e.textContent.trim() === t); if (!e) throw Error('Missing actual control'); e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw Error('Actual control occluded'); return { x, y }; }, selector, text ?? null); }
async function mouse(selector, text, right = false, count = 1) { const p = await point(selector, text); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: right ? 'right' : 'left', clickCount: count }) }); }
async function closeMenu() { if (await ev(() => !!document.querySelector('.fw-office-sheet-menu'))) { await app.key('Escape', 'Escape'); await wait(() => !document.querySelector('.fw-office-sheet-menu')); } }
async function deleteSheet(name) { await mouse(button(), name, true); await wait(() => [...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent === '删除')); await app.click('[role=menuitem]', '删除'); }
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'W19 W23 workbook controls A', inspectMain: true });
  await installFileMethodObserver(app, ['openOffice', 'officeWindow', 'officeCell', 'officeSheet', 'saveOffice', 'editOffice', 'checkpointOffice', 'closeOffice']); observed = true;
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s={original:e.ipcMain._invokeHandlers.get('files.officeSheet'),next:false,slots:[]},hash=x=>process.getBuiltinModule('crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');globalThis.__sheetControlGate=s;e.ipcMain.removeHandler('files.officeSheet');e.ipcMain.handle('files.officeSheet',async(event,...args)=>{const hold=s.next;s.next=false;const value=await s.original(event,...args);if(hold){const slot={before:hash(value),waiting:true};s.slots.push(slot);await new Promise(resolve=>slot.release=()=>{slot.after=hash(value);slot.waiting=false;resolve()})}return value});return true})()"); gated = true;
  for (const theme of ['light', 'dark']) {
    if (process.env.WILLYOU_CONTROLS_CASES === 'W21') {
      await app.invoke('appSettings.update','theme','y'+theme); stage=theme+':W21-readonly'; const readonly=theme+'-readonly.xlsx', beforeRows=(await observeFileMethods(app)).length;
      await app.open(readonly); await wait((s,text)=>document.querySelector(s)?.textContent===text,cell(0,0),'W19 '+theme+' readonly');
      await wait(()=>document.querySelector('.fw-office-header .fw-office-state')?.textContent==='只读'); await app.click(button(),'Calc');
      await wait(()=>document.querySelector('.fw-office-sheets [aria-current=page]')?.textContent==='Calc');
      assert.equal(await ev(()=>document.querySelector('.fw-office-sheets [aria-current=page]').draggable),false);
      const readonlyDrag=await dragElectronElement(app,'.fw-office-sheets [aria-current=page]','.fw-office-sheets button:last-of-type',{allowNoDrag:true});
      await mouse(button(),'Calc',false,2); await mouse(button(),'Calc',true); await mouse('[aria-label="新增工作表"]');
      assert.equal(await ev(()=>!!document.querySelector('.fw-office-sheet-menu,.fw-office-sheet-rename')),false);
      assert(!(await observeFileMethods(app)).slice(beforeRows).some(x=>['editOffice','officeSheet','saveOffice'].includes(x.method))); assert.deepEqual(await fp(readonly),r.before[readonly]);
      await app.screenshot(join(scratch,theme+'-W21-readonly.png')); await app.click('[aria-label='+JSON.stringify('关闭 '+readonly)+']');
      stage=theme+':W21-live-add';const name=theme+'-structure.xlsx';await app.open(name);await wait(s=>document.querySelector(s)?.textContent==='Label',cell(0,0));
      await wait(()=>document.querySelector('.fw-office-header .fw-office-state')?.textContent==='可编辑');await app.click('[aria-label="新增工作表"]');
      await wait(()=>document.querySelectorAll('.fw-office-sheets button[draggable=true]').length===4&&document.querySelector('.fw-office-header .fw-office-state')?.textContent==='可编辑');
      const added=await ev(()=>document.querySelector('.fw-office-sheets [aria-current=page]').textContent);await mouse(button(),added,true);await wait(()=>!!document.querySelector('.fw-office-sheet-menu'));
      assert.deepEqual(await ev(()=>[...document.querySelectorAll('.fw-office-sheet-menu [role=menuitem]')].map(e=>e.textContent)),['查看工作表','重命名','删除']);await app.click('.fw-office-sheet-menu [role=menuitem]','查看工作表');
      stage=theme+':W21-busy-lock';await app.mainEvaluate('globalThis.__sheetControlGate.next=true;true');await app.click('[aria-label="新增工作表"]');await poll(()=>app.mainEvaluate('globalThis.__sheetControlGate.slots.some(x=>x.waiting)'));
      await wait(()=>document.querySelector('.fw-office-header .fw-office-state')?.textContent==='正在处理…');const lockedCount=(await observeFileMethods(app)).filter(x=>x.method==='officeSheet').length;
      assert(await ev(()=>document.querySelector('[aria-label="新增工作表"]').disabled));assert.equal(await ev(()=>document.querySelector('.fw-office-sheets [aria-current=page]').draggable),false);
      const lockedDrag=await dragElectronElement(app,'.fw-office-sheets [aria-current=page]','.fw-office-sheets button[draggable=false]',{allowNoDrag:true});
      assert(Math.hypot(lockedDrag.from.x-lockedDrag.to.x,lockedDrag.from.y-lockedDrag.to.y)>12,'Locked drag must cross to another sheet');
      await mouse(button(),added,false,2);await mouse(button(),added,true);await mouse('[aria-label="新增工作表"]');assert.equal(await ev(()=>!!document.querySelector('.fw-office-sheet-menu,.fw-office-sheet-rename')),false);
      assert.equal((await observeFileMethods(app)).filter(x=>x.method==='officeSheet').length,lockedCount);await app.mainEvaluate('globalThis.__sheetControlGate.slots.filter(x=>x.waiting).forEach(x=>x.release());true');
      await wait(()=>document.querySelectorAll('.fw-office-sheets button[draggable=true]').length===5&&document.querySelector('.fw-office-header .fw-office-state')?.textContent==='可编辑');
      if(await ev(()=>!document.querySelector('[aria-label="保存工作簿"]').disabled)){await app.click('[aria-label="保存工作簿"]');await wait(()=>document.querySelector('.fw-footer [role=status]')?.textContent==='已保存');}
      const saved=inspect(name);assert.equal(saved.sheets.length,5);await app.screenshot(join(scratch,theme+'-W21-live-and-locked.png'));
      r.checks.push({caseId:'M9-T-W21',theme,readonlyDrag,readonlySelectOnly:true,liveAdded:added,liveMenu:true,lockedDrag,lockedNoExtraRPC:true,saved,reusedLiveDragRenameEvidence:'m9-acceptance-sheet-actions-dev186-r110-20261020.json (same ASAR)'});
      await app.click('[aria-label='+JSON.stringify('关闭 '+name)+']');continue;
    }
    await app.invoke('appSettings.update', 'theme', 'y' + theme); stage = theme + ':W19'; const readonly = theme + '-readonly.xlsx';
    const marker = 'W19 ' + theme + ' readonly';
    const traceAt = (await observeFileMethods(app)).length; await app.open(readonly); await wait((s, text) => document.querySelector(s)?.textContent === text, cell(0, 0), marker);
    await wait(() => document.querySelector('.fw-office-header .fw-office-state')?.textContent === '只读');
    await app.click(cell(0, 0)); await wait(text => document.querySelector('.fw-office [aria-label="公式栏"]')?.value === text, marker);
    stage = theme + ':W19-range';
    const start = await point(cell(0, 0)), end = await point(cell(2, 1));
    await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start }); await app.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, button: 'left', buttons: 1 });
    await app.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
    await wait(() => document.querySelector('.fw-office [aria-label="当前选区"]')?.textContent === 'A1:B3');
    assert.equal(await ev(() => document.querySelector('[aria-label="当前选区"]').tagName), 'SPAN'); await app.click('[aria-label="当前选区"]');
    stage = theme + ':W19-readonly-input';
    const beforeText = await ev(() => document.querySelector('.fw-office [aria-label="公式栏"]').value);
    assert(await ev(() => document.querySelector('.fw-office [aria-label="Insert function"]').disabled));
    await mouse('.fw-office [aria-label="Insert function"]');
    await app.click('.fw-office [aria-label="公式栏"]'); await app.cdp('Input.insertText', { text: 'MUST_NOT_CHANGE' });
    assert.equal(await ev(() => document.querySelector('.fw-office [aria-label="公式栏"]').value), beforeText);
    stage = theme + ':W19-formula-selection';
    await app.click(button(), 'Calc'); await wait(() => document.querySelector('.fw-office-sheets [aria-current=page]')?.textContent === 'Calc');
    await app.click(cell(1, 1)); await wait(() => document.querySelector('.fw-office [aria-label="公式栏"]')?.value === '=Data!$B$2+Data!B3');
    assert(await ev(() => document.querySelector('.fw-office [aria-label="公式栏"]').readOnly));
    const readonlyRows = (await observeFileMethods(app)).slice(traceAt); assert(!readonlyRows.some(x => ['editOffice', 'officeSheet', 'saveOffice'].includes(x.method)));
    assert.deepEqual(await fp(readonly), r.before[readonly]); await app.screenshot(join(scratch, theme + '-W19-readonly.png'));
    r.checks.push({ caseId: 'M9-T-W19', theme, actualReadonlySource: true, pointerRange: 'A1:B3', addressIsLabel: true, textInputDidNotWrite: true, formula: '=Data!$B$2+Data!B3', sheetSelection: 'Calc', noMutationRPC: true });
    await app.click('[aria-label=' + JSON.stringify('关闭 ' + readonly) + ']');
    if (process.env.WILLYOU_CONTROLS_CASES === 'W19') continue;
    stage = theme + ':W23'; const name = theme + '-structure.xlsx'; await app.open(name); await wait(s => document.querySelector(s)?.textContent === 'Label', cell(0, 0));
    await app.click(button(), 'Spare'); await wait(() => document.querySelector('.fw-office-sheets [aria-current=page]')?.textContent === 'Spare');
    await app.mainEvaluate('globalThis.__sheetControlGate.next=true;true'); const mutationsBefore = (await observeFileMethods(app)).filter(x => x.method === 'officeSheet').length;
    await deleteSheet('Spare'); await poll(() => app.mainEvaluate('globalThis.__sheetControlGate.slots.some(x=>x.waiting)'));
    await wait(() => document.querySelector('.fw-office-header .fw-office-state')?.textContent === '正在处理…');
    await mouse(button(), 'Calc', true); assert.equal(await ev(() => !!document.querySelector('.fw-office-sheet-menu')), false);
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 });
    assert.equal(await ev(() => !!document.querySelector('.fw-office-sheet-menu')), false);
    assert.equal((await observeFileMethods(app)).filter(x => x.method === 'officeSheet').length, mutationsBefore + 1);
    await app.mainEvaluate('globalThis.__sheetControlGate.slots.filter(x=>x.waiting).forEach(x=>x.release());true');
    await wait(() => ![...document.querySelectorAll('.fw-office-sheets button')].some(e => e.textContent === 'Spare') && document.querySelector('.fw-office-header .fw-office-state')?.textContent === '可编辑');
    // Deleting the active last sheet selects its nearest surviving neighbour.
    stage = theme + ':W23-active-fallback';
    await wait(() => document.querySelector('.fw-office-sheets [aria-current=page]')?.textContent === 'Calc'); await deleteSheet('Calc');
    await wait(() => ![...document.querySelectorAll('.fw-office-sheets button')].some(e => e.textContent === 'Calc'));
    stage = theme + ':W23-last-sheet';
    await mouse(button(), 'Data', true); await wait(() => [...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent === '删除' && e.getAttribute('aria-disabled') === 'true'));
    const lastCount = (await observeFileMethods(app)).filter(x => x.method === 'officeSheet').length; await mouse('[role=menuitem]', '删除');
    assert.equal((await observeFileMethods(app)).filter(x => x.method === 'officeSheet').length, lastCount); await closeMenu();
    if (await ev(() => !document.querySelector('[aria-label="保存工作簿"]').disabled)) { await app.click('[aria-label="保存工作簿"]'); await wait(() => document.querySelector('.fw-footer [role=status]')?.textContent === '已保存'); }
    await poll(async () => inspect(name).sheets.length === 1); const disk = inspect(name); assert.deepEqual(disk.sheets.map(s => s.name), ['Data']);
    await app.screenshot(join(scratch, theme + '-W23-last-sheet.png')); r.checks.push({ caseId: 'M9-T-W23', theme, actualDeletionAndActiveFallback: true, busyPointerAndKeyboardBlocked: true, lastSheetDeleteDisabled: true, zeroExtraMutation: true, independentSavedWorkbook: disk });
    await app.click('[aria-label=' + JSON.stringify('关闭 ' + name) + ']');
  }
  r.gates = await app.mainEvaluate('globalThis.__sheetControlGate.slots.map(({before,after,waiting})=>({before,after,waiting}))'); assert(r.gates.every(x => !x.waiting && x.before === x.after));
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__sheetControlGate;s.slots.filter(x=>x.waiting).forEach(x=>x.release());e.ipcMain.removeHandler('files.officeSheet');e.ipcMain.handle('files.officeSheet',s.original);delete globalThis.__sheetControlGate;return true})()"); gated = false;
  r.trace = await observeFileMethods(app); for (const x of r.trace.filter(x => x.delivered)) { assert.equal(x.input, x.inputAfter); assert.equal(x.before, x.after); }
  r.restored = await restoreFileMethodObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean)); assert.deepEqual(app.rendererErrors, []);
  r.after = Object.fromEntries(await Promise.all(names.map(async n => [n, await fp(n)])));
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()"); stage = "normal-exit"; const quitStarted = Date.now(); r.exit = await app.waitForExit(60_000); r.quitMs = Date.now() - quitStarted; assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally {
  if (app) { if (gated) try { await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__sheetControlGate;s.slots.filter(x=>x.waiting).forEach(x=>x.release());e.ipcMain.removeHandler('files.officeSheet');e.ipcMain.handle('files.officeSheet',s.original);return true})()"); } catch {} if (observed) try { r.cleanupRestore = await restoreFileMethodObserver(app); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, failedStage: r.failedStage, error: r.error }));
}
