import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { pngFirstPixel } from './png-first-pixel.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
import { installFileResourceObserver, observeFileResources, restoreFileResourceObserver } from '../lib/file-resource-observer.mjs';

const executable = process.env.WILLYOU_FILES_APP, manifest = process.env.WILLYOU_IMAGE_FIXTURES, prototype = process.env.WILLYOU_IMAGE_PROTOTYPE === '1';
assert(executable && manifest);
const corpus = JSON.parse(await readFile(manifest, 'utf8')), scratch = await mkdtemp('/private/tmp/willyou-ordinary-images-' + (prototype ? 'P-' : 'A-'));
const sha = x => createHash('sha256').update(x).digest('hex');
const fingerprint = async () => Object.fromEntries(await Promise.all(corpus.cases.map(async x => { const p = join(corpus.project, x.name), s = await stat(p, { bigint: true }); return [x.name, { sha256: sha(await readFile(p)), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }]; })));
const result = { caseId: 'M9-T-T16', at: new Date().toISOString(), prototype, scratch, manifest, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), checks: [], boundary: prototype ? 'P original shared FileWorkspace using exact synthetic dataURL bytes. No FileService/native reader.' : 'A original packaged image/protected resource pipeline; only passive listeners and trusted CDP input. Native context-menu event recorded separately; no OS menu selection/strategy claim.', before: await fingerprint() };
let app, observed = false, stage = 'setup', entry;
const dom = "(()=>{const e=document.querySelector('.fw-ordinary-image'),i=e?.querySelector('img');if(!i)return null;const s=getComputedStyle(i),r=i.getBoundingClientRect(),p=e.getBoundingClientRect();return{src:i.src,natural:[i.naturalWidth,i.naturalHeight],objectFit:s.objectFit,padding:s.padding,background:s.backgroundColor,box:{x:r.x,y:r.y,width:r.width,height:r.height},parent:{x:p.x,y:p.y,width:p.width,height:p.height,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,clientWidth:e.clientWidth,clientHeight:e.clientHeight},buttons:e.querySelectorAll('button').length,svgNodes:e.querySelectorAll('svg').length,overlay:!!document.querySelector('.fw-image-overlay,.fw-lightbox,[role=dialog]')}})()";
try {
  app = await openFileAcceptanceApp({ executable, projectPath: corpus.project, userData: join(scratch, 'userdata'), name: 'T16 ordinary images', inspectMain: true });
  result.pid = app.processId; entry = await app.evaluate('location.href');
  if (prototype) { await app.cdp('Page.navigate', { url: 'http://127.0.0.1:5180/tests/ordinary-images-runtime.html' }); await app.waitFor('!!window.__ordinaryImagesPrototype'); }
  else { await installFileRpcObserver(app); await installFileResourceObserver(app); observed = true; }
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')||w.webContents.getURL().includes('/tests/ordinary-images-runtime.html')),s={webContents:w.webContents,rows:[]};s.listener=(_,p)=>s.rows.push({mediaType:p.mediaType,srcURL:p.srcURL,x:p.x,y:p.y,isEditable:p.isEditable});w.webContents.on('context-menu',s.listener);globalThis.__ordinaryContext=s;return true})()");
  await app.evaluate("(()=>{const s={rows:[],types:['click','dblclick','mouseover','contextmenu']};s.listener=e=>{if(e.target.matches('.fw-ordinary-image img'))setTimeout(()=>s.rows.push({type:e.type,trusted:e.isTrusted,defaultPrevented:e.defaultPrevented}),0)};s.types.forEach(t=>document.addEventListener(t,s.listener,true));window.__ordinaryImageEvents=s;return true})()");
  for (const theme of ['light', 'dark']) {
    if (prototype) { if (theme === 'dark') await app.click('[data-testid=image-theme]'); }
    else await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    for (const item of corpus.cases) {
      stage = theme + ':' + item.name;
      if (prototype) await app.click('[role=treeitem][data-path=' + JSON.stringify(item.name) + ']'); else await app.open(item.name);
      await app.waitFor(`document.querySelector('.fw-ordinary-image img')?.naturalWidth===${item.width}&&document.querySelector('.fw-ordinary-image img')?.naturalHeight===${item.height}`);
      const before = await app.evaluate(dom); assert.equal(before.objectFit, 'contain'); assert.equal(before.buttons, 0); assert.equal(before.svgNodes, 0); assert.equal(before.overlay, false);
      assert(before.box.width <= before.parent.width && before.box.height <= before.parent.height);
      assert(before.parent.scrollWidth <= before.parent.clientWidth + 1 && before.parent.scrollHeight <= before.parent.clientHeight + 1);
      if (item.svg) { assert.equal(before.background, 'rgb(255, 255, 255)'); assert.equal(before.padding, '16px'); }
      const point = { x: before.box.x + before.box.width / 2, y: before.box.y + before.box.height / 2 };
      await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await app.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await app.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount, ...point });
      for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, button: 'right', clickCount: 1, ...point });
      await app.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      const after = await app.evaluate(dom); assert.deepEqual(after, before);
      const row = { theme, file: item.name, before, after, interactions: 'trusted hover/single/double/right click; no image gallery/zoom/rotate UI appeared' };
      const pixel = async (x, y, label) => { const { data } = await app.cdp('Page.captureScreenshot', { format: 'png', clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1, scale: 1 } }); const bytes = Buffer.from(data, 'base64'); await writeFile(join(scratch, theme + '-' + item.name + '-' + label + '.png'), bytes); return pngFirstPixel(bytes); };
      if (item.animation) { const colors = []; for (let n = 0; n < 16; n++) { colors.push(await pixel(point.x, point.y, 'frame-' + n)); await pause(75); } assert(colors.some(c => c[0] > 150 && c[1] < 90) && colors.some(c => c[1] > 130 && c[0] < 90)); row.animation = { actualCompositorColors: colors, redAndGreen: true }; }
      else if (item.transparent) { row.alpha = await app.evaluate("(()=>{const i=document.querySelector('.fw-ordinary-image img'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return[x.getImageData(2,2,1,1).data[3],x.getImageData(i.naturalWidth-2,2,1,1).data[3]]})()"); assert.deepEqual(row.alpha, [0, 255]); }
      else { row.centerPixel = await pixel(point.x, point.y, 'center'); assert(row.centerPixel[1] > 130 && row.centerPixel[0] < 90); }
      await app.screenshot(join(scratch, theme + '-' + item.name + '.png')); result.checks.push(row);
    }
    if (!prototype) { await app.click('[aria-label="关闭 vector.svg"]'); await app.waitFor('!document.querySelector(".fw-ordinary-image")'); }
  }
  result.events = await app.evaluate("(()=>{const s=window.__ordinaryImageEvents;s.types.forEach(t=>document.removeEventListener(t,s.listener,true));const rows=s.rows;delete window.__ordinaryImageEvents;return rows})()");
  for (const type of ['click', 'dblclick', 'contextmenu']) assert(result.events.filter(e => e.type === type && e.trusted).length >= 10, 'Missing actual ' + type);
  assert(result.events.every(e => !e.defaultPrevented));
  result.contextMenu = await app.mainEvaluate("(()=>{const s=globalThis.__ordinaryContext;s.webContents.removeListener('context-menu',s.listener);const rows=s.rows;delete globalThis.__ordinaryContext;return{rows,listenerRemoved:true}})()");
  assert.equal(result.contextMenu.rows.length, 10); assert(result.contextMenu.rows.every(r => r.mediaType === 'image'));
  if (observed) {
    result.rpc = await observeFileRpcs(app); result.resources = await observeFileResources(app);
    assert(result.rpc.rows.every(r => !r.delivered || r.before === r.after)); assert(result.resources.every(r => !r.delivered || r.before === r.after && r.input === r.inputAfter));
    assert.equal(result.resources.filter(r => r.method === 'openResource').length, 10); assert.equal(result.resources.filter(r => r.method === 'releaseResource').length, 10);
    result.restored = { ...await restoreFileRpcObserver(app), ...await restoreFileResourceObserver(app) }; assert(Object.values(result.restored).every(Boolean)); observed = false;
  }
  result.after = await fingerprint(); assert.deepEqual(result.after, result.before); assert.deepEqual(app.rendererErrors, []); result.rendererErrors = [];
  if (prototype) { await app.cdp('Page.navigate', { url: entry }); await app.waitFor('!!document.querySelector("[data-testid=nav-settings]")'); }
  assert.equal((await app.invoke('tasks.list')).length, 0);
  await writeFile(join(scratch, 'electron.log'), app.logs());
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");
  result.exit = await app.waitForExit(20000); assert.equal(result.exit.code, 0); assert.equal(result.exit.signal, null); await app.close(); app = null; result.status = 'passed';
} catch (error) { result.status = 'failed'; result.stage = stage; result.error = String(error); result.stack = error.stack; process.exitCode = 1; if (app) try { result.failureDom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (observed) try { result.failedRestore = { ...await restoreFileRpcObserver(app), ...await restoreFileResourceObserver(app) }; } catch {} try { await app.mainEvaluate("(()=>{const s=globalThis.__ordinaryContext;if(s)s.webContents.removeListener('context-menu',s.listener);delete globalThis.__ordinaryContext;return true})()"); } catch {} await writeFile(join(scratch, 'failure-electron.log'), app.logs()); await app.close(); } result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, checks: result.checks.length, scratch, error: result.error })); }
