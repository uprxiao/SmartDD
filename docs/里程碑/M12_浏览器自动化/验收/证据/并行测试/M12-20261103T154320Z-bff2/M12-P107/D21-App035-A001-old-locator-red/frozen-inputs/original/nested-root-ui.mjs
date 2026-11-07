// A13/D21: real packaged controls and source bytes in an isolated project.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-nested-root-app-'), outer = join(scratch, 'a'), inner = join(outer, 'b'), sibling = join(scratch, 'abc'), userData = join(scratch, 'userdata');
for (const path of [outer, inner, sibling]) await mkdir(path);
const X = 'Nested X immutable\n', Y = 'Prefix sibling immutable\n', ORIGINAL = '# Shared original\n', LOCAL = '# Shared nested edit 中文🙂\n';
const files = new Map([[join(inner, 'x.txt'), X], [join(inner, 'a.md'), ORIGINAL], [join(sibling, 'y.txt'), Y]]);
for (const [path, text] of files) await writeFile(path, text);
const sha = value => createHash('sha256').update(value).digest('hex');
const fingerprint = async path => { const bytes = await readFile(path), s = await stat(path, { bigint: true }); return { text: bytes.toString(), hash: sha(bytes), inode: String(s.ino), device: String(s.dev), mtimeNs: String(s.mtimeNs) }; };
const resources = resolve(dirname(executable), '../Resources'), result = { at: new Date().toISOString(), executable, scratch, userData, asarSha256: sha(await readFile(join(resources, 'app.asar'))), brokerSha256: sha(await readFile(join(resources, 'native/willyou-files'))), before: Object.fromEntries(await Promise.all([...files.keys()].map(async path => [path, await fingerprint(path)]))), checks: [], boundary: 'A: actual packaged pointer/key/editor/menu/root/tab/save/close/reopen controls. I: setup via real project directory registration and pre-UI issued file identities, plus read-only persisted workspace/journal/disk observations. No renderer store injection or fabricated native result. Own file chmod temporarily prevents autosave before alias/history verification. No system clipboard, model, daily project or terminal input.' };
let app, project, stage = 'setup';
async function poll(fn, label) { const end = Date.now() + 12000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(40); } throw Error('Timed out: ' + label); }
async function journals() { const root = join(userData, 'file-recovery/v1'), rows = []; let keys = []; try { keys = await readdir(root); } catch {} for (const key of keys) for (const id of await readdir(join(root, key))) try { const path = join(root, key, id, 'journal.json'), journal = JSON.parse(await readFile(path, 'utf8')); let draft; try { draft = await readFile(join(dirname(path), journal.draftLeaf), 'utf8'); } catch {} rows.push({ journal, draft }); } catch {} return rows; }
try {
  app = await openFileAcceptanceApp({ executable, projectPath: outer, userData, name: 'M9 nested root acceptance', prepare: async ({ app, project: p }) => {
    project = p; await app.invoke('projectDirs.update', p.dirs[0].id, { label: 'Outer a', path: outer }); await app.invoke('projectDirs.add', p.id, { label: 'Inner b', path: inner }); await app.invoke('projectDirs.add', p.id, { label: 'Neighbor abc', path: sibling });
    result.project = await app.invoke('projects.get', p.id);
    const scope = { kind: 'project', projectId: p.id }, roots = await app.invoke('files.roots', scope), a = roots.roots.find(r => r.path === outer), b = roots.roots.find(r => r.path === inner);
    const first = await app.invoke('files.open', { lease: a.lease, generation: a.generation, relativePath: 'b/a.md' }), second = await app.invoke('files.open', { lease: b.lease, generation: b.generation, relativePath: 'a.md' });
    assert.equal(first.documentKey, second.documentKey); assert.equal(first.absolutePath, second.absolutePath); result.preUiIdentities = { roots, first, second };
    await app.invoke('files.closeDocument', first.ref); await app.invoke('files.closeDocument', second.ref); await app.invoke('files.closeScope', scope);
  } });
  const { evaluate, click, waitFor, cdp, key } = app;
  const content = text => waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()===${JSON.stringify(text)}`);
  const tab = path => `.fw-tab [role=tab][title=${JSON.stringify(path)}]`;
  const observe = () => evaluate("({tabs:[...document.querySelectorAll('.fw-tab [role=tab]')].map(e=>({path:e.title,selected:e.getAttribute('aria-selected')})),root:{path:document.querySelector('.fw-root-trigger')?.title,label:document.querySelector('.fw-root-trigger')?.innerText},breadcrumb:[...document.querySelectorAll('.fw-breadcrumb button')].map(e=>({text:e.innerText,title:e.title})),text:document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString(),footer:document.querySelector('.fw-footer [role=status]')?.textContent,alerts:[...document.querySelectorAll('.fw-save-strip')].map(e=>e.textContent)})");
  const pointer = async (expression, button = 'left', count = 1) => { const p = await evaluate(`(()=>{const e=(${expression});if(!e)throw Error('Missing actual target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button, clickCount: count }) }); };
  const pin = () => pointer("document.querySelector('.fw-tab [role=tab][aria-selected=true]')", 'left', 2);
  const selectRoot = async path => { await click('[aria-label="文件目录来源"]'); await waitFor('!!document.querySelector(".fw-file-menu [role=menuitem]")'); await pointer(`[...document.querySelectorAll('.fw-file-menu [role=menuitem]')].find(e=>e.title===${JSON.stringify(path)})`); await waitFor(`document.querySelector('.fw-root-trigger')?.title===${JSON.stringify(path)}`); };
  const open = async (root, relative) => { const segments = relative.split('/'); for (let i = 1; i < segments.length; i++) { const selector = `[role=treeitem][title=${JSON.stringify(join(root, ...segments.slice(0, i)))}]`; await waitFor(app.exists(selector)); if (await evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')==='false'`)) await click(selector); } const selector = `[role=treeitem][title=${JSON.stringify(join(root, relative))}]`; await waitFor(app.exists(selector)); await click(selector); };
  stage = 'A13'; await app.open('b/x.txt'); await content(X); await pin(); const containingOuter = await observe();
  assert.equal(containingOuter.root.path, outer); assert.deepEqual(containingOuter.breadcrumb.map(x => x.text), ['Inner b', 'x.txt']);
  await selectRoot(sibling); const manuallyBrowsed = await observe(); assert.deepEqual(manuallyBrowsed.breadcrumb, containingOuter.breadcrumb); await click(tab(join(inner, 'x.txt'))); await waitFor(`document.querySelector('.fw-root-trigger')?.title===${JSON.stringify(inner)}`); await content(X);
  const longestNavigation = await observe(); await selectRoot(sibling); await open(sibling, 'y.txt'); await content(Y); await pin(); const neighbor = await observe(); assert.equal(neighbor.root.path, sibling); assert.deepEqual(neighbor.breadcrumb.map(x => x.text), ['Neighbor abc', 'y.txt']);
  await click(tab(join(inner, 'x.txt'))); await content(X); await waitFor(`document.querySelector('.fw-root-trigger')?.title===${JSON.stringify(inner)}`);
  result.checks.push({ caseId: 'M9-T-A13', containingOuter, manuallyBrowsed, longestNavigation, neighbor, backToNested: await observe() }); await app.screenshot(join(scratch, 'longest-root-navigation.png'));
  await click('[aria-label="关闭 x.txt"]'); await click('[aria-label="关闭 y.txt"]'); await waitFor('!document.querySelector(".fw-tab")');
  stage = 'D21-edit'; await selectRoot(outer); await open(outer, 'b/a.md'); await waitFor(app.exists('[aria-label="查看源码"]')); await click('[aria-label="查看源码"]'); await content(ORIGINAL); await pin();
  await click('.cm-content'); await key('a', 'KeyA', 4); await cdp('Input.insertText', { text: LOCAL }); await content(LOCAL); await chmod(join(inner, 'a.md'), 0o444);
  const checkpoint = await poll(async () => (await journals()).find(x => x.journal.kind === 'checkpoint' && x.draft === LOCAL), 'exact nested draft'); assert.equal((await fingerprint(join(inner, 'a.md'))).text, ORIGINAL);
  stage = 'D21-alias'; await selectRoot(inner); await open(inner, 'a.md'); await content(LOCAL); await waitFor('document.querySelectorAll(".fw-tab").length===1');
  const shared = await observe(); assert.equal(shared.tabs[0].path, join(inner, 'a.md')); assert.equal(shared.root.path, inner); assert.deepEqual(shared.breadcrumb.map(x => x.text), ['Inner b', 'a.md']); assert.equal(shared.footer, '有未保存修改'); await app.screenshot(join(scratch, 'single-dirty-nested-alias.png'));
  stage = 'D21-save'; await chmod(join(inner, 'a.md'), 0o644); await click('[aria-label="文件菜单"]'); await click('[role=menuitem]', '刷新文件和目录'); await waitFor("document.querySelector('.cm-content')?.getAttribute('contenteditable')==='true'");
  await click('[aria-label="撤销"]'); await content(ORIGINAL); const undone = await observe(); await click('[aria-label="重做"]'); await content(LOCAL); const redone = await observe();
  await click('[aria-label="文件菜单"]'); const saveEnabled = await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='保存文件')?.getAttribute('aria-disabled')!=='true'"); if (saveEnabled) await click('[role=menuitem]', '保存文件'); else await click('[aria-label="文件菜单"]');
  await waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'"); const saved = await fingerprint(join(inner, 'a.md')); assert.equal(saved.text, LOCAL);
  const savedOps = (await journals()).filter(x => x.journal.kind !== 'checkpoint' && x.journal.state === 'saved'); assert.equal(savedOps.length, 1); assert.equal(savedOps[0].journal.relativePath, 'b/a.md');
  stage = 'D21-reference'; await pointer("document.querySelector('.fw-breadcrumb button.current')", 'right'); await click('[role=menuitem]', '添加到终端引用');
  await waitFor("document.querySelector('.fw-refs')?.innerText.includes('终端引用（1）')"); const reference = await evaluate("document.querySelector('.fw-refs').innerText"); assert(reference.includes('a.md')); assert(!reference.includes('请在当前文件目录中重新选择引用')); assert(!reference.includes('文件或目录已改变'));
  await app.screenshot(join(scratch, 'nested-reference-source-mapping.png'));
  stage = 'D21-reopen'; const entries = []; for (const [root, relative] of [[outer, 'b/a.md'], [inner, 'a.md']]) { await selectRoot(root); await open(root, relative); await content(LOCAL); await waitFor('document.querySelectorAll(".fw-tab").length===1'); entries.push(await observe()); }
  await click('[aria-label="关闭 a.md"]'); await waitFor('!document.querySelector(".fw-tab")'); await open(inner, 'a.md'); await waitFor(app.exists('[aria-label="查看源码"]')); await click('[aria-label="查看源码"]'); await content(LOCAL); await pin(); const reopened = await observe();
  await selectRoot(outer); await open(outer, 'b/a.md'); await content(LOCAL); await waitFor('document.querySelectorAll(".fw-tab").length===1');
  const scope = { kind: 'project', projectId: project.id }, snapshot = await poll(async () => { const x = await app.invoke('files.workspaceSnapshot', scope); return x.state?.routes.length === 1 && x.state.routes[0].sourcePath === inner ? x : null; }, 'reopened nested route persisted');
  assert.equal((await journals()).filter(x => x.journal.kind !== 'checkpoint' && x.journal.state === 'saved').length, 1);
  result.checks.push({ caseId: 'M9-T-D21', checkpoint, shared, historyRetained: { undone, redone }, saved, savedOperation: savedOps[0].journal, reference, entries, reopened, aliasAfterReopen: await observe(), snapshot }); await app.screenshot(join(scratch, 'nested-alias-saved-reopened.png'));
  result.after = Object.fromEntries(await Promise.all([...files.keys()].map(async path => [path, await fingerprint(path)])));
  for (const path of [join(inner, 'x.txt'), join(sibling, 'y.txt')]) assert.deepEqual(result.after[path], result.before[path]); assert.equal(result.after[join(inner, 'a.md')].hash, sha(LOCAL));
  assert.deepEqual(app.rendererErrors, []); result.status = 'passed';
} catch (error) { result.status = 'failed'; result.failedStage = stage; result.error = String(error); process.exitCode = 1; if (app) try { result.failureDom = await app.evaluate('document.body.innerText'); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { await chmod(join(inner, 'a.md'), 0o644); if (app) { await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, checks: result.checks.length, scratch, failedStage: result.failedStage, error: result.error })); }
