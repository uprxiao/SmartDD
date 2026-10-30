// Packaged WillYou UI acceptance for external filesystem changes. Only fixture
// creation uses public IPC; tested actions use Chromium pointer/keyboard input.
// This does not exercise physical OS input, IME candidates, or Codex pixels.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_FILES_APP;
assert(executable, 'WILLYOU_FILES_APP must name a packaged WillYou executable');
const scratch = await mkdtemp('/private/tmp/willyou-m9-external-ui-'), projectPath = join(scratch, 'project');
await mkdir(projectPath);
const scenarios = ['ordinary', 'CLI'].flatMap(writer => ['watch', 'refresh', 'resume'].map(trigger => ({ writer, trigger })));
for (const [index] of scenarios.entries()) {
  const path = join(projectPath, `case-${index}`); await mkdir(path);
  await writeFile(join(path, 'a.txt'), 'original a'); await writeFile(join(path, 'b.txt'), 'original b');
}
await writeFile(join(projectPath, 'draft.txt'), 'draft baseline');
await writeFile(join(projectPath, 'interleave.txt'), 'interleave baseline');
const resources = resolve(dirname(executable), '../Resources');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const disk = async path => { const metadata = await stat(path, { bigint: true }), bytes = await readFile(path); return { text: bytes.toString(), hash: sha(bytes), inode: String(metadata.ino), device: String(metadata.dev) }; };
const result = { startedAt: new Date().toISOString(), platform: process.platform, arch: arch(), osRelease: release(), app: resolve(executable), asarSha256: sha(await readFile(join(resources, 'app.asar'))), brokerSha256: sha(await readFile(join(resources, 'native/willyou-files'))), scratch, input: 'CDP Input.dispatchMouseEvent / Input.dispatchKeyEvent / Input.insertText in actual packaged renderer; fixture seeding and explicit watcher-stop fault use public IPC', checks: [], status: 'running' };
let app;
try {
  app = await openElectron({ executable, userData: join(scratch, 'userdata') });
  const { cdp, evaluate, invoke, waitFor } = app;
  const click = async (selector, text) => {
    // Native refresh can briefly replace virtual rows. Wait for the actual
    // target before dispatching input; never replay an already dispatched click.
    let point; const deadline = Date.now() + 10_000;
    while (!point) {
      point = await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text === undefined ? 'true' : `e.textContent.trim()===${JSON.stringify(text)}`});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
      if (!point) { assert(Date.now() < deadline, `Missing UI target: ${selector}`); await pause(80); }
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const refresh = async () => { await click('[aria-label="文件菜单"]'); await click('[role="menuitem"]', '刷新文件和目录'); };
  const key = async (key, code, modifiers = 0) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers }); };
  const tree = path => `[role="treeitem"][title=${JSON.stringify(join(projectPath, path))}]`;
  const exists = selector => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  const textIncludes = value => `document.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(value)})`;
  const writeCli = (path, text) => execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1],process.argv[2])", path, text], { env: { PATH: '/usr/bin:/bin' }, timeout: 5000 });
  const project = await invoke('projects.create', { name: 'M9 external sync acceptance', aliases: [], description: 'Isolated packaged UI fixture', rulesPath: null }, [{ label: 'Temporary test files', path: projectPath }]);
  result.projectId = project.id;
  await cdp('Page.reload'); await waitFor(exists(`[data-project-id="${project.id}"]`));
  await evaluate(`window.__externalWatch=[];window.electronAPI.eventOn('files:watch',update=>window.__externalWatch.push(update));true`);
  await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);
  await click('[data-testid=sidebar-project-edit]'); await waitFor(exists('[data-testid=project-files]'));
  await click('[data-testid=project-files]'); await waitFor(exists(tree('draft.txt')));
  for (const [index, scenario] of scenarios.entries()) {
    const directory = join(projectPath, `case-${index}`); await click(tree(`case-${index}`)); await waitFor(exists(tree(`case-${index}/b.txt`)));
    await click(tree(`case-${index}/b.txt`)); await waitFor(textIncludes('original b'));
    const before = await disk(join(directory, 'b.txt'));
    if (scenario.trigger === 'resume') { await click('[aria-label="隐藏文件区域"]'); await waitFor('!document.querySelector("[data-testid=file-workspace]")'); }
    if (scenario.trigger === 'refresh') {
      const ids = await evaluate('[...new Set(window.__externalWatch.map(update=>update.id))]'); assert(ids.length > 0);
      for (const id of ids) await invoke('files.stopWatch', id);
    }
    if (scenario.writer === 'CLI') execFileSync(process.execPath, ['-e', "const f=require('node:fs'),p=require('node:path'),d=process.argv[1];f.writeFileSync(p.join(d,'new.txt'),'new external');f.unlinkSync(p.join(d,'a.txt'));f.renameSync(p.join(d,'b.txt'),p.join(d,'c.txt'));", directory], { env: { PATH: '/usr/bin:/bin' }, timeout: 5000 });
    else { await writeFile(join(directory, 'new.txt'), 'new external'); await unlink(join(directory, 'a.txt')); await rename(join(directory, 'b.txt'), join(directory, 'c.txt')); }
    if (scenario.trigger === 'refresh') await refresh();
    if (scenario.trigger === 'resume') await click('[data-testid=project-files]');
    await waitFor(`${exists(tree(`case-${index}/new.txt`))} && ${exists(tree(`case-${index}/c.txt`))} && !${exists(tree(`case-${index}/a.txt`))} && !${exists(tree(`case-${index}/b.txt`))}`);
    await waitFor(`document.querySelector('.fw-save-strip')?.textContent.includes('MISSING')`);
    assert.deepEqual(await disk(join(directory, 'c.txt')), before);
    await app.screenshot(join(scratch, `b08-${index}-${scenario.trigger}.png`));
    await click(tree(`case-${index}/c.txt`)); await waitFor(textIncludes('original b'));
    result.checks.push({ caseId: 'M9-T-B08', ...scenario, treeCreateDeleteRename: true, originalTabMissing: true, newRouteOpened: true, before, after: await disk(join(directory, 'c.txt')) });
    // Remount restores the real watcher after the explicit-stop fixture.
    if (scenario.trigger === 'refresh') { await click('[aria-label="隐藏文件区域"]'); await waitFor('!document.querySelector("[data-testid=file-workspace]")'); await click('[data-testid=project-files]'); await waitFor(exists(tree(`case-${index}`))); }
    await click(tree(`case-${index}`));
  }
  await click(tree('draft.txt')); await waitFor(textIncludes('draft baseline'));
  const draftPath = join(projectPath, 'draft.txt'), original = await disk(draftPath), held = openSync(draftPath, 'r');
  try {
    await click('.cm-content'); await key('a', 'KeyA', 4); await cdp('Input.insertText', { text: 'manual unsaved draft' });
    await waitFor(textIncludes('manual unsaved draft')); await pause(650); await unlink(draftPath);
    await refresh(); await waitFor(`document.querySelector('.fw-save-strip')?.textContent.includes('MISSING')`);
    writeCli(draftPath, original.text); const replacement = await disk(draftPath); assert.notEqual(replacement.inode, original.inode);
    await refresh(); await click('.cm-content'); await key('s', 'KeyS', 4);
    await waitFor(`document.querySelector('.fw-save-strip')?.textContent.includes('另一文件')`);
    await pause(3200); assert.deepEqual(await disk(draftPath), replacement); assert(await evaluate(textIncludes('manual unsaved draft'))); assert(await evaluate(exists('.fw-tab.selected .fw-dirty')));
    await app.screenshot(join(scratch, 'dev058-missing-replacement-protected.png'));
    result.checks.push({ caseId: 'M9-T-B08', defect: 'M9-DEV-058', scenario: 'dirty deleted file and unrelated same-name/same-bytes replacement', original, replacement, after: await disk(draftPath), draftRetainedInEditor: true, explicitAndAutomaticSaveBlocked: true });
  } finally { closeSync(held); }
  await click(tree('interleave.txt')); await waitFor(textIncludes('interleave baseline'));
  await click('.cm-content'); await key('a', 'KeyA', 4); await cdp('Input.insertText', { text: 'locally saved' }); await key('s', 'KeyS', 4);
  await waitFor(`document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'`);
  const savedAt = Date.now(), interleave = join(projectPath, 'interleave.txt'), saved = await disk(interleave); assert.equal(saved.text, 'locally saved');
  writeCli(interleave, 'external immediately after local save'); const deltaMs = Date.now() - savedAt, external = await disk(interleave); assert(deltaMs < 5000);
  await waitFor(textIncludes(external.text)); assert(!await evaluate(exists('.fw-tab.selected .fw-dirty'))); assert(!await evaluate(exists('.fw-conflict-strip'))); assert.deepEqual(await disk(interleave), external);
  await app.screenshot(join(scratch, 'l06-external-after-save.png'));
  result.checks.push({ caseId: 'M9-T-L06', saved, external, deltaMs, final: await disk(interleave), cleanExternalVisibleWithoutApproval: true });
  assert.deepEqual(app.rendererErrors, []); result.watchUpdates = await evaluate('window.__externalWatch'); result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = String(error); process.exitCode = 1;
  if (app) { try { await app.screenshot(join(scratch, 'failure.png')); result.failureDom = await app.evaluate('document.body.innerText'); } catch { /* Keep original failure. */ } }
} finally {
  if (app) { await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); }
  result.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, error: result.error, artifacts: scratch }));
}
