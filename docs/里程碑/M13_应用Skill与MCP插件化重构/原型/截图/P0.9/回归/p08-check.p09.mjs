// 原型 P0.8 浏览器走查（P0.9 适配：详情页菜单“从文件更新…”改名“更新…”，用户 2026-11-11 决定）：图标栏四项、插件详情按启用状态、插入会话、统一生效提示（需求 2026-11-11 补记 3）。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(400); };
const cur = () => p.evaluate(() => location.hash);
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const toast = async () => { await p.locator('.m13-toast').waitFor({ timeout: 2000 }).catch(() => {}); return p.locator('.m13-toast').innerText().catch(() => ''); };
const menuPick = async (label, item) => { await p.getByRole('button', { name: label }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: item }).click(); await p.waitForTimeout(300); };
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins'); await p.waitForTimeout(800);
// 1 图标栏四项
const rail = await p.locator('.rail-links .rail-link').evaluateAll(a => a.map(x => x.getAttribute('aria-label')));
const dl = await p.locator('.rail-download').count();
await p.locator('.rail-link[aria-label="设置"]').click(); await p.waitForTimeout(300); const r1 = await cur(); const sel = await p.locator('.rail-link[aria-current=page]').getAttribute('aria-label'); await shot('01-rail-settings');
ok('图标栏只有工作台、定时任务、设置、插件；无更多、项目资源、下载圆标；设置图标进入设置并选中', rail.join('|') === '工作台|定时任务|设置|插件与能力（M13 预览）' && dl === 0 && r1 === '#settings/general' && sel === '设置', { rail, dl, r1, sel });
// 2 插件目录去掉“开发自己的插件”
await hash('m13/plugins'); const dev = await p.locator('.m13-dev').count(); const devText = await p.getByText('开发自己的插件').count(); await shot('02-catalog');
ok('插件目录不再有“开发自己的插件”', dev === 0 && devText === 0, { dev, devText });
// 3 详情：启用状态、立即试用 → 停用后变“启用”，统一提示
await hash('m13/plugins/zentao'); const sub1 = await p.locator('.m13-detail-title p').innerText(); const btn1 = await p.locator('.m13-try').innerText(); await shot('03-detail-enabled');
await menuPick('插件更多操作', '停用'); const t1 = await toast(); const sub2 = await p.locator('.m13-detail-title p').innerText(); const btn2 = await p.locator('.m13-try').innerText(); const alert = await p.locator('.m13-alert.warn').first().innerText(); await shot('04-detail-disabled');
await p.locator('.m13-try').click(); await p.waitForTimeout(300); const t2 = await toast(); const btn3 = await p.locator('.m13-try').innerText();
ok('详情按启用状态显示：已启用→立即试用；停用→“启用”；提示统一并带运行中会话数', /^已启用 · 版本 1\.0\.0/.test(sub1) && btn1.includes('立即试用') && t1.includes('运行中的会话即刻不能再调用它') && t1.includes('1 个运行中的会话重启后完全生效') && /^已停用/.test(sub2) && btn2 === '启用' && alert.includes('新建或恢复的会话不再加载') && !alert.includes('启用\n') && t2.includes('新建或恢复的会话即可使用') && btn3.includes('立即试用'), { sub1, btn1, t1, sub2, btn2, alert, t2, btn3 });
// 4 我的工作：有运行中会话 → 插入；无 → 新建会话并插入
await hash('m13/plugins/zentao/work'); await p.locator('.m13-project-select').selectOption('ais'); await p.waitForTimeout(200);
await p.locator('.m13-zt-row').first().click(); await p.waitForTimeout(300);
const opts = await p.locator('select[aria-label="插入到会话"] option').allInnerTexts(); const hint1 = await p.locator('.m13-dialog').innerText(); const b1 = await p.locator('.m13-dialog .m10-button.primary').innerText(); await shot('05-insert-running');
await p.locator('.m13-dialog .m10-button.primary').click(); const t3 = await toast();
await p.locator('.m13-project-select').selectOption('smartdd'); await p.waitForTimeout(200); await p.locator('.m13-zt-row').first().click(); await p.waitForTimeout(300);
const hint2 = await p.locator('.m13-dialog').innerText(); const b2 = await p.locator('.m13-dialog .m10-button.primary').innerText(); await shot('06-insert-new-session');
await p.locator('.m13-dialog .m10-button.primary').click(); await p.waitForTimeout(500); const r2 = await cur(); const prompt = await p.evaluate(() => document.querySelector('textarea')?.value || ''); const proj = await p.locator('body').innerText(); await shot('07-home-prefilled');
ok('插入会话：只列当前项目运行中会话；没有时“新建会话并插入”，回到首页并预填引用、选中该项目', opts.join('|') === '调研开发环境中的 Skill 与 Agent' && hint1.includes('只列出AIS运行中的会话') && b1 === '插入终端引用' && t3.includes('已插入会话') && hint2.includes('WillYou没有运行中的会话') && b2 === '新建会话并插入' && r2 === '#home' && prompt.startsWith('禅道 Bug #1290'), { opts, b1, t3, b2, r2, prompt });
// 5 技能：内置项停用、纳管提示
await hash('m13/capabilities'); await p.locator('.m13-builtin [role=switch]').first().click(); const t4 = await toast(); await shot('08-skill-toast');
await p.locator('.m13-builtin [role=switch]').first().click(); const t5 = await toast();
await p.getByRole('button', { name: '一键纳管' }).click().catch(() => {}); const t6 = await toast();
ok('技能启停与纳管提示按统一规则（新建或恢复的会话生效，运行中会话重启后）', t4.includes('新建或恢复的会话不再加载') && t4.includes('重启后完全生效') && t5.includes('新建或恢复的会话即可使用') && t6.includes('新建或恢复的会话即可使用'), { t4, t5, t6 });
// 6 更新与卸载提示
await hash('m13/plugins/zentao'); await menuPick('插件更多操作', '更新…');
await p.locator('.m13-radio').filter({ hasText: 'zentao-plugin-1.1.0' }).click(); await p.getByRole('button', { name: '检查插件' }).click(); await p.waitForTimeout(200); await p.locator('.m13-dialog').getByRole('button', { name: '更新' }).click(); const t7 = await toast();
await hash('m13/plugins'); await menuPick('禅道 更多操作', '卸载'); await p.locator('.m13-dialog').getByRole('button', { name: '卸载' }).click(); const t8 = await toast();
ok('更新、卸载提示按统一规则', t7.includes('插件调用立即使用新版本') && t7.includes('重启后完全生效') && t8.includes('运行中的会话即刻不能再调用它'), { t7, t8 });
// 7 深色
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins/mail'); await p.waitForTimeout(700); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(200); await shot('09-detail-dark');
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
// 8 非 M13 预览不受影响
await p.goto('http://127.0.0.1:4176/#home'); await p.waitForTimeout(800);
const oldRail = await p.locator('.rail-links .rail-link').evaluateAll(a => a.map(x => x.getAttribute('aria-label'))); const oldDl = await p.locator('.rail-download').count();
ok('非 M13 预览保持原图标栏', oldRail.includes('AI 工具') && oldRail.includes('预览说明') && oldRail.includes('项目资源') && oldDl === 1, { oldRail, oldDl });
console.log(JSON.stringify({ results: R, errors }, null, 1));
await b.close();
