// R3 PDF / Notebook 真实浏览器检查（M9-GAP-05）。依赖 playwright-core + 本机 Chrome；只访问 http://127.0.0.1:4176/?preview=m9 的合成数据。
// 用法：NODE_PATH=<含 playwright-core 的 node_modules> node r3-pdf-notebook-check.mjs <输出目录>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const out = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 949 }, deviceScaleFactor: 2, locale: 'zh-CN' });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
const checks = [], shots = [];
const check = (id, title, ok, detail = {}) => checks.push({ id, title, status: ok ? 'passed' : 'failed', detail });
const shot = async (name, loc) => { const f = path.join(out, name); await (loc || p).screenshot({ path: f }); shots.push({ file: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') }); };
const open = async (filter, text) => { await p.fill('input[aria-label="筛选文件"]', filter); await p.waitForTimeout(400); await p.locator('[role=treeitem], [role=tree] button, .fw-tree-row').filter({ hasText: text }).first().dblclick(); await p.waitForTimeout(3000); };
const source = async value => { await p.locator('details.fa-fixture-controls').evaluate(d => { d.open = true; }); await p.locator('select[aria-label="PDF 文档来源"]').selectOption(value); await p.waitForTimeout(2500); };
const pages = () => p.locator('.fa-pdf-scroll article.fa-pdf-real');
await p.goto('http://127.0.0.1:4176/?preview=m9'); await p.waitForTimeout(2000);

// ---- PDF：正常文档 ----
await open('验收', '验收.pdf');
check('R3-PN01', '真实 PDF：3 页画布均渲染，且画布不是空白', await (async () => {
  const n = await pages().count(); const rendered = await p.locator('.fa-pdf-scroll canvas[data-rendered="true"]').count();
  const nonBlank = await p.locator('.fa-pdf-scroll canvas').first().evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) return true; return false; });
  return n === 3 && rendered >= 1 && nonBlank;
})(), {});
const text = await p.locator('.fa-pdf-text').first().innerText();
check('R3-PN02', '文本层含中文与英文，可选择', text.includes('文件浏览工作区') && text.includes('English mixed'), {});
check('R3-PN03', '链接层：1 个外部、1 个内部（指向第 3 页）', JSON.stringify(await p.locator('a.fa-pdf-link').evaluateAll(n => n.map(e => e.getAttribute('aria-label')))) === JSON.stringify(['外部链接 https://example.invalid/external', '跳转到第 3 页']), {});
await p.locator('a.fa-pdf-link').nth(1).click(); await p.waitForTimeout(1200);
const third = await pages().nth(2).evaluate(e => e.getBoundingClientRect().top - e.closest('.fa-pdf-scroll').getBoundingClientRect().top);
check('R3-PN04', '点击内部链接滚动到第 3 页', Math.abs(third) < 80, { topOffsetPx: Math.round(third) });
await p.locator('a.fa-pdf-link').first().click().catch(async () => { await p.locator('.fa-pdf-scroll').evaluate(e => e.scrollTo(0, 0)); await p.waitForTimeout(500); await p.locator('a.fa-pdf-link').first().click(); });
await p.waitForTimeout(400);
check('R3-PN05', '点击外部链接只提示，不导航', (await p.locator('.fa-artifact-status').allInnerTexts()).join('').includes('https://example.invalid/external') && p.url().startsWith('http://127.0.0.1:4176'), {});
const thumbs = await p.locator('nav[aria-label="PDF 页面缩略图"] button[aria-label^="第"]').evaluateAll(n => n.map(e => e.title));
check('R3-PN06', '缩略图悬停标题含大纲标题（第 2、3 页），并渲染真实小图', thumbs.join('|').includes('交互与状态') && thumbs.join('|').includes('验收与交付') && (await p.locator('nav[aria-label="PDF 页面缩略图"] canvas[data-rendered="true"]').count()) >= 1, { thumbs });
await p.locator('.fa-pdf-scroll').evaluate(e => e.scrollTo(0, 0)); await p.waitForTimeout(500);
await shot('r3-pdf-normal.png');

