// 原型 P0.15 浏览器走查：智能体（用户 2026-11-11 多轮确认后的整体版本）——平铺可排序、默认固定第一、首页开关；
// 新建三步联动、模型多选、同一 Code Agent＋供应商不重复、名称不重复、无运行说明与高级设置；添加供应商完成页只列模型并在右下角“创建智能体”；
// 供应商详情两个页签；暂不支持的 Code Agent 用官方图标；常规中没有 AI 配置。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const URL0 = 'http://127.0.0.1:4176/?preview=m13#settings/ai/configs';
const fresh = async () => { await p.goto('about:blank'); await p.goto(URL0); await p.waitForTimeout(800); };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(350); };
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const dlg = () => p.locator('.m13-dialog');
const names = () => p.locator('.m13-agent-item .m13-cap-main b').evaluateAll(es => es.map(e => e.firstChild.textContent.trim()));
const toast = async () => { const t = p.locator('.m13-toast'); await t.waitFor({ timeout: 2500 }).catch(() => {}); return t.innerText().catch(() => ''); };
const menuOf = async label => { await p.getByRole('button', { name: label }).click(); const l = await p.locator('.m10-menu [role=menuitem]').allInnerTexts(); await p.mouse.click(5, 5); await p.waitForTimeout(100); return l; };
const menuItem = async (label, item) => { await p.getByRole('button', { name: label }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: item }).click(); await p.waitForTimeout(250); };
const homeList = async () => { await hash('home'); await p.getByRole('button', { name: '选择智能体' }).click(); const l = await p.locator('.profile-choice-menu .agent-choice > span:not([data-agent-icon]):not(.m13-agent-icon)').allInnerTexts().then(a => a); await p.keyboard.press('Escape'); await p.getByRole('button', { name: '选择智能体' }).click().catch(() => {}); await hash('settings/ai/configs'); return l; };
const checked = () => dlg().locator('.m13-model-check input:checked').evaluateAll(es => es.map(e => e.closest('.m13-model-check').dataset.model));

