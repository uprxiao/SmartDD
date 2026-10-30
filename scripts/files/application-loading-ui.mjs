// E14: original packaged renderer, native discovery and authenticated actions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-application-loading-A-'), root = join(scratch, 'project'); await mkdir(root);
const source = join(root, 'application-loading.txt'), parked = join(scratch, 'parked.txt');
await writeFile(source, 'M9 E14 isolated application discovery fixture 中文🙂\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const fingerprint = async () => { const s = await stat(source, { bigint: true }); return { sha256: sha(await readFile(source)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
const r = { caseId: 'M9-T-E14', layer: 'A', at: new Date().toISOString(), executable, scratch, root, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: await fingerprint(), checks: [], status: 'running', boundary: 'Original packaged A and native discovery/opening. Only original successful discovery delivery is delayed; raw input/output JSON hashes checked. Discovery failure is actual temporary rename of the private source, then restore same inode. Own appSettings seed points to system TextEdit; source has no user content. External TextEdit open is real and scoped to this scratch file; no fake opener success, no user credentials/clipboard/OS settings.' };
let app, held = false, moved = false, stage = 'setup';
const ev = (fn, ...args) => app.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = (fn, ...args) => app.waitFor(`(${fn.toString()})(...${JSON.stringify(args)})`);
const poll = async fn => { const end = Date.now() + 12000; for (;;) { const x = await fn(); if (x) return x; assert(Date.now() < end, 'Timed out: ' + stage); await pause(35); } };
async function closeMenu() { if (await ev(() => !!document.querySelector('[role=menu]'))) { await app.key('Escape', 'Escape'); await wait(() => !document.querySelector('[role=menu]')); } }
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'E14 application loading A', inspectMain: true });
  await app.invoke('appSettings.update', 'fileOpener', { path: '/System/Applications/TextEdit.app', bundleId: 'com.apple.TextEdit' });
  await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),hash=x=>process.getBuiltinModule('crypto').createHash('sha256').update(JSON.stringify(x)??'undefined').digest('hex'),s={original:{},rows:[],slots:[],hold:true};globalThis.__applicationLoading=s;for(const method of ['applications','openExternal']){const name='files.'+method,fn=e.ipcMain._invokeHandlers.get(name);s.original[name]=fn;e.ipcMain.removeHandler(name);e.ipcMain.handle(name,async(event,...args)=>{const row={method,args,inputHash:hash(args),at:Date.now()};s.rows.push(row);try{const output=await fn(event,...args);row.output=output;row.beforeHash=hash(output);if(method==='applications'&&s.hold)await new Promise(resolve=>s.slots.push({row,release:resolve}));row.afterHash=hash(output);row.inputAfter=hash(args);row.delivered=true;return output}catch(error){row.error=String(error);throw error}})}return true})()`); held = true;
  for (const theme of ['light', 'dark']) {
    stage = theme + ':delay'; await app.invoke('appSettings.update', 'theme', 'y' + theme);
    // Reopen a fresh target so the original hook has no cached list.
    if (theme === 'dark') { await app.click('[aria-label="关闭 application-loading.txt"]'); await app.mainEvaluate('globalThis.__applicationLoading.hold=true;true'); }
    await app.open('application-loading.txt'); await wait(() => !!document.querySelector('.cm-content'));
    await poll(() => app.mainEvaluate('globalThis.__applicationLoading.slots.some(x=>!x.row.delivered)'));
    assert(await ev(() => document.querySelector('.fw-open-button>button').disabled));
    assert.match(await ev(() => document.querySelector('.fw-open-button>button').title), /正在读取/);
    await app.click('[aria-label="打开方式"]'); await wait(() => [...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.includes('正在读取可用应用') && e.getAttribute('aria-disabled') === 'true'));
    await app.screenshot(join(scratch, theme + '-loading.png'));
    await app.mainEvaluate('(()=>{const s=globalThis.__applicationLoading;s.hold=false;s.slots.forEach(x=>x.release());return true})()');
    await wait(() => !document.querySelector('.fw-open-button>button').disabled); await closeMenu();
    const preference = await app.invoke('appSettings.get', 'fileOpener');
    stage = theme + ':native-failure'; await rename(source, parked); moved = true;
    await app.click('[aria-label="打开方式"]'); await wait(() => document.querySelector('.fw-menu-message[role=alert]')?.textContent.includes('无法读取可用应用'));
    assert(await ev(() => document.querySelector('.fw-open-button>button').disabled));
    assert.equal(await ev(() => document.querySelectorAll('.fw-menu-name').length), 0);
    assert.deepEqual(await app.invoke('appSettings.get', 'fileOpener'), preference);
    await app.screenshot(join(scratch, theme + '-native-missing.png'));
    await rename(parked, source); moved = false;
    await app.click('[role=menuitem]', '重新读取应用列表'); await wait(() => !document.querySelector('.fw-open-button>button').disabled && !document.querySelector('.fw-menu-message[role=alert]'));
    await closeMenu(); stage = theme + ':real-open';
    await app.click('.fw-open-button>button');
    await poll(() => app.mainEvaluate(`globalThis.__applicationLoading.rows.filter(x=>x.method==='openExternal'&&x.delivered).length>=${theme === 'light' ? 1 : 2}`));
    assert.deepEqual(await app.invoke('appSettings.get', 'fileOpener'), preference);
    await app.cdp('Page.bringToFront');
    r.checks.push({ theme, loadingDisabled: true, originalListReleased: true, nativeMissingWithoutFakeChoices: true, preferencePreservedOnFailureAndDefaultOpen: true, restoredSameInode: await fingerprint(), realExternalOpen: true });
  }
  r.trace = await app.mainEvaluate('globalThis.__applicationLoading.rows');
  for (const row of r.trace.filter(x => x.delivered)) { assert.equal(row.inputHash, row.inputAfter); assert.equal(row.beforeHash, row.afterHash); }
  const opens = r.trace.filter(x => x.method === 'openExternal'); assert.equal(opens.length, 2); assert(opens.every(x => x.delivered && x.args[0].remember === false && x.output.state === 'opened'));
  r.after = await fingerprint(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []); r.status = 'passed';
} catch (error) {
  r.status = 'failed'; r.error = String(error); r.failedStage = stage; process.exitCode = 1;
  if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {}
} finally {
  if (moved) await rename(parked, source);
  if (app) {
    if (held) try { r.restore = await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__applicationLoading;s.hold=false;s.slots.forEach(x=>x.release());const result={};for(const[name,fn]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,fn);result[name]=e.ipcMain._invokeHandlers.get(name)===fn}delete globalThis.__applicationLoading;return{rows:s.rows,handlers:result}})()"); } catch {}
    await writeFile(join(scratch, 'electron.log'), app.logs());
    if (r.status === 'passed') { await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()"); r.exit = await app.waitForExit(); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); }
    await app.close();
  }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, error: r.error, failedStage: r.failedStage }));
}
