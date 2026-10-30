// Shared scaffold for the M9 N-series packaged-App drivers (A layer). Each driver supplies only its steps.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {openTaskFileFixture} from '../lib/task-file-fixture.mjs';

const sha = (x) => createHash('sha256').update(x).digest('hex');

export async function runNCase({caseId, tag, files, terminal = false, run}) {
  const executable = process.env.WILLYOU_FILES_APP;
  assert(executable, 'WILLYOU_FILES_APP is required');
  const scratch = await mkdtemp('/private/tmp/willyou-' + tag + '-A-'), root = join(scratch, 'project');
  await mkdir(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), {recursive: true}); await writeFile(join(root, path), content); }
  const fingerprints = async () => Object.fromEntries(await Promise.all(Object.keys(files).map(async (path) => {
    const s = await stat(join(root, path), {bigint: true});
    return [path, {sha256: sha(await readFile(join(root, path))), inode: String(s.ino), mtimeNs: String(s.mtimeNs)}];
  })));
  const r = {at: new Date().toISOString(), caseId, layer: 'A', scratch, root, executable,
    asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), before: await fingerprints(), checks: [], status: 'running'};
  let app, fixture, stage = 'setup';
  const setStage = (s) => { stage = s; };
  try {
    if (terminal) { fixture = await openTaskFileFixture({executable, scratch, root, name: caseId}); app = fixture.app; }
    else app = await openFileAcceptanceApp({executable, projectPath: root, userData: join(scratch, 'userdata'), name: caseId, inspectMain: true});
    r.runtime = await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return{packaged:e.app.isPackaged,userData:e.app.getPath('userData')}})()");
    assert(r.runtime.packaged);
    const theme = (name) => app.cdp('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: name}]});
    await run({app, fixture, r, root, scratch, setStage, theme, fingerprints});
    r.after = await fingerprints();
    assert.deepEqual(r.after, r.before, 'Source files changed');
    assert.deepEqual(app.rendererErrors, [], 'Renderer errors');
    await writeFile(join(scratch, 'electron.log'), app.logs());
    if (fixture) for (const task of Object.values(fixture.tasks)) { try { await app.invoke('tasks.kill', task.task.id); } catch {} }
    await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");
    r.exit = await app.waitForExit(20000);
    assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null);
    await app.close(); app = null; r.status = 'passed';
  } catch (error) {
    r.status = 'failed'; r.failedStage = stage; r.error = String(error); r.stack = error.stack; process.exitCode = 1;
    if (app) try { r.dom = await app.evaluate('document.body.innerText.slice(0,6000)'); await app.screenshot(join(scratch, 'failure.png')); } catch {}
  } finally {
    if (app) { await writeFile(join(scratch, 'failure-electron.log'), app.logs()); await app.close(); }
    r.finishedAt = new Date().toISOString();
    await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n');
    console.log(JSON.stringify({status: r.status, checks: r.checks.length, failedStage: r.failedStage, error: r.error, artifacts: scratch}));
  }
}

// Trusted pointer helpers shared by the drivers.
export const point = (app, selector, index = 0) => app.evaluate(`(async()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})][${index}];if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}})()`);
export async function mouse(app, p, button = 'left') {
  const buttons = button === 'right' ? 2 : 1;
  await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y});
  await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button, buttons, clickCount: 1});
  await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1});
}
