// F02: directory expansion and real metadata failure/retry in the packaged UI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-metadata-open-A-'), root = join(scratch, 'project'); await mkdir(root);
const names = [], sha = x => createHash('sha256').update(x).digest('hex');
for (const theme of ['light', 'dark']) {
  await mkdir(join(root, theme + '-folder'));
  for (const [name, text] of [[theme + '-folder/child.txt', 'F02_DIRECTORY_CHILD_' + theme], [theme + '-metadata.txt', 'F02_METADATA_RECOVERED_' + theme + '_中文🙂']]) {
    await writeFile(join(root, name), text + '\n'); names.push(name);
  }
}
const fingerprint = async () => Object.fromEntries(await Promise.all(names.map(async name => { const path = join(root, name), s = await stat(path, { bigint: true }); return [name, { sha256: sha(await readFile(path)), inode: String(s.ino), mtimeNs: String(s.mtimeNs), mode: Number(s.mode) }]; })));
const r = { at: new Date().toISOString(), caseId: 'M9-T-F02', layer: 'A', executable, scratch, root, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: await fingerprint(), checks: [], status: 'running', boundary: 'Original packaged App, private userData/project. Tree expansion, file opens, explicit retry and close are trusted UI input. Real chmod000 creates native PERMISSION; source restored in finally. No metadata or IPC result substitution, no Store/DOM mutation, clipboard, external model or daily credentials. ctime is intentionally changed by chmod and is not claimed unchanged.' };
let app, observed = false, denied, stage = 'setup';
const view = 'document.querySelector(".fw-editor-host .cm-content")?.cmTile?.root?.view';
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'F02 metadata authority A', inspectMain: true });
  await installFileMethodObserver(app, ['open', 'read', 'list', 'save']); observed = true;
  for (const theme of ['light', 'dark']) {
    await app.invoke('appSettings.update', 'theme', 'y' + theme);
    stage = theme + ':directory'; const folder = theme + '-folder', child = folder + '/child.txt';
    const beforeOpen = (await observeFileMethods(app)).filter(x => x.method === 'open').length;
    await app.click(app.tree(folder));
    await app.waitFor(`document.querySelector(${JSON.stringify(app.tree(folder))})?.getAttribute('aria-expanded')==='true'&&!!document.querySelector(${JSON.stringify(app.tree(child))})`);
    assert.equal((await observeFileMethods(app)).filter(x => x.method === 'open').length, beforeOpen);
    assert.equal(await app.evaluate(`!![...document.querySelectorAll('.fw-tab [role=tab]')].find(e=>e.title===${JSON.stringify(join(root, folder))})`), false);
    await app.open(child); await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify('F02_DIRECTORY_CHILD_' + theme + '\n')}`);
    r.checks.push({ theme, scenario: 'directory expands and its child opens', directoryWasNotOpenedAsText: true });
    stage = theme + ':native-metadata-denied'; const name = theme + '-metadata.txt'; denied = join(root, name); await chmod(denied, 0o000);
    await app.open(name); await app.waitFor("document.querySelector('.fw-empty[role=alert]')?.textContent.includes('PERMISSION')");
    assert.equal(await app.evaluate("!!document.querySelector('.fw-editor-host .cm-editor')"), false);
    const alert = await app.evaluate("document.querySelector('.fw-empty[role=alert]').textContent");
    assert((await observeFileMethods(app)).some(x => x.method === 'open' && x.args[0]?.relativePath === name && x.error?.includes('PERMISSION')));
    await app.screenshot(join(scratch, theme + '-metadata-error.png'));
    r.checks.push({ theme, scenario: 'real native permission error has explicit retry and no guessed editor', alert });
    stage = theme + ':retry'; await chmod(denied, 0o644); denied = undefined;
    await app.click('.fw-empty[role=alert] button', '重试');
    await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify('F02_METADATA_RECOVERED_' + theme + '_中文🙂\n')}`);
    assert.equal(await app.evaluate("!!document.querySelector('.fw-empty[role=alert]')"), false);
    await app.screenshot(join(scratch, theme + '-metadata-recovered.png'));
    r.checks.push({ theme, scenario: 'actual retry obtains complete source after permission restoration', recovered: await app.evaluate(`${view}.state.doc.toString()`) });
    await app.click('[aria-label=' + JSON.stringify('关闭 ' + name) + ']');
  }
  r.trace = await observeFileMethods(app); assert.equal(r.trace.filter(x => x.method === 'save').length, 0);
  for (const row of r.trace.filter(x => x.delivered)) { assert.equal(row.input, row.inputAfter); assert.equal(row.before, row.after); }
  r.after = await fingerprint(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []);
  r.restored = await restoreFileMethodObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean));
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()"); r.exit = await app.waitForExit(180000); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.dom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally {
  if (denied) await chmod(denied, 0o644);
  if (app) { if (observed) try { r.cleanupRestore = await restoreFileMethodObserver(app); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, failedStage: r.failedStage, error: r.error }));
}
