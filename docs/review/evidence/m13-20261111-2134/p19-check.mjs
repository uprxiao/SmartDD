// P0.19 走查（审核 review-20261111-2119 F01）：沿用复核驱动的操作序列，核对身份变化提示、不预选、明确选择后恢复；另核身份未变时仍预选原智能体。
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = '/private/tmp/m13-review-20261111-2134/p19/'; const URL0 = process.env.P19_URL || 'http://127.0.0.1:4181/?preview=m13#home';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage(); p.setDefaultTimeout(10000);
const r = { errors: [], checks: {} }; p.on('pageerror', e => r.errors.push(e.message)); const d = () => p.locator('.m13-dialog');
const nav = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(150); };
try {
  await p.goto(URL0);
  // 对照：身份未变时，恢复弹窗仍预选原智能体
  await p.getByLabel('任务描述').fill('走查：身份未变'); await p.getByRole('button', { name: '启动任务', exact: true }).click();
  await p.getByRole('button', { name: '任务信息', exact: true }).click();
  await d().getByRole('button', { name: '切换智能体恢复', exact: true }).click();
  r.checks.unchangedPreselect = await d().getByLabel('恢复使用的智能体').inputValue() === 'rc-cc-login' && await d().locator('[data-resume-identity]').count() === 0;
  await d().getByRole('button', { name: '管理智能体', exact: true }).click();
  // 同复核：删 Claude Code · DeepSeek，把订阅改为 DeepSeek
  await p.goto(URL0); await p.getByLabel('任务描述').fill('走查：原智能体身份已变更'); await p.getByRole('button', { name: '启动任务', exact: true }).click();
  await p.getByRole('button', { name: '任务信息', exact: true }).click(); r.before = await d().locator('[data-task-info]').innerText();
  const route = await p.evaluate(() => location.hash.slice(1));
  await d().getByRole('button', { name: '切换智能体恢复', exact: true }).click(); await d().getByRole('button', { name: '管理智能体', exact: true }).click();
  await p.getByRole('button', { name: 'Claude Code · DeepSeek 更多操作', exact: true }).click(); await p.getByRole('menuitem', { name: '删除', exact: true }).click();
  await p.getByRole('button', { name: 'Claude Code · 订阅 更多操作', exact: true }).click(); await p.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await d().getByRole('radio', { name: /DeepSeek/ }).click(); await d().getByRole('button', { name: '保存', exact: true }).click();
  await nav(route); await p.getByRole('button', { name: '任务信息', exact: true }).click();
  await d().getByRole('button', { name: '切换智能体恢复', exact: true }).click();
  r.alert = await d().locator('[data-resume-identity]').innerText().catch(() => '');
  r.selected = await d().getByLabel('恢复使用的智能体').inputValue();
  r.recoverEnabledBeforePick = await d().getByRole('button', { name: '恢复任务', exact: true }).isEnabled();
  await p.screenshot({ path: out + 'identity-prompt.png' });
  r.checks.prompt = /订阅（CLI 自己的登录） → DeepSeek/.test(r.alert);
  r.checks.noPreselect = r.selected === '' && r.recoverEnabledBeforePick === false;
  await d().getByLabel('恢复使用的智能体').selectOption('rc-cc-login');
  r.recoverEnabledAfterPick = await d().getByRole('button', { name: '恢复任务', exact: true }).isEnabled();
  await d().getByRole('button', { name: '恢复任务', exact: true }).click();
  await p.getByRole('button', { name: '任务信息', exact: true }).click(); r.after = await d().locator('[data-task-info]').innerText();
  await p.screenshot({ path: out + 'identity-after-resume.png' });
  r.checks.explicitResume = r.recoverEnabledAfterPick && /DeepSeek/.test(r.after);
  r.checks.noPageErrors = r.errors.length === 0;
} catch (e) { r.driverError = String(e.stack); await p.screenshot({ path: out + 'driver-error.png' }).catch(() => {}); }
finally { r.at = new Date().toISOString(); writeFileSync(out + 'p19-result.json', JSON.stringify(r, null, 2)); await b.close(); }
console.log(JSON.stringify(r.checks), r.driverError || '');
