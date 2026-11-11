// P0.20 走查（复核 review-20261111-2134 K01）：沿用复核驱动，经供应商详情“更换 → 保存”实际入口替换 Key，核对恢复提示；另核缺 Key 时首次填写不触发提示。
import { createRequire } from 'node:module'; import { writeFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = fileURLToPath(new URL('.', import.meta.url)); const URL0 = process.env.P20_URL || 'http://127.0.0.1:4184/?preview=m13#home';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, locale: 'zh-CN' })).newPage(); p.setDefaultTimeout(10000);
const r = { errors: [], checks: {} }; p.on('pageerror', e => r.errors.push(e.message)); const d = () => p.locator('.m13-dialog');
const nav = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(150); };
try {
  await p.goto(URL0);
  await p.getByRole('button', { name: '选择智能体', exact: true }).click();
  await p.locator('.profile-choice-menu [role=menuitem]').filter({ hasText: 'Claude Code · DeepSeek' }).click();
  await p.getByLabel('任务描述').fill('走查：更换已有 Key'); await p.getByRole('button', { name: '启动任务', exact: true }).click();
  await p.getByRole('button', { name: '任务信息', exact: true }).click(); const route = await p.evaluate(() => location.hash.slice(1));
  await d().getByRole('button', { name: '切换智能体恢复', exact: true }).click();
  r.checks.preselectBeforeChange = await d().getByLabel('恢复使用的智能体').inputValue() === 'rc-cc-ds' && await d().locator('[data-resume-identity]').count() === 0;
  await d().getByRole('button', { name: '管理智能体', exact: true }).click(); await nav('settings/ai/providers/deepseek');
  r.keyBefore = (await d().innerText()).match(/Key\n[^\n]+/)?.[0];
  await d().getByRole('button', { name: '更换', exact: true }).click();
  await d().getByLabel('新的 Key', { exact: true }).fill('sk-synthetic-review-5678');
  await d().getByRole('button', { name: '保存', exact: true }).click();
  r.keyAfter = (await d().innerText()).match(/Key\n[^\n]+/)?.[0];
  await d().getByRole('button', { name: '完成', exact: true }).click();
  await nav(route); await p.getByRole('button', { name: '任务信息', exact: true }).click();
  await d().getByRole('button', { name: '切换智能体恢复', exact: true }).click();
  r.alert = await d().locator('[data-resume-identity]').innerText().catch(() => '');
  r.selected = await d().getByLabel('恢复使用的智能体').inputValue();
  r.recoverEnabled = await d().getByRole('button', { name: '恢复任务', exact: true }).isEnabled();
  await p.screenshot({ path: out + 'key-change-prompt.png' });
  r.checks.keyMasked = /5678/.test(r.keyAfter || '') && !/synthetic/.test(r.keyAfter || '');
  r.checks.prompt = /DeepSeek → DeepSeek（地址或 Key 已修改）/.test(r.alert);
  r.checks.noPreselect = r.selected === '' && r.recoverEnabled === false;
  await d().getByLabel('恢复使用的智能体').selectOption('rc-cc-ds');
  r.checks.explicitResume = await d().getByRole('button', { name: '恢复任务', exact: true }).isEnabled();
  r.checks.noPageErrors = r.errors.length === 0;
} catch (e) { r.driverError = String(e.stack); await p.screenshot({ path: out + 'driver-error.png' }).catch(() => {}); }
finally { r.at = new Date().toISOString(); writeFileSync(out + 'p20-result.json', JSON.stringify(r, null, 2)); await b.close(); }
console.log(JSON.stringify(r.checks), r.driverError || '');
