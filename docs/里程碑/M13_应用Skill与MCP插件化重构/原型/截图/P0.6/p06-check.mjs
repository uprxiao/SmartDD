// 原型 P0.6 浏览器走查：Code Agent 配置（需求 2026-11-11 补记）。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(350); };
const dlg = () => p.locator('.m13-dialog'); const ad = () => p.locator('.m13-agent-dialog'); const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const toast = async () => (await p.locator('.m13-toast').innerText().catch(() => ''));
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/ai'); await p.waitForTimeout(700);
// 命名
const h1 = await p.locator('.m10-page-head h1').innerText(); const tabs = await p.locator('.m10-tabs button').allInnerTexts(); const nav = await p.locator('.m10-sidebar .m10-nav').nth(2).innerText();
await hash('home'); const pickerBtn = await p.getByRole('button', { name: '选择 Code Agent' }).count(); await p.getByRole('button', { name: '选择 Code Agent' }).click(); const pickerHead = await p.locator('.profile-choice-menu > span').first().innerText(); await p.keyboard.press('Escape');
ok('命名：Code Agent 配置／三个页签／侧栏／首页选择器', h1 === 'Code Agent 配置' && tabs.map(t => t.replace(/\s*\d+$/, '')).join('|') === 'Code Agent|供应商|本机工具' && nav.includes('Code Agent') && pickerBtn === 1 && pickerHead === 'Code Agent', { h1, tabs, nav, pickerHead });
// 目录
await hash('m13/ai/providers'); await p.getByRole('button', { name: '接入供应商' }).first().click(); await p.waitForTimeout(150);
const groups = await dlg().locator('.m13-cat-group h3').allInnerTexts(); const items = await dlg().locator('.m13-cat-item b').allInnerTexts();
const disabled = await dlg().locator('.m13-cat-item:disabled b').allInnerTexts(); const unverified = await dlg().locator('.m13-cat-item').filter({ has: p.locator('.m13-unverified') }).locator('b').allInnerTexts();
await dlg().getByLabel('查找供应商').fill('glm'); const searched = await dlg().locator('.m13-cat-item').count(); await dlg().getByLabel('查找供应商').fill(''); await shot('01-catalog');
ok('目录：原有登录／供应商／自定义三组，五家供应商，已接入不可重复，占位项标待核实，可搜索', groups.length === 3 && ['DeepSeek', 'GLM（智谱）', 'SMG', 'UltraCloud', 'Magpie'].every(n => items.some(t => t.startsWith(n))) && disabled.length === 4 && unverified.length === 3 && searched === 2, { groups, disabled, unverified, searched });
// 预设 GLM：缺 Key 报错 → 确认（Anthropic 可用、OpenAI 兼容需经网关）→ 完成页只能搭配 Claude Code → 一键生成
await dlg().locator('.m13-cat-item').filter({ hasText: 'GLM' }).click(); await p.waitForTimeout(150);
const placeholderWarn = await dlg().getByText('占位数据').count(); await dlg().getByRole('button', { name: '获取模型' }).click(); const keyErr = await dlg().getByText('请填写智谱 API Key').count();
await dlg().locator('input[type=password]').fill('glm-key-1234'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '下一步' }).click(); await p.waitForTimeout(1000);
const confirmRows = await dlg().locator('.m13-agent-row').allInnerTexts(); await shot('02-glm-confirm');
await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200); const pairs = await dlg().locator('.m13-pair-btn').allInnerTexts(); await shot('03-glm-done');
await dlg().locator('.m13-pair-btn').first().click(); await p.waitForTimeout(300); const agents = await p.locator('.m13-agent-row b').allInnerTexts();
ok('预设接入：占位提示、缺 Key 报错、按协议确认、只给可搭配的工具、一键生成 Code Agent', placeholderWarn === 1 && keyErr === 1 && confirmRows.some(t => t.includes('Anthropic') && t.includes('可用')) && confirmRows.some(t => t.includes('OpenAI 兼容') && t.includes('需经网关')) && pairs.length === 1 && pairs[0].includes('Claude Code') && agents.some(t => t.startsWith('Claude Code · GLM')), { confirmRows, pairs, last: agents.at(-1) });
// 同一组合不重复
await hash('m13/ai/providers'); await p.locator('.m13-agent-row').filter({ hasText: 'GLM' }).click(); await dlg().getByRole('button', { name: /搭配 Claude Code/ }).click(); await p.waitForTimeout(200); const dupToast = await toast();
ok('供应商详情一键搭配；已有同一组合时不重复创建', dupToast.includes('已有'), dupToast);
// UltraCloud：只有 OpenAI 兼容 → 可保存、不能搭配；列表标“需经网关”；新建时两个工具都不可用
await hash('m13/ai/providers'); await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: 'UltraCloud' }).click();
await dlg().locator('input[type=password]').fill('uc-key-1234'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '下一步' }).click(); await p.waitForTimeout(1000);
await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200); const ucNoPair = await dlg().getByText('暂时不能搭配工具').count(); await shot('04-ultracloud-done'); await dlg().getByRole('button', { name: '完成' }).click();
const gw = await p.locator('.m13-agent-row').filter({ hasText: 'UltraCloud' }).locator('.m13-toolchip.none').count();
await hash('m13/ai/configs'); await p.getByRole('button', { name: '新建 Code Agent' }).click(); await p.locator('.m13-pane-item').filter({ hasText: 'UltraCloud' }).click(); await p.waitForTimeout(150);
const bothOff = await ad().locator('.m13-seg button:disabled').count(); const saveOff = await ad().getByRole('button', { name: '保存' }).isDisabled(); await shot('05-new-agent-ultracloud');
ok('不匹配：只有 OpenAI 兼容的供应商可保存但不能搭配，列表标需经网关，新建时两个工具置灰、不能保存', ucNoPair === 1 && gw === 1 && bothOff === 2 && saveOff, { ucNoPair, gw, bothOff, saveOff });
// 两栏新建：DeepSeek → Claude Code，名称自动、档位、保存后出现在列表和首页
await p.locator('.m13-pane-item').filter({ hasText: 'DeepSeek' }).click(); await ad().locator('.m13-seg button').filter({ hasText: 'Claude Code' }).click(); await p.waitForTimeout(100);
const autoName = await ad().locator('.m13-field').filter({ hasText: '名称' }).locator('input').inputValue(); await ad().locator('summary').click(); const tiers = await ad().locator('.m13-tiers select').count();
await ad().locator('.m13-field').filter({ hasText: '名称' }).locator('input').fill('我的 DeepSeek 编码'); await ad().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(250);
const listed = await p.locator('.m13-agent-row b').allInnerTexts(); await hash('home'); await p.getByRole('button', { name: /选择 Code Agent|Claude Code/ }).first().click(); const homeItems = await p.locator('.profile-choice-menu [role=menuitem]').allInnerTexts(); await p.keyboard.press('Escape');
ok('两栏新建：选供应商与工具，名称自动生成可改，Claude 档位可调，保存后列表与首页同步', autoName === 'Claude Code · DeepSeek' && tiers === 5 && listed.some(t => t.startsWith('我的 DeepSeek 编码')) && homeItems.some(t => t.includes('我的 DeepSeek 编码')), { autoName, tiers });
// 从新建弹窗进入接入新供应商
await hash('m13/ai/configs'); await p.getByRole('button', { name: '新建 Code Agent' }).click(); await ad().getByRole('button', { name: '接入新供应商' }).click(); await p.waitForTimeout(150); const fromAgent = await dlg().getByText('接入供应商').first().count(); await dlg().getByRole('button', { name: '取消' }).click();
ok('新建弹窗左栏底部可直接接入新供应商', fromAgent === 1);
// 自定义：缺名称报错；Anthropic 地址检测为 Anthropic；完成后只搭配 Claude Code
await hash('m13/ai/providers'); await p.getByRole('button', { name: '接入供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: '自定义供应商' }).click();
await dlg().getByRole('button', { name: '获取模型' }).click(); const nameErr = await dlg().getByText('请填写名称').count();
await dlg().getByLabel('名称').fill('公司中转'); await dlg().getByRole('tab', { name: 'Anthropic' }).click(); await dlg().getByLabel('服务地址').fill('https://relay.example.test/anthropic'); await dlg().getByRole('button', { name: '检测协议' }).click(); const det = await dlg().locator('.m13-inline-actions .m13-hint').first().innerText();
await dlg().getByLabel('API 密钥').fill('rk-1234'); await dlg().getByLabel('模型 ID').fill('relay-coder'); await shot('06-custom-form'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '下一步' }).click(); await p.waitForTimeout(1000); await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200);
const cPairs = await dlg().locator('.m13-pair-btn').allInnerTexts(); await dlg().getByRole('button', { name: '完成' }).click();
ok('自定义供应商：必填校验、检测协议给出候选、按协议决定可搭配工具', nameErr === 1 && det.includes('Anthropic') && cPairs.length === 1 && cPairs[0].includes('Claude Code'), { det, cPairs });
// Magpie 未运行时测试连接失败
await p.locator('.m13-previewbar select').selectOption('magpie-down'); await hash('m13/ai/configs'); await p.getByRole('button', { name: '新建 Code Agent' }).click(); await p.locator('.m13-pane-item').filter({ has: p.locator('b', { hasText: /^Magpie$/ }) }).click(); await ad().getByRole('button', { name: '测试连接' }).click(); await p.waitForTimeout(900);
const mgErr = await ad().locator('.m13-alert.danger').innerText().catch(() => ''); await ad().getByRole('button', { name: '取消' }).click(); await p.locator('.m13-previewbar select').selectOption('normal');
ok('Magpie 未运行时测试连接给出明确失败', mgErr.includes('Magpie 未运行'), mgErr);
// 深色与窄窗
await p.getByRole('button', { name: '切换深色主题' }).click(); await hash('m13/ai/providers'); await shot('07-dark-providers'); await p.getByRole('button', { name: '切换浅色主题' }).click();
await p.setViewportSize({ width: 900, height: 820 }); await hash('m13/ai/configs'); await p.getByRole('button', { name: '新建 Code Agent' }).click(); await p.waitForTimeout(200); await shot('08-narrow-new-agent');
const overflow = await p.evaluate(() => document.querySelector('.m13-agent-dialog').scrollWidth > document.querySelector('.m13-agent-dialog').clientWidth + 1);
ok('窄窗下两栏弹窗改为上下排列，无横向溢出', !overflow);
R.errors = errors; console.log(JSON.stringify(R, null, 1)); await b.close();
