import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installLspObserver, observeLsp, restoreLspObserver } from '../lib/lsp-observer.mjs';
const executable = process.env.WILLYOU_FILES_APP, command = '/opt/anaconda3/bin/pylsp'; assert(executable);
const scratch = await mkdtemp('/private/tmp/willyou-python-language-A-'), root = join(scratch, 'project'); await mkdir(root);
const source = 'def compute(value: int) -> int:\r\n    return value + 1\r\nlabel = "中文🙂"; result = compute(4)\r\n', normalized = source.replaceAll('\r\n', '\n'), file = join(root, 'python_language.py'); await writeFile(file, source);
const sha = b => createHash('sha256').update(b).digest('hex'), fp = async () => { const s = await stat(file, { bigint: true }); return { sha256: sha(await readFile(file)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
const r = { caseId: 'M9-T-Y29', layer: 'A', status: 'running', at: new Date().toISOString(), scratch, root, sourceHash: sha(source), before: await fp(), server: { command, version: execFileSync(command, ['--version'], { encoding: 'utf8' }).trim(), sha256: sha(await readFile(command)) }, asarSha256: sha(await readFile(resolve(executable, '../../Resources/app.asar'))), checks: [], boundary: 'Partial Y29 Python matrix only. Existing local pylsp, no installation/download. Original packaged UI/settings/native files and real stdio server. Actual pointer/keyboard configuration/navigation, passive original RPC/spawn observer. No fabricated protocol server, Store/editor changes, clipboard/model/daily configuration or claim of TypeScript support.' };
let app, observed = false, stage = 'setup'; const view = "document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view";
const ev = (f, ...args) => app.evaluate(`(${f.toString()})(...${JSON.stringify(args)})`);
const poll = async (fn, label, ms = 15000) => { const end = Date.now() + ms; for (;;) { const x = await fn(); if (x) return x; assert(Date.now() < end, 'Timed out: ' + label); await new Promise(done => setTimeout(done, 30)); } };
async function input(selector, text) { await app.click(selector); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] }); await app.cdp('Input.insertText', { text }); await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`); }
async function caret(offset) { await app.click('.fw-editor-host .cm-content'); await app.key('ArrowUp', 'ArrowUp', 4); await app.waitFor(`${view}.state.selection.main.head===0`); for (const _ of [...normalized.slice(0, offset)]) await app.key('ArrowRight', 'ArrowRight'); await app.waitFor(`${view}.state.selection.main.head===${offset}`); }
async function query(kind) { await app.click('[aria-label="代码语义导航"]'); await app.click('[role=menuitem]', { definition: '转到定义', references: '查找引用' }[kind]); }
async function queryResult(kind, at) { return poll(async () => { const s = await observeLsp(app); return s.rows.findLast(x => x.method === 'languageQuery' && x.at >= at && x.args[0].kind === kind && (x.delivered || x.error)); }, kind); }
try {
  app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name: 'Y29 existing Python server A', inspectMain: true }); await installLspObserver(app, { commands: [command] }); observed = true;
  await app.open('python_language.py'); await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(normalized)}`);
  const p = await ev(() => { const b = document.querySelector('.fw-tab [aria-selected=true]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }); for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 2 });
  stage = 'configure-existing-pylsp'; await app.click('[aria-label="文件菜单"]'); await app.click('[role=menuitem]', '语言服务设置…');
  await app.waitFor("[...document.querySelectorAll('.fw-language-detected button')].some(e=>e.textContent==='手动登记服务'&&!e.disabled)"); await app.click('.fw-language-detected button', '手动登记服务'); await app.waitFor("document.querySelectorAll('.fw-language-settings fieldset').length===1");
  await input('[aria-label="语言服务名称"]', 'Existing Python pylsp'); await input('[aria-label="语言服务可执行文件"]', command); await input('[aria-label="语言服务语言"]', 'python');
  await app.click('[role=dialog] button', '保存配置'); await app.waitFor("!document.querySelector('[role=dialog] .fw-language-settings')");
  const ready = await poll(() => ev(() => document.querySelector('[aria-label="代码语义导航"]')?.title.includes('pylsp') && document.querySelector('[aria-label="代码语义导航"]')?.title), 'pylsp actual initialization', 16000);
  await app.click('[aria-label="代码语义导航"]'); await app.waitFor("Boolean(document.querySelector('.fw-language-menu-status'))"); const capabilities = await ev(() => [...document.querySelectorAll('[role=menuitem]')].filter(e => /转到|查找引用/.test(e.textContent)).map(e => ({ text: e.textContent, disabled: e.getAttribute('aria-disabled') === 'true' })));
  assert.equal(capabilities.find(x => x.text === '转到定义').disabled, false); assert.equal(capabilities.find(x => x.text === '查找引用').disabled, false); assert.equal(capabilities.find(x => x.text === '转到实现').disabled, true); await app.key('Escape', 'Escape'); r.checks.push({ scenario: stage, ready, capabilities });
  const offset = normalized.lastIndexOf('compute');
  for (const kind of ['definition', 'references']) {
    stage = 'real-pylsp-' + kind; await caret(offset); const at = Date.now(); await query(kind); const row = await queryResult(kind, at); assert(!row.error, row.error); assert(row.output.locations.length > 0);
    assert.equal(row.args[0].position.line, 2); assert.equal(row.args[0].position.character, normalized.split('\n')[2].indexOf('compute'));
    if (kind === 'definition') await app.waitFor(`${view}.state.sliceDoc(${view}.state.selection.main.from,${view}.state.selection.main.to)==='compute'`);
    else { await app.waitFor("document.querySelector('.fw-language-results')?.textContent.includes('引用')"); await app.click('[aria-label="关闭符号结果"]'); }
    r.checks.push({ scenario: stage, originalQuery: row, utf16AfterEmoji: true }); await app.screenshot(join(scratch, kind + '.png'));
  }
  stage = 'real-pylsp-hover'; await app.click('[aria-label="隐藏目录树"]'); await app.waitFor("!document.querySelector('.fw-tree')"); await caret(offset); await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const hover = await app.evaluate(`(()=>{const b=${view}.coordsAtPos(${offset + 2}),x=b.left+1,y=(b.top+b.bottom)/2;if(!document.elementFromPoint(x,y)?.closest('.cm-content'))throw Error('Python hover is clipped');return{x,y}})()`); await app.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hover }); await app.waitFor("document.querySelector('.fw-language-hover')?.textContent.includes('compute')", 10000); r.checks.push({ scenario: stage, actualHover: await ev(() => document.querySelector('.fw-language-hover').textContent) }); await app.screenshot(join(scratch, 'hover.png'));
  stage = 'close-owned-language-process'; await app.click('[aria-label="隐藏文件区域"]'); r.trace = await poll(async () => { const s = await observeLsp(app); return s.processes.length && s.processes.every(x => x.exited) ? s : null; }, 'owned Python processes exit', 6000);
  assert(r.trace.processes.some(x => x.command === command)); for (const row of r.trace.rows) if (row.delivered) assert.equal(row.before, row.after);
  r.restored = await restoreLspObserver(app); observed = false; assert(Object.values(r.restored).every(Boolean)); r.after = await fp(); assert.deepEqual(r.after, r.before); assert.deepEqual(app.rendererErrors, []);
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()"); r.exit = await app.waitForExit(); assert.equal(r.exit.code, 0); assert.equal(r.exit.signal, null); r.status = 'passed-partial-Y29-Python';
} catch (error) { r.status = 'failed'; r.failedStage = stage; r.error = String(error); process.exitCode = 1; if (app) try { r.dom = await ev(() => document.body.innerText); await app.screenshot(join(scratch, 'failure.png')); } catch {} }
finally { if (app) { if (observed) try { r.trace = await observeLsp(app); r.cleanupRestore = await restoreLspObserver(app); } catch {} await writeFile(join(scratch, 'electron.log'), app.logs()); await app.close(); } r.finishedAt = new Date().toISOString(); await writeFile(join(scratch, 'result.json'), JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify({ status: r.status, checks: r.checks.length, scratch, failedStage: r.failedStage, error: r.error })); }
