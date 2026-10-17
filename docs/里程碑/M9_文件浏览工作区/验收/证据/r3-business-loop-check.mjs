// R3 业务接入闭环检查（M9-GAP-07）：文件/选区 → 引用托盘 → 放入终端输入（不回车）→ 用户按 Enter → 请 CLI 修改 → 审阅；含失败与过期路径。
// 目标是合成原型的演示终端，不是真实 CLI/真实 PTY；不调用模型。用法：NODE_PATH=<含 playwright-core 的 node_modules> node r3-business-loop-check.mjs <输出目录>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const out = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await browser.newContext({ viewport: { width: 1512, height: 949 }, deviceScaleFactor: 1, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
const checks = [], shots = []; const check = (id, title, ok, detail = {}) => checks.push({ id, title, status: ok === 'untested' ? 'untested' : ok ? 'passed' : 'failed', detail });
const shot = async name => { const f = path.join(out, name); await p.screenshot({ path: f }); shots.push({ file: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') }); };
const fresh = async () => { await p.goto('http://127.0.0.1:4176/?preview=m9'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto('http://127.0.0.1:4176/?preview=m9'); await p.waitForTimeout(1800); };
const ed = () => p.locator('textarea:not(.xterm-helper-textarea)').first(); // 终端自带一个隐藏 textarea，编辑器的是另一个
const term = async () => (await p.locator('.terminal-mount .xterm-rows').innerText().catch(() => '')).replace(/ /g, ' ');
const resume = async () => { await p.getByRole('button', { name: '更多' }).click(); await p.getByText('恢复', { exact: true }).first().click(); await p.locator('dialog[aria-label="恢复任务"]').getByRole('button', { name: '恢复任务' }).click(); await p.waitForTimeout(700); };
const open = async (filter, text) => { await p.fill('input[aria-label="筛选文件"]', filter); await p.waitForTimeout(400); await p.locator('[role=treeitem]').filter({ hasText: text }).first().dblclick(); await p.waitForTimeout(1200); await p.fill('input[aria-label="筛选文件"]', ''); await p.waitForTimeout(300); };
const select = async (start, end) => ed().evaluate((el, [a, b]) => { el.focus(); el.setSelectionRange(a, b); el.dispatchEvent(new Event('select', { bubbles: true })); }, [start, end]);
const rightClickEditor = async () => { await ed().dispatchEvent('contextmenu', { bubbles: true, cancelable: true }); await p.waitForTimeout(250); }; // 直接派发 contextmenu，避免鼠标点击折叠选区
// 第 a..b 行（0 起，含）在文本里的 UTF-16 偏移区间，行尾换行不含在最后一行内
const span = (content, a, b) => { const ls = content.split('\n'); let start = 0; for (let i = 0; i < a; i++) start += ls[i].length + 1; let end = start; for (let i = a; i <= b; i++) end += ls[i].length + (i < b ? 1 : 0); return [start, end]; };
const status = async () => (await p.locator('.fw-footer [role=status]').innerText().catch(() => ''));
const tray = () => p.locator('section.fw-refs');
const demoPanel = async () => { await p.locator('.fw-demo').count() || await p.getByRole('button', { name: /M9 交互样例/ }).click(); await p.waitForTimeout(200); };

await fresh();
// ---------- 任务未运行：不能放入终端 ----------
await p.locator('[role=treeitem]').filter({ hasText: '发布演示' }).first().click({ button: 'right' }); await p.waitForTimeout(250);
await p.getByRole('button', { name: '添加到终端引用' }).click(); await p.waitForTimeout(300);
check('R3-BL01', '文件右键“添加到终端引用”：托盘出现 1 条引用，尚未放入终端', (await tray().count()) === 1 && (await tray().locator('li').count()) === 1, { chips: await tray().locator('li').allInnerTexts() });
check('R3-BL02', '任务已停止时“放入终端输入”禁用，并说明原因', await tray().getByRole('button', { name: '放入终端输入（不发送）' }).isDisabled() && (await tray().innerText()).includes('任务未运行'), {});
await shot('r3-business-tray-stopped.png');
await resume();
// ---------- 引用预览与放入 ----------
await tray().getByRole('button', { name: '预览' }).click(); await p.waitForTimeout(200);
const preview1 = await tray().getByLabel('将放入终端的文本').innerText();
check('R3-BL03', '预览显示将放入终端的确切文本（文件引用只含路径），并标明是普通输入模式', preview1.trim() === 'docs/发布演示.pptx' && (await tray().innerText()).includes('普通输入'), { preview: preview1.trim() });
await tray().getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(700);
let t = await term();
check('R3-BL04', '放入终端后输入行出现引用文本，但没有被提交（没有“CLI 收到”输出）', t.includes('docs/发布演示.pptx') && !t.includes('CLI 收到了文件引用') && (await status()).includes('未发送'), { statusBar: await status() });
check('R3-BL05', '放入后托盘清空', (await tray().count()) === 0, {});
await p.locator('.terminal-mount .xterm-helper-textarea').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
t = await term();
check('R3-BL06', '用户在终端按 Enter 之后，演示 CLI 才“收到”引用（提交永远是用户动作）', t.includes('CLI 收到了文件引用'), {});
await shot('r3-business-after-enter.png');

// ---------- 选区引用：行号、所选文字、格式与括号粘贴 ----------
await fresh(); await resume(); await open('main', 'main.ts');
const area = ed(); const content = await area.inputValue();
const [start, end] = span(content, 3, 4); // “export const workspace = {” 与 “  name: …” 即第 4–5 行
await select(start, end); await rightClickEditor();
await p.getByRole('button', { name: '添加所选内容到终端引用' }).click(); await p.waitForTimeout(300);
const chip = (await tray().locator('li').first().innerText()).trim();
check('R3-BL07', '选中第 4–5 行 → 引用标签为 src/main.ts:L4-5', /src\/main\.ts:L4-5/.test(chip), { chip });
await tray().getByRole('button', { name: '预览' }).click(); await p.waitForTimeout(200);
const withText = await tray().getByLabel('将放入终端的文本').innerText();
await tray().getByLabel(/包含所选文字/).uncheck(); await p.waitForTimeout(200);
const withoutText = await tray().getByLabel('将放入终端的文本').innerText();
check('R3-BL08', '勾选“包含所选文字”时预览含缩进的所选内容；取消后只剩位置', withText.includes('    ') && withText.split('\n').length >= 3 && withoutText.trim() === 'src/main.ts:L4-5', { withTextLines: withText.split('\n').length, withoutText: withoutText.trim() });
await tray().getByLabel('引用格式').selectOption('at'); await p.waitForTimeout(150);
check('R3-BL09', '“@路径”格式把行号放在括号里（该 CLI 是否识别需单独验证）', (await tray().getByLabel('将放入终端的文本').innerText()).trim() === '@src/main.ts (L4-5)', {});
await tray().getByLabel('引用格式').selectOption('plain'); await tray().getByLabel(/包含所选文字/).check();
await demoPanel(); await p.getByLabel('演示终端启用括号粘贴（多行引用）').check(); await p.waitForTimeout(200);
const bracketedPreview = await tray().innerText();
check('R3-BL10', '终端启用括号粘贴时预览标明“换行保留”，否则“换行折叠为空格”', bracketedPreview.includes('括号粘贴，换行保留'), {});
await tray().getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(700);
t = await term(); const tl = t.split('\n'); const at = tl.findIndex(l => l.includes('src/main.ts:L4-5'));
check('R3-BL11', '括号粘贴模式：多行引用保留换行地放进终端输入（连续 3 行），仍未提交', at >= 0 && tl[at + 1]?.includes('export const workspace') && tl[at + 2]?.includes('name:') && !t.includes('CLI 收到了文件引用'), { lines: tl.slice(at, at + 3) });
await p.getByLabel('演示终端启用括号粘贴（多行引用）').uncheck();

// ---------- 清理：含控制字符的文件，走完整界面路径 ----------
await fresh(); await resume(); await open('控制', '控制字符.txt');
const evil = await ed().inputValue(); const [es, ee] = span(evil, 1, 1);
await select(es, ee); await rightClickEditor(); await p.getByRole('button', { name: '添加所选内容到终端引用' }).click(); await p.waitForTimeout(300);
await tray().getByRole('button', { name: '预览' }).click(); await p.waitForTimeout(200);
const evilPreview = await tray().innerText(); const previewText = await tray().getByLabel('将放入终端的文本').innerText();
check('R3-BL12', '含 ESC[201~ 与 ^C 的所选文字：预览已提示移除不安全字符，且预览文本不含控制字符', /已移除 \d+ 个不安全字符/.test(evilPreview) && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(previewText.replace(/\n/g, '')), { notice: (evilPreview.match(/已移除 \d+ 个不安全字符/) || [])[0], previewText });
await tray().getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(700);
t = await term();
check('R3-BL14', '放入终端后：状态栏提示已移除控制字符；终端里没有执行、没有中断，注入文字只是普通文本', (await status()).includes('已移除不安全的控制字符') && t.replace(/\n/g, '').includes('x[201~touch INJECTED') && !t.includes('CLI 收到了文件引用') && !t.includes('^C'), { statusBar: await status(), terminalTail: t.split('\n').slice(-3) }); // 终端会把长行折行，先拼接再判断

// ---------- 请 CLI 修改所选文本 ----------
await fresh(); await resume(); await open('main', 'main.ts');
const c2 = await ed().inputValue(); const l2 = c2.split('\n'); const [s2, e2] = span(c2, 4, 4);
await select(s2, e2); await rightClickEditor(); await p.getByRole('button', { name: '请 CLI 修改所选文本…' }).click(); await p.waitForTimeout(300);
const dialog = p.getByRole('dialog', { name: '请 CLI 修改所选文本' });
check('R3-ED01', '没有指令时“放入终端输入”禁用；对话框明确说明不调用模型', await dialog.getByRole('button', { name: '放入终端输入（不发送）' }).isDisabled() && (await dialog.innerText()).includes('不会调用模型'), {});
await dialog.getByLabel('修改指令').fill('把这一行改成 async 风格并保持缩进'); await dialog.getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(800);
t = await term(); const banner = p.locator('section.fw-selection-edit');
check('R3-ED02', '指令与位置放入终端（含指令引用），横幅显示“尚未发送”', t.includes('src/main.ts:L5') && t.includes('async') && (await banner.innerText()).includes('尚未发送'), { banner: (await banner.innerText()).slice(0, 60) });
await p.locator('.terminal-mount .xterm-helper-textarea').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
check('R3-ED03', '用户在终端按 Enter 后，横幅变为“已在终端提交，等待 CLI 修改”', (await banner.innerText()).includes('已在终端提交'), {});
await demoPanel(); await p.getByRole('button', { name: '模拟：CLI 修改了所选范围' }).click(); await p.waitForTimeout(400);
const before = await banner.getByLabel('修改前').innerText(), after = await banner.getByLabel('修改后').innerText();
check('R3-ED04', '文件被“CLI”改动后进入审阅：并排显示修改前/后，且只涉及所选范围', (await banner.innerText()).includes('请审阅') && before === l2[4] && after === l2[4] + ' // CLI 修改示例', { before, after });
await shot('r3-business-review.png');
const baseLen = c2.length; await banner.getByRole('button', { name: '保留修改' }).click(); await p.waitForTimeout(400);
const afterKeep = await ed().inputValue();
check('R3-ED05', '“保留修改”把改动放进编辑缓冲（仍按正常保存流程），其余内容不变；横幅显示已保留', afterKeep.length === baseLen + ' // CLI 修改示例'.length && afterKeep.includes(l2[4] + ' // CLI 修改示例') && (await banner.innerText()).includes('已保留'), {});
// 还原路径
await fresh(); await resume(); await open('main', 'main.ts');
const c3 = await ed().inputValue(); const l3 = c3.split('\n'); const [s3, e3] = span(c3, 4, 4);
await select(s3, e3); await rightClickEditor(); await p.getByRole('button', { name: '请 CLI 修改所选文本…' }).click();
await p.getByRole('dialog').getByLabel('修改指令').fill('x'); await p.getByRole('dialog').getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(700);
await demoPanel(); await p.getByRole('button', { name: '模拟：CLI 修改了所选范围' }).click(); await p.waitForTimeout(300);
await banner.getByRole('button', { name: '还原' }).click(); await p.waitForTimeout(300);
check('R3-ED06', '“还原”：缓冲保持原样，横幅显示已还原', (await ed().inputValue()) === c3 && (await banner.innerText()).includes('已还原'), {});
// 本地编辑使快照过期
await fresh(); await resume(); await open('main', 'main.ts');
const c4 = await ed().inputValue(); const l4 = c4.split('\n'); const [s4, e4] = span(c4, 4, 4);
await select(s4, e4); await rightClickEditor(); await p.getByRole('button', { name: '请 CLI 修改所选文本…' }).click();
await p.getByRole('dialog').getByLabel('修改指令').fill('x'); await p.getByRole('dialog').getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(700);
await ed().click(); await p.keyboard.type('本地改动'); await p.waitForTimeout(500);
check('R3-ED07', '等待期间在本地改了文件：请求过期，不会把旧快照当基线', (await banner.innerText()).includes('已在本地被修改'), { banner: (await banner.innerText()).slice(0, 50) });
await demoPanel(); await p.getByRole('button', { name: '模拟：CLI 修改了所选范围' }).isDisabled().then(d => check('R3-ED08', '过期后“模拟 CLI 修改”不可用', d, {}));
// 取消
await fresh(); await resume(); await open('main', 'main.ts');
const c5 = await ed().inputValue(); const l5 = c5.split('\n'); const [s5, e5] = span(c5, 4, 4);
await select(s5, e5); await rightClickEditor(); await p.getByRole('button', { name: '请 CLI 修改所选文本…' }).click();
await p.getByRole('dialog').getByLabel('修改指令').fill('x'); await p.getByRole('dialog').getByRole('button', { name: '放入终端输入（不发送）' }).click(); await p.waitForTimeout(700);
await demoPanel(); await banner.getByRole('button', { name: '取消', exact: true }).click(); await p.waitForTimeout(200);
check('R3-ED09', '取消：横幅显示已取消，不再跟踪', (await banner.innerText()).includes('已取消') && await p.getByRole('button', { name: '模拟：CLI 修改了所选范围' }).isDisabled(), {});
// 任务停止时对话框内的提示
await fresh(); await open('main', 'main.ts');
const c6 = await ed().inputValue(); const l6 = c6.split('\n'); const [s6, e6] = span(c6, 4, 4);
await select(s6, e6); await rightClickEditor(); await p.getByRole('button', { name: '请 CLI 修改所选文本…' }).click();
await p.getByRole('dialog').getByLabel('修改指令').fill('x');
check('R3-ED10', '任务未运行：对话框提示原因，且“放入终端输入”禁用，不会创建请求', (await p.getByRole('dialog').innerText()).includes('任务未运行') && await p.getByRole('dialog').getByRole('button', { name: '放入终端输入（不发送）' }).isDisabled(), {});
check('R3-BL13', '全程没有 pageerror / console error', errors.length === 0, { errors: errors.slice(0, 4) });
await browser.close();
const summary = checks.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {});
fs.writeFileSync(path.join(out, 'r3-business-loop-check.json'), JSON.stringify({ schemaVersion: 1, ranAt: new Date().toISOString(), target: 'http://127.0.0.1:4176/?preview=m9', browser: 'Google Chrome (local, headless)', viewport: '1512x949', scope: '合成原型的演示终端；不是真实 CLI/PTY，不调用模型；真实 PTY 的注入安全见技研实验 terminal-injection-probe', screenshots: shots, checks, summary }, null, 2));
console.log(JSON.stringify(summary)); for (const x of checks) console.log(x.id, x.status, x.title);
