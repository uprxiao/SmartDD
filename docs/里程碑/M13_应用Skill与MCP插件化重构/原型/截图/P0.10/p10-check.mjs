// 原型 P0.10 浏览器走查：停用插件的页面（B1）、项目关闭插件的生效提示（B2/A7）、只数受影响会话（B3）、更新停用插件（B4）。
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
const toast = async (sel = '.m13-toast') => { await p.waitForTimeout(150); await p.locator(sel).waitFor({ timeout: 2000 }).catch(() => {}); const t = await p.locator(sel).innerText().catch(() => ''); await p.locator(sel).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); return t; };
const catMenu = async (name, item) => { await hash('m13/plugins'); await p.getByRole('button', { name: name + ' 更多操作' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: item }).click(); await p.waitForTimeout(250); };
const projSwitch = async (proj, label) => { await hash('project/' + proj + '/apps'); await p.getByRole('switch', { name: label }).click(); return toast('.toast'); }; // 项目页用 App 的提示组件
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins'); await p.waitForTimeout(800);
// 1 B1 停用后页面
await catMenu('禅道', '停用'); await toast();
await hash('m13/plugins/zentao/work'); const empty = await p.locator('.m13-empty').innerText().catch(() => ''); const rows0 = await p.locator('.m13-zt-row').count();
const childCls = await p.locator('.m13-nav-child').getAttribute('class'); await shot('01-work-disabled');
await hash('m13/plugins/zentao'); const workBtn = await p.locator('.m13-detail-actions button').filter({ hasText: '我的工作' }).isDisabled();
await hash('m13/plugins/zentao/work'); await p.locator('.m13-empty').getByRole('button', { name: '启用' }).click(); const tOn = await toast(); const rows1 = await p.locator('.m13-zt-row').count();
await catMenu('邮件', '停用'); await toast(); await hash('m13/plugins/mail/drafts'); const mailEmpty = await p.locator('.m13-empty').innerText().catch(() => ''); await shot('02-drafts-disabled');
await p.locator('.m13-empty').getByRole('button', { name: '启用' }).click(); await toast(); const draftsBack = await p.locator('.m13-subpage h1').innerText();
ok('B1 停用后“我的工作”“草稿”不读数据，显示已停用与启用；侧栏子项与详情按钮不可用；页内启用后恢复', empty.includes('禅道插件已停用') && empty.includes('已有数据都保留') && rows0 === 0 && childCls.includes('m13-disabled') && workBtn && tOn.includes('已启用') && rows1 > 0 && mailEmpty.includes('邮件插件已停用') && draftsBack === '草稿', { empty: empty.slice(0, 80), rows0, childCls, workBtn, tOn, rows1, mailEmpty: mailEmpty.slice(0, 40) });
// 2 B2/A7 项目开关提示 + B3 只数本项目
const tAisOff = await projSwitch('ais', '关闭 禅道'); await shot('03-project-off');
const tSdOff = await projSwitch('smartdd', '关闭 禅道');
ok('B2/A7 项目关闭插件按统一规则提示，只数本项目的运行中会话', tAisOff.includes('已在本项目关闭：本项目运行中的会话即刻不能再调用它') && tAisOff.includes('1 个运行中的会话重启后完全生效') && tSdOff.includes('已在本项目关闭') && !tSdOff.includes('重启后'), { tAisOff, tSdOff });
// 3 B3 全局停用：两个项目都关了 → 0 个受影响
await catMenu('禅道', '停用'); const tOff0 = await toast();
const tProjWhileOff = await projSwitch('ais', '启用 禅道');
await catMenu('禅道', '启用'); const tOn1 = await toast();
ok('B3 全局停用只数插件可用项目的会话（两个项目都已关闭时不提重启）；全局停用时改项目开关提示全局优先', tOff0.includes('已停用') && !tOff0.includes('重启后') && tProjWhileOff.includes('插件当前已全局停用') && tOn1.includes('1 个运行中的会话重启后完全生效'), { tOff0, tProjWhileOff, tOn1 });
// 4 B3 技能：内置（用户级）与纳管（只算另一个工具）
await hash('m13/capabilities'); await p.locator('.m13-builtin [role=switch]').first().click(); const tCap = await toast(); await p.locator('.m13-builtin [role=switch]').first().click(); await toast();
await p.locator('.m13-cap').filter({ hasText: 'pdf-tools' }).first().click(); await p.waitForTimeout(200); await dlg().getByRole('button', { name: '纳管', exact: true }).click(); const tManage = await toast();
ok('B3 技能：用户级停用数全部运行中会话；Codex 来源纳管给 Claude 只数 Claude 会话', tCap.includes('1 个运行中的会话重启后完全生效') && tManage.includes('已纳管') && tManage.includes('1 个运行中的会话重启后完全生效'), { tCap, tManage });
// 5 B4 更新停用中的插件
await catMenu('禅道', '停用'); await toast(); await catMenu('禅道', '更新…');
await dlg().locator('.m13-radio').filter({ hasText: 'zentao-plugin-1.1.0' }).click(); await dlg().getByRole('button', { name: '检查插件' }).click(); await p.waitForTimeout(200);
const upd = await dlg().innerText(); await shot('04-update-disabled');
await dlg().getByRole('button', { name: '更新' }).click(); const tUpd = await toast(); await hash('m13/plugins/zentao'); const sub = await p.locator('.m13-detail-title p').innerText();
ok('B4 更新停用中的插件：说明保持停用、不提运行中会话；更新后仍为停用', upd.includes('当前已停用，更新后仍保持停用') && !upd.includes('正在执行的调用按') && tUpd === '禅道 已更新到 1.1.0，仍为停用状态' && /^已停用 · 版本 1\.1\.0/.test(sub), { upd: upd.slice(0, 300), tUpd, sub });
// 6 深色
await hash('m13/plugins/zentao/work'); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(200); await shot('05-work-disabled-dark');
console.log(JSON.stringify({ results: R, errors }, null, 1));
await b.close();
