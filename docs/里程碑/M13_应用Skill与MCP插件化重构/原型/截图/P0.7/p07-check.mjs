// 原型 P0.7 浏览器走查：智能体移入设置、技能改名、旧入口移除（需求 2026-11-11 补记 2）。
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
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins'); await p.waitForTimeout(800);
// 1 自定义侧栏
const sideNav = (await p.locator('.m13-shell .m10-sidebar > .m10-nav:not(.installed)').allInnerTexts()).map(t => t.trim());
await hash('m13/capabilities'); const capH1 = await p.locator('.m10-page-head h1').innerText(); const capDesc = await p.locator('.m10-page-head p').first().innerText(); await shot('01-skills');
ok('自定义侧栏只有插件、技能；技能页标题与说明', sideNav.join('|') === '插件|技能' && capH1 === '技能' && capDesc.includes('所有项目默认可用') && !capDesc.includes('Agent'), { sideNav, capH1, capDesc });
// 2 设置导航
await hash('settings/general'); const groups = await p.locator('.settings-nav-group h3').allInnerTexts(); const items = (await p.locator('.settings-nav .nav-row').allInnerTexts()).map(t => t.trim());
ok('设置：个人组含智能体（原 AI 配置位置），无集成组、无 Skill 与 MCP', groups.join('|') === '个人|应用' && items[2] === '智能体' && !items.some(t => /Skill|AI 配置/.test(t)), { groups, items });
// 3 智能体页
await p.locator('.settings-nav .nav-row').filter({ hasText: '智能体' }).click(); await p.waitForTimeout(400);
const h1 = await p.locator('.m13-settings-embed .m10-page-head h1').innerText(); const tabs = (await p.locator('.m13-settings-embed .m10-tabs button').allInnerTexts()).map(t => t.replace(/\s*\d+$/, ''));
const crumb = await p.locator('.breadcrumbs').innerText(); const railSel = await p.locator('.rail-link[aria-current=page]').getAttribute('aria-label'); await shot('02-settings-agent');
await p.locator('.m13-settings-embed .m10-tabs button').nth(1).click(); await p.waitForTimeout(300); const h2 = await cur(); await shot('03-settings-providers');
ok('设置 › 智能体：标题、三个页签、面包屑、左栏机器人图标选中、页签路由', h1 === '智能体' && tabs.join('|') === '智能体|供应商|本机工具' && crumb.includes('智能体') && railSel === '智能体' && h2 === '#settings/ai/providers', { h1, tabs, crumb, railSel, h2 });
// 4 弹窗在设置中可用：新建智能体保存、接入供应商并一键搭配
await hash('settings/ai/configs'); const before = await p.locator('.m13-agent-row b').count();
await p.getByRole('button', { name: '新建智能体' }).first().click(); await p.waitForTimeout(200); const dlgTitle = await p.locator('.m13-agent-dialog h2').innerText(); await shot('04-new-agent');
await p.locator('.m13-agent-dialog').getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(300); const toast1 = await p.locator('.m13-toast').innerText().catch(() => ''); const after = await p.locator('.m13-agent-row b').count();
await hash('settings/ai/providers'); await p.getByRole('button', { name: '接入供应商' }).first().click(); await p.waitForTimeout(200);
await p.locator('.m13-dialog .m13-cat-item').filter({ hasText: 'GLM' }).click(); await p.waitForTimeout(150);
await p.locator('.m13-dialog input[type=password]').fill('glm-key-1234'); await p.locator('.m13-dialog').getByRole('button', { name: '获取模型' }).click(); await p.locator('.m13-dialog').getByRole('button', { name: '下一步' }).click(); await p.waitForTimeout(1000);
await p.locator('.m13-dialog').getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200); await p.locator('.m13-dialog .m13-pair-btn').first().click(); await p.waitForTimeout(400);
const afterPair = await cur(); const toast2 = await p.locator('.m13-toast').innerText().catch(() => ''); const names = await p.locator('.m13-agent-row b').allInnerTexts();
ok('设置中弹窗可用：新建智能体保存、接入 GLM 后一键搭配', dlgTitle === '新建智能体' && after === before + 1 && toast1.includes('智能体') && afterPair === '#settings/ai/configs' && toast2.includes('已生成智能体') && names.some(n => n.includes('GLM')), { dlgTitle, before, after, toast1, afterPair, toast2 });
// 5 演示场景共享
await p.locator('.m13-scene-line select').selectOption('magpie-down'); await hash('settings/ai/providers'); const down = await p.locator('.m13-agent-row').filter({ hasText: 'Magpie' }).first().innerText();
await hash('m13/plugins'); const sceneInPlugins = await p.locator('.m13-previewbar select').inputValue(); await p.locator('.m13-previewbar select').selectOption('normal');
ok('演示场景在插件页与设置 › 智能体之间共用', /未运行|无法连接|不可用/.test(down) && sceneInPlugins === 'magpie-down', { down: down.slice(0, 80), sceneInPlugins });
// 6 旧地址跳转
await hash('m13/ai/tools'); await p.waitForTimeout(200); const r1 = await cur(); await hash('settings/skills'); await p.waitForTimeout(200); const r2 = await cur(); await hash('project/ais/skills'); await p.waitForTimeout(200); const r3 = await cur();
ok('旧地址跳转：m13/ai → 设置 › 智能体；设置 Skill 与 MCP → 技能；项目 Skill 与 MCP → 项目概览', r1 === '#settings/ai/tools' && r2 === '#m13/capabilities' && r3 === '#project/ais', { r1, r2, r3 });
// 7 项目页签
const ptabs = (await p.locator('.tabbar button').allInnerTexts()).map(t => t.trim()); await shot('05-project-tabs');
ok('项目页签无 Skill 与 MCP，应用改称插件', ptabs.join('|') === '概览|代码目录|数据库|服务器|插件|项目任务', { ptabs });
// 8 左栏与首页
const rail = await p.locator('.rail-links .rail-link').evaluateAll(a => a.map(x => x.getAttribute('aria-label')));
await hash('home'); const picker = await p.getByRole('button', { name: '选择智能体' }).count(); await p.getByRole('button', { name: '选择智能体' }).click(); const head = await p.locator('.profile-choice-menu > span').first().innerText();
const manage = p.locator('.profile-choice-menu').getByText('管理智能体'); const hasManage = await manage.count(); if (hasManage) { await manage.click(); await p.waitForTimeout(300); }
const r4 = await cur();
ok('左栏无 Skill 与 MCP、机器人图标为智能体；首页“选择智能体”，管理入口进入设置 › 智能体', !rail.includes('Skill 与 MCP') && rail.includes('智能体') && picker === 1 && head === '智能体' && hasManage === 1 && r4.startsWith('#settings/ai'), { rail, head, r4 });
// 9 深色
await hash('settings/ai/configs'); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(200); await shot('06-settings-agent-dark');
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
// 非 M13 预览不受影响
await p.goto('http://127.0.0.1:4176/#settings/general'); await p.waitForTimeout(800);
const oldItems = (await p.locator('.settings-nav .nav-row').allInnerTexts()).map(t => t.trim());
ok('非 M13 预览保持原设置（AI 配置、Skill 与 MCP 仍在）', oldItems.includes('AI 配置') && oldItems.includes('Skill 与 MCP'), { oldItems });
console.log(JSON.stringify({ results: R, errors }, null, 1));
await b.close();
