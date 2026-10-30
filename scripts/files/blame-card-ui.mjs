import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blameCardFile, blameCardFingerprint, createBlameCardFixture } from './blame-card-fixtures.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';
const executable = process.env.WILLYOU_FILES_APP;
assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-blame-card-A-'), fixture = await createBlameCardFixture();
const sha = raw => createHash('sha256').update(raw).digest('hex');
const r = { at: new Date().toISOString(), caseId: 'M9-T-S04', layer: 'A independent current-contract subset', scratch, fixture, executable, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), driverSha256: sha(await readFile(fileURLToPath(import.meta.url))), checks: [], status: 'running', boundary: 'Original packaged App/native Git and current five-field metadata,own source/commits/userData. Real mouse/key input,passive original IPC/events only,no data substitution,store/DOM/model writes,clipboard,focus/foreground API,network,OS opener or account/PR lookup. Optional-source and real external-link branches remain pending;not full S04.' };
let app, observed = false, stage = 'setup';
const ev = (fn, ...args) => app.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = (fn, ...args) => app.waitFor(`(${fn.toString()})(...${JSON.stringify(args)})`, 15000);
async function phase(next) { stage = next; const data = { at: new Date().toISOString(), stage, pid: r.pid, checks: r.checks.length, scratch }; await writeFile(join(scratch, 'progress.json'), JSON.stringify(data) + '\n'); console.log(JSON.stringify(data)); }
const model = () => ev(() => document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view?.state.doc.toString());
async function closeCard() {
  if (await ev(() => !!document.querySelector('.fw-blame-card'))) {
    await app.click('[aria-label=关闭行归属详情]');
    await wait(() => !document.querySelector('.fw-blame-card'));
  }
}
async function toggle() {
  await app.click('[aria-label=文件菜单]');
  await wait(() => [...document.querySelectorAll('.fw-file-menu [role=menuitem]')].some(e => /行归属/.test(e.textContent) && e.getAttribute('aria-disabled') !== 'true'));
  const label = await ev(() => [...document.querySelectorAll('.fw-file-menu [role=menuitem]')].find(e => /行归属/.test(e.textContent)).textContent.trim());
  if (!label.startsWith('隐藏')) await app.click('.fw-file-menu [role=menuitem]', label);
  else await app.key('Escape', 'Escape');
  await wait(() => !document.querySelector('.fw-file-menu'));
}
async function hover(line) {
  const point = await ev(n => {
    const e = document.querySelector(`.fw-blame-author[aria-label^="第 ${n} 行归属"]`);
    if (!e) throw Error('Missing actual native author');
    const b = e.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (!e.contains(document.elementFromPoint(x, y))) throw Error('Author target occluded');
    return { x, y };
  }, line);
  await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 120, y: point.y + 50 });
  await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
}
async function focusByTab(line) {
  await app.click('[aria-label=文件菜单]'); await app.key('Escape', 'Escape');
  await wait(() => !document.querySelector('.fw-file-menu'));
  const sequence = [];
  for (let i = 0; i < 60; i++) {
    await app.key('Tab', 'Tab');
    const value = await ev(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.slice(0, 100) }));
    sequence.push(value);
    if (value.label?.startsWith(`第 ${line} 行归属：`)) return sequence;
  }
  throw Error('Actual Tab traversal did not reach requested author: ' + JSON.stringify(sequence));
}
async function card(expected, pinned, trigger, sequence) {
  await wait(role => document.querySelector('.fw-blame-card')?.getAttribute('role') === role, pinned ? 'dialog' : 'tooltip');
  const state = await ev(() => {
    const e = document.querySelector('.fw-blame-card'), rect = e.getBoundingClientRect();
    return { role: e.getAttribute('role'), author: e.querySelector('strong')?.textContent, summary: e.querySelector('p')?.textContent, dateAndSha: e.querySelector('small')?.textContent, links: [...e.querySelectorAll('a,.fw-blame-link')].map(x => x.textContent), markupElements: e.querySelectorAll('script,img').length, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, events: globalThis.__S04Events.slice(), source: document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view?.state.doc.toString() };
  });
  const expectedDate = await ev(at => new Date(at * 1000).toLocaleString(), expected.at);
  assert.equal(state.author, expected.author); assert.equal(state.summary, expected.summary || '无提交说明');
  assert.equal(state.dateAndSha, expectedDate + ' · ' + expected.commitId.slice(0, 7));
  assert.deepEqual(state.links, []); assert.equal(state.markupElements, 0);
  assert(state.rect.width > 0 && state.rect.height > 0); assert.equal(state.source, fixture.text);
  const event = state.events.findLast(x => x.kind === trigger && x.line === expected.line);
  assert(event?.trusted, 'Expected trusted native input event for ' + trigger);
  return { expected, trigger, sequence, state, pass: true };
}
try {
  app = await openFileAcceptanceApp({ executable, projectPath: fixture.project, userData: join(scratch, 'userdata'), name: 'A S04 isolated native attribution card', inspectMain: true });
  r.pid = app.processId;
  await app.click('[aria-label=文件全屏]');
  await installFileMethodObserver(app, ['open','read','closeDocument','gitStatus','gitBlame','cancelGit','save','checkpoint','openWebLink']); observed = true;
  await ev(() => {
    globalThis.__S04Events = [];
    const read = event => { const target = event.target?.closest?.('.fw-blame-author'); if (target) globalThis.__S04Events.push({ kind: event.type, line: Number(/^第 ([0-9]+) 行归属/.exec(target.getAttribute('aria-label'))?.[1]), trusted: event.isTrusted, at: performance.now() }); };
    globalThis.__S04Listener = read;
    for (const kind of ['mouseover','focusin','click']) document.addEventListener(kind, read, true);
    return true;
  });
  for (const theme of ['light','dark']) {
    await phase(theme + ':open');
    await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await app.open(blameCardFile); await wait(text => document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view?.state.doc.toString() === text, fixture.text);
    await toggle(); await wait(() => document.querySelectorAll('.fw-blame-author').length === 3);
    for (const expected of fixture.expected.slice(0,2)) {
      for (const trigger of ['mouseover','focusin','click']) {
        await phase(theme + ':line' + expected.line + ':' + trigger);
        await closeCard(); let sequence;
        if (trigger === 'mouseover') await hover(expected.line);
        else if (trigger === 'focusin') sequence = await focusByTab(expected.line);
        else await app.click(`.fw-blame-author[aria-label^="第 ${expected.line} 行归属"]`);
        const check = await card(expected, trigger === 'click', trigger, sequence);
        r.checks.push({ theme, ...check });
        if (trigger === 'click') await app.screenshot(join(scratch, theme + '-line' + expected.line + '-pinned.png'));
      }
    }
    await closeCard();
    assert.equal(await model(), fixture.text);
    assert.deepEqual(await blameCardFingerprint(fixture.project), fixture.before);
    await app.click(`.fw-tab:has([title=${JSON.stringify(join(fixture.project, blameCardFile))}]) [aria-label^="关闭 "]`);
    await wait(() => document.querySelectorAll('.fw-tab').length === 0);
  }
  r.rpc = await observeFileMethods(app);
  assert(r.rpc.filter(row => row.method === 'gitBlame' && row.delivered).length >= 2);
  for (const row of r.rpc.filter(row => row.method === 'gitBlame' && row.delivered)) assert.deepEqual(row.output.lines, fixture.expected);
  assert(!r.rpc.some(row => ['save','checkpoint','openWebLink'].includes(row.method)));
  assert(r.rpc.every(row => !row.delivered || row.input === row.inputAfter && row.before === row.after));
  r.restored = await restoreFileMethodObserver(app); observed = false;
  assert(Object.values(r.restored).every(Boolean));
  r.eventsRestored = await ev(() => { for (const kind of ['mouseover','focusin','click']) document.removeEventListener(kind, globalThis.__S04Listener, true); delete globalThis.__S04Listener; delete globalThis.__S04Events; return true; });
  assert.deepEqual(app.rendererErrors, []);
  r.rendererErrors = app.rendererErrors; r.normalExitClaimed = false;
  await writeFile(join(scratch, 'electron.log'), app.logs());
  await app.close(); app = null;
  r.after = await blameCardFingerprint(fixture.project); assert.deepEqual(r.after, fixture.before);
  r.status = 'twelve-current-contract-App-groups-passed;optional-source-and-external-link-branches-pending';
} catch (error) {
  r.status = 'failed'; r.failedStage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1;
  if (app) {
    try { r.rpc = observed ? await observeFileMethods(app) : r.rpc; r.sourceAtFailure = await model(); await app.screenshot(join(scratch,'failure.png')); } catch (failure) { r.observationFailure = String(failure); }
  }
} finally {
  if (app) {
    if (observed) try { r.restored = await restoreFileMethodObserver(app); } catch (error) { r.restoreFailure = String(error); }
    await writeFile(join(scratch,'failure-electron.log'), app.logs()); await app.crash(); await app.close();
  }
  r.finishedAt = new Date().toISOString(); await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({ status:r.status, checks:r.checks.length, failedStage:r.failedStage, error:r.error, pid:r.pid, scratch }));
}
