// H27/H28: real packaged renderer/quit lifecycle with native fault hooks in a
// private cloned App only. No fake native success receipts or user resources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { arch, release } from 'node:os';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
const originalExecutable = process.env.WILLYOU_FILES_APP, testBroker = process.env.SMARTDD_TEST_FILE_BROKER; assert(originalExecutable && testBroker);
const scratch = await mkdtemp('/private/tmp/willyou-close-recovery-'), projectPath = join(scratch, 'project'), userData = join(scratch, 'userdata'), gateDirectory = join(scratch, 'gates'), log = join(scratch, 'native-faults.jsonl'); await mkdir(projectPath); await mkdir(gateDirectory);
const BASE = 'Original disk 中文🙂\n', LOCAL = 'Edited locally 中文🙂\n', EXTERNAL = 'External concurrent edit through held original FD 中文🙂\n';
const names = ['failed-before.txt', 'failed-io-before.txt', 'unknown-after.txt', 'conflict-after.txt', 'while-save.txt', 'unmount.txt', 'quit.txt', 'clean.txt'];
for (const name of names) await writeFile(join(projectPath, name), BASE);
const sha = data => createHash('sha256').update(data).digest('hex');
const fingerprint = async path => { const s = await stat(path, { bigint: true }), bytes = await readFile(path); return { text: bytes.toString(), hash: sha(bytes), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; };
const originalApp = resolve(dirname(originalExecutable), '../..'), clonedApp = join(scratch, 'Fault WillYou.app'); execFileSync('/bin/cp', ['-cR', originalApp, clonedApp]);
const resources = join(clonedApp, 'Contents/Resources'), broker = join(resources, 'native/willyou-files'), originalResources = resolve(dirname(originalExecutable), '../Resources');
await copyFile('scripts/files/recovery-fault-broker.py', broker); await chmod(broker, 0o755); await writeFile(broker + '.json', JSON.stringify({ projectPath, testBroker, externalText: EXTERNAL, gateDirectory, log }));
const executable = join(clonedApp, 'Contents/MacOS/WillYou'), asarSha256 = sha(await readFile(join(resources, 'app.asar'))); assert.equal(asarSha256, sha(await readFile(join(originalResources, 'app.asar'))));
const result = { startedAt: new Date().toISOString(), originalExecutable, executable, asarSha256, normalBrokerSha256: sha(await readFile(join(originalResources, 'native/willyou-files'))), faultWrapperSha256: sha(await readFile(broker)), testBroker, testBrokerSha256: sha(await readFile(testBroker)), system: { platform: process.platform, arch: arch(), release: release() }, scratch, projectPath, userData, checks: [], status: 'running', boundary: 'A: actual packaged App pointer/keyboard editing, close/discard/recovery menu, hide/reopen and real normal quit coordinator. A private COW clone has unchanged ASAR and a wrapper forwarding real native IO; exact synthetic save filenames alone enable original native test hooks. I: setup via public project IPC; main inspector only triggers electron.app.quit (no mocked coordinator acknowledgement; no physical CmdQ claim). No model, clipboard, global focus/IME or other Apps.' };
let app, stage = 'start';
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (!await fn()) { assert(Date.now() < end, 'Timed out waiting for independent fixture state'); await pause(30); } };
async function journals() {
  const root = join(userData, 'file-recovery/v1'), out = []; let projects = []; try { projects = await readdir(root); } catch { return out; }
  for (const projectKey of projects) for (const id of await readdir(join(root, projectKey))) { try { const path = join(root, projectKey, id, 'journal.json'), record = JSON.parse(await readFile(path, 'utf8')); out.push({ path, record }); } catch {} }
  return out;
}
const nativeRows = async () => { try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
const operations = rows => [...new Set(rows.map(row => row.opId))];
const materials = async row => { const j = row.record; return Object.fromEntries(await Promise.all(Object.entries({ current: join(projectPath, j.relativePath), displaced: join(projectPath, j.transactionLeaf, 'candidate'), draft: join(dirname(row.path), j.draftLeaf), materialized: join(projectPath, j.transactionLeaf, 'materialized'), journal: row.path }).map(async ([kind, path]) => [kind, await fingerprint(path)]))); };
try {
  app = await openFileAcceptanceApp({ executable, projectPath, userData, name: 'M9 H27 H28 isolated acceptance', inspectMain: true });
  const { click, key, waitFor, evaluate, cdp } = app;
  const content = text => waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()===${JSON.stringify(text)}`);
  const open = async name => { await waitFor(app.exists(app.tree(name))); await app.open(name); await content(BASE); };
  const edit = async text => { await click('.cm-content'); await key('a', 'KeyA', 4); await cdp('Input.insertText', { text }); await content(text); };
  const closePrompt = async name => { await click(`[aria-label="关闭 ${name}"]`); await waitFor(app.exists('[role=dialog]')); };
  const discard = async name => { await click('[role=dialog] button', '放弃修改并关闭'); await waitFor(`!document.querySelector(${JSON.stringify(`[aria-label="关闭 ${name}"]`)})`); await waitFor('!document.querySelector("[role=dialog]")'); };
  stage = 'H27-precommit'; await open('failed-before.txt'); const before = await fingerprint(join(projectPath, 'failed-before.txt')); await chmod(join(projectPath, 'failed-before.txt'), 0o444); await edit(LOCAL); await key('s', 'KeyS', 4); await waitFor(app.exists('.fw-save-strip[role=alert]'));
  await closePrompt('failed-before.txt'); await click('[role=dialog] button', '继续查看'); await waitFor('!document.querySelector("[role=dialog]")'); await content(LOCAL);
  const retained = (await journals()).filter(row => row.record.kind === 'checkpoint' && row.record.relativePath === 'failed-before.txt' && row.record.state === 'dirty'); assert(retained.length > 0); assert.equal((await fingerprint(join(dirname(retained.at(-1).path), retained.at(-1).record.draftLeaf))).text, LOCAL);
  await closePrompt('failed-before.txt'); await discard('failed-before.txt'); await pause(3300);
  const after = await fingerprint(join(projectPath, 'failed-before.txt')); for (const field of ['text', 'hash', 'inode', 'mtimeNs']) assert.equal(after[field], before[field]); assert((await journals()).filter(row => row.record.kind === 'checkpoint' && row.record.relativePath === 'failed-before.txt').every(row => row.record.state === 'resolved'));
  result.checks.push({ caseId: 'M9-T-H27', scenario: 'precommit failure; continue then explicit discard', before, after, ordinaryDraftResolved: true, nativeSaveOperations: operations((await nativeRows()).filter(row => row.name === 'failed-before.txt')).length });
  stage = 'H27-native-precommit-IO'; await open('failed-io-before.txt'); const ioBefore = await fingerprint(join(projectPath, 'failed-io-before.txt')); await edit(LOCAL); await key('s', 'KeyS', 4); await waitFor(app.exists('.fw-save-strip[role=alert]')); await closePrompt('failed-io-before.txt'); await click('[role=dialog] button', '继续查看'); await waitFor('!document.querySelector("[role=dialog]")'); await content(LOCAL);
  await closePrompt('failed-io-before.txt'); const ioOperations = operations((await nativeRows()).filter(row => row.name === 'failed-io-before.txt')); assert(ioOperations.length > 0); await discard('failed-io-before.txt'); await pause(3300); assert.deepEqual(await fingerprint(join(projectPath, 'failed-io-before.txt')), ioBefore); assert.deepEqual(operations((await nativeRows()).filter(row => row.name === 'failed-io-before.txt')), ioOperations);
  const ioRecords = (await journals()).filter(row => row.record.relativePath === 'failed-io-before.txt'); assert(ioRecords.filter(row => row.record.kind === 'checkpoint').every(row => row.record.state === 'resolved')); assert(ioRecords.filter(row => row.record.kind !== 'checkpoint').every(row => row.record.state === 'failed' && row.record.exchanged === false && !row.record.receipt.recoveryId));
  result.checks.push({ caseId: 'M9-T-H27', scenario: 'actual native IO failure before exchange; ordinary draft resolved, no implicit retry after discard', sourceBeforeAndAfter: ioBefore, saveOperationsBeforeAndAfterDiscard: ioOperations, journals: ioRecords.map(row => row.record) });
  for (const [name, mode] of [['unknown-after.txt', 'unknown'], ['conflict-after.txt', 'conflict']]) {
    stage = 'H27-' + mode; await open(name); await edit(LOCAL); await key('s', 'KeyS', 4); await waitFor(app.exists('.fw-conflict-strip'));
    const row = (await journals()).find(row => row.record.kind !== 'checkpoint' && row.record.relativePath === name); assert(row); const before = await materials(row); assert.equal(before.current.text, LOCAL); assert.equal(before.displaced.text, mode === 'unknown' ? BASE : EXTERNAL); assert.equal(before.draft.text, LOCAL);
    await closePrompt(name); await click('[role=dialog] button', '继续查看'); await waitFor('!document.querySelector("[role=dialog]")'); await content(LOCAL); await closePrompt(name); await discard(name); await pause(3300); assert.deepEqual(await materials(row), before);
    await click('[aria-label=文件菜单]'); await click('[role=menuitem]', '保存恢复材料…'); await waitFor(app.exists(`[data-record="${row.record.opId}"]`)); await click(`[data-record="${row.record.opId}"]`); await waitFor('document.querySelector(".fw-recovery-materials")?.getAttribute("aria-busy")==="false"&&document.querySelectorAll("[data-material]").length===4');
    const ui = await evaluate("({state:document.querySelector('.fw-recovery-state')?.textContent,materials:[...document.querySelectorAll('[data-material]')].map(e=>({kind:e.dataset.material,text:e.querySelector('pre')?.textContent,summary:e.querySelector('summary')?.textContent}))})");
    assert(ui.state.includes('只读')); assert.equal(ui.materials.find(x => x.kind === 'current').text, LOCAL); assert.equal(ui.materials.find(x => x.kind === 'displaced').text, mode === 'unknown' ? BASE : EXTERNAL); assert.equal(ui.materials.find(x => x.kind === 'draft').text, LOCAL); assert.deepEqual(await materials(row), before);
    await app.screenshot(join(scratch, mode + '-recovery.png')); await click('[data-slot=dialog-close]'); await waitFor('!document.querySelector("[role=dialog]")'); const saves = operations((await nativeRows()).filter(r => r.name === name)); assert.equal(saves.length, 1);
    result.checks.push({ caseId: 'M9-T-H27', scenario: mode + ' after exchange; explicit discard and actual recovery entry', journal: row.record, versionsBeforeAndAfter: before, ui, saveOperations: saves, noRetryAfterDiscard: true });
  }
  stage = 'H08-new-input-during-save'; await open('while-save.txt'); await edit(LOCAL); await key('s', 'KeyS', 4);
  await poll(async () => { try { await stat(join(gateDirectory, 'while-save.txt.waiting')); return true; } catch { return false; } }); assert.equal((await fingerprint(join(projectPath, 'while-save.txt'))).text, BASE);
  const NEWER = 'Newer input while an older save is pending 中文🙂\n'; await edit(NEWER); await writeFile(join(gateDirectory, 'while-save.txt.release'), 'release actual older native save'); await poll(async () => (await fingerprint(join(projectPath, 'while-save.txt'))).text === LOCAL);
  await content(NEWER); await waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='有未保存修改'"); const firstSaved = await fingerprint(join(projectPath, 'while-save.txt')); await app.screenshot(join(scratch, 'older-save-newer-dirty.png'));
  await poll(async () => (await fingerprint(join(projectPath, 'while-save.txt'))).text === NEWER); await waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'"); assert.equal(operations((await nativeRows()).filter(row => row.name === 'while-save.txt')).length, 2);
  result.checks.push({ caseId: 'M9-T-H08', scenario: 'real input B while native save A is suspended; only A acknowledged before B autosaves', firstSaved, newerInputRemainedDirty: true, finalDisk: await fingerprint(join(projectPath, 'while-save.txt')), saveOperations: operations((await nativeRows()).filter(row => row.name === 'while-save.txt')) });
  stage = 'H28-unmount'; await open('unmount.txt'); await edit(LOCAL); await click('[aria-label="隐藏文件区域"]'); await poll(async () => { try { await stat(join(gateDirectory, 'unmount.txt.waiting')); return true; } catch { return false; } });
  assert(!await evaluate('Boolean(document.querySelector("[data-testid=file-workspace]"))')); assert.equal((await fingerprint(join(projectPath, 'unmount.txt'))).text, BASE); await pause(400); await writeFile(join(gateDirectory, 'unmount.txt.release'), 'release actual native save'); await poll(async () => (await fingerprint(join(projectPath, 'unmount.txt'))).text === LOCAL);
  await click('[data-testid=project-files]'); await waitFor(app.exists('.cm-content')); await content(LOCAL); await pause(3300); assert.equal(operations((await nativeRows()).filter(row => row.name === 'unmount.txt')).length, 1); await app.screenshot(join(scratch, 'unmount-restored.png'));
  result.checks.push({ caseId: 'M9-T-H28', scenario: 'actual pane unmount waits delayed native write; reopen retains snapshot', independentDisk: await fingerprint(join(projectPath, 'unmount.txt')), saveOperations: operations((await nativeRows()).filter(row => row.name === 'unmount.txt')) });
  stage = 'H28-normal-quit'; await open('clean.txt'); await open('quit.txt'); await edit(LOCAL); const exitPromise = app.waitForExit();
  const trigger = await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');e.app.quit();return 'electron.app.quit requested';})()");
  await poll(async () => { try { await stat(join(gateDirectory, 'quit.txt.waiting')); return true; } catch { return false; } }); await waitFor('document.querySelector("#root")?.inert&&document.querySelector(".fw-closing-overlay")?.textContent.includes("正在保存")'); assert.equal((await fingerprint(join(projectPath, 'quit.txt'))).text, BASE); await app.screenshot(join(scratch, 'normal-quit-waiting.png')); await pause(400); await writeFile(join(gateDirectory, 'quit.txt.release'), 'release actual native save');
  const exited = await exitPromise; assert.equal(exited.code, 0); assert.equal(exited.signal, null); assert.equal((await fingerprint(join(projectPath, 'quit.txt'))).text, LOCAL); assert.equal(operations((await nativeRows()).filter(row => row.name === 'clean.txt')).length, 0);
  const finalJournals = await journals(); assert(finalJournals.filter(row => row.record.kind === 'checkpoint' && ['unmount.txt', 'quit.txt'].includes(row.record.relativePath)).every(row => row.record.state === 'resolved'));
  result.checks.push({ caseId: 'M9-T-H28', scenario: 'normal App quit waits native save and only then exits', trigger, exited, independentDisk: await fingerprint(join(projectPath, 'quit.txt')), sourceStayedOldWhileWaiting: true, rootInertAndOverlayObserved: true, cleanSourceSaveOperations: 0, ordinaryDraftsResolved: true });
  assert.deepEqual(app.rendererErrors, []); result.finalJournals = finalJournals.map(row => row.record); result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = String(error); result.failedStage = stage; process.exitCode = 1;
  if (app) try { await app.screenshot(join(scratch, 'failure.png')); result.failureDom = await app.evaluate('document.body.innerText'); } catch {}
} finally {
  if (app) { await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); }
  await chmod(join(projectPath, 'failed-before.txt'), 0o644); result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, checks: result.checks.length, failedStage: result.failedStage, error: result.error, artifacts: scratch }));
}
