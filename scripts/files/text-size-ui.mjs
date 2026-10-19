import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { EDIT_BYTES, READ_BYTES, exactUtf8Text, textSizeCases, textSizeMetadata } from './text-size-fixtures.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-text-size-app-'), projectPath = join(scratch, 'project'), userData = join(scratch, 'userdata'); await mkdir(projectPath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRows = textSizeCases.flatMap(item => ['txt', 'md'].map(extension => ({ ...item, name: `${item.id}.${extension}` })));
const draftRows = [EDIT_BYTES - 1, EDIT_BYTES, EDIT_BYTES + 1, READ_BYTES - 1, READ_BYTES].map((bytes, index) => ({ name: `draft-${index}.txt`, bytes }));
draftRows.push({ name: 'saved-large.md', bytes: 21, largeDisk: true });
const allNames = [...sourceRows.map(x => x.name), ...draftRows.map(x => x.name), 'over-draft.txt', 'growth.txt', 'growth.md'];
for (const item of sourceRows) await writeFile(join(projectPath, item.name), exactUtf8Text(item.bytes));
for (const item of draftRows) await writeFile(join(projectPath, item.name), item.largeDisk ? exactUtf8Text(READ_BYTES) : 'Current authoritative disk 中文🙂\n');
for (const name of ['over-draft.txt', 'growth.txt', 'growth.md']) await writeFile(join(projectPath, name), 'BASE\n');
const disk = async name => { const path = join(projectPath, name), s = await stat(path, { bigint: true }), bytes = await readFile(path); return { sha256: sha(bytes), bytes: bytes.length, inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
const fingerprints = async () => Object.fromEntries(await Promise.all(allNames.map(async name => [name, await disk(name)])));
const resources = resolve(dirname(executable), '../Resources'), result = { startedAt: new Date().toISOString(), app: executable, asarSha256: sha(await readFile(join(resources, 'app.asar'))), brokerSha256: sha(await readFile(join(resources, 'native/willyou-files'))), scratch, projectPath, before: await fingerprints(), status: 'running', checks: [], seeds: [], boundary: 'Actual normal packaged App pointer/keyboard/trusted text input and original FileService/native IO. Public IPC only prepares independent real recovery data; restore/save are actual UI. Private original-RPC observer records reduced receipts and, for growth only, delays invocation of the unchanged original read. No fake bytes/errors, private Store/editor writes, clipboard/models/system IME/Codex dynamic-parity claim. Readonly base/draft checks use complete CodeMirror model/hash, not virtual visible lines.' };
let app, stage = 'setup', observerInstalled = false;
const poll = async (fn, label, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(20); } throw Error('Timed out: ' + label); };
const observe = () => app.evaluate(`(async()=>{const e=document.querySelector('.cm-content'),v=e?.cmTile?.root?.view,text=v?.state.doc.toString(),bytes=text===undefined?null:new TextEncoder().encode(text),hash=bytes?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''):null;return{hash,units:text?.length,bytes:bytes?.length,editable:e?.getAttribute('contenteditable'),alerts:[...document.querySelectorAll('.fw-save-strip[role=alert],.fw-content>.fw-empty[role=alert]')].map(x=>x.textContent),footer:document.querySelector('.fw-footer')?.textContent,conflict:!!document.querySelector('.fw-conflict-strip'),active:document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.getAttribute('title')}})()`);
const content = async (bytes, editable) => poll(async () => { const value = await observe(); return value.hash === sha(bytes) && value.editable === String(editable) ? value : null; }, 'exact complete model and editable=' + editable);
const closeTab = async name => { await app.click(`[aria-label=${JSON.stringify('关闭 ' + name)}]`); await app.waitFor(`![...document.querySelectorAll('.fw-tab [role=tab]')].some(e=>e.title===${JSON.stringify(join(projectPath, name))})`); };
const trace = () => app.mainEvaluate('({rows:globalThis.__textSizeObserver.rows,gates:globalThis.__textSizeObserver.gates.map(({release,...x})=>x)})');
async function installObserver() {
  await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')),h=x=>process.getBuiltinModule('crypto').createHash('sha256').update(x).digest('hex'),s={sender:w.webContents.id,original:{},rows:[],gates:[],holdRead:false};globalThis.__textSizeObserver=s;for(const method of['open','read','refresh','checkpoint','save']){const name='files.'+method,fn=e.ipcMain._invokeHandlers.get(name);if(!fn)throw Error('Missing original '+name);s.original[name]=fn;e.ipcMain.removeHandler(name);e.ipcMain.handle(name,async(event,...args)=>{if(event.sender.id!==s.sender)return fn(event,...args);const input=JSON.stringify(args),row={method,at:Date.now(),inputSha256:h(input),relativePath:args[0]?.relativePath,ref:args[0]?.ref??(method==='read'||method==='refresh'?args[0]:undefined),inputBase64Length:args[0]?.base64?.length};s.rows.push(row);try{if(method==='read'&&s.holdRead){s.holdRead=false;const slot={row,waiting:true};s.gates.push(slot);await new Promise(done=>slot.release=done);slot.waiting=false}row.inputUnchanged=h(JSON.stringify(args))===row.inputSha256;const r=await fn(event,...args);row.originalReturned=true;const b64=r?.base64;row.output={relativePath:r?.relativePath??r?.document?.relativePath,size:r?.revision?.size??r?.document?.revision?.size,state:r?.state,base64Length:b64?.length,base64Sha256:b64?h(b64):undefined};return r}catch(error){row.error=String(error);throw error}})}return true})()`); observerInstalled = true;
  await app.evaluate("window.__textSizeInputs=[];window.__textSizeInputListener=e=>{if(e.target.closest?.('.cm-content'))window.__textSizeInputs.push({type:e.inputType,trusted:e.isTrusted,units:e.data?.length})};document.addEventListener('beforeinput',window.__textSizeInputListener,true);true");
}
async function restoreObserver() {
  const cleanup = await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__textSizeObserver;s.gates.forEach(x=>x.release?.());const out={};for(const[name,fn]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,fn);out[name]=e.ipcMain._invokeHandlers.get(name)===fn}delete globalThis.__textSizeObserver;return{restored:out,rows:s.rows,gates:s.gates.map(({release,...x})=>x)}})()");
  result.restored = cleanup.restored; result.finalTrace = { rows: cleanup.rows, gates: cleanup.gates };
  assert(Object.values(result.restored).every(Boolean)); observerInstalled = false;
  result.inputEvents = await app.evaluate("(()=>{document.removeEventListener('beforeinput',window.__textSizeInputListener,true);return window.__textSizeInputs})()");
}
try {
  app = await openFileAcceptanceApp({ executable, projectPath, userData, name: 'M9 exact text size boundaries', inspectMain: true, prepare: async ({ app: driver, project }) => {
    const scope = { kind: 'project', projectId: project.id }, root = (await driver.invoke('files.roots', scope)).roots[0];
    for (const item of draftRows) {
      const doc = await driver.invoke('files.open', { lease: root.lease, generation: root.generation, relativePath: item.name }), bytes = item.largeDisk ? Buffer.from('Small retained draft\n') : exactUtf8Text(item.bytes), draftId = randomUUID();
      assert.equal(bytes.length, item.bytes);
      const receipt = await driver.invoke('files.checkpoint', { ref: doc.ref, draftId, bufferVersion: 5, baseHash: 'a'.repeat(64), base64: bytes.toString('base64'), encoding: 'utf-8', bom: false });
      result.seeds.push({ name: item.name, ...textSizeMetadata(bytes), sha256: sha(bytes), receipt, disk: await disk(item.name), intentionalOldBaseHash: true }); await driver.invoke('files.closeDocument', doc.ref);
    }
    await driver.invoke('files.closeScope', scope);
  } });
  await installObserver(); await app.cdp('Page.bringToFront');
  for (const item of sourceRows) {
    stage = 'source-' + item.name; console.log(JSON.stringify({ phase: stage, completed: result.checks.length })); await app.open(item.name);
    if (item.bytes > READ_BYTES) { await app.waitFor("[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('TOO_LARGE'))"); const ui = await observe(); assert.equal(ui.hash, null); result.checks.push({ caseId: item.caseId, stage, bytes: item.bytes, ui, noTruncatedEditor: true }); }
    else { const ui = await content(exactUtf8Text(item.bytes), item.bytes <= EDIT_BYTES); result.checks.push({ caseId: item.caseId, stage, bytes: item.bytes, ui }); }
    if (item.name.endsWith('.txt')) await app.screenshot(join(scratch, stage + '.png'));
    assert.deepEqual(await disk(item.name), result.before[item.name]); await closeTab(item.name);
  }
  for (const item of draftRows) {
    stage = 'restore-' + item.name; console.log(JSON.stringify({ phase: stage, completed: result.checks.length })); await app.open(item.name); await app.waitFor("[...document.querySelectorAll('.fw-save-strip button')].some(e=>e.textContent.trim()==='恢复草稿')"); await app.click('.fw-save-strip button', '恢复草稿');
    const bytes = item.largeDisk ? Buffer.from('Small retained draft\n') : exactUtf8Text(item.bytes), ui = await content(bytes, !item.largeDisk && item.bytes <= EDIT_BYTES); assert(ui.conflict); assert(ui.footer.includes('有未保存修改')); assert.deepEqual(await disk(item.name), result.before[item.name]);
    result.checks.push({ caseIds: item.bytes <= EDIT_BYTES ? ['M9-T-K01', 'M9-T-K02'] : ['M9-T-K02'], stage, draftBytes: bytes.length, savedContentBytes: result.before[item.name].bytes, ui });
    await app.screenshot(join(scratch, stage + '.png')); await app.click('.fw-conflict-strip button', '使用磁盘版本');
    await poll(async () => !(await observe()).conflict && !(await observe()).footer.includes('有未保存修改'), 'explicit disk choice clears draft'); await closeTab(item.name);
  }
  for (const name of ['growth.txt', 'growth.md']) {
    stage = 'metadata-read-growth-' + name; await app.mainEvaluate('globalThis.__textSizeObserver.holdRead=true'); await app.open(name); await poll(async () => (await trace()).gates.some(x => x.waiting), 'original read paused before native invocation');
    const before = await disk(name), metadata = (await trace()).rows.filter(x => x.method === 'open').at(-1); assert.equal(metadata.output.size, before.bytes);
    await writeFile(join(projectPath, name), exactUtf8Text(READ_BYTES + 1)); const grown = await disk(name); await app.mainEvaluate('globalThis.__textSizeObserver.gates.forEach(x=>x.release?.());true');
    await app.waitFor("[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('TOO_LARGE'))"); const failed = await observe(); assert.equal(failed.hash, null); assert.equal(grown.bytes, READ_BYTES + 1); await app.screenshot(join(scratch, stage + '.png'));
    await writeFile(join(projectPath, name), 'RECOVERED 完整🙂\n'); await app.click('[aria-label="文件菜单"]'); await app.click('[role=menuitem]', '刷新文件和目录'); const recovered = await content(Buffer.from('RECOVERED 完整🙂\n'), true);
    assert(!recovered.alerts.some(Boolean)); result.checks.push({ caseId: 'M9-T-K08', stage, before, metadata, grown, failed, recovered, after: await disk(name) }); await closeTab(name);
  }
  stage = 'over-20MiB-real-input'; await app.open('over-draft.txt'); await content(Buffer.from('BASE\n'), true); await app.click('.cm-content');
  for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] });
  const oversized = exactUtf8Text(READ_BYTES + 1), raw = oversized.toString(); result.inputChunks = [];
  // Input.insertText is browser text insertion, not a large native paste. Keep
  // each trusted insertion bounded and preserve surrogate pairs at its edge.
  for (let from = 0; from < raw.length;) {
    let to = Math.min(raw.length, from + 256 * 1024); if (to < raw.length && /[\ud800-\udbff]/.test(raw[to - 1])) to--;
    const started = Date.now(); await app.cdp('Input.insertText', { text: raw.slice(from, to) });
    await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.length===${to}`);
    result.inputChunks.push({ from, to, elapsedMs: Date.now() - started }); console.log(JSON.stringify({ phase: stage, insertedUnits: to, totalUnits: raw.length })); from = to;
  }
  const fullMemory = await content(oversized, true);
  await app.key('s', 'KeyS', 4); await app.waitFor("[...document.querySelectorAll('.fw-save-strip[role=alert]')].some(e=>e.textContent.includes('20 MiB'))");
  const rejected = await observe(); assert.equal(rejected.hash, sha(oversized)); assert(rejected.footer.includes('有未保存修改')); assert.deepEqual(await disk('over-draft.txt'), result.before['over-draft.txt']);
  result.checks.push({ caseId: 'M9-T-K02', stage, bytes: oversized.length, fullMemory, rejected, disk: await disk('over-draft.txt') }); await app.screenshot(join(scratch, 'over-20MiB-draft.png'));
  stage = 'cleanup-explicit-discard';
  await app.click('[aria-label="关闭 over-draft.txt"]'); await app.waitFor("[...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('文件尚未保存'))");
  await app.click('[role=dialog] button', '放弃修改并关闭'); await app.waitFor(`![...document.querySelectorAll('.fw-tab [role=tab]')].some(e=>e.title===${JSON.stringify(join(projectPath, 'over-draft.txt'))})`);
  result.cleanupExplicitDiscard = true;
  result.trace = await trace(); assert(result.trace.rows.every(x => x.inputUnchanged)); assert(!result.trace.rows.some(x => x.method === 'save')); assert(result.trace.gates.every(x => !x.waiting));
  result.after = await fingerprints(); for (const name of allNames.filter(x => !x.startsWith('growth.'))) assert.deepEqual(result.after[name], result.before[name]);
  assert.equal((await app.invoke('tasks.list')).length, 0); assert.deepEqual(app.rendererErrors, []); result.rendererErrors = []; result.status = 'passed';
} catch (error) { result.status = 'failed'; result.error = String(error); result.failedStage = stage; process.exitCode = 1; if (app) try { result.failureDom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); if (observerInstalled) result.trace = await trace(); } catch {} }
finally { if (app) { try { if (observerInstalled) await restoreObserver(); assert(result.inputEvents.every(x => x.trusted)); } catch (error) { result.cleanupError = String(error); result.status = 'failed'; process.exitCode = 1; } await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, checks: result.checks.length, failedStage: result.failedStage, error: result.error, cleanupError: result.cleanupError, artifacts: scratch })); }
