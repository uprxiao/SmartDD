import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1422, height: 903 }, deviceScaleFactor: 1.8 })).newPage();
await p.goto('http://127.0.0.1:4176/?preview=m13#m13/plugins/zentao'); await p.waitForTimeout(600);
const m = await p.evaluate(() => {
  const R = e => e.getBoundingClientRect();
  const desc = R(document.querySelector('.m13-desc'));
  const secs = [...document.querySelectorAll('.m13-section')];
  const h2 = R(secs[0].querySelector('h2')); const firstIcon = R(secs[0].querySelector('.m13-rowicon'));
  const rows = [...secs[0].querySelectorAll('.m13-row')].map(R);
  const info = secs.find(s => s.querySelector('.m13-info')); const ih2 = R(info.querySelector('h2')); const dts = [...info.querySelectorAll('dt')].map(R); const dd = R(info.querySelector('dd'));
  const cs = getComputedStyle(secs[0].querySelector('h2'));
  return { descBottom_to_h2Top: h2.top - desc.bottom, h2TextBottom_to_divider: h2.height - parseFloat(cs.paddingBottom) - parseFloat(cs.lineHeight) , h2Pad: cs.paddingBottom, divider_to_icon: firstIcon.top - h2.bottom, rowPitch: rows[1].top - rows[0].top, infoDivider_to_firstRow: dts[0].top - ih2.bottom, infoRowPitch: dts[1].top - dts[0].top, labelCol: dd.left - dts[0].left, nameColor: getComputedStyle(secs[0].querySelector('.m13-row>span:nth-child(2)')).color };
});
// 参考（100%）：描述底→分节标题 24.4；标题下内边距 9＋分隔线；分隔线→行图标 25；信息：分隔线→首行 17.5；行距 30；标签列 132；Codex“应用”行之间没有固定行距可比（只有一行）
console.log(JSON.stringify(m, null, 1)); await b.close();
