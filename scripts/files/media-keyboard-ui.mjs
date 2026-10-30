import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openTaskFileFixture } from '../lib/task-file-fixture.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
import { installMediaObserver, observeMedia, restoreMediaObserver } from '../lib/media-resource-observer.mjs';
import { runMediaKeyboard } from '../lib/media-keyboard-matrix.mjs';

const executable = process.env.WILLYOU_FILES_APP, manifest = process.env.WILLYOU_MEDIA_FIXTURES, prototype = process.env.WILLYOU_MEDIA_PROTOTYPE === '1';
assert(executable && manifest);
const f = JSON.parse(await readFile(manifest, 'utf8')), root = f.projectPath;
const scratch = await mkdtemp('/private/tmp/willyou-media-keyboard-' + (prototype ? 'P-' : 'A-'));
const sha = x => createHash('sha256').update(x).digest('hex');
const fingerprint = async () => { const p = join(root, 'clip-a.mp4'), s = await stat(p, { bigint: true }); return { sha256: sha(await readFile(p)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
const r = { at: new Date().toISOString(), scratch, prototype, manifest, before: await fingerprint(), asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), checks: [], boundary: prototype ? 'P original shared FileWorkspace/Media, simulated playback and explicit textarea input receiver. No PTY or decoder claim.' : 'A original packaged UI, actual decoder/protocol and xterm/PTY to two input-only Python receivers. No shell execution/model/clipboard/picker/external App/user data. Setup RPC is not UI acceptance.' };
let app, fixture, observed = false, expected = '', entry, stage = 'setup';
const poll = async fn => { const end = Date.now() + 15000; for (;;) { const x = await fn(); if (x) return x; assert(Date.now() < end, 'Receiver did not settle'); await pause(20); } };
try {
  if (prototype) app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'M9 Media keyboard P', inspectMain: true });
  else {
    fixture = await openTaskFileFixture({ executable, scratch, root, name: 'M9 Media keyboard input-only' }); app = fixture.app;
    await fixture.show('T2'); await fixture.show('T1');
    r.receiversBefore = {};
    for (const label of ['T1', 'T2']) r.receiversBefore[label] = await poll(() => fixture.receiver(label).catch(() => null));
    assert.equal(r.receiversBefore.T1.rawHex, ''); assert.equal(r.receiversBefore.T2.rawHex, '');
    r.tasksBefore = await app.invoke('tasks.list'); r.tasks = fixture.tasks;
    await app.evaluate("(()=>{window.__mediaKeyboardPtyExits={};window.electronAPI.eventOn('pty:exit',e=>window.__mediaKeyboardPtyExits[e.ptyId]=e.code);return true})()");
    await installFileRpcObserver(app); await installMediaObserver(app); observed = true;
  }
  r.pid = app.processId; entry = await app.evaluate('location.href');
  if (prototype) { await app.cdp('Page.navigate', { url: 'http://127.0.0.1:5180/tests/media-controls-runtime.html?keyboard=1' }); await app.waitFor('!!window.__mediaControlsPrototype&&!!document.querySelector("[data-testid=media-keyboard-receiver-playing]")'); }
  for (const theme of ['light', 'dark']) {
    stage = theme + ':open';
    if (prototype) {
      if (theme === 'dark') await app.click('[data-testid=media-theme]');
      await app.click('[role=treeitem][data-path="clip-a.mp4"]');
    } else {
      await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await app.open('clip-a.mp4'); await app.waitFor('document.querySelector("video")?.readyState>=3&&document.querySelector("video").videoWidth===320');
    }
    stage = theme + ':matrix';
    const term = fixture ? fixture.terminal(fixture.tasks.T1) : null;
    await runMediaKeyboard(app, { prototype, theme, terminal: prototype ? target => { const selector = '[data-testid=media-keyboard-receiver-' + (target ? 'playing' : 'paused') + ']'; return { click: selector, focus: selector }; } : { click: term + ' .xterm-screen', focus: term + ' .xterm-helper-textarea' }, receive: async (delta, target) => {
      expected = prototype ? delta : expected + delta;
      if (prototype) {
        const selector = '[data-testid=media-keyboard-receiver-' + (target ? 'playing' : 'paused') + ']';
        await app.waitFor(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(expected)}`);
        return { value: await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), mockTextarea: true };
      }
      const t1 = await poll(async () => { const s = await fixture.receiver('T1'); return s.rawHex === Buffer.from(expected).toString('hex') ? s : null; }), t2 = await fixture.receiver('T2');
      assert.equal(t2.rawHex, '');
      for (const [label, s] of Object.entries({ T1: t1, T2: t2 })) { assert.equal(s.pid, r.receiversBefore[label].pid); assert.equal(s.inputOnly, true); assert.equal(s.executedCommands, 0); assert.equal((await app.invoke('tasks.get', fixture.tasks[label].task.id)).ptyId, fixture.tasks[label].ptyId); }
      assert.equal((await readFile(join(scratch, 'T1', 'raw.bin'))).toString('hex'), Buffer.from(expected).toString('hex'));
      return { T1: t1, T2: t2 };
    }, record: async data => { r.checks.push({ caseId: 'M9-T-T25', ...data }); console.log(JSON.stringify({ theme, checks: r.checks.length, scenario: data.scenario })); } });
    await app.screenshot(join(scratch, theme + '-keyboard.png'));
    await app.click('[aria-label="关闭 clip-a.mp4"]'); await app.waitFor('!document.querySelector("video,.fw-media")');
  }
  r.expectedHex = Buffer.from(expected).toString('hex'); r.after = await fingerprint(); assert.deepEqual(r.before, r.after);
  if (observed) { r.rpc = await observeFileRpcs(app); r.media = await observeMedia(app); r.restored = { ...await restoreFileRpcObserver(app), ...await restoreMediaObserver(app) }; observed = false; assert(Object.values(r.restored).every(Boolean)); }
  if (prototype) { await app.cdp('Page.navigate', { url: entry }); await app.waitFor('!!document.querySelector("[data-testid=nav-settings]")'); }
  else {
    r.receiversAfter = { T1: await fixture.receiver('T1'), T2: await fixture.receiver('T2') }; r.tasksAfter = await app.invoke('tasks.list');
    assert.deepEqual(r.tasksAfter.map(x => x.id).sort(), r.tasksBefore.map(x => x.id).sort());
    for (const task of Object.values(fixture.tasks)) await app.invoke('tasks.kill', task.task.id);
    await app.waitFor(`Object.keys(window.__mediaKeyboardPtyExits).length>=2`); r.ptyExits = await app.evaluate('window.__mediaKeyboardPtyExits');
  }
  assert.deepEqual(app.rendererErrors, []); r.rendererErrors = [];
  await writeFile(join(scratch, 'electron.log'), app.logs());
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");
  r.exit = await app.waitForExit(20000); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null);
  await app.close(); app = null; fixture = null; r.status = 'passed';
} catch (error) {
  r.status = 'failed'; r.stage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1;
  if (app) try { r.dom = await app.evaluate('document.body.innerText'); r.failureInput = await app.evaluate("({value:document.querySelector('[data-testid=media-keyboard-receiver-playing]')?.value,tag:document.activeElement?.tagName,selection:[document.activeElement?.selectionStart,document.activeElement?.selectionEnd]})"); await app.screenshot(join(scratch, 'failure.png')); } catch {}
} finally {
  if (app) {
    if (observed) try { r.failedRestore = { ...await restoreFileRpcObserver(app), ...await restoreMediaObserver(app) }; } catch {}
    await writeFile(join(scratch, 'failure-electron.log'), app.logs());
    if (fixture) await fixture.close(); else await app.close();
  }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n');
  console.log(JSON.stringify({ status: r.status, checks: r.checks.length, artifacts: scratch, error: r.error, stage: r.stage }));
}