await fresh();
const n0 = await names(); const m0 = await menuOf('Claude Code · DeepSeek 更多操作'); let home = await homeList(); await shot('01-agents');
ok('列表平铺、和首页下拉同顺序（隐藏的不出现）；菜单没有“复制”', n0.join('|') === 'Claude Code · 订阅|Claude Code · DeepSeek|Codex · DeepSeek|Codex · Magpie|CC-rj' && home.join('|') === 'Claude Code · 订阅|Claude Code · DeepSeek|Codex · DeepSeek|CC-rj' && !m0.includes('复制') && m0.includes('编辑'), { n0, home, m0 });
const hid = await menuOf('Codex · Magpie 更多操作'); await menuItem('Codex · DeepSeek 更多操作', '设为默认'); const n1 = await names(); const dm = await menuOf('Codex · DeepSeek 更多操作');
await p.locator('[data-agent=rc-legacy-rj]').dragTo(p.locator('[data-agent=rc-codex-ds]')); await p.waitForTimeout(300); const n2 = await names(); home = await homeList(); await shot('02-default-first');
ok('默认规则：隐藏的不能设为默认；设为默认即排第一且不能移动；拖到它上方时放在它后面；首页同步', !hid.includes('设为默认') && n1[0] === 'Codex · DeepSeek' && !dm.includes('上移') && n2[0] === 'Codex · DeepSeek' && n2[1] === 'CC-rj' && home[0] === 'Codex · DeepSeek' && home[1] === 'CC-rj', { hid, n1, dm, n2, home });
// 新建：Claude Code
await fresh(); await p.getByRole('button', { name: '新建智能体' }).click(); await p.waitForTimeout(250);
const exist = await dlg().locator('[data-existing]').evaluateAll(es => es.map(e => e.dataset.existing)); const sel = await dlg().locator('.m13-prov-opt.selected b').innerText();
const icons = await dlg().locator('.m13-agent-card').evaluateAll(es => es.map(e => e.querySelector('image')?.getAttribute('href') || 'letter'));
const ck = await checked(); const nm = await dlg().getByLabel('名称').inputValue(); const extras = [await dlg().locator('.m13-notes').count(), await dlg().locator('.m13-adv').count()]; await shot('03-new-claude');
ok('新建 Claude Code：订阅、DeepSeek 已有智能体，显示“已有…编辑它”不可选；默认选 Magpie，推荐模型已勾选，名称自动；没有运行说明与高级设置；暂不支持的用官方图标', exist.join() === 'rc-cc-login,rc-cc-ds' && sel.startsWith('Magpie') && ck.join() === 'claude-sonnet-5-5' && nm === 'Claude Code · Magpie' && extras.join() === '0,0' && ['opencode.png', 'zcode.png', 'pi.svg', 'dsh.png'].every(f => icons.some(i => i.endsWith(f))), { exist, sel, ck, nm, extras, icons });
await dlg().getByLabel('名称').fill('Codex · DeepSeek'); await p.waitForTimeout(100); const dupMsg = await dlg().locator('.m13-err').innerText().catch(() => ''); const dis = await dlg().getByRole('button', { name: '创建' }).isDisabled(); await shot('04-dup-name');
ok('名称不能重复：提示并禁止创建', dupMsg.includes('已被“Codex · DeepSeek”使用') && dis, { dupMsg, dis });
await dlg().locator('[data-existing=rc-cc-ds]').getByRole('button', { name: '编辑它' }).click(); await p.waitForTimeout(250);
const t5 = (await dlg().locator('h2').innerText()) + '|' + (await dlg().locator('.m13-dialog-head p').innerText()); const ck5 = await checked(); await shot('05-edit-existing');
ok('点“编辑它”打开已有的 Claude Code · DeepSeek，可勾选更多模型', t5.startsWith('编辑智能体|Claude Code · DeepSeek') && ck5.join() === 'deepseek-v4-pro,deepseek-v4-flash', { t5, ck5 });
await dlg().getByRole('button', { name: '取消' }).click(); await p.waitForTimeout(150);
await p.getByRole('button', { name: '新建智能体' }).click(); await dlg().locator('.m13-model-check[data-model="gpt-5.5"] input').check(); await dlg().getByRole('button', { name: '创建' }).click(); const t6 = await toast(); const n6 = await names();
await p.getByRole('button', { name: '新建智能体' }).click(); await p.waitForTimeout(200); const exist7 = await dlg().locator('[data-existing]').evaluateAll(es => es.map(e => e.closest('[data-existing]').innerText.split('\n')[0]));
const msg7 = await dlg().locator('[data-step="3"] p.m13-plain').first().innerText().catch(() => ''); await shot('06-claude-all-taken');
ok('创建 Claude Code · Magpie（两个模型）后，再新建时 Magpie 也变成“已有”，第 3 步提示编辑已有的或添加供应商', t6.includes('已创建') && n6.at(-1) === 'Claude Code · Magpie' && exist7.length === 3 && msg7.includes('都已经有智能体'), { t6, n6, exist7, msg7 });
await dlg().locator('.m13-agent-card').filter({ hasText: 'Codex' }).click(); await p.waitForTimeout(150); const cx = await dlg().locator('.m13-prov-list').innerText(); const cdis = await dlg().getByRole('button', { name: '创建' }).isDisabled(); await shot('07-codex');
ok('Codex：订阅未登录置灰、DeepSeek 与 Magpie 已有，不能创建', cx.includes('未登录') && (cx.match(/同一组合只能有一个/g) || []).length === 2 && cdis, { cx: cx.replace(/\n/g, ' / '), cdis });
await dlg().getByRole('button', { name: '取消' }).click();
// 添加供应商完成页
await p.getByRole('tab', { name: /供应商/ }).click(); await p.getByRole('button', { name: '添加供应商' }).first().click(); await dlg().locator('.m13-cat-item').filter({ hasText: 'OpenAI' }).click();
await dlg().getByLabel('OpenAI API Key').fill('decoy-key-1111'); await dlg().getByRole('button', { name: '获取模型' }).click(); await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 4000 });
const foot = await dlg().locator('.m13-dialog-foot button').allInnerTexts(); const rows = await dlg().locator('.done-models [data-model]').count(); const old = [await dlg().locator('[data-new-agent]').count(), await dlg().getByText('推荐模型测试').count()]; await shot('08-provider-done');
ok('完成页只列模型；右下角“创建智能体”在“完成”左边；没有“查看供应商”、没有中间的新建卡片', foot.join('|') === '创建智能体|完成' && rows === 2 && old.join() === '0,0', { foot, rows, old });
await dlg().getByRole('button', { name: '创建智能体' }).click(); await p.waitForTimeout(300); const pt = await dlg().locator('.m13-agent-card.selected b').innerText(); const pp = await dlg().locator('.m13-prov-opt.selected b').innerText(); await shot('09-create-from-done');
ok('“创建智能体”打开新建并预选 Codex 与 OpenAI', pt === 'Codex' && pp.startsWith('OpenAI'), { pt, pp });
await dlg().getByRole('button', { name: '取消' }).click();
// 供应商详情
await hash('settings/ai/providers'); await p.locator('[data-provider=deepseek]').click(); await p.waitForTimeout(200); await dlg().locator('.m13-ptabs [role=tab]').filter({ hasText: '智能体' }).click(); await p.waitForTimeout(150);
const at = await dlg().innerText(); const nb = await dlg().locator('.m13-regen').count(); await shot('10-provider-agents');
ok('供应商详情“智能体”页签：两个 Code Agent 都已有时不再给新建按钮，提示去编辑', nb === 0 && at.includes('都已经有智能体'), { nb });
await dlg().getByRole('button', { name: '完成' }).click();
await hash('settings/general'); const hasAI = await p.getByText('默认 AI 配置').count(); await hash('settings/ai/configs');
ok('设置 › 常规不再有“AI 配置”', hasAI === 0, hasAI);
await p.getByRole('button', { name: '新建智能体' }).click(); await p.waitForTimeout(200);
const ts = await dlg().locator('.m13-tool-status').innerText();
await p.locator('.m13-scene-line select').selectOption('codex-unverified').catch(() => {});
await dlg().getByRole('button', { name: '取消' }).click(); await p.locator('.m13-scene-line select').selectOption('codex-unverified'); await p.getByRole('button', { name: '新建智能体' }).click(); await p.waitForTimeout(200);
const tsU = await dlg().locator('.m13-ts-item[data-tool=codex]').innerText(); await dlg().getByRole('button', { name: '取消' }).click();
await p.locator('.m13-scene-line select').selectOption('codex-missing'); await p.waitForTimeout(300); await p.getByRole('button', { name: '新建智能体' }).click(); await p.waitForTimeout(200);
const tsM = await dlg().locator('.m13-ts-item[data-tool=codex]').innerText(); const cxDis = await dlg().locator('.m13-agent-card').filter({ hasText: 'Codex' }).isDisabled(); await shot('10b-tool-missing');
await dlg().locator('.m13-ts-item[data-tool=codex]').getByRole('button', { name: '自定义路径…' }).click(); await p.waitForTimeout(150); await dlg().locator('input').fill('/opt/missing/codex'); await dlg().getByRole('button', { name: '检测并保存' }).click(); await p.waitForTimeout(100); const pErr = await dlg().getByText('找不到该文件').count();
await dlg().locator('input').fill('/opt/homebrew/bin/codex'); await dlg().getByRole('button', { name: '检测并保存' }).click(); await p.waitForTimeout(300);
const back = await dlg().locator('h2').innerText(); const cxOk = !(await dlg().locator('.m13-agent-card').filter({ hasText: 'Codex' }).isDisabled());
ok('本机检测（需求 5.1）：新建第 1 步下显示各工具检测项与“重新检测”“自定义路径”；未验证版本提示；未检测到时卡片置灰，自定义路径校验后可用并回到新建', ts.includes('检测到程序') && ts.includes('程序可启动') && ts.includes('版本已验证') && ts.includes('重新检测') && tsU.includes('未验证版本 0.167.0') && tsM.includes('未检测到') && cxDis && pErr === 1 && back === '新建智能体' && cxOk, { ts, tsU, tsM, cxDis, pErr, back, cxOk });
await dlg().getByRole('button', { name: '取消' }).click(); await p.locator('.m13-scene-line select').selectOption('normal'); await p.waitForTimeout(300);
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(200); await shot('11-agents-dark'); await p.getByRole('button', { name: '新建智能体' }).click(); await p.waitForTimeout(200); await shot('12-new-dark');
console.log(JSON.stringify({ results: R, errors }, null, 1)); await b.close();
