// P0.16 追加：首页输入框随内容增高，最多 10 行，再多出现竖向滚动条（用户 2026-11-11 参照 Codex 截图要求）。真实键盘输入，不改 DOM 值。
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out = process.argv[2]; const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1512, height: 949 }, deviceScaleFactor: 2, locale: 'zh-CN' })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); const R = {}; const ok = (k, v, d) => { R[k] = { pass: !!v, detail: d }; };
await p.goto('http://127.0.0.1:4176/?preview=m13#home'); await p.waitForTimeout(900);
const box = p.getByRole('textbox', { name: '任务描述' }); await box.click();
const m = () => box.evaluate(e => ({ h: Math.round(e.getBoundingClientRect().height), sh: e.scrollHeight, oy: getComputedStyle(e).overflowY, st: e.scrollTop, lines: e.value.split('\n').length }));
const e0 = await m();
await p.keyboard.type('1'); for (let i = 2; i <= 5; i++) { await p.keyboard.press('Shift+Enter'); await p.keyboard.type(String(i)); }
const e5 = await m(); await p.locator('.reference-composer').screenshot({ path: `${out}/composer-5.png` });
for (let i = 6; i <= 10; i++) { await p.keyboard.press('Shift+Enter'); await p.keyboard.type(String(i)); }
const e10 = await m(); await p.locator('.reference-composer').screenshot({ path: `${out}/composer-10.png` });
for (let i = 11; i <= 14; i++) { await p.keyboard.press('Shift+Enter'); await p.keyboard.type(String(i)); }
const e14 = await m(); await p.locator('.reference-composer').screenshot({ path: `${out}/composer-14-scroll.png` });
await p.keyboard.press('Meta+A'); await p.keyboard.press('Backspace'); const eClr = await m();
ok('空输入框保持原高度 42px，无滚动条', e0.h === 42 && e0.oy === 'hidden', e0);
ok('5 行时随内容增高（5×22=110px），无滚动条', e5.lines === 5 && e5.h === 110 && e5.oy === 'hidden', e5);
ok('10 行时高度 220px，正好不出滚动条', e10.lines === 10 && e10.h === 220 && e10.oy === 'hidden', e10);
ok('超过 10 行（14 行）高度停在 220px，出现竖向滚动条并滚到光标处', e14.lines === 14 && e14.h === 220 && e14.oy === 'auto' && e14.sh > 220 && e14.st > 0, e14);
ok('清空后回到 42px', eClr.h === 42 && eClr.oy === 'hidden', eClr);
console.log(JSON.stringify({ checks: R, errors }, null, 1)); await b.close();
