// P0.16 适配：插入终端引用后跳到目标会话终端，插入后回到“我的工作”页继续。
// P0.15 适配：自定义部分协议通过时检查完成页模型表只有 Codex 列；编辑智能体在勾选列表里测试未测试的模型；工具路径从新建弹窗第 1 步“本机检测”进入。P0.12 适配：供应商详情改为模型 × 工具表（按钮“测试”）；接入为三步并自动生成；智能体测试改为编辑时测试未测试的模型；工具路径从分组标题“…”菜单进入（用户 2026-11-11 确认）。
// P0.11 适配：禅道在项目页“插件”分区的“外部”页签（用户 2026-11-11 决定按内置／外部分页签），进入后先点“外部”。
// 原型 P0.5 浏览器走查：七项讨论结论与审核 P05／P10／P11。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN', acceptDownloads: true })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(350); };
const dlg = () => p.locator('.m13-dialog');
const toast = async () => (await p.locator('.m13-toast').innerText().catch(() => ''));
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins'); await p.waitForTimeout(700);
// 旧入口隐藏
ok('旧“应用接入”入口在 M13 预览中隐藏', await p.locator('.app-rail [aria-label="应用接入"]').count() === 0 && await p.locator('.app-rail [aria-label^="插件与能力"]').count() === 1);
// 第 1 项：邮件草稿页
await hash('m13/plugins/mail'); await p.getByRole('button', { name: '草稿' }).first().click(); await p.waitForTimeout(250);
const draftRows = await p.locator('.m13-cap').count(); await shot('01-mail-drafts');
await p.locator('.m13-cap').filter({ hasText: '登录异常' }).click(); await p.waitForTimeout(150);
const sendDisabled = await dlg().getByRole('button', { name: '重新发送' }).isDisabled(); await dlg().getByRole('button', { name: '关闭' }).click();
await hash('m13/plugins/mail'); await p.getByRole('button', { name: /添加发件账号/ }).click();
const f = dlg().locator('.m13-field input'); await f.nth(0).fill('公司邮箱'); await f.nth(1).fill('smtp.example.test'); await f.nth(3).fill('liubu@example.test'); await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200);
await hash('m13/plugins/mail/drafts'); await p.locator('.m13-cap').filter({ hasText: '登录异常' }).click(); await dlg().getByRole('button', { name: '重新发送' }).click(); await p.waitForTimeout(200);
const sentPill = await p.locator('.m13-cap').filter({ hasText: '登录异常' }).locator('.m13-pill').innerText();
await p.locator('.m13-cap').filter({ hasText: '批量导入超时' }).click(); await dlg().getByRole('button', { name: '核对结果' }).click(); await p.waitForTimeout(100); await shot('02-draft-unknown-check');
await dlg().getByRole('button', { name: /标记为已发送/ }).click(); await p.waitForTimeout(150);
ok('第 1 项 草稿页：4 封、无发件账号时不能发送、添加后可发送、结果未知需人工核对', draftRows === 4 && sendDisabled && sentPill === '已发送' && (await p.locator('.m13-cap').filter({ hasText: '批量导入超时' }).locator('.m13-pill').innerText()) === '已发送', { draftRows, sendDisabled, sentPill });
// 第 2 项 + P10：禅道我的工作
await hash('m13/plugins/zentao/work'); await p.waitForTimeout(200);
const first = await p.locator('.m13-zt-row').count(); await p.getByRole('button', { name: '读取下一页' }).click(); await p.waitForTimeout(150);
const second = await p.locator('.m13-zt-row').count(); await shot('03-zentao-work');
await p.locator('.m13-zt-row').first().click(); await p.waitForTimeout(150);
const hasHistory = await dlg().getByText('历史').count(); await shot('04-zentao-detail');
await dlg().getByRole('button', { name: '插入终端引用' }).click(); await p.waitForTimeout(150); const ins = await (async () => { await p.locator('.m13-toast, .toast').first().waitFor({ timeout: 2500 }).catch(() => {}); return p.locator('.m13-toast, .toast').first().innerText().catch(() => ''); })(); await hash('m13/plugins/zentao/work'); await p.waitForTimeout(200);
await p.getByRole('tab', { name: /研发需求/ }).click(); await p.waitForTimeout(100); const stories = await p.locator('.m13-zt-row').count();
await p.locator('.m13-previewbar select').selectOption('zentao-partial'); await hash('m13/plugins'); await hash('m13/plugins/zentao/work');
await p.getByRole('button', { name: '读取下一页' }).click(); await p.waitForTimeout(150); const partial = await p.getByText('列表读取未完成').count(); await shot('05-zentao-partial');
await p.getByRole('button', { name: '重试' }).click(); await p.waitForTimeout(150); const afterRetry = await p.locator('.m13-zt-row').count();
await p.locator('.m13-previewbar select').selectOption('normal');
ok('第 2 项 我的工作：分页 5→10、详情含历史、插入终端引用、需求页签、读取失败可重试', first === 5 && second === 10 && hasHistory > 0 && ins.includes('已插入') && stories === 5 && partial === 1 && afterRetry === 10, { first, second, ins, stories, partial, afterRetry });
// 第 3 项 + P05：连接全局默认、项目个性化、改默认同步、删除拦截
await hash('m13/plugins/zentao'); await p.getByRole('button', { name: /添加禅道连接/ }).click();
const g = dlg().locator('.m13-field input'); await g.nth(0).fill('运维禅道'); await g.nth(1).fill('https://ops-zentao.example.test'); await g.nth(2).fill('liubu'); await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200);
const defaultPills = await p.locator('#m13-connections .m13-pill.ok').allInnerTexts();
await hash('project/smartdd/apps'); await p.waitForTimeout(250); await p.locator('.m13-pp-tabs [role=tab]').filter({ hasText: '外部' }).click(); await p.waitForTimeout(150);
const tabLabel = await p.locator('.tabbar button.active').innerText();
await p.locator('select[aria-label="禅道禅道连接"]').selectOption({ label: '公司禅道' }); await p.waitForTimeout(150); await shot('06-project-plugins');
await hash('m13/plugins/zentao'); await p.locator('#m13-connections .m13-row').filter({ hasText: '运维禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '设为全局默认' }).click(); await p.waitForTimeout(150);
const follow = await dlg().locator('.m13-chips').first().innerText(); const custom = await dlg().locator('.m13-chips').nth(1).innerText(); await shot('07-default-change');
await dlg().getByRole('button', { name: '确认更换' }).click(); await p.waitForTimeout(200);
await hash('project/smartdd/apps'); await p.locator('.m13-pp-tabs [role=tab]').filter({ hasText: '外部' }).click(); await p.waitForTimeout(150); const sdSel = await p.locator('select[aria-label="禅道禅道连接"]').evaluate(e => e.options[e.selectedIndex].text);
await hash('project/ais/apps'); await p.locator('.m13-pp-tabs [role=tab]').filter({ hasText: '外部' }).click(); await p.waitForTimeout(150); const aisEff = await p.locator('.m13-pp-card').filter({ hasText: '禅道' }).locator('small.m13-hint').innerText();
ok('第 3 项 连接：首个为全局默认、项目页叫“插件”、改默认只同步跟随的项目', defaultPills.length === 1 && tabLabel === '插件' && follow.includes('AIS') && custom.includes('WillYou') && sdSel === '公司禅道' && aisEff.includes('运维禅道'), { defaultPills, tabLabel, follow, custom, sdSel, aisEff });
await hash('m13/plugins/zentao'); await p.locator('#m13-connections .m13-row').filter({ hasText: '公司禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '删除…' }).click(); await p.waitForTimeout(150);
const blocked = await dlg().getByText('有任务正在使用这个连接').count(); await shot('08-delete-blocked'); await dlg().getByRole('button', { name: '知道了' }).click();
await p.locator('#m13-connections .m13-row').filter({ hasText: '运维禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '删除…' }).click(); await p.waitForTimeout(150);
const needNew = await dlg().getByText('请先选新的全局默认').count(); await dlg().getByRole('button', { name: '删除' }).click(); await p.waitForTimeout(200);
const remain = await p.locator('#m13-connections .m13-row').allInnerTexts();
ok('第 3 项 删除：运行中任务在用时阻止；删全局默认先选新默认', blocked === 1 && needNew === 1 && remain.length === 1 && remain[0].includes('全局默认'), { blocked, needNew, remain });
// 项目关闭插件
await hash('project/ais/apps'); await p.getByRole('switch', { name: '关闭 浏览器' }).click(); await p.waitForTimeout(100);
ok('项目可关闭插件', (await p.locator('.m13-pp-card').filter({ hasText: '浏览器' }).locator('.m13-switch-row span').innerText()) === '本项目已关闭');
// 第 4 项：任务顶栏称“插件”
await hash('task/research'); await p.waitForTimeout(300); const hdr = await p.locator('.m10-session-trigger span').first().innerText().catch(() => '');
ok('第 4 项 任务顶栏称“插件”', hdr === '插件', hdr);
// 第 5 项：插件只显示当前版本；新版本删除能力时提示
await hash('m13/plugins'); await p.getByRole('button', { name: '添加' }).click(); await p.getByRole('menuitem', { name: /文件夹/ }).click();
await dlg().locator('.m13-radio').filter({ hasText: '2.0.0-drop' }).click(); await dlg().getByRole('button', { name: '检查插件' }).click(); await p.waitForTimeout(150);
const dropWarn = await dlg().getByText('老任务调用这些能力会失败').count(); await shot('09-update-removed-capability'); await dlg().getByRole('button', { name: '返回' }).click(); await dlg().getByRole('button', { name: '取消' }).click();
ok('第 5 项 新版本删能力时提示', dropWarn === 1);
// 第 7 项 + P11：内置分组、重新扫描自动纳管
await hash('m13/capabilities'); const builtins = await p.locator('.m13-builtin .m13-cap b').allInnerTexts();
await p.getByRole('switch', { name: /以后自动纳管|^$/ }).count();
await p.locator('.m13-switch-row').filter({ hasText: '以后自动纳管' }).locator('button').click(); await p.getByRole('button', { name: '重新扫描' }).click(); await p.waitForTimeout(1000);
const scanToast = await toast(); await shot('10-capabilities-builtin-autoscan');
ok('第 7 项 内置分组；P11 重新扫描自动纳管、冲突停下', builtins.length === 3 && builtins[0].includes('1.3.0') && scanToast.includes('changelog-writer') && scanToast.includes('code-review'), { builtins, scanToast });
// 第 6 项：导入导出
await hash('settings/ai'); await p.getByRole('button', { name: '导出', exact: true }).click(); await dlg().locator('.m13-check input').check(); await dlg().locator('input[type=password]').first().fill('short'); await dlg().getByRole('button', { name: '导出', exact: true }).click(); await p.waitForTimeout(100);
const shortErr = await dlg().getByText('口令至少 8 个字符').count(); await shot('11-export'); await dlg().getByRole('button', { name: '取消' }).click();
await p.getByRole('button', { name: '导入', exact: true }).click(); await p.waitForTimeout(100); await shot('12-import-preview'); await dlg().getByRole('button', { name: '导入', exact: true }).click(); await p.waitForTimeout(200);
const imported = await p.locator('.m13-agent-row b').allInnerTexts();
await p.getByRole('button', { name: '导入', exact: true }).click(); await dlg().locator('.m13-radio').filter({ hasText: '含加密的 Key' }).click(); await dlg().locator('input[type=password]').fill('wrong-pass'); await dlg().getByRole('button', { name: '导入', exact: true }).click(); await p.waitForTimeout(100);
const wrongPass = await dlg().getByText('口令不正确').count(); await dlg().getByRole('button', { name: '取消' }).click();
await hash('settings/ai/providers'); const needKey = await p.locator('.m13-agent-row').filter({ hasText: '需要填写 Key' }).count();
ok('第 6 项 导出口令校验、导入不覆盖同名、未带 Key 标出、口令错误不导入', shortErr === 1 && imported.some(t => t.includes('Codex · DeepSeek（导入）')) && wrongPass === 1 && needKey === 2, { shortErr, wrongPass, needKey });
// P11：Provider 刷新模型、测试结果保留
await p.locator('.m13-agent-row').filter({ has: p.locator('b', { hasText: /^DeepSeek/ }) }).first().click(); await dlg().getByRole('button', { name: '刷新模型' }).click(); await p.waitForTimeout(900);
await dlg().locator('[data-model="deepseek-v4-lite"] .m13-cell[data-tool=codex]').getByRole('button', { name: '测试' }).click(); await p.waitForTimeout(900); await dlg().getByRole('button', { name: '完成' }).click();
await p.locator('.m13-agent-row').filter({ has: p.locator('b', { hasText: /^DeepSeek/ }) }).first().click(); const liteState = await dlg().locator('[data-model="deepseek-v4-lite"] .m13-cell[data-tool=codex] .m13-pill').innerText(); await dlg().getByRole('button', { name: '完成' }).click();
ok('P11 刷新模型新增、测试结果关闭后仍保留', liteState === '可用', liteState);
// P11：自定义接入仅部分协议通过
await p.getByRole('button', { name: '添加供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: '自定义供应商' }).click();
await dlg().getByLabel('名称').fill('Acme 服务'); await dlg().getByLabel('服务地址').fill('https://api.acme.example/v1'); await dlg().locator('details.m13-adv summary').click(); await dlg().locator('details.m13-adv .m13-field').filter({ hasText: 'Anthropic' }).locator('input').fill('https://api.acme.example/anthropic');
await dlg().getByLabel('API 密钥').fill('sk-acme-1234'); await dlg().locator('.m13-form-grid select').selectOption('partial'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 });
await shot('13-custom-partial'); const genOpts = await dlg().locator('.done-models .m13-th-tool').allInnerTexts(); await dlg().getByRole('button', { name: '完成' }).click();
ok('P11 只保留确认通过的协议：完成页模型表只有 Codex 列（P0.15）', genOpts.length === 1 && genOpts[0].includes('Codex'), genOpts);
// P11（P0.15）：编辑智能体时在模型勾选列表里测试未测试的模型；工具路径从新建弹窗“本机检测”进入并校验
await hash('settings/ai'); await p.getByRole('button', { name: 'Codex · DeepSeek 更多操作' }).click(); await p.getByRole('menuitem', { name: '编辑' }).click(); await p.waitForTimeout(150);
await dlg().locator('.m13-model-check[data-model="deepseek-v4-flash"]').getByRole('button', { name: '测试' }).click(); await p.waitForTimeout(900);
const testText = await dlg().locator('.m13-model-check[data-model="deepseek-v4-flash"]').innerText(); await dlg().getByRole('button', { name: '取消' }).click();
await p.getByRole('button', { name: '新建智能体' }).click(); await dlg().locator('.m13-ts-item[data-tool=codex]').getByRole('button', { name: '自定义路径…' }).click();
await dlg().locator('input').fill('/opt/missing/codex'); await dlg().getByRole('button', { name: '检测并保存' }).click(); await p.waitForTimeout(100); const pathErr = await dlg().getByText('找不到该文件').count();
await dlg().locator('input').fill('/opt/homebrew/bin/codex'); await dlg().getByRole('button', { name: '检测并保存' }).click(); await p.waitForTimeout(200);
await dlg().locator('.m13-ts-item[data-tool=codex]').getByRole('button', { name: '自定义路径…' }).click(); const newPath = await dlg().locator('input').inputValue(); await dlg().getByRole('button', { name: '取消' }).click(); await dlg().getByRole('button', { name: '取消' }).click();
ok('P11 编辑智能体可测试未测试的模型；工具路径校验并保存', testText.includes('可用') && !testText.includes('未测试') && pathErr === 1 && newPath === '/opt/homebrew/bin/codex', { testText, pathErr, newPath });
R.errors = errors; console.log(JSON.stringify(R, null, 1)); await b.close();
