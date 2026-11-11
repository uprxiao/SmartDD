// 原型 P0.17 浏览器走查：首页智能体权限（需求补记 8）。参考图：同目录 ref-codex-权限菜单-用户截图20261111.png（比例约 1.08）。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN', deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; console.log((v ? 'PASS ' : 'FAIL ') + k); };
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const trig = () => p.locator('.m13-perm-trigger');
const menu = () => p.locator('.m13-perm-menu');
const dlg = () => p.locator('.m13-dialog');
const agent = async name => { await p.getByRole('button', { name: '选择智能体' }).click(); await p.locator('.profile-choice-menu [role=menuitem]').filter({ hasText: name }).click(); await p.waitForTimeout(150); };
const choose = async name => { await trig().click(); await menu().getByRole('menuitemradio').filter({ has: p.locator('b', { hasText: new RegExp('^' + name.replace(/[()]/g, '\\$&') + '$') }) }).click(); await p.waitForTimeout(150); };
await p.goto('http://127.0.0.1:4176/?preview=m13#home'); await p.waitForTimeout(1000);
// 1 默认智能体（Claude Code · 订阅）：默认请求批准；菜单三项、无帮我批准
const t0 = await trig().innerText(); await trig().click(); await p.waitForTimeout(150);
const head1 = await menu().locator('.m13-perm-head span').innerText(); const items1 = await menu().getByRole('menuitemradio').allInnerTexts(); await shot('01-claude-menu');
ok('默认档位为请求批准；Claude 菜单只有请求批准、完全访问权限两项（无帮我批准、无自定义），表头写 Claude Code', t0.includes('请求批准') && head1 === '应如何批准 Claude Code 操作?' && items1.length === 2 && !items1.some(x => x.includes('帮我批准') || x.includes('自定义')), { t0, head1, items1 });
await p.keyboard.press('Escape'); await p.waitForTimeout(100);
ok('Esc 关闭权限菜单', await menu().count() === 0);
// 2 Codex：四项，选中项打勾；尺寸与参考换算值比对
await agent('Codex · DeepSeek'); await trig().click(); await p.waitForTimeout(150);
const items2 = await menu().getByRole('menuitemradio').allInnerTexts(); const box = await menu().boundingBox(); const rows = await menu().getByRole('menuitemradio').evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height)));
const checked = await menu().locator('[aria-checked=true]').innerText(); const danger = await menu().locator('button.danger b').evaluate(e => getComputedStyle(e).color); await shot('02-codex-menu');
await menu().screenshot({ path: `${out}/02b-codex-menu-crop.png` });
ok('Codex 菜单三项：请求批准、帮我批准、完全访问权限（无自定义），当前项打勾，完全访问为橙红色', items2.length === 3 && items2[1].includes('帮我批准') && !items2.some(x => x.includes('自定义')) && checked.includes('请求批准') && danger === 'rgb(222, 62, 0)', { items2, checked, danger });
ok('尺寸按参考换算值（宽约 329，每项约 47；三项高约 179）', box && Math.abs(box.width - 329) <= 2 && Math.abs(box.height - 179) <= 6 && rows.every(h => Math.abs(h - 47) <= 2), { box, rows });
await p.keyboard.press('Escape');
// 3 帮我批准：切到 Claude 显示请求批准，切回 Codex 恢复
await choose('帮我批准'); const t3a = await trig().innerText();
await agent('Claude Code · 订阅'); const t3b = await trig().innerText(); await shot('03-claude-fallback');
await agent('Codex · DeepSeek'); const t3c = await trig().innerText();
ok('Codex 选帮我批准后切到 Claude 显示请求批准，切回 Codex 恢复帮我批准', t3a.includes('帮我批准') && t3b.includes('请求批准') && t3c.includes('帮我批准'), { t3a, t3b, t3c });
// 4 完全访问：第一次确认，取消不改；确认后记住
await choose('完全访问权限'); const d1 = await dlg().count(); const dtext = d1 ? await dlg().innerText() : ''; await shot('04-full-confirm');
await dlg().getByRole('button', { name: '取消' }).click(); await p.waitForTimeout(150); const t4a = await trig().innerText();
await choose('完全访问权限'); await dlg().getByRole('button', { name: '继续使用完全访问' }).click(); await p.waitForTimeout(150);
const t4b = await trig().innerText(); const tcolor = await trig().evaluate(e => getComputedStyle(e).color);
await choose('请求批准'); await choose('完全访问权限'); const d2 = await dlg().count(); await shot('05-full-selected');
ok('第一次选完全访问弹确认；取消后档位不变；确认后切换并记住，再选不再询问；按钮变橙红', d1 === 1 && dtext.includes('不经询问修改你电脑上的任何文件') && t4a.includes('帮我批准') && t4b.includes('完全访问权限') && tcolor === 'rgb(222, 62, 0)' && d2 === 0, { d1, t4a, t4b, tcolor, d2 });
// 5 建任务记录权限快照；首页之后改档位不影响旧任务
await p.getByLabel('任务描述').fill('P0.17 权限任务'); await p.locator('form.reference-composer').evaluate(f => f.requestSubmit()); await p.waitForTimeout(1500);
const taskHash = await p.evaluate(() => location.hash);
await p.getByRole('button', { name: '任务信息' }).click(); await p.waitForTimeout(200); const info1 = await dlg().locator('[data-task-info]').innerText(); await shot('06-task-info'); await dlg().getByRole('button', { name: '完成' }).click();
await p.evaluate(() => { location.hash = 'home'; }); await p.waitForTimeout(400); await choose('请求批准');
await p.evaluate(h => { location.hash = h; }, taskHash.slice(1)); await p.waitForTimeout(500);
await p.getByRole('button', { name: '任务信息' }).click(); await p.waitForTimeout(200); const info2 = await dlg().locator('[data-task-info]').innerText(); await dlg().getByRole('button', { name: '完成' }).click();
ok('任务信息记录创建时的权限与启动参数；之后首页改为请求批准，旧任务仍为完全访问', info1.includes('完全访问权限') && info1.includes('--dangerously-bypass-approvals-and-sandbox') && info2.includes('完全访问权限'), { info1: info1.replace(/\n/g, ' / ').slice(0, 300) });
// 6 了解更多（演示提示）与深色
await p.evaluate(() => { location.hash = 'home'; }); await p.waitForTimeout(400);
await trig().click(); await menu().getByRole('button', { name: '了解更多' }).click(); await p.waitForTimeout(300); const toast = await p.locator('.toast, .m13-toast').first().innerText().catch(() => '');
ok('了解更多给出演示提示，不打开外部链接', toast.includes('演示'), toast);
await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await trig().click(); await p.waitForTimeout(200); await shot('07-dark-menu'); await p.keyboard.press('Escape');
ok('无页面错误', errors.length === 0, errors);
const fs = await import('node:fs'); fs.writeFileSync(`${out}/p17-result.json`, JSON.stringify(R, null, 1));
console.log(Object.values(R).filter(r => r.pass).length + '/' + Object.keys(R).length);
await b.close();
