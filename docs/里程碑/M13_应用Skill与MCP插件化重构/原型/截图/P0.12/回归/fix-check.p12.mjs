// P0.12 适配：智能体改为接入后自动生成（无“新建智能体”与两栏弹窗），P01 用“复制并改模型”新建；P06 删除需二次确认、接入为三步；P07 智能体绑定供应商不再改供应商，改为核对 Claude Code · Magpie 的档位都属于 Magpie（用户 2026-11-11 确认）。
// P0.11 适配：禅道在项目页“插件”分区的“外部”页签（用户 2026-11-11 决定按内置／外部分页签），进入后先点“外部”。
// P0.6 起 AI 配置改为 智能体（两栏新建、供应商目录），驱动相应调整。
// P0.5 起连接行“编辑”收进“…”菜单，驱动相应调整。
// 审核 review-20261111-0030 中原型已有部分错误（P01–P04、P06–P08）的浏览器复核；P09 由模型单测覆盖。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(350); };
const dlg = () => p.locator('.m13-dialog');
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins'); await p.waitForTimeout(700);
// P01：新建运行配置 → 回工作台 → 首页选择器有它 → 回 M13 仍在
await hash('settings/ai'); await p.getByRole('button', { name: 'Codex · DeepSeek 更多操作' }).click(); await p.getByRole('menuitem', { name: '复制并改模型' }).click();
await dlg().locator('.m13-field').filter({ hasText: '名称' }).locator('input').fill('P01 校验配置'); await dlg().getByRole('button', { name: '创建' }).click(); await p.waitForTimeout(200);
await hash('home'); await p.getByRole('button', { name: '选择智能体' }).click(); await p.waitForTimeout(150);
const homeItems = await p.locator('.profile-choice-menu [role=menuitem]').allInnerTexts();
await p.screenshot({ path: out + '/p01-home-picker.png' });
await p.keyboard.press('Escape'); await hash('settings/ai');
const back = await p.locator('.m13-agent-row b').allInnerTexts();
ok('P01 首页可选新配置', homeItems.some(t => t.includes('P01 校验配置')), homeItems);
ok('P01 回到 M13 不丢失', back.some(t => t.includes('P01 校验配置')), back.length);
// P02：禅道 3 个只读能力，浏览器打开页面为写入
await hash('m13/plugins/zentao');
const ztCaps = await p.locator('#m13-connections').evaluate(() => [...document.querySelectorAll('.m13-section')].find(s => s.querySelector('h2')?.textContent.startsWith('能力'))?.querySelectorAll('.m13-row').length);
const ztWrite = await p.locator('.m13-section').filter({ hasText: '能力' }).first().locator('.m13-pill.warn').count();
await hash('m13/plugins/browser');
const brOpen = await p.locator('.m13-row').filter({ hasText: '打开页面' }).locator('.m13-pill').innerText();
ok('P02 禅道只读 3 项、浏览器打开页面为写入', ztCaps === 3 && ztWrite === 0 && brOpen === '写入', { ztCaps, ztWrite, brOpen });
// P03：邮件连接表单为邮件字段；禅道改名保存后重开为新值
await hash('m13/plugins/mail'); await p.getByRole('button', { name: /添加发件账号/ }).click(); await p.waitForTimeout(150);
const mailFields = await dlg().locator('.m13-field > span').allInnerTexts(); await p.screenshot({ path: out + '/p03-mail-smtp-form.png' });
await dlg().getByRole('button', { name: '关闭' }).click();
await hash('m13/plugins/zentao'); await p.locator('.m13-row').filter({ hasText: '公司禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '编辑' }).click(); await p.waitForTimeout(150);
const ztFields = await dlg().locator('.m13-field > span').allInnerTexts();
await dlg().locator('.m13-field input').first().fill('研发禅道'); await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200);
await p.locator('.m13-row').filter({ hasText: '研发禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '编辑' }).click(); await p.waitForTimeout(150);
const reopened = await dlg().locator('.m13-field input').first().inputValue(); await dlg().getByRole('button', { name: '关闭' }).click();
ok('P03 邮件表单为 SMTP 字段，不含禅道字段', mailFields.some(t => t.includes('SMTP 服务器')) && !mailFields.some(t => t.includes('禅道') || t.includes('服务器地址')), mailFields);
ok('P03 禅道含认证方式，改名保存后重开为新值', ztFields.some(t => t.includes('认证方式')) && reopened === '研发禅道', { ztFields, reopened });
// P04：卸载保留数据 → 重装恢复连接、全局默认与项目个性化设置；插件自带 Skill 随卸载消失（P0.5 起项目授权为项目页“插件”分区的设置）
await hash('project/smartdd/apps'); await p.locator('.m13-pp-tabs [role=tab]').filter({ hasText: '外部' }).click(); await p.waitForTimeout(150); await p.locator('select[aria-label="禅道禅道连接"]').selectOption({ label: '研发禅道' }); await p.waitForTimeout(150); await hash('m13/plugins/zentao');
await p.locator('.m13-detail-actions').getByRole('button', { name: '插件更多操作' }).click(); await p.getByRole('menuitem', { name: '卸载…' }).click();
await dlg().getByRole('button', { name: '卸载' }).click(); await p.waitForTimeout(250);
await hash('m13/capabilities'); const skillsAfterUninstall = await p.locator('.m13-cap b').allInnerTexts();
await hash('m13/plugins'); await p.getByRole('button', { name: '添加' }).click(); await p.getByRole('menuitem', { name: /文件夹/ }).click();
await dlg().locator('.m13-radio').filter({ hasText: 'zentao-plugin-1.1.0' }).click(); await dlg().getByRole('button', { name: '检查插件' }).click(); await dlg().getByRole('button', { name: '安装' }).click(); await p.waitForTimeout(300);
const conns = await p.locator('#m13-connections .m13-row').count(); const dflt = await p.locator('#m13-connections .m13-pill.ok').count(); await hash('project/smartdd/apps'); await p.locator('.m13-pp-tabs [role=tab]').filter({ hasText: '外部' }).click(); await p.waitForTimeout(150); const projs = (await p.locator('select[aria-label="禅道禅道连接"]').evaluate(e => e.options[e.selectedIndex].text)) === '研发禅道' ? 1 : 0; await hash('m13/plugins/zentao');
await p.screenshot({ path: out + '/p04-reinstall-restored.png' });
ok('P04 卸载后插件自带 Skill 消失', !skillsAfterUninstall.includes('zentao-bug-analysis'), skillsAfterUninstall);
ok('P04 保留数据后重装恢复连接、全局默认与项目个性化', conns === 1 && dflt === 1 && projs === 1, { conns, dflt, projs });
// P04 删除数据路径
await p.locator('.m13-detail-actions').getByRole('button', { name: '插件更多操作' }).click(); await p.getByRole('menuitem', { name: '卸载…' }).click();
await dlg().locator('.m13-radio').filter({ hasText: '删除数据' }).click(); await dlg().getByRole('button', { name: '卸载' }).click(); await p.waitForTimeout(250);
await p.getByRole('button', { name: '添加' }).click(); await p.getByRole('menuitem', { name: /文件夹/ }).click();
await dlg().locator('.m13-radio').filter({ hasText: 'zentao-plugin-1.1.0' }).click(); await dlg().getByRole('button', { name: '检查插件' }).click(); await dlg().getByRole('button', { name: '安装' }).click(); await p.waitForTimeout(300);
{ const c0 = await p.locator('#m13-connections .m13-row').count(); await hash('project/smartdd/apps'); await p.locator('.m13-pp-tabs [role=tab]').filter({ hasText: '外部' }).click(); await p.waitForTimeout(150); const noConn = await p.locator('.m13-pp-card').filter({ hasText: '禅道' }).getByText('还没有连接').count(); await hash('m13/plugins/zentao'); ok('P04 删除数据后重装为空（连接与项目设置都清除）', c0 === 0 && noConn === 1, { c0, noConn }); }
// P06：删除 DeepSeek 后可重新以预设接入
await hash('settings/ai/providers'); await p.locator('.m13-agent-row').filter({ hasText: 'DeepSeek' }).click(); await dlg().getByRole('button', { name: '删除' }).click(); await p.waitForTimeout(200); await dlg().getByRole('button', { name: '删除' }).click(); await p.waitForTimeout(200);
await p.getByRole('button', { name: '接入供应商' }).first().click();
const dsDisabled = await dlg().locator('.m13-cat-item').filter({ hasText: 'DeepSeek' }).isDisabled();
await dlg().locator('.m13-cat-item').filter({ hasText: 'DeepSeek' }).click();
await dlg().locator('input[type=password]').fill('sk-demo-1234'); await dlg().getByRole('button', { name: '获取模型' }).click(); await p.waitForTimeout(150);
await dlg().getByRole('button', { name: '接入' }).click(); await dlg().locator('.m13-done').waitFor({ timeout: 3000 }); await dlg().getByRole('button', { name: '完成' }).click(); await p.waitForTimeout(300); await hash('settings/ai/providers');
const provs = await p.locator('.m13-agent-row b').allInnerTexts();
ok('P06 删除后 DeepSeek 预设可选并重新接入', !dsDisabled && provs.some(t => t.startsWith('DeepSeek')), { dsDisabled, provs });
// P07（P0.12）：智能体绑定供应商；Claude Code · Magpie 的 5 个档位都属于 Magpie
await hash('settings/ai'); await p.getByRole('button', { name: 'Claude Code · Magpie 更多操作' }).click(); await p.getByRole('menuitem', { name: '编辑' }).click(); await p.waitForTimeout(150);
await dlg().locator('summary').click(); await p.waitForTimeout(150);
const tierVals = await dlg().locator('.m13-tiers select').evaluateAll(els => els.map(e => e.value));
const tierOpts = await dlg().locator('.m13-tiers select').first().locator('option').evaluateAll(els => els.map(e => e.value));
await p.screenshot({ path: out + '/p07-tiers-magpie.png' });
await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200);
ok('P07 Claude Code · Magpie 的 5 个档位都属于 Magpie，可选项只含 Magpie 模型', tierVals.length === 5 && tierVals.every(v => ['gpt-5.5', 'claude-sonnet-5-5'].includes(v)) && tierOpts.every(v => ['gpt-5.5', 'claude-sonnet-5-5'].includes(v)), { tierVals, tierOpts });
// P08：旧高级配置可维护环境变量与参数，保存后重开回显
await p.locator('.m13-agent-row').filter({ hasText: 'CC-rj' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '编辑' }).click(); await p.waitForTimeout(150);
await dlg().getByRole('button', { name: '添加变量' }).click(); const rows = dlg().locator('.m13-env-row');
await rows.last().locator('input').first().fill('HTTPS_PROXY'); await rows.last().locator('input').nth(1).fill('${HTTPS_PROXY}');
await dlg().locator('.m13-field').filter({ hasText: '附加启动参数' }).locator('input').fill('--verbose'); await dlg().getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(200);
await p.locator('.m13-agent-row').filter({ hasText: 'CC-rj' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '编辑' }).click(); await p.waitForTimeout(150);
const envKeys = await dlg().locator('.m13-env-row input[aria-label=变量名]').evaluateAll(els => els.map(e => e.value));
const argsVal = await dlg().locator('.m13-field').filter({ hasText: '附加启动参数' }).locator('input').inputValue();
await p.screenshot({ path: out + '/p08-legacy-editable.png' });
ok('P08 旧高级配置可编辑并回显', envKeys.includes('HTTPS_PROXY') && envKeys.includes('RJ_GATEWAY_MODE') && argsVal === '--verbose', { envKeys, argsVal });
R.errors = errors; console.log(JSON.stringify(R, null, 1)); await b.close();
