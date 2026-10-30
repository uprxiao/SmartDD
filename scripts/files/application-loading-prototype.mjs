import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openElectron } from '../lib/electron-harness.mjs';
const scratch = await mkdtemp('/private/tmp/willyou-application-loading-P-');
const r = { caseId: 'M9-T-E14', layer: 'P', at: new Date().toISOString(), scratch, checks: [], boundary: 'Original shared FileWorkspace, synthetic application capability/choice model. Demo select/change is explicit fixture setup; visible menu, retry, remember checkbox and opening use actual pointer inputs. P never launches an external app and never proves native discovery/opening.' };
let app, stage = 'setup';
const ev = (fn, ...args) => app.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = (fn, ...args) => app.waitFor(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function click(selector, text) {
  await wait((s, t) => [...document.querySelectorAll(s)].some(e => t === null || e.textContent.trim() === t), selector, text ?? null);
  const p = await ev(async (s, t) => { const e = [...document.querySelectorAll(s)].find(e => t === null || e.textContent.trim() === t); e.scrollIntoView({ block: 'nearest' }); await new Promise(requestAnimationFrame); const b = e.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw Error('Prototype control occluded'); return { x, y }; }, selector, text ?? null);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
}
async function scene(theme) {
  await ev(async theme => {
    window.__appsUnmount?.(); document.getElementById('apps-p')?.remove(); document.documentElement.dataset.theme = theme;
    const [f, m, react, dom] = await Promise.all([import('/src/FileWorkspace.jsx'), import('/src/file-workspace-model.mjs'), import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js')]);
    const root = '/synthetic/application-' + theme, roots = [{ id: 'main', hostId: 'local', path: root }, { id: 'extra', hostId: 'local', path: '/workspace/shared-docs' }], id = 'application-' + theme, scope = m.workspaceScope(id, roots);
    const state = m.openFile(m.initialWorkspace(), 'main', 'package.json', true); localStorage.setItem('willyou-m9-prototype-v1', JSON.stringify({ [scope]: state })); window.__applicationScope = scope;
    document.getElementById('root').style.display = 'none'; document.title = 'P E14 · synthetic application choices · file region only';
    const host = document.createElement('section'); host.id = 'apps-p'; host.style.cssText = 'position:fixed;inset:0;z-index:999;width:1200px;height:900px;display:flex'; document.body.append(host);
    const rr = (dom.createRoot ?? dom.default.createRoot)(host), React = react.default ?? react; window.__appsUnmount = () => rr.unmount(); rr.render(React.createElement(f.FileWorkspace, { task: { id, cwd: root, hostId: 'local', status: 'running' }, project: { id: 'P', path: root, hostId: 'local', name: 'Synthetic E14' }, dark: theme === 'dark', onTheme: () => {}, onClose: () => {} }));
  }, theme);
  await wait(() => !!document.querySelector('#apps-p .fw-content textarea'));
  await ev(() => { Object.assign(document.querySelector('#apps-p>.file-workspace').style, { width: '100%', height: '100%', margin: '0', flex: '1' }); });
}
async function scenario(value) {
  await click('#apps-p .fw-footer>button');
  await wait(() => !!document.querySelector('#apps-p [aria-label="外部应用能力场景"]'));
  await ev(value => { const e = document.querySelector('#apps-p [aria-label="外部应用能力场景"]'); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await click('#apps-p .fw-footer>button');
}
const preference = () => ev(() => JSON.parse(localStorage.getItem('willyou-m9-prototype-v1'))[window.__applicationScope].fileOpener);
try {
  app = await openElectron({ executable: process.env.WILLYOU_FILES_APP, userData: join(scratch, 'userdata') });
  await app.cdp('Page.navigate', { url: 'http://127.0.0.1:5179/?preview=m9' }); await wait(() => !!document.querySelector('.file-workspace'));
  for (const theme of ['light', 'dark']) {
    stage = theme + ':loading'; await scene(theme); const before = await preference(); await scenario('loading');
    await click('#apps-p [aria-label="打开方式"]'); await wait(() => document.querySelector('#apps-p .fw-menu')?.textContent.includes('正在读取可用应用'));
    assert(await ev(() => document.querySelector('#apps-p .fw-open-button>button').disabled));
    assert.equal(await ev(() => [...document.querySelectorAll('#apps-p .fw-menu button')].filter(e => !e.disabled && /TextEdit|VS Code|Visual Studio|Typora/.test(e.textContent)).length), 0);
    await app.screenshot(join(scratch, theme + '-loading.png')); await click('#apps-p .fw-dismiss');
    stage = theme + ':failure'; await scenario('error');
    // The context menu has the explicit recovery action, unlike the compact
    // Open-with menu. Use its actual file trigger and right mouse button.
    const p = await ev(() => { const e = document.querySelector('#apps-p .fw-breadcrumb button.current'), b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: 'right', clickCount: 1 }) });
    await wait(() => document.querySelector('#apps-p .fw-menu [role=alert]')?.textContent.includes('无法获取可用应用'));
    assert.deepEqual(await preference(), before); await app.screenshot(join(scratch, theme + '-failure.png'));
    await click('#apps-p .fw-menu button', '重新读取应用列表');
    await wait(() => !document.querySelector('#apps-p .fw-menu [role=alert]') && !document.querySelector('#apps-p .fw-open-button>button').disabled);
    await click('#apps-p .fw-dismiss'); await click('#apps-p .fw-open-button>button');
    await wait(() => document.querySelector('#apps-p .fw-footer [role=status]')?.textContent.includes('原型模拟打开'));
    assert.deepEqual(await preference(), before);
    r.checks.push({ theme, loadingDisabled: true, noFakeReadyChoicesOnFailure: true, explicitRetry: true, defaultOpenKeepsPreference: true });
  }
  assert.deepEqual(app.rendererErrors, []); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.error = String(error); r.failedStage = stage; process.exitCode = 1; if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, scratch, checks: r.checks.length, failedStage: r.failedStage, error: r.error })); }