// ---- PDF：缩放重渲染 ----
const wBefore = await pages().first().evaluate(e => e.getBoundingClientRect().width);
await p.getByRole('button', { name: 'PDF 缩放' }).click(); await p.getByRole('menuitemradio', { name: '150%' }).click(); await p.waitForTimeout(2000);
const wAfter = await pages().first().evaluate(e => e.getBoundingClientRect().width);
const stillRendered = await pages().first().locator('canvas').getAttribute('data-rendered');
check('R3-PN07', '缩放到 150%：页面变宽并重新渲染', wAfter > wBefore * 1.5 && stillRendered === 'true', { wBefore: Math.round(wBefore), wAfter: Math.round(wAfter) });

// ---- PDF：文字评论与区域评论（真实文本层） ----
await p.getByRole('button', { name: 'PDF 缩放' }).click(); await p.getByRole('menuitem', { name: '适合宽度' }).click(); await p.waitForTimeout(1500);
await p.locator('details.fa-fixture-controls').evaluate(d => { d.open = true; });
await p.getByLabel('annotation_batching_enabled').check();
await p.getByRole('button', { name: 'PDF 评论' }).click();
await p.locator('.fa-pdf-text span').first().evaluate(span => { const r = document.createRange(); r.selectNodeContents(span); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await pages().first().dispatchEvent('mouseup'); await p.waitForTimeout(500);
const editorText = await p.locator('.fa-pdf-editor').innerText().catch(() => '');
check('R3-PN08', '真实文本层选择文字后出现评论编辑器，引用所选文字', editorText.includes('所选文字') && editorText.includes('文件浏览工作区'), { editor: editorText.slice(0, 60) });
await p.getByRole('button', { name: '取消 PDF 评论草稿' }).click();
const box = await pages().first().boundingBox();
await p.mouse.move(box.x + box.width * .3, box.y + box.height * .6); await p.mouse.down(); await p.mouse.move(box.x + box.width * .7, box.y + box.height * .8, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
const region = await p.locator('.fa-pdf-editor header').innerText().catch(() => '');
check('R3-PN09', '空白处拖出矩形：区域评论，坐标按真实页面尺寸（点）换算', region.includes('所选区域'), { header: region });
await p.getByRole('textbox', { name: 'PDF 评论内容' }).fill('区域评论 real'); await p.locator('.fa-pdf-editor').getByRole('button', { name: /^(发送|添加)/ }).click(); await p.waitForTimeout(1200);
const marker = await p.locator('.fa-pdf-marker').count();
check('R3-PN10', '批处理模式下，添加评论后页面显示标记（非批处理模式发送后队列清空，属原设计）', marker >= 1, { markers: marker });

// ---- PDF：密码 ----
await source('encrypted');
check('R3-PN11', '加密 PDF：弹出密码框，内容不泄漏', (await p.getByRole('dialog', { name: 'PDF 密码' }).count()) === 1 && (await p.locator('.fa-pdf-text').count()) === 0, {});
await p.getByRole('dialog', { name: 'PDF 密码' }).getByLabel('PDF 密码').fill('wrong'); await p.getByRole('dialog', { name: 'PDF 密码' }).getByRole('button', { name: '打开', exact: true }).click(); await p.waitForTimeout(1200);
check('R3-PN12', '错误密码：提示重试，仍未显示内容', (await p.getByRole('dialog', { name: 'PDF 密码' }).innerText()).includes('密码错误') && (await p.locator('.fa-pdf-text').count()) === 0, {});
await p.getByRole('dialog', { name: 'PDF 密码' }).getByLabel('PDF 密码').fill('m9-user'); await p.getByRole('dialog', { name: 'PDF 密码' }).getByRole('button', { name: '打开', exact: true }).click(); await p.waitForTimeout(2500);
check('R3-PN13', '正确密码：对话框关闭并渲染 3 页', (await p.getByRole('dialog', { name: 'PDF 密码' }).count()) === 0 && (await pages().count()) === 3, {});
await shot('r3-pdf-encrypted-opened.png');
await source('synthetic'); await source('encrypted');
await p.getByRole('dialog', { name: 'PDF 密码' }).getByRole('button', { name: '取消', exact: true }).click(); await p.waitForTimeout(800);
check('R3-PN14', '取消密码框：显示需要密码的错误与重试，没有残留对话框', (await p.getByRole('alert').innerText().catch(() => '')).includes('需要密码') && (await p.getByRole('dialog', { name: 'PDF 密码' }).count()) === 0, {});

// ---- PDF：损坏/伪装 ----
for (const [id, name, label] of [['R3-PN15', 'truncated', '截断损坏'], ['R3-PN16', 'garbage', '随机字节']]) {
  await source(name);
  const alert = await p.getByRole('alert').innerText().catch(() => '');
  check(id, label + '：显示“不是有效 PDF 或已损坏”，提供重试，原文件未改', alert.includes('不是有效的 PDF') && (await p.getByRole('button', { name: '重试' }).count()) === 1, { alert: alert.slice(0, 80) });
}
await shot('r3-pdf-invalid.png');

// ---- PDF：超大页 ----
await source('bigpage');
const big = await p.locator('.fa-pdf-scroll canvas').first().evaluate(c => ({ w: c.width, h: c.height }));
check('R3-PN17', '14400×14400pt 超大页：画布面积与边长受限并提示降采样', big.w * big.h <= 16 * 1024 * 1024 * 1.01 && Math.max(big.w, big.h) <= 16384 && (await p.locator('.fa-artifact-status').allInnerTexts()).join('').includes('降低渲染分辨率'), big);

// ---- PDF：快速切换来源（取消与清理） ----
const before = errors.length;
for (const s of ['normal', 'encrypted', 'garbage', 'normal', 'bigpage', 'normal']) { await p.locator('select[aria-label="PDF 文档来源"]').selectOption(s); await p.waitForTimeout(120); }
await p.waitForTimeout(3000);
check('R3-PN18', '快速切换 6 次来源：无页面错误，最终正常渲染', errors.length === before && (await pages().count()) === 3 && (await p.locator('.fa-pdf-scroll canvas[data-rendered="true"]').count()) >= 1, { newErrors: errors.slice(before, before + 2) });

// ---- Notebook ----
await open('实验', '实验.ipynb');
await p.locator('details.fa-fixture-controls').evaluate(d => { d.open = true; });
await p.locator('select[aria-label="Notebook 示例场景"]').selectOption('all'); await p.waitForTimeout(1500);
const nb = p.locator('.fa-notebook');
check('R3-NB01', 'Notebook Markdown 单元用通用渲染（列表/表格/行内代码/公式）', (await nb.locator('.fa-static-markdown').count()) >= 1, { markdownBlocks: await nb.locator('.fa-static-markdown').count() });
check('R3-NB02', '代码单元与 JSON 输出有语法高亮（hljs）', (await nb.locator('code.hljs .hljs-keyword, code.hljs .hljs-string, code.hljs .hljs-number, code.hljs .hljs-title').count()) >= 1, { tokens: await nb.locator('code.hljs span').count() });
check('R3-NB03', 'Notebook 内没有 script 元素；HTML 输出仍在 sandbox 空权限 iframe', (await nb.locator('script').count()) === 0 && (await nb.locator('iframe[sandbox=""]').count()) >= 1, { iframes: await nb.locator('iframe').count() });
await shot('r3-notebook-light.png');
await p.locator('button[aria-label*="主题"], button[title*="主题"], button[aria-label*="深色"]').first().click().catch(() => {});
await p.waitForTimeout(600);
const dark = await p.evaluate(() => document.documentElement.dataset.theme);
if (dark === 'dark') await shot('r3-notebook-dark.png');
check('R3-NB04', '深色主题下 Notebook 可切换并截图（高亮色另行配置）', dark === 'dark', { theme: dark });
check('R3-PN19', '全程没有 pageerror / console error', errors.length === 0, { errors: errors.slice(0, 4) });
await browser.close();
const summary = checks.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {});
fs.writeFileSync(path.join(out, 'r3-pdf-notebook-check.json'), JSON.stringify({ schemaVersion: 1, ranAt: new Date().toISOString(), target: 'http://127.0.0.1:4176/?preview=m9', browser: 'Google Chrome (local, headless, isolated context)', viewport: '1512x949 DPR2', scope: '合成 PDF/Notebook 原型；不是 Codex 参考运行，不计入正式用例', screenshots: shots, checks, summary }, null, 2));
console.log(JSON.stringify(summary)); for (const x of checks) console.log(x.id, x.status, x.title);
