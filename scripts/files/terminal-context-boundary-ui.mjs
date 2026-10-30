import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openTaskFileFixture } from '../lib/task-file-fixture.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { installTerminalRpcObserver, holdTerminalRpc, observeTerminalRpcs, releaseTerminalRpcs, restoreTerminalRpcObserver } from '../lib/terminal-rpc-observer.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-terminal-context-boundary-app-'), root = join(scratch, 'A'), extraRoot = join(scratch, 'B'); await mkdir(root); await mkdir(extraRoot);
const files = { 'a.ts': 'const greeting = "中文🙂";', 'b.ts': 'const other = 2;', 'failure.ts': 'const failure = 1;', 'late-failure.ts': 'const failure = 2;', 'c4000.txt': '中'.repeat(4000), 'c4001.txt': '中'.repeat(4001), 'pair.txt': 'a'.repeat(3999) + '🙂', 'l200.txt': Array(200).fill('x').join('\n'), 'l201.txt': Array(201).fill('x').join('\n') };
for (const boundary of ['task', 'root', 'close']) files['failed-' + boundary + '.ts'] = 'const delayedFailure = "' + boundary + '";';
for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text); await writeFile(join(extraRoot, 'b.ts'), 'B root selection');
const sha = value => createHash('sha256').update(value).digest('hex'), resources = resolve(dirname(executable), '../Resources');
const result = { startedAt: new Date().toISOString(), executable, scratch, asarSha256: sha(await readFile(join(resources, 'app.asar'))), checks: [], status: 'running', boundary: 'Real packaged App pointer/keyboard selections, dialogs, tray and input-only raw PTYs. Public IPC creates own two tasks/project and stops own task; observer delays original authenticated RPC input/response unchanged. Real same-path inode replacement produces original source refusal. No model, clipboard, Store/editor/DOM value mutation, forged receipts or daily data. CM state is read-only for selection/document assertions.' };
let fixture, app, installed = false, stage = 'setup', expected = { T1: '', T2: '' };
const poll = async (fn, label) => { const end = Date.now() + 12000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(15); } throw Error('Timed out: ' + label); };
try {
 fixture = await openTaskFileFixture({ executable, scratch, root, extraRoot, name: 'M9 H34 S08 terminal context', receiverScript: 'scripts/files/context-receiver.py' }); app = fixture.app; await installTerminalRpcObserver(app); installed = true;
 const view = 'document.querySelector(".cm-content")?.cmTile?.root?.view', noTray = '!document.querySelector(".fw-refs")', noWorkspace = '!document.querySelector("[data-testid=file-workspace]")';
 const trace = () => observeTerminalRpcs(app), insertCount = async () => (await trace()).rows.filter(x => x.method === 'terminalInsert').length;
 const receiver = async label => poll(async () => { try { const value = await fixture.receiver(label); return value.rawHex === Buffer.from(expected[label]).toString('hex') ? value : null; } catch { return null; } }, label + ' exact raw bytes');
 const unchanged = async () => { const states = {}; for (const label of ['T1', 'T2']) { states[label] = await receiver(label); assert.equal(states[label].unbracketedNewlines, 0); assert.equal(states[label].executedCommands, 0); } return states; };
 const status = () => app.evaluate("[...document.querySelectorAll('.fw-refs [role=status],.fw-save-strip[role=status]')].map(e=>e.textContent).join('|')");
 const state = async () => ({ text: await status(), refs: await app.evaluate("document.querySelectorAll('.fw-refs li').length"), inserts: await insertCount(), receivers: await unchanged() });
 const record = async (scenario, extra = {}) => { result.checks.push({ caseIds: ['M9-T-H34', 'M9-T-S08'], scenario, ...await state(), ...extra, pass: true }); console.log('terminal case', result.checks.length, scenario); };
 const clear = async () => { if (await app.evaluate(app.exists('.fw-refs'))) await app.click('.fw-refs button', '清空'); await app.waitFor(noTray); };
 const rootSelect = async path => { if (await app.evaluate(`document.querySelector('.fw-root-folder')?.title===${JSON.stringify(path)}`)) return; await app.click('[aria-label=文件目录来源]'); await app.click(`.fw-file-menu [role=menuitem][title=${JSON.stringify(path)}]`); await app.waitFor(`document.querySelector('.fw-root-folder')?.title===${JSON.stringify(path)}`); };
 const open = async name => {
  await rootSelect(root);
  // Actual virtual tree rows must be revealed by real wheel input.
  if (!await app.evaluate(app.exists(app.tree(name)))) {
   const point = await app.evaluate("(()=>{const r=document.querySelector('.fw-tree-scroll').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
   for (const deltaY of [-4000, 350, 350, 350, 350]) { await app.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY }); await pause(35); if (await app.evaluate(app.exists(app.tree(name)))) break; }
  }
  await app.open(name); await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(files[name])}`);
 };
 const selectAll = async () => { await app.click('.cm-content'); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) }); await app.waitFor(`${view}?.state.selection.main.from===0&&${view}?.state.selection.main.to===${view}?.state.doc.length`); };
 const selectionMenu = async () => { await selectAll(); const point = await app.evaluate("(()=>{const e=document.querySelector('.cm-content'),r=e.getBoundingClientRect(),p=e.closest('.cm-scroller').getBoundingClientRect();return{x:Math.max(r.left,p.left)+20,y:Math.max(r.top,p.top)+8}})()"); for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, button: 'right', clickCount: 1, ...point }); await app.waitFor(app.exists('[role=menuitem]')); };
 const fill = async (selector, text) => { await app.click(selector); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) }); await app.cdp('Input.insertText', { text }); };
 const dialog = async (name, comment) => { await open(name); await selectionMenu(); await app.click('[role=menuitem]', '让 CLI 修改所选代码…'); await app.waitFor(app.exists('[role=dialog]')); assert.equal(await app.evaluate("document.querySelector('.fw-ai-selection').textContent"), files[name]); await fill('[aria-label="所选代码的 CLI 指令"]', comment); };
 const add = async (name = 'a.ts', comment = 'Explain this selection.') => { await dialog(name, comment); await app.click('[role=dialog] button', '加入终端引用'); await app.waitFor(noDialog); await app.waitFor(app.exists('.fw-refs')); };
 const noDialog = '!document.querySelector("[role=dialog]")';
 const includeText = async () => { if (!await app.evaluate("document.querySelector('.fw-refs input[type=checkbox]').checked")) await app.click('.fw-refs input[type=checkbox]'); };
 const preview = async () => { if (!await app.evaluate("document.querySelector('.fw-refs details')?.open")) await app.click('.fw-refs summary'); return app.evaluate("document.querySelector('.fw-refs pre').textContent"); };
 const insert = () => app.click('.fw-refs button', '插入到终端输入');
 const held = () => poll(async () => (await trace()).slots.find(x => x.waiting), 'original RPC held');
 const release = async () => { await releaseTerminalRpcs(app); await poll(async () => !(await trace()).slots.some(x => x.waiting), 'original RPC released'); };
 const send = async text => { const count = await insertCount(); await insert(); await app.waitFor("document.querySelector('.fw-save-strip')?.textContent.includes('已插入终端输入，尚未提交')"); expected.T1 += '\x1b[200~' + text.replace(/\n/g, '\r') + '\x1b[201~'; await receiver('T1'); assert.equal(await insertCount(), count + 1); };
 await poll(async () => { try { return (await fixture.receiver('T1')).bracketedMode && (await fixture.receiver('T2')).bracketedMode; } catch { return false; } }, 'two isolated raw receivers');

 stage = 'no terminal / dialog cancellation'; await dialog('a.ts', 'Cancelled instruction'); const initial = await insertCount(); await app.click('[role=dialog] button', '取消'); await app.waitFor(noDialog); await app.waitFor(noTray); assert.equal(await insertCount(), initial); await record('instruction cancellation before collection');
 await add(); await app.waitFor("document.querySelector('.fw-refs')?.textContent.includes('当前没有可用的任务终端')"); assert(await app.evaluate("[...document.querySelectorAll('.fw-refs button')].find(e=>e.textContent==='插入到终端输入').disabled")); await clear(); assert.equal(await insertCount(), initial); await record('project view has no target; collect/preview/clear without PTY writes');

 await fixture.show('T1');
 for (const boundary of ['clear', 'root']) {
  stage = 'cancel before dispatch ' + boundary; await add(); const count = await insertCount(); await holdTerminalRpc(app, 'terminalPrepare', 'after'); await insert(); await held();
  if (boundary === 'clear') await clear(); else await rootSelect(extraRoot);
  await release(); await pause(80); assert.equal(await insertCount(), count); await app.waitFor(noTray); await record('before dispatch cancellation: ' + boundary); await rootSelect(root);
 }

 stage = 'obsolete captured content instance'; await open('a.ts'); await selectionMenu(); await holdTerminalRpc(app, 'open', 'after', 'a.ts'); await app.click('[role=menuitem]', '添加所选内容到终端引用'); await held(); await app.open('b.ts'); await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(files['b.ts'])}`); await release(); await app.waitFor(noTray); await app.waitFor("document.querySelector('.fw-save-strip')?.textContent.includes('选区内容已改变')"); await record('old capture callback rejected after editor instance replacement');

 for (const late of [false, true]) {
  stage = 'original explicit failure ' + late; const name = late ? 'late-failure.ts' : 'failure.ts'; await add(name, 'Keep context on source refusal'); const count = await insertCount(); await holdTerminalRpc(app, 'terminalInsert', 'before'); await insert(); await held();
  await writeFile(join(root, name + '.replacement'), 'replacement source inode'); await rename(join(root, name + '.replacement'), join(root, name));
  if (late) { await app.waitFor("document.querySelector('.fw-refs')?.textContent.includes('插入结果未知')"); assert.equal(await insertCount(), count + 1); assert(await app.evaluate("[...document.querySelectorAll('.fw-refs button')].find(e=>e.textContent==='插入到终端输入').disabled")); await pause(100); }
  await release(); await poll(async () => { const row = (await trace()).rows.filter(x => x.method === 'terminalInsert').at(-1); return row?.deliveredAt && row.output?.state === 'failed' ? row : null; }, 'real unchanged failed receipt'); await app.waitFor("document.querySelectorAll('.fw-refs li').length===1"); assert(!/结果未知|正在插入/.test(await status())); assert.equal(await insertCount(), count + 1); await record(late ? 'timeout then original late failed receipt; no duplicate or PTY write' : 'genuine source replacement explicitly refuses before write; context retained'); await clear();
 }

 for (const boundary of ['same', 'task', 'root', 'close']) {
  stage = 'original late success ' + boundary; await fixture.show('T1'); await rootSelect(root); await add('a.ts', 'Late success ' + boundary); await includeText(); const text = await preview(), count = await insertCount(); await holdTerminalRpc(app, 'terminalInsert', 'after'); await insert(); const slot = await held(); assert.equal(slot.row.output.state, 'inserted'); expected.T1 += '\x1b[200~' + text.replace(/\n/g, '\r') + '\x1b[201~'; await receiver('T1'); await app.waitFor("document.querySelector('.fw-refs')?.textContent.includes('插入结果未知')");
  assert(await app.evaluate("[...document.querySelectorAll('.fw-refs button')].find(e=>e.textContent==='插入到终端输入').disabled")); await pause(100); assert.equal(await insertCount(), count + 1);
  if (boundary === 'task') { await fixture.show('T2'); await rootSelect(root); await add('b.ts', 'New task context must survive'); }
  if (boundary === 'root') { await rootSelect(extraRoot); await app.click(`[role=treeitem][title=${JSON.stringify(join(extraRoot, 'b.ts'))}]`); }
  if (boundary === 'close') { await app.click('[data-testid=task-files]'); await app.waitFor(noWorkspace); }
  const before = { status: await status(), refs: await app.evaluate("document.querySelector('.fw-refs')?.textContent??null"), taskId: boundary === 'task' ? fixture.tasks.T2.task.id : fixture.tasks.T1.task.id };
  await release(); await pause(80);
  if (boundary === 'same') await app.waitFor("document.querySelector('.fw-save-strip')?.textContent.includes('已插入终端输入，尚未提交')");
  else { assert.equal(await status(), before.status); assert.equal(await app.evaluate("document.querySelector('.fw-refs')?.textContent??null"), before.refs); }
  assert.equal(await insertCount(), count + 1); await record('late success after ' + boundary + '; write happened once before receipt', { before, slot });
  await fixture.show('T1'); await rootSelect(root); await clear();
 }

 for (const boundary of ['task', 'root', 'close']) {
  stage = 'original late failure after ' + boundary; const name = 'failed-' + boundary + '.ts'; await fixture.show('T1'); await add(name, 'Original failed receipt ' + boundary); const count = await insertCount();
  await holdTerminalRpc(app, 'terminalInsert', 'before'); await insert(); await held(); await writeFile(join(root, name + '.replacement'), 'replacement source inode'); await rename(join(root, name + '.replacement'), join(root, name));
  // Let the original service actually refuse the replaced inode, then hold its
  // unchanged failed receipt. The next gate is not a replacement result.
  await holdTerminalRpc(app, 'terminalInsert', 'after'); await releaseTerminalRpcs(app);
  const slot = await poll(async () => (await trace()).slots.find(x => x.waiting && x.phase === 'after' && x.row.output?.state === 'failed'), 'original real failed receipt held');
  await app.waitFor("document.querySelector('.fw-refs')?.textContent.includes('插入结果未知')"); assert(Date.now() - slot.row.at >= 1450);
  if (boundary === 'task') { await fixture.show('T2'); await clear(); await add('b.ts', 'New context after failed ' + boundary); }
  if (boundary === 'root') await rootSelect(extraRoot);
  if (boundary === 'close') { await app.click('[data-testid=task-files]'); await app.waitFor(noWorkspace); }
  const before = { status: await status(), refs: await app.evaluate("document.querySelector('.fw-refs')?.textContent??null") }; await release(); await pause(80);
  assert.equal(await status(), before.status); assert.equal(await app.evaluate("document.querySelector('.fw-refs')?.textContent??null"), before.refs); assert.equal(await insertCount(), count + 1);
  await record('late genuine failure after ' + boundary + ' cannot overwrite new instance', { before, slot }); await fixture.show('T1'); await rootSelect(root); await clear();
 }

 for (const [name, selected, truncated] of [['c4000.txt', '中'.repeat(4000), false], ['c4001.txt', '中'.repeat(4000), true], ['pair.txt', 'a'.repeat(3999), true], ['l200.txt', Array(200).fill('x').join('\n'), false], ['l201.txt', Array(200).fill('x').join('\n'), true]]) {
  stage = 'selection limit ' + name; await add(name, 'Boundary'); await includeText(); const lines = files[name].split('\n').length, location = 'L1' + (lines > 1 ? '-' + lines : ''), text = name + ':' + location + '\n> Boundary\n' + selected.split('\n').map(line => '    ' + line).join('\n') + (truncated ? '\n    …（已截断）' : ''); assert.equal(await preview(), text); assert.equal((await status()).includes('处选区已截断'), truncated); await send(text); await record('selection bound ' + name, { textLength: text.length, selectedUtf16: files[name].length, selectedLines: lines, truncated });
 }
 for (const total of [7999, 8000, 8001]) {
  stage = 'aggregate ' + total; const name = 'a.ts', prefix = 'a.ts:L1\n> ', comment = 'i'.repeat(total - prefix.length); await add(name, comment); if (await app.evaluate("document.querySelector('.fw-refs input[type=checkbox]').checked")) await app.click('.fw-refs input[type=checkbox]'); const count = await insertCount();
  if (total <= 8000) { const text = prefix + comment; assert.equal(text.length, total); assert.equal(await preview(), text); await send(text); }
  else { assert.equal(await preview(), ''); assert((await status()).includes('8001')); assert(await app.evaluate("[...document.querySelectorAll('.fw-refs button')].find(e=>e.textContent==='插入到终端输入').disabled")); assert.equal(await insertCount(), count); await clear(); }
  await record('aggregate bound ' + total);
 }

 stage = 'stopped target'; await add('a.ts', 'Stopped task retains context'); const count = await insertCount(); await app.invoke('tasks.kill', fixture.tasks.T1.task.id); await app.waitFor("document.querySelector('.fw-refs')?.textContent.includes('当前没有可用的任务终端')"); assert.equal((await app.invoke('tasks.get', fixture.tasks.T1.task.id)).ptyId, null); assert(await app.evaluate("[...document.querySelectorAll('.fw-refs button')].find(e=>e.textContent==='插入到终端输入').disabled")); assert.equal(await insertCount(), count); await record('actual stopped task removes target; no insertion or automatic restart'); await clear();

 result.trace = await trace(); for (const row of result.trace.rows) if (row.deliveredAt) assert.equal(row.before, row.after); assert.deepEqual(app.rendererErrors, []);
 const taskIds = (await app.invoke('tasks.list')).map(x => x.id).sort(); assert.deepEqual(taskIds, Object.values(fixture.tasks).map(x => x.task.id).sort());
 result.sourceHashes = {}; for (const [name, text] of Object.entries(files)) { const actual = await readFile(join(root, name), 'utf8'), changedForFault = name.includes('failure') || name.startsWith('failed-'); assert.equal(actual, changedForFault ? 'replacement source inode' : text); result.sourceHashes[name] = { initial: sha(text), final: sha(actual), changedForFault }; } assert.equal(await readFile(join(extraRoot, 'b.ts'), 'utf8'), 'B root selection');
 await app.screenshot(join(scratch, 'completed.png'));
 result.restored = await restoreTerminalRpcObserver(app); installed = false; assert(Object.values(result.restored).every(Boolean));
 await app.invoke('tasks.kill', fixture.tasks.T2.task.id); await writeFile(join(scratch, 'electron.log'), app.logs()); await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()"); result.exit = await app.waitForExit(20000); assert.equal(result.exit.code, 0); assert.equal(result.exit.signal, null); await app.close(); app = null; fixture = null; result.status = 'passed';
} catch (error) { result.status = 'failed'; result.failedStage = stage; result.error = String(error); process.exitCode = 1; if (app) try { result.dom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (installed) { result.failureTrace = await observeTerminalRpcs(app); result.restored = await restoreTerminalRpcObserver(app); } await writeFile(join(scratch, 'failure-electron.log'), app.logs()); await fixture.close(); } result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, checks: result.checks.length, failedStage: result.failedStage, error: result.error, artifacts: scratch })); }
