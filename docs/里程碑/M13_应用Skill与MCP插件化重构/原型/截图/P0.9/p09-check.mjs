// 原型 P0.9 浏览器走查：插件安装与更新分开、只接受同一插件、不允许降级、更新只列变化、卸载后装旧版回退（需求 2026-11-11 补记 3 插件升级）。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(400); };
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const dlg = () => p.locator('.m13-dialog');
const head = async () => ({ title: await dlg().locator('h2').first().innerText(), text: await dlg().innerText() });
const toast = async () => { await p.locator('.m13-toast').waitFor({ timeout: 2000 }).catch(() => {}); return p.locator('.m13-toast').innerText().catch(() => ''); };
const menuItems = async label => { await p.getByRole('button', { name: label }).click(); const t = (await p.locator('.m10-menu [role=menuitem]').allInnerTexts()).map(x => x.trim()); return t; };
const pickCheck = async file => { await dlg().locator('.m13-radio').filter({ hasText: file }).click(); await dlg().getByRole('button', { name: '检查插件' }).click(); await p.waitForTimeout(200); };
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins'); await p.waitForTimeout(800);
// 1 入口
const mailMenu = await menuItems('邮件 更多操作'); await p.keyboard.press('Escape'); await p.mouse.click(5, 500); await p.waitForTimeout(150);
const ztMenu = await menuItems('禅道 更多操作');
ok('目录卡片菜单：外部插件有“更新…”，内置没有', ztMenu.includes('更新…') && !mailMenu.includes('更新…'), { mailMenu, ztMenu });
await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '更新…' }).click(); await p.waitForTimeout(250);
const h0 = await head(); await shot('01-update-pick');
// 2 别的插件
await pickCheck('demo-tracker-0.1.0.zip'); const h1 = await head(); await shot('02-update-mismatch');
ok('从“更新…”进入：标题“更新 禅道”；选别的插件的包被拒绝', h0.title === '更新 禅道' && h0.text.includes('更高版本') && h1.text.includes('插件包不匹配') && h1.text.includes('这不是禅道的插件包') && h1.text.includes('未做任何改动'), { h0: h0.title, h1: h1.text.slice(0, 200) });
// 3 降级
await dlg().getByRole('button', { name: '重新选择' }).click(); await pickCheck('zentao-plugin-0.9.0.zip'); const h2 = await head(); await shot('03-update-downgrade');
ok('选更低版本：不能安装更低的版本，未做改动', h2.text.includes('不能安装更低的版本') && h2.text.includes('0.9.0 低于已安装的 1.0.0') && !(await dlg().getByRole('button', { name: '更新' }).count()), { h2: h2.text.slice(0, 200) });
// 4 正常更新
await dlg().getByRole('button', { name: '重新选择' }).click(); await pickCheck('zentao-plugin-1.1.0'); const h3 = await head(); await shot('04-update-review');
await dlg().getByRole('button', { name: '更新' }).click(); const t1 = await toast(); await p.waitForTimeout(200); const sub = await p.locator('.m13-detail-title p').innerText();
ok('更新页只列变化：1.0.0 → 1.1.0、新增权限需同意、新增能力与 Skill；更新后版本为 1.1.0', h3.title === '更新 禅道' && h3.text.includes('1.0.0 → 1.1.0') && h3.text.includes('新增权限，点“更新”即表示同意') && h3.text.includes('新增：下载附件') && h3.text.includes('新增：zentao-daily-summary') && !h3.text.includes('它会获得的权限') && t1.includes('已更新到 1.1.0') && sub.includes('版本 1.1.0'), { h3: h3.text.slice(0, 400), t1, sub });
// 5 从“添加”选到已安装插件的新版本 → 自动按更新处理
await hash('m13/plugins'); await p.getByRole('button', { name: '添加' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '从本地文件夹安装' }).click(); await p.waitForTimeout(200);
await pickCheck('zentao-plugin-2.0.0-drop'); const h4 = await head(); await shot('05-add-becomes-update');
ok('从“添加”选到已安装插件的新版本：自动切到“更新 禅道”，提示删除能力', h4.title === '更新 禅道' && h4.text.includes('将按更新处理') && h4.text.includes('新版本删除了能力') && h4.text.includes('删除：查看详情与历史'), { h4: h4.text.slice(0, 400) });
await dlg().getByRole('button', { name: '返回' }).click(); await dlg().getByRole('button', { name: '取消' }).click(); await p.waitForTimeout(150);
// 6 新装：完整介绍
await p.getByRole('button', { name: '添加' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '.zip' }).click(); await p.waitForTimeout(200);
await pickCheck('demo-tracker-0.1.0.zip'); const h5 = await head(); await shot('06-install-review');
await dlg().getByRole('button', { name: '安装' }).click(); const t2 = await toast();
ok('从“添加”新装：标题“安装 Demo Tracker”，显示说明、能力、自带 Skill、权限与安全提示', h5.title === '安装 Demo Tracker' && h5.text.includes('能力') && h5.text.includes('自带 Skill') && h5.text.includes('demo-tracker-usage') && h5.text.includes('它会获得的权限') && h5.text.includes('独立进程') && t2.includes('已安装'), { h5: h5.text.slice(0, 400), t2 });
// 7 详情页菜单
await hash('m13/plugins/zentao'); const dm = await menuItems('插件更多操作'); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '更新…' }).click(); await p.waitForTimeout(200); const h6 = await head();
ok('详情页“…”菜单为“更新…”，打开“更新 禅道”', dm.includes('更新…') && !dm.some(x => x.includes('从文件更新')) && h6.title === '更新 禅道', { dm, h6: h6.title });
await dlg().getByRole('button', { name: '取消' }).click();
// 7b 回退：卸载（保留数据）后安装旧版本（用户 2026-11-11 决定保留）
await hash('m13/plugins'); await p.getByRole('button', { name: '禅道 更多操作' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '卸载' }).click(); await p.waitForTimeout(200);
const un = await dlg().innerText(); await shot('08-uninstall-keep'); await dlg().getByRole('button', { name: '卸载' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: '添加' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '.zip' }).click(); await p.waitForTimeout(200);
await pickCheck('zentao-plugin-0.9.0.zip'); const h7 = await head(); await dlg().getByRole('button', { name: '安装' }).click(); const t3 = await toast(); await p.waitForTimeout(200); const sub2 = await p.locator('.m13-detail-title p').innerText();
ok('回退：卸载弹窗说明可卸载后装旧版；保留数据卸载后可安装 0.9.0，连接恢复', un.includes('可以这样卸载后重新安装旧版本') && un.includes('读不了新版本写入的数据') && h7.title === '安装 禅道' && t3.includes('已恢复保留的 1 个连接') && sub2.includes('版本 0.9.0'), { un: un.slice(0, 300), h7: h7.title, t3, sub2 });
// 8 深色
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await hash('m13/plugins'); await p.getByRole('button', { name: '禅道 更多操作' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '更新…' }).click(); await p.waitForTimeout(200);
await pickCheck('zentao-plugin-2.0.0-drop'); await shot('07-update-review-dark');
console.log(JSON.stringify({ results: R, errors }, null, 1));
await b.close();
