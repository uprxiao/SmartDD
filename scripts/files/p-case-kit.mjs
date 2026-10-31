// Shared scaffold for the M9 N-series prototype (P layer) drivers: an isolated synthetic FileWorkspace mounted inside the
// packaged App window from the prototype dev server (same recipe as reduced-motion-ui.mjs). P has no real PTY / filesystem.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';

export const P_URL = 'http://127.0.0.1:5179/?preview=m9';
const sha = (x) => createHash('sha256').update(x).digest('hex');

export async function runPCase({caseId, tag, run}) {
  const executable = process.env.WILLYOU_FILES_APP;
  assert(executable, 'WILLYOU_FILES_APP is required');
  const scratch = await mkdtemp('/private/tmp/willyou-' + tag + '-P-');
  const r = {at: new Date().toISOString(), caseId, layer: 'P', scratch, executable, prototypeUrl: P_URL,
    asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), checks: [], status: 'running',
    boundary: 'P = isolated synthetic FileWorkspace from the prototype dev server inside the packaged App window; no real PTY/filesystem/watcher; no App quit claim'};
  let app, stage = 'setup';
  const setStage = (s) => { stage = s; };
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  try {
    app = await openElectron({executable, userData: join(scratch, 'userdata'), inspectMain: true});
    await app.cdp('Page.navigate', {url: P_URL});
    await app.waitFor("!!document.querySelector('.file-workspace')");
    // Mount (or remount) an isolated workspace with the given synthetic files. removeDefaults hides the built-in sample tree.
    const mount = async ({theme, files, removeDefaults = true, expanded = []}) => {
      await ev(async (theme, files, removeDefaults, expanded) => {
        window.__pUnmount?.(); document.getElementById('p-shell')?.remove(); document.documentElement.dataset.theme = theme; document.getElementById('root').style.display = 'none';
        const [f, m, react, dom] = await Promise.all([import('/src/FileWorkspace.jsx'), import('/src/file-workspace-model.mjs'), import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js')]);
        const R = react.default ?? react, roots = [{id: 'main', hostId: 'local', path: '/synthetic/' + theme}, {id: 'extra', hostId: 'local', path: '/workspace/shared-docs'}], id = 'p-' + theme + '-' + Date.now();
        const state = {...m.initialWorkspace(), tabs: [], active: null, expanded, rootStates: {main: {expanded, query: '', selected: [], focused: '', scrollTop: 0}}, removedPaths: {main: removeDefaults ? m.FILES.map((x) => x.path) : []}, syntheticFiles: {main: files}};
        localStorage.setItem('willyou-m9-prototype-v1', JSON.stringify({[m.workspaceScope(id, roots)]: state}));
        const shell = document.createElement('section'); shell.id = 'p-shell'; shell.style.cssText = 'position:fixed;inset:40px 20px 20px;z-index:999;display:flex'; shell.innerHTML = '<div id="p-host" style="width:100%;height:100%;display:flex"></div>'; document.body.append(shell);
        const root = (dom.createRoot ?? dom.default.createRoot)(shell.firstElementChild); window.__pUnmount = () => root.unmount();
        root.render(R.createElement(f.FileWorkspace, {task: {id, cwd: roots[0].path, hostId: 'local', status: 'running'}, project: {id: 'p-host', path: roots[0].path, hostId: 'local'}, dark: theme === 'dark', onTheme: () => {}, onClose: () => {}}));
        return true;
      }, theme, files, removeDefaults, expanded);
      await app.waitFor("!!document.querySelector('#p-host>.file-workspace')");
      await ev(() => { Object.assign(document.querySelector('#p-host>.file-workspace').style, {width: '100%', height: '100%', margin: 0, flex: 1}); return true; });
    };
    await run({app, r, ev, mount, setStage});
    r.status = 'passed';
  } catch (error) {
    r.status = 'failed'; r.failedStage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1;
    if (app) try { r.dom = await app.evaluate('document.body.innerText.slice(0,5000)'); await app.screenshot(join(scratch, 'failure.png')); } catch {}
  } finally {
    if (app) { try { await app.evaluate('window.__pUnmount?.();true'); await app.cdp('Emulation.clearDeviceMetricsOverride'); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); }
    r.finishedAt = new Date().toISOString();
    await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n');
    console.log(JSON.stringify({status: r.status, checks: r.checks.length, failedStage: r.failedStage, error: r.error, artifacts: scratch}));
  }
}
