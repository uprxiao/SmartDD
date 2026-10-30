// Packaged-app development checks. Fixtures are seeded through the public IPC;
// file interactions below use real pointer/keyboard events in Electron.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const executable = process.env.WILLYOU_FILES_APP;
const withSearch = process.env.WILLYOU_FILES_SEARCH === '1';
assert(executable, 'Set WILLYOU_FILES_APP to the packaged Contents/MacOS/WillYou executable');
const scratch = await mkdtemp(join(tmpdir(), 'willyou-m9-ui-'));
const projectPath = join(scratch, 'project');
await mkdir(join(projectPath, 'src'), { recursive: true });
await writeFile(join(projectPath, 'hello.txt'), '\ufeff第一行\r\nsecond line\n第三行\r');
await writeFile(join(projectPath, '.hidden'), 'hidden visible');
await writeFile(join(projectPath, 'src', 'example.ts'), 'export const greeting = "你好";\n');
await writeFile(join(projectPath, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="teal"/></svg>');
const server = createServer();
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
await new Promise((done) => server.close(done));
const env = { ...process.env, SMARTDD_USER_DATA: join(scratch, 'userdata') };
for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_)/.test(key)) delete env[key];
const app = spawn(resolve(executable), ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', ws, cdp, evaluate;
app.stdout.on('data', (bytes) => { log += bytes; }); app.stderr.on('data', (bytes) => { log += bytes; });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const checks = [], errors = []; let realProject;
try {
  let page;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === 'page'); if (page) break; } catch { /* startup */ }
    if (app.exitCode !== null) throw new Error(`Application exited: ${app.exitCode}`);
    await pause(100);
  }
  assert(page, 'Packaged renderer did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const job = pending.get(message.id); pending.delete(message.id); if (job) message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  cdp = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
  await cdp('Runtime.enable');
  evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await pause(80); }
    throw new Error(`Timed out: ${expression}`);
  };
  const invoke = (channel, ...args) => evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`);
  const click = async (selector) => {
    const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing target'); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const key = async (key, code, modifiers = 0) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  };
  const screenshot = async (name) => { const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(scratch, `${name}.png`), Buffer.from(data, 'base64')); };
  const type = async (selector, value) => { await click(selector); await key('a', 'KeyA', 4); await cdp('Input.insertText', { text: value }); };
  await waitFor('Boolean(window.electronAPI && document.querySelector("[data-testid=nav-settings]"))');
  const project = await invoke('projects.create', { name: 'M9 packaged development', aliases: [], description: 'Isolated file workspace fixture', rulesPath: null }, [{ label: '本机测试目录', path: projectPath }]);
  await cdp('Page.reload');
  await waitFor(`Boolean(document.querySelector('[data-project-id="${project.id}"]'))`);
  await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);
  await click('[data-testid=sidebar-project-edit]');
  await waitFor('Boolean(document.querySelector("[data-testid=project-files]"))');
  await click('[data-testid=project-files]');
  await waitFor(`Boolean(document.querySelector('[role=treeitem][title$="/hello.txt"]'))`);
  assert(await evaluate(`Boolean(document.querySelector('[role=treeitem][title$="/.hidden"]'))`));
  checks.push('Project root and hidden entry read from disk');
  await click('[role=treeitem][title$="/hello.txt"]');
  await waitFor('document.querySelector(".cm-content")?.textContent.includes("第一行")');
  assert(await evaluate('Boolean(document.querySelector(".fw-tab.preview"))'));
  await click('.cm-content');
  await key('ArrowDown', 'ArrowDown', 4);
  await cdp('Input.insertText', { text: '编辑追加' });
  await waitFor('Boolean(document.querySelector(".fw-dirty"))');
  await key('s', 'KeyS', 4);
  await waitFor('document.querySelector(".fw-footer")?.textContent.includes("已保存")');
  const saved = await readFile(join(projectPath, 'hello.txt'), 'utf8');
  assert(saved.startsWith('\ufeff')); assert(saved.includes('编辑追加'));
  assert.equal((saved.match(/\r\n/g) ?? []).length, 1); assert.equal((saved.match(/\r(?!\n)/g) ?? []).length, 1);
  assert(await evaluate('!document.querySelector(".fw-tab.preview")'));
  checks.push('Real editor input pins preview; explicit save preserves BOM and untouched mixed EOL');
  if (withSearch) {
    await type('[aria-label="筛选文件"]', 'example');
    await waitFor(`Boolean(document.querySelector('.fw-name-result[title$="/src/example.ts"]'))`);
    await click('.fw-name-result[title$="/src/example.ts"]');
    await waitFor('document.querySelector(".cm-content")?.textContent.includes("greeting")');
    await click('[aria-label="清除文件筛选"]');
    await click('[aria-label="在文件中搜索"]');
    await type('[aria-label="搜索文件掩码"]', '*.ts');
    await type('[aria-label="全文搜索内容"]', 'greeting');
    await waitFor(`document.querySelector('[data-search-row="0"]')?.textContent.includes('src/example.ts')`);
    await screenshot('search-results');
    await click('[data-search-row="0"]');
    await waitFor(`!document.querySelector('[aria-label="全文搜索内容"]')`);
    await click('[role=treeitem][title$="/hello.txt"]');
    await waitFor('document.querySelector(".cm-content")?.textContent.includes("编辑追加")');
    checks.push('Name search finds an unexpanded child; full-text mask and result open the actual source');
  }
  for (const theme of ['ylight', 'ydark']) { await invoke('appSettings.update', 'theme', theme); await waitFor(`document.documentElement.classList.contains('${theme}')`); await screenshot(`editor-${theme}`); }
  await writeFile(join(projectPath, 'hello.txt'), '来自外部程序\n');
  if (!withSearch) await click('[aria-label="刷新文件和目录"]');
  await waitFor('document.querySelector(".cm-content")?.textContent.includes("来自外部程序")');
  assert(await evaluate('!document.querySelector(".fw-conflict-strip")'));
  checks.push('Clean external edit reloads without approval');
  if (withSearch) {
    await writeFile(join(projectPath, 'watch-created.txt'), 'created outside app');
    await waitFor(`Boolean(document.querySelector('[role=treeitem][title$="/watch-created.txt"]'))`);
    await unlink(join(projectPath, 'watch-created.txt'));
    await waitFor(`!document.querySelector('[role=treeitem][title$="/watch-created.txt"]')`);
    checks.push('Live native watch updates clean content and directory create/delete without refresh');
  }
  await click('[role=treeitem][title$="/image.svg"]');
  await waitFor('Boolean(document.querySelector(".fw-ordinary-image img")?.naturalWidth)');
  await screenshot('image'); checks.push('SVG loaded through bounded native chunk reads and img decoding');
  await click('[aria-label="隐藏文件区域"]');
  await waitFor('!document.querySelector("[data-testid=file-workspace]")');
  await click('[data-testid=project-files]');
  await waitFor('Boolean(document.querySelector(".fw-ordinary-image img")?.naturalWidth)');
  checks.push('Hide/show preserves open buffer and active route');
  if (process.env.WILLYOU_FILES_REAL_ROOT) {
    const realRoot = resolve(process.env.WILLYOU_FILES_REAL_ROOT), sample = join(realRoot, 'pom.xml');
    const before = createHash('sha256').update(await readFile(sample)).digest('hex');
    realProject = await invoke('projects.create', { name: 'AIS 文件工作区验收', aliases: [], description: '用户指定的 M9 真实目录验证项目', rulesPath: null }, [{ label: 'AIS 本机目录', path: realRoot }]);
    await cdp('Page.reload');
    await waitFor(`Boolean(document.querySelector('[data-project-id="${realProject.id}"]'))`);
    await click(`[data-project-id="${realProject.id}"] [data-testid=sidebar-project-more]`);
    await click('[data-testid=sidebar-project-edit]');
    await waitFor('Boolean(document.querySelector("[data-testid=project-files]"))');
    if (!await evaluate('Boolean(document.querySelector("[data-testid=file-workspace]"))')) await click('[data-testid=project-files]');
    // Scroll using actual input so an off-screen virtualized row can mount.
    for (let index = 0; index < 40 && !await evaluate(`Boolean(document.querySelector('[role=treeitem][title$="/pom.xml"]'))`); index++) {
      const point = await evaluate(`(() => { const r = document.querySelector('[role=tree]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', deltaY: 300, deltaX: 0, ...point }); await pause(80);
    }
    await waitFor(`Boolean(document.querySelector('[role=treeitem][title$="/pom.xml"]'))`);
    await screenshot('ais-real-directory');
    if (withSearch) {
      await type('[aria-label="筛选文件"]', 'pom');
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(`.fw-name-result[title="${realRoot}/pom.xml"]`)}))`, 20000);
      await screenshot('ais-name-search');
      await click('[aria-label="清除文件筛选"]');
      await click('[aria-label="在文件中搜索"]');
      await type('[aria-label="搜索文件掩码"]', 'pom.xml');
      await type('[aria-label="全文搜索内容"]', '<modelVersion>');
      await waitFor('Boolean(document.querySelector("[data-search-row]"))', 20000);
      await screenshot('ais-content-search');
      await click('[aria-label="关闭全文搜索"]');
      checks.push('User AIS directory: real filename and scoped full-text searches return source matches');
    }
    await click('[role=treeitem][title$="/pom.xml"]');
    await waitFor('Boolean(document.querySelector(".cm-content")?.textContent.length)');
    const detail = await invoke('projects.get', realProject.id);
    assert(detail.dirs.some((directory) => directory.path === realRoot && directory.isDefault));
    assert.equal(createHash('sha256').update(await readFile(sample)).digest('hex'), before);
    realProject = { id: realProject.id, path: realRoot, userData: join(scratch, 'userdata'), sample: 'pom.xml', sampleHashUnchanged: before };
    checks.push('User-provided AIS project registered as default root; real tree and pom.xml opened without modification');
  }
  assert.deepEqual(errors, []);
  const appRoot = resolve(dirname(executable), '..', 'Resources');
  const hash = createHash('sha256').update(await readFile(join(appRoot, 'app.asar'))).digest('hex');
  const result = { ok: true, scope: 'development smoke, not formal M9 acceptance', checks, realProject, appAsarSha256: hash, artifacts: scratch, platform: process.platform, arch: process.arch, timestamp: new Date().toISOString() };
  await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (cdp) { try { const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(scratch, 'failure.png'), Buffer.from(data, 'base64')); } catch { /* preserve original */ } }
  await writeFile(join(scratch, 'failure.json'), JSON.stringify({ error: String(error), checks, errors }, null, 2));
  console.error(error); console.error(`Artifacts: ${scratch}`); process.exitCode = 1;
} finally {
  ws?.close(); app.kill('SIGTERM'); await writeFile(join(scratch, 'electron.log'), log);
}
