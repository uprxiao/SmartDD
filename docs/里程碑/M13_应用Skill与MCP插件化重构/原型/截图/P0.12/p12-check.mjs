// 原型 P0.12 浏览器走查：智能体自动生成、订阅/API 检测、模型 × 工具可用性、官方图标（用户 2026-11-11 确认）。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const failedImgs = []; p.on('requestfailed', r => failedImgs.push(r.url())); p.on('response', r => { if (r.url().includes('m13-agent-icons') && r.status() >= 400) failedImgs.push(r.url() + ' ' + r.status()); });
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(350); };
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const dlg = () => p.locator('.m13-dialog');
const rowsOf = tool => p.locator(`.m13-tool-group[data-tool=${tool}] .m13-agent-item .m13-cap-main b`).evaluateAll(es => es.map(e => e.firstChild.textContent.trim()));
const agent = id => p.locator(`.m13-agent-item[data-agent="${id}"]`);
const agentByName = n => p.locator('.m13-agent-item').filter({ has: p.locator('.m13-cap-main b', { hasText: n }) });
const toast = async () => { const t = p.locator('.m13-toast'); await t.waitFor({ timeout: 2500 }).catch(() => {}); return t.innerText().catch(() => ''); };
const scene = async v => { await p.locator('.m13-scene-line select').selectOption(v); await p.waitForTimeout(300); };
const menuItem = async (label, item) => { await p.getByRole('button', { name: label }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: item }).click(); await p.waitForTimeout(250); };
const homeList = async () => { await hash('home'); await p.getByRole('button', { name: '选择智能体' }).click(); const l = await p.locator('.profile-choice-menu [role=menuitem] span').allInnerTexts(); await p.keyboard.press('Escape'); await p.getByRole('button', { name: '选择智能体' }).click().catch(() => {}); return l; };

