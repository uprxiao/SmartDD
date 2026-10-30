import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { openTaskFileFixture } from '../lib/task-file-fixture.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';

const executable = process.env.WILLYOU_FILES_APP, manifest = process.env.WILLYOU_MARKDOWN_IMAGE_FIXTURES, prototype = process.env.WILLYOU_IMAGE_PROTOTYPE === '1', manualSave = process.env.WILLYOU_IMAGE_MANUAL_SAVE === '1';
assert(executable && manifest);
const corpus = JSON.parse(await readFile(manifest, 'utf8')), root = corpus.project, scratch = await mkdtemp('/private/tmp/willyou-markdown-images-' + (prototype ? 'P-' : 'A-'));
const sha = x => createHash('sha256').update(x).digest('hex');
const fingerprints = async () => Object.fromEntries(await Promise.all([...corpus.cases.map(x => x.name), corpus.markdown].map(async name => { const p = join(root, name), s = await stat(p, { bigint: true }); return [name, { sha256: sha(await readFile(p)), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }]; })));
const r = { at: new Date().toISOString(), scratch, prototype, manifest, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: await fingerprints(), checks: [], boundary: prototype ? 'P original shared FileWorkspace/FileMarkdown/ImageGallery and same synthetic bytes; actual Chromium anchor download to explicit private destination. No native-file/task/provider claim.' : 'A original packaged Markdown Worker/FileService/decoder/shared gallery; real project and two input-only PTYs. Only passive IPC observers/trusted input. Native picker success requires user selection; no stub is A success.' };
let app, fixture, observed = false, entry, stage = 'setup';
const imageSelector = name => prototype ? `.fw-md-image:has(img[alt="${name === 'wide.png' ? '宽图' : name === 'tall.png' ? '高图' : '动画'}"])` : `img[data-md-src=${JSON.stringify(name)}]`;
const title = () => app.evaluate("document.querySelector('.fw-gallery header>span')?.textContent");
const rightClick = async selector => { const p = await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: 'right', clickCount: 1 }) }); };
const openMarkdown = async () => { if (prototype) await app.click('[role=treeitem][data-path="images.md"]'); else await app.open('images.md'); await app.waitFor(prototype ? "document.querySelector('.fw-md-image img[alt=宽图]')?.naturalWidth===1600&&document.querySelector('.fw-md-image img[alt=高图]')?.naturalWidth===200" : "document.querySelector('img[data-md-src=\"wide.png\"]')?.naturalWidth===1600&&document.querySelector('img[data-md-src=\"tall.png\"]')?.naturalWidth===200"); };
const openGallery = async theme => {
  await app.click(imageSelector('wide.png')); await app.waitFor("document.querySelector('.fw-gallery img')?.naturalWidth===1600"); assert.equal(await title(), '宽图');
  assert(await app.evaluate("!document.querySelector('[aria-label=上一张图片]')"));
  await app.click('[aria-label=放大图片]'); const zoomed = await app.evaluate("document.querySelector('.fw-gallery-viewport img').style.transform");
  await app.click('[aria-label=下一张图片]'); await app.waitFor("document.querySelector('.fw-gallery img')?.naturalHeight===1600"); assert.equal(await title(), '高图');
  await app.waitFor("(()=>{const v=document.querySelector('.fw-gallery-viewport'),i=v?.querySelector('img');if(!i||i.naturalHeight!==1600)return false;const fit=Math.min(1,Math.max(.01,Math.min((v.clientWidth-64)/i.naturalWidth,(v.clientHeight-32)/i.naturalHeight))),m=/scale\\(([^)]+)\\)/.exec(i.style.transform);return m&&Math.abs(Number(m[1])-fit)<.00001})()");
  const reset = await app.evaluate("document.querySelector('.fw-gallery-viewport img').style.transform"); assert.notEqual(reset, zoomed);
  await app.click('[aria-label=上一张图片]'); await app.waitFor("document.querySelector('.fw-gallery img')?.naturalWidth===1600"); assert.equal(await title(), '宽图');
  await app.screenshot(join(scratch, theme + '-gallery.png')); await app.click('[aria-label=关闭图片预览]'); await app.waitFor('!document.querySelector(".fw-gallery")');
  if (!prototype) assert(await app.evaluate("document.activeElement?.matches('img[data-md-src=\"wide.png\"]')"), 'Gallery close did not restore original image focus');
  return { theme, scenario: 'original gallery connected order wide/tall/back, first bound, zoom reset, close/focus', zoomed, reset };
};
try {
  if (prototype) app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'Embedded images P', inspectMain: true });
  else { fixture = await openTaskFileFixture({ executable, scratch, root, name: 'Embedded images input-only' }); app = fixture.app; }
  r.pid = app.processId; entry = await app.evaluate('location.href');
  if (prototype) { await mkdir(join(scratch, 'downloads')); await app.cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: join(scratch, 'downloads') }); await app.cdp('Page.navigate', { url: process.env.WILLYOU_IMAGE_URL || 'http://127.0.0.1:5180/tests/markdown-images-runtime.html' }); await app.waitFor('!!window.__markdownImagesPrototype'); }
  else { await fixture.show('T2'); await fixture.show('T1'); const receiverReady=async label=>{const end=Date.now()+15000;for(;;){try{return await fixture.receiver(label)}catch(error){if(!String(error).includes('ENOENT'))throw error;assert(Date.now()<end,'Input-only receiver did not initialize');await pause(30)}}};r.receiversBefore = { T1: await receiverReady('T1'), T2: await receiverReady('T2') }; await installFileMethodObserver(app, ['open', 'read', 'related', 'chunk', 'closeDocument', 'saveCopy']); observed = true; }
  for (const theme of ['light', 'dark']) {
    stage = theme + ':prepare';
    if (prototype) { if (theme === 'dark') await app.click('[data-testid=image-theme]'); while (!await app.evaluate("document.querySelector('[data-testid=image-context]').textContent.endsWith('0')")) await app.click('[data-testid=image-context]'); }
    else { await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }); await fixture.projectView(); }
    await openMarkdown(); stage = theme + ':no-context';
    await rightClick(imageSelector('wide.png')); await pause(50); assert(!await app.evaluate("!!document.querySelector('.fw-embedded-image-menu,.fw-image-menu')"));
    r.checks.push({ theme, scenario: 'other/project no-context: no embedded image lazy menu' });
    r.checks.push(await openGallery(theme + '-no-context'));
    if (prototype) await app.click('[data-testid=image-context]'); else await fixture.show('T1');
    await openMarkdown(); stage = theme + ':context';
    await rightClick(imageSelector('wide.png')); await app.waitFor("!!document.querySelector('.fw-embedded-image-menu,.fw-image-menu')");
    let labels = await app.evaluate("[...document.querySelectorAll('.fw-embedded-image-menu [role=menuitem],.fw-image-menu [role=menuitem]')].map(e=>e.textContent.trim())");
    assert.deepEqual(labels, ['在新标签打开图片', '添加到当前任务', '复制图片', '在文件管理器中显示', '下载副本']); await app.screenshot(join(scratch, theme + '-context-menu.png'));
    if (!prototype) { await app.click('[role=menuitem]', '添加到当前任务'); await app.waitFor("document.querySelector('.fw-image-notice')?.textContent.includes('尚未接入图片输入 provider')"); }
    else await app.key('Escape', 'Escape');
    r.checks.push({ theme, scenario: 'context local static image menu capability order', labels, actualMissingImageProvider: !prototype });
    await rightClick(imageSelector('animated.gif')); await app.waitFor("!!document.querySelector('.fw-embedded-image-menu,.fw-image-menu')");
    labels = await app.evaluate("[...document.querySelectorAll('.fw-embedded-image-menu [role=menuitem],.fw-image-menu [role=menuitem]')].map(e=>e.textContent.trim())");
    assert.deepEqual(labels, ['在新标签打开图片', '在文件管理器中显示', '下载副本']); await app.key('Escape', 'Escape'); r.checks.push({ theme, scenario: 'animated image removes reference/copy', labels });
    r.checks.push(await openGallery(theme + '-context'));
    await rightClick(imageSelector('wide.png')); await app.waitFor("!!document.querySelector('.fw-embedded-image-menu,.fw-image-menu')"); await app.click('[role=menuitem]', '在新标签打开图片');
    await app.waitFor("document.querySelector('.fw-ordinary-image img')?.naturalWidth===1600"); assert(!await app.evaluate('!!document.querySelector(".fw-gallery")'));
    if (!prototype) { const rows = await observeFileMethods(app), readOnly = rows.filter(x => x.method === 'open' && x.output?.relativePath === 'wide.png').at(-1); assert(readOnly?.args[0].readOnly && readOnly.output.writable === false); }
    await app.click('.fw-ordinary-image img'); assert(!await app.evaluate('!!document.querySelector(".fw-gallery")')); r.checks.push({ theme, scenario: 'new tab uses image route, readonly main narrowing checked in A; ordinary click has no gallery' });
    await openMarkdown();
    if (prototype) {
      stage = theme + ':download'; await app.click(imageSelector('wide.png')); await app.waitFor("document.querySelector('.fw-gallery img')?.naturalWidth===1600"); await app.click('.fw-gallery header button', '下载');
      const destination = join(scratch, 'downloads/wide.png'); const end = Date.now() + 10000; for (;;) { try { if (sha(await readFile(destination)) === corpus.cases.find(x => x.name === 'wide.png').sha256) break; } catch {} assert(Date.now() < end, 'P download did not produce exact PNG bytes'); await pause(30); }
      r.checks.push({ theme, scenario: 'P genuine anchor download exact synthetic bytes', path: destination, sha256: sha(await readFile(destination)) }); await app.click('[aria-label=关闭图片预览]');
      // Third approved menu condition: a document scope without task context.
      await app.click('[data-testid=image-context]'); await openMarkdown(); await rightClick(imageSelector('wide.png')); await app.waitFor('!!document.querySelector(".fw-image-menu")'); await app.key('Escape', 'Escape');
      r.checks.push({ theme, scenario: 'document scope without context still supplies image menu' });
      // Avoid overwriting a previously downloaded filename in the next theme.
      if (theme === 'light') await (await import('node:fs/promises')).rename(destination, join(scratch, 'downloads/light-wide.png'));
    } else {
      await app.waitFor("[...document.querySelectorAll('img[data-md-src]')].some(e=>e.title.includes('远程或私有图片来源尚未适配'))");
      r.checks.push({ theme, scenario: 'private/remote source explicit unavailable, no implicit remote read' });
    }
  }
  if (!prototype && manualSave) {
    stage = 'manual-native-save'; await openMarkdown(); await app.click(imageSelector('wide.png')); await app.waitFor("document.querySelector('.fw-gallery img')?.naturalWidth===1600"); await app.click('.fw-gallery header button', '下载');
    const ready = { at: new Date().toISOString(), scratch, expectedDefaultPath: join(root, 'wide 副本.png'), sourceHash: corpus.cases.find(x => x.name === 'wide.png').sha256, action: 'Original native save dialog: user must choose Save, no stub or CDP file chooser override' }; await writeFile(join(scratch, 'manual-ready.json'), JSON.stringify(ready, null, 2) + '\n'); console.log(JSON.stringify({ status: 'waiting-for-native-save', ...ready }));
    const end = Date.now() + 1800000;
    for (;;) { const row = (await observeFileMethods(app)).filter(x => x.method === 'saveCopy').at(-1); if (row?.delivered) { r.nativeSave = row.output; assert.equal(row.output.state, 'saved', 'Native save was cancelled; success still pending'); assert.equal(sha(await readFile(row.output.path)), ready.sourceHash); r.checks.push({ scenario: 'A original native save dialog, explicit user selection, exact original image bytes', ...row.output }); break; } assert(Date.now() < end, 'Native save still requires user'); await pause(500); }
    await app.click('[aria-label=关闭图片预览]');
  } else if (!prototype) r.pending = 'A native save picker not executed; full T17 remains incomplete';
  r.after = await fingerprints(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []); r.rendererErrors = [];
  if (!prototype) {
    r.rpc = await observeFileMethods(app); assert(r.rpc.every(x => !x.delivered || x.before === x.after && x.input === x.inputAfter)); r.restored = await restoreFileMethodObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean));
    r.receiversAfter = { T1: await fixture.receiver('T1'), T2: await fixture.receiver('T2') }; for (const label of ['T1', 'T2']) { assert.equal(r.receiversAfter[label].rawHex, r.receiversBefore[label].rawHex); assert.equal(r.receiversAfter[label].pid, r.receiversBefore[label].pid); assert.equal(r.receiversAfter[label].executedCommands, 0); }
    for (const task of Object.values(fixture.tasks)) await app.invoke('tasks.kill', task.task.id);
  } else { await app.cdp('Page.navigate', { url: entry }); await app.waitFor('!!document.querySelector("[data-testid=nav-settings]")'); assert.equal((await app.invoke('tasks.list')).length, 0); }
  await writeFile(join(scratch, 'electron.log'), app.logs());
  if (process.env.WILLYOU_IMAGE_NATIVE_QUIT === '1') {
    const lifecycle = join(scratch, 'lifecycle.json');
    await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),fs=process.getBuiltinModule('fs'),rows=[],record=(kind,extra={})=>{rows.push({at:Date.now(),kind,...extra});fs.writeFileSync(${JSON.stringify(lifecycle)},JSON.stringify(rows,null,2)+'\\n');};for(const name of ['before-quit','will-quit','quit','window-all-closed']){e.app.prependListener(name,()=>record('before:'+name));e.app.on(name,()=>record('after:'+name));}const w=e.BrowserWindow.getAllWindows();if(w.length!==1)throw Error('Expected only own main window');for(const name of ['close','closed'])w[0].on(name,()=>record('window:'+name));record('observer-ready');return true})()`,{synchronous:true});
    const ready={scratch,pid:r.pid,status:'awaiting-original-native-menu-quit',app:executable};await writeFile(join(scratch,'quit-ready.json'),JSON.stringify(ready)+'\n');console.log(JSON.stringify(ready));r.quitMethod='Original native CmdQ;passive application lifecycle observation';r.exit=await app.waitForExit(120000);
  } else { await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");r.quitMethod='Inspector-scheduled original app.quit';r.exit=await app.waitForExit(20000); }
  assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); await app.close(); app = null; fixture = null; r.status = r.pending ? 'partial' : 'passed';
} catch (error) { r.status = 'failed'; r.stage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1; if (app) try { r.dom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (observed) try { r.failedRestore = await restoreFileMethodObserver(app); } catch {} await writeFile(join(scratch, 'failure-electron.log'), app.logs()); if (fixture) await fixture.close(); else await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, error: r.error })); }
