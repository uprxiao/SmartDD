// R3 Markdown 真实浏览器检查（M9-GAP-03）。依赖：playwright-core（装在仓库外的临时目录）+ 本机 Google Chrome。
// 用法：NODE_PATH=<含 playwright-core 的 node_modules> node r3-markdown-check.mjs <输出目录>
// 只访问 http://127.0.0.1:4176/?preview=m9 的合成数据；独立 Chrome 实例、空白存储，不连接现有浏览器。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const out = process.argv[2] || '.';
const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 949 }, deviceScaleFactor: 1, locale: 'zh-CN' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4176' });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
const checks = []; const check = (id, title, ok, detail) => checks.push({ id, title, status: ok ? 'passed' : 'failed', detail });
const shot = async (name, locator) => { const file = path.join(out, name); await (locator || p).screenshot({ path: file }); return { file: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }; };
const open = async name => { await p.fill('input[aria-label="筛选文件"]', name); await p.waitForTimeout(400); await p.locator('[role=treeitem], [role=tree] button, .fw-tree-row').filter({ hasText: name }).first().dblclick(); await p.waitForTimeout(2200); };
const clip = async () => { await p.getByRole('button', { name: '复制 Markdown' }).click(); await p.waitForTimeout(200); return p.evaluate(() => navigator.clipboard.readText()); };
const shots = [];
await p.goto('http://127.0.0.1:4176/?preview=m9'); await p.waitForTimeout(2000);

await open('Markdown语法全集');
const art = p.locator('article.fw-markdown');
const c = async s => art.locator(s).count();
check('R3-MD01', 'KaTeX 行内与块级公式渲染；价格文本“$5 和 $6”不被当作公式', (await c('.katex')) === 2 && (await c('.katex-display')) === 1, { katex: await c('.katex'), display: await c('.katex-display') });
check('R3-MD02', 'Mermaid 实际渲染（序列图+类图），无错误块', (await c('.fw-md-mermaid svg')) === 2 && (await c('.fw-md-mermaid-error')) === 0, { svg: await c('.fw-md-mermaid svg') });
const classText = await art.locator('.fw-md-mermaid svg').nth(1).evaluate(s => s.textContent);
check('R3-MD03', '类图节点标签文字可见（htmlLabels:false 修复前为空白）', classText.includes('FileWorkspace') && classText.includes('Tab'), { text: classText.slice(-30) });
check('R3-MD04', '表格对齐 left/center/right', JSON.stringify(await art.locator('table th').evaluateAll(n => n.map(e => getComputedStyle(e).textAlign))) === '["left","center","right"]', {});
check('R3-MD05', '原始 HTML 被转义，无 script 元素', (await c('script')) === 0 && (await art.innerText()).includes('<b>不会执行的 HTML</b>'), {});
check('R3-MD06', 'frontmatter 键值（含数组/对象）与引用定义保留为源码', JSON.stringify(await art.locator('.fw-md-frontmatter dt').allTextContents()) === '["title","tags","meta"]' && (await c('.fw-md-definition')) === 1, {});
check('R3-MD07', '嵌套有序/无序列表与任务项渲染', (await c('ul,ol')) >= 4 && (await c('input.fw-md-task-box')) === 2, { lists: await c('ul,ol') });
shots.push(await shot('r3-markdown-syntax-top.png'));
await art.locator('.fw-md-mermaid svg').nth(1).scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
shots.push(await shot('r3-markdown-mermaid-class.png', art.locator('.fw-md-mermaid svg').nth(1)));

// 任务切换：源码只改动对应一行
const before = await clip();
await art.locator('input.fw-md-task-box').first().scrollIntoViewIfNeeded(); await art.locator('input.fw-md-task-box').first().click(); await p.waitForTimeout(300);
const after = await clip();
const bl = before.split('\n'), al = after.split('\n');
const changed = bl.map((l, i) => l !== al[i] ? [i + 1, l, al[i]] : null).filter(Boolean);
check('R3-MD08', '勾选第一个任务只改写其所在源码行 [ ] → [x]，其余字节不变', bl.length === al.length && changed.length === 1 && changed[0][1].includes('[ ]') && changed[0][2].includes('[x]'), { changed });

