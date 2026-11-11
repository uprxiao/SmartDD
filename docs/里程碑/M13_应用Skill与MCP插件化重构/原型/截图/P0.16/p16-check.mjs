// 原型 P0.16 浏览器走查：审核 review-20261111-1500 的 N01、N04–N07、N09 与禅道插入终端（界面层）；N02、N03、N08 由 tests/m13-review-1500.test.mjs 覆盖。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
const fresh = async h => { await p.goto('about:blank'); await p.goto('http://127.0.0.1:4176/?preview=m13#' + h); await p.waitForTimeout(900); };
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(400); };
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const dlg = () => p.locator('.m13-dialog');
const term = () => p.locator('.xterm-rows').first().innerText().catch(() => '');
const toast = async () => { for (const sel of ['.m13-toast', '.toast']) { const t = p.locator(sel); if (await t.count()) return t.first().innerText().catch(() => ''); } await p.waitForTimeout(600); return (await p.locator('.m13-toast, .toast').first().innerText().catch(() => '')); };
// N01 新智能体建任务 → 终端 / 任务信息 / 恢复 / 会话插件
await fresh('home');
await p.getByRole('button', { name: '选择智能体' }).click(); await p.locator('.profile-choice-menu [role=menuitem]').filter({ hasText: 'Codex · DeepSeek' }).click(); await p.waitForTimeout(150);
await p.getByLabel('任务描述').fill('P0.16 回归任务'); await p.locator('form.reference-composer').evaluate(f => f.requestSubmit()); await p.waitForTimeout(1500);
const newTask = await p.evaluate(() => location.hash.slice(1));
const t1 = (await term()).replace(/\s+/g, ' '); await shot('01-terminal');
ok('N01 终端按新智能体显示：Codex、智能体名称与默认模型（不再回退 CC-work）', t1.includes('Codex · DeepSeek') && t1.includes('DeepSeek V4 Pro') && !t1.includes('CC-work'), t1.slice(0, 300));
await p.getByRole('button', { name: '任务信息' }).click(); await p.waitForTimeout(200);
const info = await dlg().locator('[data-task-info]').innerText(); await shot('02-task-info');
await dlg().getByRole('button', { name: '切换智能体恢复' }).click(); await p.waitForTimeout(200);
const opts = await dlg().getByLabel('恢复使用的智能体').locator('option').allInnerTexts(); await shot('03-resume');
await dlg().getByLabel('恢复使用的智能体').selectOption({ label: 'Codex · Magpie' }); await dlg().getByRole('button', { name: '恢复任务' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: '任务信息' }).click(); await p.waitForTimeout(200); const info2 = await dlg().locator('[data-task-info]').innerText(); await dlg().getByRole('button', { name: '完成' }).click();
ok('N01 任务信息读快照；恢复只列同工具（Codex）的智能体，换智能体后快照随之更新', info.includes('Codex · DeepSeek') && info.includes('DeepSeek V4 Pro（默认）') && opts.every(o => o.startsWith('Codex')) && opts.some(o => o.includes('（原智能体）')) && info2.includes('Codex · Magpie') && info2.includes('gpt-5.5'), { info: info.replace(/\n/g, ' / ').slice(0, 260), opts, info2: info2.replace(/\n/g, ' / ').slice(0, 200) });
await p.getByRole('button', { name: '会话插件' }).click(); await p.waitForTimeout(200); const sp = await dlg().locator('[data-session-plugin]').allInnerTexts(); await shot('04-session-plugins'); await dlg().getByRole('button', { name: '完成' }).click();
ok('N01 会话插件按启动时的插件快照显示', sp.length >= 2 && sp.every(x => x.includes('启动时 v')), sp.map(x => x.replace(/\n/g, ' ')));
// 禅道“插入终端引用”写入演示终端
await hash('m13/plugins/zentao/work'); await p.waitForTimeout(400);
await p.locator('.m13-zt-row, .m13-cap').first().click(); await p.waitForTimeout(300);
const hasTarget = await dlg().getByLabel('插入到会话').count();
if (hasTarget) { await dlg().getByRole('button', { name: '插入终端引用' }).click(); await p.waitForTimeout(1200); }
const t2 = (await term()).replace(/\s+/g, ' '); const route2 = await p.evaluate(() => location.hash); await shot('05-zentao-inserted');
ok('禅道“插入终端引用”跳到所选会话并写入终端输入（不回车）', hasTarget === 1 && route2.startsWith('#task/') && /禅道 (Bug|研发需求) #\d+/.test(t2), { hasTarget, route2, tail: t2.slice(-200) });
// N09 重新读取插件
await hash('m13/plugins'); const e0 = errors.length; await p.getByRole('button', { name: '重新读取插件' }).click(); await p.waitForTimeout(1200); const t3 = await p.locator('.m13-toast').innerText().catch(() => '');
ok('N09 “重新读取插件”完成后提示，无页面错误', t3.includes('插件状态已刷新') && errors.length === e0, { t3, newErrors: errors.slice(e0) });
// N05 更新禅道后权限
await p.getByRole('button', { name: '禅道 更多操作' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '更新…' }).click(); await p.waitForTimeout(250);
await dlg().locator('.m13-radio').filter({ hasText: 'zentao-plugin-1.1.0' }).click(); await dlg().getByRole('button', { name: '检查插件' }).click(); await p.waitForTimeout(200); await dlg().getByRole('button', { name: '更新' }).click(); await p.waitForTimeout(400);
await hash('m13/plugins/zentao'); const detail = await p.locator('.m13-content').innerText(); await shot('06-zentao-updated');
ok('N05 更新到 1.1.0 后详情里的权限包含新增的“联网：下载 Bug 附件”', detail.includes('1.1.0') && detail.includes('联网：下载 Bug 附件'), detail.match(/权限[\s\S]{0,300}/)?.[0]);
// N07 删除连接：运行中任务在用时阻止；停止后可删
await p.locator('#m13-connections .m13-row').filter({ hasText: '公司禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '删除…' }).click(); await p.waitForTimeout(200);
const blocked = await dlg().getByText('有任务正在使用这个连接').count(); const blockedText = await dlg().innerText(); await shot('07-delete-blocked'); await dlg().getByRole('button', { name: '知道了' }).click();
const stop = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(500); await p.getByRole('button', { name: '任务信息' }).click(); await dlg().getByRole('button', { name: '切换智能体恢复' }).click(); await p.waitForTimeout(150); await dlg().getByRole('button', { name: '管理智能体' }).click().catch(() => {}); };
const openDel = async () => { await hash('m13/plugins/zentao'); await p.waitForTimeout(200); await p.locator('#m13-connections .m13-row').filter({ hasText: '公司禅道' }).getByRole('button', { name: /更多操作/ }).click(); await p.getByRole('menuitem', { name: '删除…' }).click(); await p.waitForTimeout(200); return { blocked: await dlg().getByText('有任务正在使用这个连接').count(), text: await dlg().innerText() }; };
await stop('task/research'); const d2 = await openDel(); await shot('08-delete-other-task'); await dlg().getByRole('button', { name: /取消|知道了/ }).first().click();
await stop(newTask); const d3 = await openDel(); await shot('08b-delete-after-stop'); await dlg().getByRole('button', { name: /取消|知道了/ }).first().click();
ok('N07 删除连接按运行中任务启动时的连接判断：调研任务运行中阻止；停止后名单里只剩另一个仍在运行、同样用该连接的任务；全部停止后不再阻止', blocked === 1 && blockedText.includes('调研开发环境') && d2.blocked === 1 && !d2.text.includes('调研开发环境') && d2.text.includes('P0.16 回归任务') && d3.blocked === 0, { blocked, d2: d2.text.replace(/\n/g, ' ').slice(0, 200), d3blocked: d3.blocked });
// N06 邮件：AIS 关闭邮件插件后 AIS 草稿只读；其他项目显示本项目发件账号状态
await hash('project/ais/apps'); await p.waitForTimeout(400); await p.getByRole('switch', { name: '关闭 邮件' }).click(); await p.waitForTimeout(300);
await hash('m13/plugins/mail/drafts'); await p.waitForTimeout(400);
const aisRow = await p.locator('.m13-cap').filter({ hasText: '回复：登录异常' }).innerText(); await p.locator('.m13-cap').filter({ hasText: '回复：登录异常' }).click(); await p.waitForTimeout(200);
const closed = await dlg().locator('[data-mail-closed]').count(); const foot = await dlg().locator('.m13-dialog-foot button').allInnerTexts(); await shot('09-mail-closed'); await dlg().locator('.m13-dialog-foot').getByRole('button', { name: '关闭' }).click();
await p.locator('.m13-cap').filter({ hasText: '报表金额四舍五入' }).click(); await p.waitForTimeout(200);
const sender = await dlg().locator('[data-mail-sender]').innerText(); const sendDis = await dlg().getByRole('button', { name: '发送' }).isDisabled(); await shot('10-mail-sender');
ok('N06 邮件按项目：AIS 关闭后其草稿标“本项目已关闭邮件插件”、只读（只有关闭按钮）；WillYou 项目显示本项目发件账号状态，没有可用 SMTP 时不能发送', aisRow.includes('本项目已关闭邮件插件') && closed === 1 && foot.join() === '关闭' && sender.includes('本项目还没有可用的发件账号') && sendDis, { aisRow: aisRow.replace(/\n/g, ' '), foot, sender: sender.replace(/\n/g, ' '), sendDis });
await dlg().locator('.m13-dialog-foot').getByRole('button', { name: '关闭' }).click().catch(() => {});
// N04 默认智能体的工具没了
await fresh('settings/ai/configs');
await p.getByRole('button', { name: 'Codex · DeepSeek 更多操作' }).click(); await p.locator('.m10-menu [role=menuitem]').filter({ hasText: '设为默认' }).click(); await p.waitForTimeout(250);
await p.locator('.m13-scene-line select').selectOption('codex-missing'); await p.waitForTimeout(500); const t4 = await p.locator('.m13-toast').innerText().catch(() => '');
const first = await p.locator('.m13-agent-item').first().innerText(); await shot('11-default-handover');
await hash('home'); const homeSel = await p.getByRole('button', { name: '选择智能体' }).innerText();
await hash('settings/ai/configs'); await p.locator('.m13-scene-line select').selectOption('normal'); await p.waitForTimeout(500); const first2 = await p.locator('.m13-agent-item').first().innerText();
ok('N04 默认智能体的工具没了：从上往下第一个可用的设为默认并排第一，首页一致；Codex 恢复后不抢回', t4.includes('默认改为“Claude Code · 订阅”') && first.includes('Claude Code · 订阅') && first.includes('默认') && homeSel.includes('Claude Code · 订阅') && first2.includes('Claude Code · 订阅') && first2.includes('默认'), { t4, first: first.replace(/\n/g, ' '), homeSel, first2: first2.replace(/\n/g, ' ') });
console.log(JSON.stringify({ results: R, errors }, null, 1)); await b.close();
