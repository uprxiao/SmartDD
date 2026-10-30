// Diagnose/retest one atomic text input in our own normal packaged App.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { exactUtf8Text, EDIT_BYTES, READ_BYTES } from './text-size-fixtures.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-large-input-app-'), projectPath = join(scratch, 'project'); await mkdir(projectPath);
const name = 'atomic.txt', path = join(projectPath, name); await writeFile(path, 'BASE\n');
const sha = x => createHash('sha256').update(x).digest('hex');
const fingerprint = async () => { const s = await stat(path, { bigint: true }); return { sha256: sha(await readFile(path)), inode: String(s.ino), mtimeNs: String(s.mtimeNs), bytes: Number(s.size) }; };
const resources = resolve(dirname(executable), '../Resources'), result = { at: new Date().toISOString(), executable, asarSha256: sha(await readFile(join(resources, 'app.asar'))), scratch, projectPath, before: await fingerprint(), events: [], status: 'running', boundary: 'One trusted atomic CDP text insertion into original normal App. Passive beforeinput/input binding and V8 CPU profiler only; no private Store/editor writes or synthetic paste/IME. Read-only complete model/hash and independent source fingerprints. Profiler is diagnostic, not whole-process memory/OS performance proof.' };
let app, detach, profiled = false;
try {
  app = await openFileAcceptanceApp({ executable, projectPath, userData: join(scratch, 'userdata'), name: 'M9 atomic input diagnosis' });
  await app.cdp('Page.bringToFront'); await app.open(name); await app.waitFor("document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='BASE\\n'"); await app.click('.cm-content');
  for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] });
  await app.cdp('Runtime.addBinding', { name: '__largeInputEvent' });
  detach = app.onCDP('Runtime.bindingCalled', event => { if (event.name === '__largeInputEvent') { const value = JSON.parse(event.payload); result.events.push(value); console.log(JSON.stringify({ event: value })); } });
  await app.evaluate("(()=>{window.__largeInputListener=e=>{if(e.target.closest?.('.cm-content'))window.__largeInputEvent(JSON.stringify({type:e.type,inputType:e.inputType,units:e.data?.length,cancelable:e.cancelable,trusted:e.isTrusted,composing:e.isComposing,at:performance.now()}))};for(const type of['beforeinput','input'])document.addEventListener(type,window.__largeInputListener,true);return true})()");
  await app.cdp('Profiler.enable'); await app.cdp('Profiler.setSamplingInterval', { interval: 1000 }); await app.cdp('Profiler.start'); profiled = true;
  const byteCount = Number(process.env.WILLYOU_LARGE_INPUT_BYTES ?? READ_BYTES + 1); assert([EDIT_BYTES, EDIT_BYTES + 1, READ_BYTES + 1].includes(byteCount));
  const bytes = exactUtf8Text(byteCount), raw = bytes.toString(), started = Date.now(); result.expected = { bytes: bytes.length, units: raw.length, sha256: sha(bytes) };
  try { await app.cdp('Input.insertText', { text: raw }, 10000); result.inputReturnedMs = Date.now() - started; }
  catch (error) { result.inputError = String(error); result.inputTimeoutMs = Date.now() - started; throw error; }
  const profile = await app.cdp('Profiler.stop', {}, 5000); profiled = false; await writeFile(join(scratch, 'profile.json'), JSON.stringify(profile.profile));
  result.model = await app.evaluate("(async()=>{const v=document.querySelector('.cm-content')?.cmTile?.root?.view,text=v?.state.doc.toString(),bytes=new TextEncoder().encode(text);return{units:text?.length,bytes:bytes.length,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''),focus:document.activeElement?.getAttribute('aria-label')}})()");
  assert.deepEqual({ bytes: result.model.bytes, units: result.model.units, sha256: result.model.sha256 }, result.expected);
  await app.key('s', 'KeyS', 4);
  if (byteCount <= EDIT_BYTES) {
    await app.waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'", 20000); result.saved = await fingerprint(); assert.equal(result.saved.sha256, result.expected.sha256); assert.equal(result.saved.bytes, byteCount);
    await app.screenshot(join(scratch, 'atomic-input-saved.png')); await app.click('[aria-label="关闭 atomic.txt"]');
  } else {
    const limit = byteCount > READ_BYTES ? '20 MiB' : '10 MiB'; await app.waitFor(`[...document.querySelectorAll('.fw-save-strip[role=alert]')].some(e=>e.textContent.includes(${JSON.stringify(limit)}))`);
    result.alerts = await app.evaluate("[...document.querySelectorAll('.fw-save-strip[role=alert]')].map(e=>e.textContent)"); await app.screenshot(join(scratch, 'atomic-input-preserved.png'));
    await app.click('[aria-label="关闭 atomic.txt"]'); await app.waitFor("[...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('文件尚未保存'))"); await app.click('[role=dialog] button', '放弃修改并关闭');
  }
  await app.waitFor("!document.querySelector('.fw-tab [role=tab]')"); result.after = await fingerprint();
  if (byteCount > EDIT_BYTES) assert.deepEqual(result.after, result.before); else assert.deepEqual(result.after, result.saved);
  assert.deepEqual(app.rendererErrors, []); assert(result.events.every(e => e.trusted)); result.rendererErrors = []; result.status = 'passed';
} catch (error) { result.status = 'failed'; result.error = String(error); process.exitCode = 1; }
finally {
  if (app) {
    if (profiled) try { const profile = await app.cdp('Profiler.stop', {}, 3000); await writeFile(join(scratch, 'profile.json'), JSON.stringify(profile.profile)); result.profileCapturedAfterFailure = true; } catch (error) { result.profilerError = String(error); }
    try { result.finalObservation = await app.evaluate("({units:document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.length,focus:document.activeElement?.getAttribute('aria-label')})", 2000); await app.evaluate("for(const type of['beforeinput','input'])document.removeEventListener(type,window.__largeInputListener,true);true", 2000); } catch (error) { result.observationError = String(error); }
    detach?.(); await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close();
  }
  result.afterCleanup = await fingerprint(); result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, inputReturnedMs: result.inputReturnedMs, inputTimeoutMs: result.inputTimeoutMs, events: result.events, error: result.error, profilerError: result.profilerError, artifacts: scratch }));
}
