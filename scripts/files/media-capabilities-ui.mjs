import assert from 'node:assert/strict';
import { readFile, writeFile, stat, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
import { installMediaObserver, observeMedia, restoreMediaObserver } from '../lib/media-resource-observer.mjs';
import { pause } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_FILES_APP, manifest = process.env.WILLYOU_MEDIA_FIXTURES;
assert(executable && manifest);
const f = JSON.parse(await readFile(manifest, 'utf8')), root = f.projectPath, scratch = await mkdtemp('/private/tmp/willyou-media-capabilities-A-');
const sha = x => createHash('sha256').update(x).digest('hex');
async function fingerprint() { const p = join(root, 'clip-a.mp4'), s = await stat(p, { bigint: true }); return { sha256: sha(await readFile(p)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; }
const r = { at: new Date().toISOString(), scratch, manifest, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: await fingerprint(), checks: [], boundary: 'Own packaged App/native media protocol/decoder and trusted UI inputs. Normal native PiP/fullscreen separate from explicitly injected false capability flags and rejected public request promises. No provider/store/decoder/value substitution, user data/model/clipboard/picker/external App or physical OS input claim.' };
let app, observed = false, stage = 'setup';
const snap = () => app.evaluate(`(()=>{const v=document.querySelector('video'),h=v?.closest('.fw-media-view'),b=h?.querySelector('.fw-media-controls'),s=document.querySelector('[aria-label="播放进度"]'),c=b&&getComputedStyle(b),p=document.querySelector('[aria-label="退出画中画"],[aria-label="画中画"]'),f=document.querySelector('[aria-label="退出全屏"],[aria-label="全屏"]');return{at:performance.now(),presentation:h?.dataset.presentation,position:v?.currentTime,duration:v?.duration,paused:v?.paused,ready:v?.readyState,frames:v?.getVideoPlaybackQuality().totalVideoFrames,src:v?.currentSrc,pip:document.pictureInPictureElement===v,fullscreen:document.fullscreenElement===h,pipButton:p&&{label:p.ariaLabel,pressed:p.getAttribute('aria-pressed')},fullscreenButton:f&&{label:f.ariaLabel,pressed:f.getAttribute('aria-pressed'),glyph:f.querySelector('svg')?.getAttribute('class')},capabilities:{pip:document.pictureInPictureEnabled,pipMethod:typeof v?.requestPictureInPicture,fullscreen:document.fullscreenEnabled,fullMethod:typeof h?.requestFullscreen},viewport:{width:innerWidth,height:innerHeight},slider:s&&{value:+s.value,min:+s.min,max:+s.max,step:+s.step},controls:b&&{visible:b.dataset.visible,opacity:c.opacity,visibility:c.visibility,rect:b.getBoundingClientRect().toJSON(),frame:v.getBoundingClientRect().toJSON()},focusInViewer:!!h?.contains(document.activeElement),hoverInViewer:!!h?.matches(':hover'),error:h?.querySelector('[role=alert]')?.textContent}})()`);
const record = async (caseId, theme, scenario, data) => { r.checks.push({ caseId, theme, scenario, ...data }); console.log(JSON.stringify({ caseId, theme, scenario, checks: r.checks.length })); };
const open = async () => { await app.open('clip-a.mp4'); await app.waitFor('document.querySelector("video")?.readyState>=3&&document.querySelector("video").videoWidth===320'); };
const close = async () => { await app.click('[aria-label="关闭 clip-a.mp4"]'); await app.waitFor('!document.querySelector("video")'); };
const arrow = async key => { for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'ArrowRight' ? 39 : 37, nativeVirtualKeyCode: key === 'ArrowRight' ? 124 : 123 }); };
const windows = () => app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return e.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('file:')).map(w=>({id:w.id,fullscreen:w.isFullScreen(),simpleFullscreen:w.isSimpleFullScreen(),visible:w.isVisible(),focused:w.isFocused(),fullscreenable:w.isFullScreenable(),bounds:w.getBounds(),events:globalThis.__mediaNativeFullscreen.rows.filter(x=>x.window===w.id)}))})()");
async function focusNative() {
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');for(const w of e.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('file:'))){w.show();w.focus()}e.app.focus({steal:true});return true})()");
  const end = Date.now() + 3000; for (;;) { const v = await windows(); if (v.length && v.every(x => x.focused)) return v; assert(Date.now() < end, 'Own test window native focus unavailable; system fullscreen remains unverified'); await pause(100); }
}
async function nativeFull(expected) {
  const end = Date.now() + 15000;
  for (;;) {
    const v = await windows();
    if (v.length && v.every(x => {
      if ((x.fullscreen || x.simpleFullscreen) !== expected) return false;
      if (x.simpleFullscreen) return true;
      const events = x.events.filter(e => ['enter-full-screen', 'leave-full-screen'].includes(e.name));
      return expected ? events.at(-1)?.name === 'enter-full-screen' : !events.length || events.at(-1)?.name === 'leave-full-screen';
    })) return v;
    assert(Date.now() < end, 'Own native fullscreen transition did not settle'); await pause(100);
  }
}
async function htmlFull(expected) { const end = Date.now() + 10000; for (;;) { const v = await windows(); if (v.length && v.every(x => x.events.filter(e => ['enter-html-full-screen', 'leave-html-full-screen'].includes(e.name)).at(-1)?.name === (expected ? 'enter-html-full-screen' : 'leave-html-full-screen'))) return v; assert(Date.now() < end, 'Own HTML fullscreen event did not settle'); await pause(100); } }
async function fault(mode) {
  return app.evaluate(`(()=>{const s=window.__mediaCapabilities;if(s.restoreFault)throw Error('Previous fault not restored');const originals=[],replace=(o,k,d)=>{const old=Object.getOwnPropertyDescriptor(o,k);originals.push(()=>old?Object.defineProperty(o,k,old):delete o[k]);Object.defineProperty(o,k,{configurable:true,...d})};if(${JSON.stringify(mode)}==='unavailable'){replace(document,'pictureInPictureEnabled',{value:false});replace(document,'fullscreenEnabled',{value:false})}else{for(const[o,k]of[[HTMLVideoElement.prototype,'requestPictureInPicture'],[Element.prototype,'requestFullscreen']])replace(o,k,{value:async()=>{throw new DOMException('DEV179 deliberate '+k+' rejection','NotAllowedError')}})}s.restoreFault=()=>{originals.reverse().forEach(fn=>fn());delete s.restoreFault;return true};return{mode:${JSON.stringify(mode)},injected:true}})()`);
}
const restoreFault = () => app.evaluate('window.__mediaCapabilities.restoreFault?.()??true');
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'M9 Media native capabilities', inspectMain: true }); r.pid = app.processId;
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s={rows:[],bindings:[]};globalThis.__mediaNativeFullscreen=s;for(const w of e.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('file:')))for(const name of['enter-full-screen','leave-full-screen','enter-html-full-screen','leave-html-full-screen']){const before=w.listenerCount(name),fn=()=>s.rows.push({window:w.id,name,at:Date.now()});w.on(name,fn);s.bindings.push({w,name,fn,before})}return s.bindings.length})()");
  await installFileRpcObserver(app); await installMediaObserver(app); observed = true;
  await app.evaluate(`(()=>{const s={keys:[],listeners:[],ids:new WeakMap(),next:0},add=document.addEventListener,remove=document.removeEventListener,ad=Object.getOwnPropertyDescriptor(document,'addEventListener'),rd=Object.getOwnPropertyDescriptor(document,'removeEventListener');s.key=e=>{const row={key:e.key,trusted:e.isTrusted,target:e.target.getAttribute?.('aria-label')};s.keys.push(row);setTimeout(()=>row.prevented=e.defaultPrevented,0)};window.addEventListener('keydown',s.key,true);document.addEventListener=function(...args){if(args[0]==='fullscreenchange'){if(!s.ids.has(args[1]))s.ids.set(args[1],++s.next);s.listeners.push({action:'add',id:s.ids.get(args[1])})}return add.apply(this,args)};document.removeEventListener=function(...args){if(args[0]==='fullscreenchange')s.listeners.push({action:'remove',id:s.ids.get(args[1])});return remove.apply(this,args)};s.restore=()=>{window.removeEventListener('keydown',s.key,true);ad?Object.defineProperty(document,'addEventListener',ad):delete document.addEventListener;rd?Object.defineProperty(document,'removeEventListener',rd):delete document.removeEventListener;return document.addEventListener===add&&document.removeEventListener===remove};window.__mediaCapabilities=s;return true})()`);
  for (const theme of ['light', 'dark']) {
    stage = theme + ':below'; await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }); await open();
    await app.click('[aria-label="播放进度"]'); await app.waitFor('document.activeElement===document.querySelector(\'[aria-label="播放进度"]\')&&!document.querySelector("video").seeking');
    const before = await snap(); assert.equal(before.presentation, 'below'); assert.equal(before.slider.step, .1); assert(before.position < before.duration - .1);
    await arrow('ArrowRight'); await app.waitFor(`Math.abs(document.querySelector('video').currentTime-${before.position + .1})<1e-6`); const right = await snap();
    await arrow('ArrowLeft'); await app.waitFor(`Math.abs(document.querySelector('video').currentTime-${before.position})<1e-6`); const left = await snap();
    await app.waitFor('window.__mediaCapabilities.keys.filter(x=>x.target==="播放进度").every(x=>typeof x.prevented==="boolean")');
    const keys = await app.evaluate('window.__mediaCapabilities.keys.filter(x=>x.target==="播放进度").slice(-2)'); assert.equal(keys.length, 2); assert(keys.every(x => x.trusted && !x.prevented));
    await record('M9-T-T27', theme, 'below native slider uses 0.1 step and no custom five-second interception', { before, right, left, keys });
    await app.click('[aria-label="播放"]'); await app.waitFor('!document.querySelector("video").paused');
    await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    for (let i = 0; i < 24 && await app.evaluate('document.querySelector(".fw-media-view").contains(document.activeElement)'); i++) await app.key('Tab', 'Tab');
    const start = await snap(); assert(!start.focusInViewer && !start.hoverInViewer);
    await app.waitFor(`document.querySelector('video').currentTime>${start.position + 3.1}`, 15000);
    const afterIdle = await snap(); assert.equal(afterIdle.controls.visible, 'true'); assert.equal(afterIdle.controls.visibility, 'visible'); assert.equal(+afterIdle.controls.opacity, 1); assert(afterIdle.controls.rect.top >= afterIdle.controls.frame.bottom - 1); assert(afterIdle.frames > start.frames);
    await app.click('[aria-label="暂停"]'); await record('M9-T-T27', theme, 'below toolbar remains visible after native playback beyond overlay deadline with pointer/focus outside', { start, afterIdle });
    if (process.env.WILLYOU_MEDIA_BELOW_ONLY === '1') { await app.screenshot(join(scratch, theme + '-below.png')); await close(); continue; }
    stage = theme + ':native-capabilities'; const native = await snap(); r.nativeCapabilities ??= native.capabilities;
    assert.equal(!!native.pipButton, !!native.capabilities.pip && native.capabilities.pipMethod === 'function');
    assert.equal(!!native.fullscreenButton, !!native.capabilities.fullscreen && native.capabilities.fullMethod === 'function');
    if (native.pipButton) {
      await app.click('[aria-label="画中画"]'); await app.waitFor('document.pictureInPictureElement===document.querySelector("video")||!!document.querySelector(".fw-media-view [role=alert]")');
      const entered = await snap(); assert(entered.pip && !entered.error, JSON.stringify(entered)); assert.deepEqual(entered.pipButton, { label: '退出画中画', pressed: 'true' });
      await app.click('[aria-label="退出画中画"]'); await app.waitFor('!document.pictureInPictureElement&&!!document.querySelector(\'[aria-label="画中画"]\')'); const exited = await snap(); assert.equal(exited.pipButton.pressed, 'false');
      await record('M9-T-T30', theme, 'actual native PiP enter and exit', { native, entered, exited });
    } else await record('M9-T-T30', theme, 'actual native PiP unavailable; no button', { native });
    if (native.fullscreenButton) {
      let focusedWindows, blocked = r.nativeFullscreenBlock;
      if (!blocked) try { focusedWindows = await focusNative(); } catch (error) {
        if (process.env.WILLYOU_MEDIA_CONTINUE_NATIVE_BLOCK !== '1') throw error;
        assert(String(error).includes('native focus unavailable'));
        blocked = r.nativeFullscreenBlock = { caseId: 'M9-T-T30', reason: String(error), windows: await windows(), nativeWindowUnverified: true };
      }
      const previousWindows = await nativeFull(false); await app.click('[aria-label="全屏"]');
      await app.waitFor('document.fullscreenElement===document.querySelector(".fw-media-view")||!!document.querySelector(".fw-media-view [role=alert]")'); const enteredWindows = blocked ? await htmlFull(true) : await nativeFull(true), entered = await snap();
      assert(entered.fullscreen && !entered.error); assert.equal(entered.fullscreenButton.pressed, 'true'); assert(/lucide-minimize/.test(entered.fullscreenButton.glyph));
      assert(Math.abs(entered.controls.rect.right - (entered.viewport.width - 20)) <= 1);
      await app.click('[aria-label="退出全屏"]'); await app.waitFor('!document.fullscreenElement&&!!document.querySelector(\'[aria-label="全屏"]\')'); const exitedWindows = blocked ? await htmlFull(false) : await nativeFull(false), exited = await snap(); assert.equal(exited.fullscreenButton.pressed, 'false'); assert(/lucide-maximize/.test(exited.fullscreenButton.glyph));
      await record('M9-T-T30', theme, blocked ? 'HTML fullscreen UI/event cycle passed; native system fullscreen remains blocked' : 'actual HTML and native window fullscreen enter and exit', { focusedWindows, previousWindows, enteredWindows, entered, exitedWindows, exited, nativeWindowVerified: !blocked, ...(blocked ? { blocked } : {}) });
    } else await record('M9-T-T30', theme, 'actual native fullscreen unavailable; no button', { native });
    stage = theme + ':rejection-fault'; const rejected = await fault('reject');
    for (const label of ['画中画', '全屏']) if (await app.evaluate(app.exists('[aria-label=' + JSON.stringify(label) + ']'))) {
      await app.click('[aria-label=' + JSON.stringify(label) + ']'); await app.waitFor('document.querySelector(".fw-media-view [role=alert]")?.textContent.includes("DEV179 deliberate")');
      const failure = await snap(); assert(!failure.pip && !failure.fullscreen && failure.src === native.src); assert(/操作未完成/.test(failure.error));
      await record('M9-T-T30', theme, 'explicit public API rejected Promise: ' + label, { injection: rejected, failure });
    }
    assert(await restoreFault()); await close();
    stage = theme + ':capability-fault'; const unavailable = await fault('unavailable'); await open(); const hidden = await snap(); assert(!hidden.pipButton && !hidden.fullscreenButton); await record('M9-T-T30', theme, 'explicit false capability flags hide both controls', { injection: unavailable, hidden });
    await close(); assert(await restoreFault()); await open(); const restored = await snap(); assert.deepEqual(restored.capabilities, native.capabilities); assert.equal(!!restored.pipButton, !!native.pipButton); assert.equal(!!restored.fullscreenButton, !!native.fullscreenButton);
    await app.click('[aria-label="播放"]'); await app.waitFor('!document.querySelector("video").paused&&document.querySelector("video").currentTime>.25'); await app.click('[aria-label="暂停"]'); const recovered = await snap(); assert(!recovered.error && recovered.frames > restored.frames); await record('M9-T-T30', theme, 'original native capabilities and decoder recover after fault restoration', { restored, recovered });
    await app.screenshot(join(scratch, theme + '-capabilities.png')); await close();
  }
  r.listeners = await app.evaluate('window.__mediaCapabilities.listeners'); const added = r.listeners.filter(x => x.action === 'add').map(x => x.id), removed = r.listeners.filter(x => x.action === 'remove').map(x => x.id); assert.deepEqual(added.sort(), removed.sort()); assert(added.length > 0);
  r.keys = await app.evaluate('window.__mediaCapabilities.keys'); assert(r.keys.every(x => x.trusted)); r.observerRestored = await app.evaluate('window.__mediaCapabilities.restore()'); assert(r.observerRestored); await app.evaluate('delete window.__mediaCapabilities');
  r.rpc = await observeFileRpcs(app); r.media = await observeMedia(app); r.restored = { ...await restoreFileRpcObserver(app), ...await restoreMediaObserver(app) }; observed = false; assert(Object.values(r.restored).every(Boolean));
  r.nativeObserver = await app.mainEvaluate("(()=>{const s=globalThis.__mediaNativeFullscreen,result={rows:s.rows,restored:s.bindings.map(({w,name,fn,before})=>{w.removeListener(name,fn);return{name,before,after:w.listenerCount(name),restored:w.listenerCount(name)===before}})};delete globalThis.__mediaNativeFullscreen;return result})()"); assert(r.nativeObserver.restored.every(x => x.restored));
  r.after = await fingerprint(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []); r.rendererErrors = []; assert.deepEqual(await app.invoke('tasks.list'), []);
  await writeFile(join(scratch, 'electron.log'), app.logs()); await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");
  r.exit = await app.waitForExit(20000); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); await app.close(); app = null; r.status = r.nativeFullscreenBlock ? 'partial' : 'passed';
  r.completedCases = ['M9-T-T27', ...(!r.nativeFullscreenBlock ? ['M9-T-T30'] : [])]; r.blockedCases = r.nativeFullscreenBlock ? ['M9-T-T30'] : []; if (r.nativeFullscreenBlock) process.exitCode = 2;
} catch (error) {
  r.status = 'failed'; r.stage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1;
  if (app) try { r.dom = await app.evaluate('document.body.innerText'); r.failure = await snap(); r.failureWindows = await windows(); await app.screenshot(join(scratch, 'failure.png')); } catch {}
} finally {
  if (app) {
    try { await app.evaluate('(async()=>{const s=window.__mediaCapabilities;s?.restoreFault?.();if(document.pictureInPictureElement)await document.exitPictureInPicture();if(document.fullscreenElement)await document.exitFullscreen();s?.restore?.();delete window.__mediaCapabilities;return true})()'); } catch {}
    if (observed) try { r.failedRestore = { ...await restoreFileRpcObserver(app), ...await restoreMediaObserver(app) }; } catch {}
    try { await app.mainEvaluate("(()=>{const s=globalThis.__mediaNativeFullscreen;if(s){for(const {w,name,fn}of s.bindings)if(!w.isDestroyed())w.removeListener(name,fn);delete globalThis.__mediaNativeFullscreen}return true})()"); } catch {}
    await writeFile(join(scratch, 'failure-electron.log'), app.logs()); await app.close();
  }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, artifacts: scratch, error: r.error, stage: r.stage }));
}