await p.goto('http://127.0.0.1:4176/?preview=m13#settings/ai/configs'); await p.waitForTimeout(900);
// 1 列表：按工具分组
const tabs = (await p.locator('.m10-tabs [role=tab]').allInnerTexts()).map(x => x.replace(/\s+/g, ''));
const heads = await p.locator('.m13-tool-head').allInnerTexts();
const cc = await rowsOf('claude'), cx = await rowsOf('codex');
const hint = await p.locator('.m13-tool-group[data-tool=codex] .m13-tool-hint').innerText().catch(() => '');
const mpOff = await agent('rc-cc-mp').getByRole('switch').getAttribute('aria-checked');
const defDisabled = await agent('rc-cc-login').getByRole('switch').isDisabled();
await shot('01-agents');
ok('页签只有智能体/供应商；按工具分组，分组标题显示版本与登录状态；订阅排第一并为默认；Codex 未登录显示登录提示', tabs.join('|') === '智能体6|供应商2' && heads[0].includes('Claude Code') && heads[0].includes('v2.1.322') && heads[0].includes('已登录订阅') && heads[1].includes('未登录') && cc.join('|') === 'Claude Code · 订阅|Claude Code · DeepSeek|Claude Code · Magpie' && cx.join('|') === 'Codex · DeepSeek|Codex · Magpie' && hint.includes('点“重新检测”即可添加订阅或 API 智能体') && mpOff === 'false' && defDisabled, { tabs, heads, cc, cx, hint, mpOff, defDisabled });
const icons = await p.locator('.m13-tool-head .m13-icon image, .m13-agent-item .m13-icon image').evaluateAll(es => [...new Set(es.map(e => e.getAttribute('href')))]);
ok('使用官方图标：Claude、Codex(OpenAI 标志)、DeepSeek、Magpie', ['claude.png', 'openai-white.svg', 'deepseek.png', 'magpie.png'].every(f => icons.some(i => i.endsWith(f))), icons);
// 2 首页只列显示的
let home = await homeList();
ok('首页智能体选择只列“首页显示”打开的（Claude Code · Magpie 不在）', home.join('|') === 'Claude Code · 订阅|Claude Code · DeepSeek|Codex · DeepSeek|Codex · Magpie|CC-rj', home);
await hash('settings/ai/configs');
await agent('rc-cc-mp').getByRole('switch').click(); const t2 = await toast(); home = await homeList();
ok('打开首页显示后首页出现', t2.includes('会在首页显示') && home.includes('Claude Code · Magpie'), { t2, home });
await hash('settings/ai/configs');
await menuItem('Codex · DeepSeek 更多操作', '设为默认'); const t3 = await toast();
const newDef = await agent('rc-codex-ds').locator('.m13-pill.ok').count(), oldDef = await agent('rc-cc-login').locator('.m13-pill.ok').count();
ok('设为默认：默认只有一个，默认的首页开关不可关', t3.includes('已设为默认') && newDef === 1 && oldDef === 0 && await agent('rc-codex-ds').getByRole('switch').isDisabled(), { t3 });
await menuItem('Claude Code · 订阅 更多操作', '设为默认'); await p.waitForTimeout(200);
const loginMenu = await (async () => { await p.getByRole('button', { name: 'Claude Code · 订阅 更多操作' }).click(); const l = await p.locator('.m10-menu [role=menuitem]').allInnerTexts(); await p.keyboard.press('Escape'); await p.mouse.click(5, 5); return l; })();
ok('订阅智能体不能删除，也没有“复制并改模型”', !loginMenu.includes('删除') && !loginMenu.includes('复制并改模型'), loginMenu);
// 3 供应商页签
await p.getByRole('tab', { name: /供应商/ }).click(); await p.waitForTimeout(250);
const fit = await p.locator('[data-provider=deepseek] .m13-fit').innerText(); await shot('02-providers');
ok('供应商列表显示“适用”工具', fit.replace(/\s+/g, '').includes('适用ClaudeCodeCodex'), fit);
// 4 供应商详情：模型 × 工具
await p.locator('[data-provider=deepseek]').click(); await p.waitForTimeout(300);
const th = (await dlg().locator('.m13-table.matrix .m13-th').innerText()).replace(/\s+/g, '');
const cell = (m, t) => dlg().locator(`[data-model="${m}"] .m13-cell[data-tool=${t}]`);
const flashCodex = await cell('deepseek-v4-flash', 'codex').getAttribute('data-avail'), flashCC = await cell('deepseek-v4-flash', 'claude').getAttribute('data-avail'), legacy = await cell('deepseek-legacy-chat', 'codex').getAttribute('data-avail');
const stars = await dlg().locator('[data-model="deepseek-v4-pro"] .m13-star').count();
const gen = await dlg().locator('.m13-gen-list').innerText();
await shot('03-provider-deepseek');
ok('详情有模型 × 工具可用性表；按工具分别记录；★ 标默认模型；列出由它生成的智能体', th.includes('ClaudeCode') && th.includes('Codex') && flashCodex === 'untested' && flashCC === 'ok' && legacy === 'bad' && stars === 2 && gen.includes('Claude Code · DeepSeek') && gen.includes('Codex · DeepSeek'), { th, flashCodex, flashCC, legacy, stars, gen });
await cell('deepseek-v4-flash', 'codex').getByRole('button', { name: '测试' }).click(); await p.waitForTimeout(900);
const after = await cell('deepseek-v4-flash', 'codex').getAttribute('data-avail'); await cell('deepseek-legacy-chat', 'claude').getByRole('button', { name: '重测' }).click(); await p.waitForTimeout(900);
ok('单个测试：未测试→可用；原来不可用的重测仍不可用', after === 'ok' && await cell('deepseek-legacy-chat', 'claude').getAttribute('data-avail') === 'bad', { after });
await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
await p.locator('[data-provider=magpie]').click(); await p.waitForTimeout(300);
const mgBad = await dlg().locator('[data-model="claude-sonnet-5-5"] .m13-cell[data-tool=codex]').getAttribute('data-avail'); await shot('04-provider-magpie');
await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
// 5 编辑智能体：下拉只列可用/未测试
await hash('settings/ai/configs'); await menuItem('Codex · Magpie 更多操作', '编辑');
const opts = await dlg().getByLabel('默认模型').locator('option').allInnerTexts(); const hid = await dlg().locator('.m13-field small.m13-hint').first().innerText().catch(() => '');
await shot('05-edit-codex-magpie');
ok('编辑：默认模型只列这个工具可用或未测试的，推荐标出；不可用的隐藏并说明', mgBad === 'bad' && opts.length === 1 && opts[0].includes('gpt-5.5') && opts[0].includes('可用') && opts[0].includes('推荐') && hid.includes('1 个模型在 Codex 中不可用'), { mgBad, opts, hid });
await dlg().getByRole('button', { name: '取消' }).click(); await p.waitForTimeout(200);
await menuItem('Claude Code · DeepSeek 更多操作', '编辑'); await dlg().locator('summary').click(); await p.waitForTimeout(150);
const tierHint = await dlg().locator('.m13-adv .m13-hint').first().innerText(); await shot('06-edit-cc-ds-advanced');
ok('Claude Code 高级设置一行说明各档位默认使用默认模型', tierHint.includes('各档位默认使用默认模型'), tierHint);
await dlg().getByRole('button', { name: '取消' }).click(); await p.waitForTimeout(200);
// 复制并改模型
await menuItem('Codex · DeepSeek 更多操作', '复制并改模型'); await dlg().getByLabel('默认模型').selectOption('deepseek-v4-flash'); await dlg().locator('input').first().fill('Codex · DeepSeek Flash'); await dlg().getByRole('button', { name: '创建' }).click(); const t5 = await toast();
const cx2 = await rowsOf('codex');
ok('复制并改模型：生成同工具同供应商的另一个智能体', t5.includes('已创建') && cx2.includes('Codex · DeepSeek Flash'), { t5, cx2 });
// 6 接入 GLM：只生成 Claude Code
await p.getByRole('button', { name: '接入供应商' }).first().click(); await p.waitForTimeout(250);
const groups = await dlg().locator('.m13-cat-group h3').allInnerTexts(); const vend = await dlg().locator('.m13-cat-group').first().locator('.m13-cat-item b').allInnerTexts();
const steps = await dlg().locator('.m13-steps li').allInnerTexts(); await shot('07-catalog');
ok('接入目录：三步；没有订阅组；有 Anthropic、OpenAI 官方', steps.length === 3 && !groups.some(g => g.includes('订阅') || g.includes('原有登录')) && vend.slice(0, 2).join('|') === 'Anthropic|OpenAI', { groups, vend, steps });
await dlg().locator('.m13-cat-item').filter({ hasText: 'GLM' }).click(); await dlg().getByLabel('智谱 API Key').fill('decoy-key-0000'); await dlg().getByRole('button', { name: '获取模型' }).click(); await p.waitForTimeout(200);
const fetched = await dlg().locator('.m13-fetched h3').innerText(); await shot('08-form-fetched');
await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 });
const done = await dlg().locator('.m13-done').innerText(); await shot('09-done-glm');
ok('接入 GLM：获取模型后接入，只生成 Claude Code · GLM（推荐模型已测可用），Codex 说明原因未生成', fetched.includes('已获取 2 个模型') && done.includes('已生成 1 个智能体') && done.includes('Claude Code · GLM') && done.includes('默认模型 GLM-5') && done.includes('Codex：Codex 需要 OpenAI Responses 兼容接口，未生成'), { fetched, done });
await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
// 接入 OpenAI 官方
await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: 'OpenAI' }).click(); await dlg().getByLabel('OpenAI API Key').fill('decoy-key-1111'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 });
const doneO = await dlg().locator('.m13-done').innerText(); await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
ok('接入 OpenAI 官方：生成 Codex · OpenAI', doneO.includes('Codex · OpenAI') && !doneO.includes('Claude Code · OpenAI'), doneO);
// 自定义：推荐模型测试失败
await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: '自定义供应商' }).click();
await dlg().getByLabel('名称').fill('Acme'); await dlg().getByLabel('服务地址').fill('https://acme.example.test/v1'); await dlg().locator('details summary').click(); await dlg().locator('.m13-adv input').nth(0).fill('https://acme.example.test/anthropic');
await dlg().getByLabel('API 密钥').fill('decoy-key-2222'); await dlg().getByLabel('演示结果').selectOption('model-fail'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 });
const doneA = await dlg().locator('.m13-done').innerText(); await shot('10-done-model-fail'); await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
ok('推荐模型测试失败：改用下一个候选并标未测试', doneA.includes('测试失败，已改用 acme-coder-small（未测试）') && doneA.includes('Codex · Acme'), doneA);
// 7 订阅/API 检测
await scene('login-api'); const t7 = await toast(); const cc7 = await rowsOf('claude'); const h7 = await p.locator('.m13-tool-group[data-tool=claude] .m13-tool-head').innerText(); await shot('11-login-api');
ok('CLI 改用 API Key 登录：改名为“Claude Code · API”，不生成第二个', t7.includes('已改名为“Claude Code · API”') && cc7[0] === 'Claude Code · API' && cc7.filter(x => x.startsWith('Claude Code · 订阅')).length === 0 && h7.includes('已登录（API Key）'), { t7, cc7, h7 });
await scene('claude-logout'); const t8 = await toast(); const lo = await p.locator('.m13-agent-item').filter({ hasText: '已退出登录' }).count(); await shot('12-claude-logout');
const sw8 = await p.locator('.m13-agent-item').filter({ hasText: '已退出登录' }).getByRole('switch').isDisabled(); home = await homeList();
ok('退出登录：保留并标“已退出登录”，不在首页显示，默认交给下一个', t8.includes('已退出登录') && t8.includes('默认改为') && lo === 1 && sw8 && !home.includes('Claude Code · API'), { t8, home });
await hash('settings/ai/configs'); await scene('normal'); const t9 = await toast();
ok('重新登录（订阅）：恢复并改回订阅', t9.includes('已重新登录') && (await rowsOf('claude'))[0] === 'Claude Code · 订阅', t9);
await scene('codex-login'); const t10 = await toast(); const cx10 = await rowsOf('codex'); await shot('13-codex-login');
ok('Codex 登录订阅后自动添加“Codex · 订阅”，排第一', t10.includes('已添加“Codex · 订阅”') && cx10[0] === 'Codex · 订阅', { t10, cx10 });
// 8 新检测到工具
await scene('codex-missing'); const t11 = await toast(); const dim = await p.locator('.m13-tool-group[data-tool=codex] .m13-agent-item.dim').count(); await shot('14-codex-missing'); home = await homeList();
ok('没有检测到 Codex：Codex 智能体变灰、不在首页', t11.includes('没有检测到 Codex') && dim >= 3 && !home.some(x => x.startsWith('Codex')), { t11, dim, home });
await hash('settings/ai/configs'); await menuItem('Codex · Magpie 更多操作', '删除'); await p.waitForTimeout(200);
await scene('normal'); const t12 = await toast(); const re = await agentByName('Codex · Magpie').getByRole('switch').getAttribute('aria-checked');
ok('重新检测到 Codex：为缺少的供应商补生成 Codex 智能体，默认不在首页显示', t12.includes('检测到 Codex：已为 1 个供应商补上 Codex 智能体，默认不在首页显示') && re === 'false', { t12, re });
// 9 删除供应商
await p.getByRole('tab', { name: /供应商/ }).click(); await p.locator('[data-provider=deepseek]').click(); await dlg().getByRole('button', { name: '删除' }).click(); await p.waitForTimeout(200);
const conf = await dlg().innerText(); await shot('15-delete-provider');
await dlg().getByRole('button', { name: '删除' }).click(); const t13 = await toast(); await hash('settings/ai/configs');
ok('删除供应商：先列出将一起删除的智能体，删除后这些智能体消失', conf.includes('会一起删除') && conf.includes('Claude Code · DeepSeek') && conf.includes('Codex · DeepSeek') && t13.includes('已删除 DeepSeek') && !(await rowsOf('claude')).includes('Claude Code · DeepSeek'), { conf, t13 });
// 9b 只有 OpenAI 兼容：可保存但不生成；Magpie 未运行时接入报错；Anthropic 官方只生成 Claude Code
await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: 'UltraCloud' }).click(); await dlg().locator('input[type=password]').fill('decoy-key-3333'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 });
const doneU = await dlg().locator('.m13-done').innerText(); await shot('15b-done-ultracloud'); await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
await p.getByRole('tab', { name: /供应商/ }).click(); const ucFit = await p.locator('.m13-agent-row').filter({ hasText: 'UltraCloud' }).locator('.m13-toolchip.off').count(); await hash('settings/ai/configs');
ok('只有 OpenAI 兼容的供应商：可保存、不生成智能体，列表两个工具都标“—”', doneU.includes('没有生成智能体') && ucFit === 2, { doneU: doneU.slice(0, 160), ucFit });
await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: 'Anthropic' }).click(); await dlg().getByLabel('Anthropic API Key').fill('decoy-key-4444'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 });
const doneAn = await dlg().locator('.m13-done').innerText(); await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(200);
ok('接入 Anthropic 官方：只生成 Claude Code · Anthropic，默认 Claude Sonnet 5.5', doneAn.includes('Claude Code · Anthropic') && doneAn.includes('默认模型 Claude Sonnet 5.5') && doneAn.includes('Codex：'), doneAn.slice(0, 200));
await scene('magpie-down'); await p.getByRole('tab', { name: /供应商/ }).click(); await p.locator('[data-provider=magpie]').click(); await dlg().getByRole('button', { name: '删除' }).click(); await dlg().getByRole('button', { name: '删除' }).click(); await p.waitForTimeout(200);
await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: 'Magpie' }).click(); await dlg().getByRole('button', { name: '获取模型' }).click(); await p.waitForTimeout(150);
const mgErr = await dlg().locator('.m13-alert.danger').innerText().catch(() => ''); await dlg().getByRole('button', { name: '取消' }).click(); await scene('normal'); await hash('settings/ai/configs');
ok('Magpie 未运行：接入时获取模型报错，不生成', mgErr.includes('Magpie 未运行'), mgErr);
await p.setViewportSize({ width: 760, height: 900 }); await p.waitForTimeout(200); const ovf = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1); await shot('15c-narrow'); await p.setViewportSize({ width: 1512, height: 949 });
ok('窄窗口 760px 无横向滚动', !ovf, { ovf });
// 10 深色
await p.goto('about:blank'); await p.goto('http://127.0.0.1:4176/?preview=m13#settings/ai/configs'); await p.waitForTimeout(800); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(200); await shot('16-agents-dark');
await p.getByRole('tab', { name: /供应商/ }).click(); await p.locator('[data-provider=deepseek]').click(); await p.waitForTimeout(300); await shot('17-provider-dark');
ok('图标资源全部加载成功', failedImgs.length === 0, failedImgs);
console.log(JSON.stringify({ results: R, errors }, null, 1));
await b.close();