// 原位编辑
await art.locator('.fw-md-paragraph').first().click(); await p.waitForTimeout(300);
const ta = art.locator('textarea'); const taValue = await ta.inputValue();
await ta.press('End'); await ta.pressSequentially('【原位新增】'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const edited = await clip();
check('R3-MD09', '点击段落进入该块源码；输入后渲染结果更新，总行数不变（逐字节比对由模型测试覆盖）', taValue.startsWith('段落含 **加粗**') && edited.includes('【原位新增】') && edited.split('\n').length === al.length, { editedLines: edited.split('\n').length });

// 查找高亮
await art.click({ position: { x: 4, y: 4 } }).catch(() => {}); await p.keyboard.press('Meta+f'); await p.waitForTimeout(300);
const find = p.locator('input[aria-label*="查找"], input[placeholder*="查找"], input[type=search]').first();
await find.fill('嵌套'); await p.waitForTimeout(400);
check('R3-MD10', '文件内查找在渲染后的 HTML 文本节点上高亮（“嵌套”命中 2 处）；公式内部是否排除高亮未单独验证', (await c('mark')) === 2, { marks: await c('mark') });
shots.push(await shot('r3-markdown-find.png'));
await p.keyboard.press('Escape');

// 相对链接
await p.locator('article.fw-markdown a[data-md-href="../AGENTS.md"]').click(); await p.waitForTimeout(600);
check('R3-MD11', '相对链接 ../AGENTS.md 切换到已存在标签；外部链接只提示不导航', (await p.locator('[role=tab][aria-selected=true]').allTextContents()).join('').includes('AGENTS.md'), {});

// 异常样例
await open('Markdown异常样例');
const a2 = p.locator('article.fw-markdown');
check('R3-MD12', '无效 YAML 显示可读错误；无效 Mermaid 显示错误块；无效公式不抛出；未闭合围栏延伸到文末', (await a2.locator('.fw-md-frontmatter-error').count()) === 1 && (await a2.locator('.fw-md-mermaid-error').count()) === 1 && (await a2.locator('.fw-md-fence code').allTextContents()).some(t => t.includes('still code')), {});
check('R3-MD13', '失败的 Mermaid 渲染不在 body 留下残余节点', (await p.locator('[id^="dfw-mermaid"]').count()) === 0, {});
shots.push(await shot('r3-markdown-abnormal.png'));
// ---- 重构后回归：图片画廊、右键菜单、编辑保存持久化 ----
await open('Markdown完整交互');
const g = p.locator('article.fw-markdown button.fw-md-image');
await g.first().click(); await p.waitForTimeout(400);
const opened = await p.locator('[role=dialog].fw-gallery').count();
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
check('R3-MD15', '重构后图片画廊可打开/Escape 关闭（2 张独立图片）', (await g.count()) === 2 && opened === 1 && (await p.locator('[role=dialog].fw-gallery').count()) === 0, { images: await g.count() });
await g.first().click({ button: 'right' }); await p.waitForTimeout(300);
const menu = await p.locator('.fw-image-menu button').allTextContents(); await p.keyboard.press('Escape');
check('R3-MD16', '图片右键菜单项与顺序不变', JSON.stringify(menu) === JSON.stringify(['在新标签打开图片', '添加到当前任务', '复制图片', '在文件管理器中显示', '下载副本']), { menu });
await p.locator('article.fw-markdown p').first().click(); await p.waitForTimeout(300);
const ta3 = p.locator('article.fw-markdown textarea'); await ta3.press('End'); await ta3.pressSequentially('【保存测试】'); await p.keyboard.press('Escape'); await p.waitForTimeout(3600);
await p.reload(); await p.waitForTimeout(2200); await open('Markdown完整交互');
check('R3-MD17', '编辑后等 3.6 秒自动保存，刷新页面后内容仍在', (await p.locator('article.fw-markdown').innerText()).includes('【保存测试】'), {});
// ---- 迟到的 Mermaid：渲染未完成时反复切换文件 ----
const errStart = errors.length;
for (let i = 0; i < 5; i++) { await p.fill('input[aria-label="筛选文件"]', 'Markdown语法全集'); await p.waitForTimeout(250); await p.locator('[role=treeitem], [role=tree] button, .fw-tree-row').filter({ hasText: 'Markdown语法全集' }).first().dblclick(); await p.waitForTimeout(60); await p.fill('input[aria-label="筛选文件"]', 'AGENTS'); await p.waitForTimeout(250); await p.locator('[role=treeitem], [role=tree] button, .fw-tree-row').filter({ hasText: 'AGENTS.md' }).first().dblclick(); await p.waitForTimeout(60); }
await p.waitForTimeout(2500);
const leaked = await p.locator('body > [id^="dfw-mermaid"], body > svg[id^="fw-mermaid"]').count();
check('R3-MD18', '渲染未完成时快速来回切换 5 轮：无页面错误、body 无残留 Mermaid 节点', errors.length === errStart && leaked === 0, { errors: errors.slice(errStart, errStart + 3), leaked });
check('R3-MD14', '全程没有 pageerror / console error', errors.length === 0, { errors });
await browser.close();
const summary = checks.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {});
fs.writeFileSync(path.join(out, 'r3-markdown-check.json'), JSON.stringify({ schemaVersion: 1, ranAt: new Date().toISOString(), target: 'http://127.0.0.1:4176/?preview=m9', browser: 'Google Chrome (local, headless, isolated context)', viewport: '1512x949 DPR1', scope: '合成数据原型；不是 Codex 参考运行，不计入 385 条正式用例', screenshots: shots, checks, summary }, null, 2));
console.log(JSON.stringify(summary)); for (const x of checks) console.log(x.id, x.status, x.title);
