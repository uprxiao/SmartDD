// R01: capability-gated content search in the real packaged file workspace.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-search-entry-A-'), root = join(scratch, 'project'); await mkdir(root);
const text = 'R01 original selection 中文🙂\nfirst needle\nsecond needle\n', source = join(root, 'source.txt'); await writeFile(source, text);
const sha = x => createHash('sha256').update(x).digest('hex');
const fingerprint = async () => { const s = await stat(source, { bigint: true }); return { sha256: sha(await readFile(source)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
const r = { at: new Date().toISOString(), caseId: 'M9-T-R01', layer: 'A', scratch, root, executable, status: 'running', checks: [], before: await fingerprint(), asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), brokerSha256: sha(await readFile(resolve(executable, '../../Resources/native/willyou-files'))), boundary: 'Unmodified packaged App with fresh private userData and three synthetic local projects. Project preparation is not under test; all project navigation, file open, editor selection, content-search trigger/query/close use actual trusted CDP input. Read-only actual CodeMirror state, original root/search RPC and native result observations. No Store/DOM/editor/result mutation. Unreachable missing callback/transport/host variants are component U, untrusted scopes/leases are actual native I, not fake A. No native focus, clipboard, chooser, daily data or model invocation.' };
let app, observed = false, browserObserved = false, stage = 'setup', projects;
const view = 'document.querySelector(".fw-editor-host .cm-content")?.cmTile?.root?.view';
const selected = () => app.evaluate(`(()=>{const v=${view};return v?{doc:v.state.doc.toString(),selection:v.state.selection.toJSON(),selected:v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to),tabs:[...document.querySelectorAll('.fw-tab [role=tab]')].map(e=>({title:e.title,selected:e.getAttribute('aria-selected')}))}:null})()`);
async function navigate(project) {
  await app.click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`); await app.click('[data-testid=sidebar-project-edit]');
  await app.waitFor(app.exists('[data-testid=project-files]'));
  if (!await app.evaluate("document.querySelector('[data-testid=project-files]')?.getAttribute('aria-pressed')==='true'")) await app.click('[data-testid=project-files]');
  await app.waitFor(app.exists('[data-testid=file-workspace]'));
  await app.waitFor('!document.querySelector(".fw-tree-status.loading")');
}
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'A · R01 isolated local search', inspectMain: true, showFiles: false, prepare: async ({ app, project }) => {
    const input = name => ({ name, aliases: [], description: 'R01 isolated fixture', rulesPath: null });
    projects = { local: project, empty: await app.invoke('projects.create', input('A · R01 no registered root'), []), missing: await app.invoke('projects.create', input('A · R01 registered missing root'), [{ label: 'Missing synthetic directory', path: join(scratch, 'does-not-exist') }]) };
  } }); r.appPid = app.processId; r.projectIds = Object.fromEntries(Object.entries(projects).map(([k, p]) => [k, p.id]));
  await installFileMethodObserver(app, ['roots', 'search', 'startSearchSession', 'cancelSearch', 'open', 'read', 'save']); observed = true;
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s={original:e.shell.openExternal,external:[],created:[]};s.createdListener=(_event,wc)=>s.created.push({id:wc.id,type:wc.getType()});e.app.on('web-contents-created',s.createdListener);s.wrapper=function(...args){s.external.push({at:Date.now(),url:args[0]});return s.original.apply(this,args)};e.shell.openExternal=s.wrapper;globalThis.__r01BrowserObserver=s;return true})()"); browserObserved = true;
  r.windowOpenEvents = []; app.onCDP('Page.windowOpen', e => r.windowOpenEvents.push(e)); await app.cdp('Page.enable');
  for (const theme of ['light', 'dark']) {
    await app.invoke('appSettings.update', 'theme', 'y' + theme);
    stage = theme + ':local'; await navigate(projects.local); await app.waitFor(app.exists(app.tree('source.txt'))); await app.open('source.txt'); await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(text)}`);
    const roots = (await observeFileMethods(app)).filter(x => x.method === 'roots' && x.args[0]?.projectId === projects.local.id && x.delivered).at(-1)?.output;
    assert.equal(roots.roots.length, 1); assert.equal(roots.roots[0].hostId, 'local'); assert.equal(roots.roots[0].capabilities.searchContent, true);
    await app.click('.fw-editor-host .cm-content'); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) });
    await app.waitFor(`${view}?.state.selection.main.from===0&&${view}?.state.selection.main.to===${text.length}`); const before = await selected(); assert.equal(before.selected, text);
    await app.click('[aria-label="在文件中搜索"]'); await app.waitFor('Boolean(document.querySelector("[role=dialog] [aria-label=全文搜索内容]"))');
    const after = await selected(); assert.deepEqual(after, before); await app.waitFor('document.activeElement?.getAttribute("aria-label")==="全文搜索内容"');
    await app.cdp('Input.insertText', { text: 'needle' }); await app.waitFor('document.querySelectorAll("[role=dialog] [data-search-row]").length===2');
    const results = await app.evaluate('[...document.querySelectorAll("[role=dialog] [data-search-row]")].map(e=>e.textContent)'); assert(results.every(x => x.includes('needle') && x.includes('source.txt'))); assert.deepEqual(await selected(), before);
    await app.screenshot(join(scratch, theme + '-native-search.png')); await app.click('[aria-label="关闭全文搜索"]'); await app.waitFor('!document.querySelector(".fw-search-dialog")'); assert.deepEqual(await selected(), before);
    r.checks.push({ theme, scenario: 'trusted-local-search', mainRoot: roots.roots[0], originalSelection: before, afterOpen: after, actualNativeRows: results, preservedAfterClose: true, pass: true });
    for (const variant of ['empty', 'missing']) {
      stage = theme + ':' + variant; const count = (await observeFileMethods(app)).filter(x => ['search', 'startSearchSession'].includes(x.method)).length;
      await navigate(projects[variant]); await app.waitFor('document.querySelector(".fw-empty")?.textContent.includes("没有可用的本机目录")');
      const actual = (await observeFileMethods(app)).filter(x => x.method === 'roots' && x.args[0]?.projectId === projects[variant].id && x.delivered).at(-1)?.output;
      assert.equal(actual.roots.length, 0); assert.equal(actual.unavailable.length, variant === 'missing' ? 1 : 0);
      assert.equal(await app.evaluate('Boolean(document.querySelector("[aria-label=在文件中搜索]"))'), false); assert.equal(await app.evaluate('Boolean(document.querySelector(".fw-search-dialog"))'), false);
      assert.equal((await observeFileMethods(app)).filter(x => ['search', 'startSearchSession'].includes(x.method)).length, count);
      assert.equal(await app.evaluate('document.querySelectorAll("[role=treeitem],.fw-tab [role=tab],.fw-editor-host .cm-content").length'), 0);
      await app.screenshot(join(scratch, theme + '-' + variant + '-search-hidden.png')); r.checks.push({ theme, scenario: variant, originalRoots: actual, entryHidden: true, noDialog: true, searchRequestsAdded: 0, noFallbackTreeOrTabs: true, pass: true });
    }
    await writeFile(join(scratch, 'partial.json'), JSON.stringify(r, null, 2) + '\n');
  }
  r.browser = await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__r01BrowserObserver;return{external:s.external,created:s.created,windows:e.BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL()}))}})()"); assert.deepEqual(r.browser.external, []); assert.deepEqual(r.browser.created, []); assert.equal(r.browser.windows.length, 1); assert.deepEqual(r.windowOpenEvents, []);
  r.browserRestored = await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__r01BrowserObserver;e.shell.openExternal=s.original;e.app.off('web-contents-created',s.createdListener);const restored=e.shell.openExternal===s.original;delete globalThis.__r01BrowserObserver;return restored})()"); browserObserved = false; assert(r.browserRestored);
  r.trace = await observeFileMethods(app); assert.equal(r.trace.filter(x => x.method === 'save').length, 0); assert(r.trace.some(x => x.method === 'startSearchSession' && x.args[0].query === 'needle' && x.output.rows.length === 2));
  for (const x of r.trace.filter(x => x.delivered)) { assert.equal(x.input, x.inputAfter); assert.equal(x.before, x.after); }
  r.restored = await restoreFileMethodObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean)); r.after = await fingerprint(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []);
  stage = 'normal-exit'; await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()"); r.exit = await app.waitForExit(180000); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); r.status = 'passed';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1; if (app) try { r.dom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally {
  if (app) { if (browserObserved) try { await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__r01BrowserObserver;e.shell.openExternal=s.original;e.app.off('web-contents-created',s.createdListener);delete globalThis.__r01BrowserObserver;return true})()"); } catch {} if (observed) try { r.trace = await observeFileMethods(app); r.cleanupRestored = await restoreFileMethodObserver(app); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, stage: r.failedStage, error: r.error, scratch }));
}
