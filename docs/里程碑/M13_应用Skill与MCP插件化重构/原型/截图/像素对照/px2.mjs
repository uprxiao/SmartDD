import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const [out, w, h, name, hash] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1.8, locale: 'zh-CN' })).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4176/?preview=m13#' + hash); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${name}.png` }); console.log(name, 'errors', errs.length, errs[0]||''); await b.close();
