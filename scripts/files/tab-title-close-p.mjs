// N06 (P): long tab titles and close entry on the prototype workspace (genuine trusted pointer, real window resize).
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';

const longZh = '这是一个非常长的中文文件名用于验证标签标题裁剪与关闭入口是否仍然可达测试文件.txt', longEn = 'a'.repeat(120) + '.txt', short = 'short.txt';
const files = [longZh, longEn, short].map((path) => ({path, kind: 'code', text: path.slice(0, 6) + '\n'}));

await runPCase({caseId: 'M9-T-N06', tag: 'n06-tabs', run: async ({app, r, ev, mount, setStage}) => {
  const exists = (s) => `Boolean(document.querySelector(${JSON.stringify(s)}))`;
  const click = async (s) => mouse(app, await point(app, s));
  const resize = (w, h) => app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const win=e.BrowserWindow.getAllWindows()[0];win.setContentSize(${w},${h});return win.getContentSize()})()`);
  const dbl = async (p) => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); for (const n of [1, 2]) { await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: n}); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: n}); } };
  const row = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`;
  const tabBtn = (n) => `#p-host .fw-tab:has(button[role=tab][title$=${JSON.stringify('/' + n)}]) button[role=tab]`;
  const tabBox = (n) => `#p-host .fw-tab:has(button[role=tab][title$=${JSON.stringify('/' + n)}])`;
  const pinAll = async () => { for (const n of [longZh, longEn, short]) {
    await app.waitFor(exists(row(n))); const rp = await point(app, row(n)); rp.x = rp.left + 80; await mouse(app, rp); await app.waitFor(exists(tabBtn(n))); // P rows are max-content wide: click the visible left part
    await dbl(await point(app, tabBtn(n))); await app.waitFor(`!document.querySelector(${JSON.stringify(tabBox(n))})?.classList.contains('preview')`);
  } };
  const measure = () => ev(() => {
    const list = document.querySelector('#p-host .fw-tabs'), lr = list.getBoundingClientRect();
    return {viewport: {w: innerWidth, h: innerHeight}, list: {left: lr.left, right: lr.right, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth}, tabs: [...document.querySelectorAll('#p-host .fw-tab')].map((tab) => {
      const b = tab.querySelector('button[role=tab]'), span = b.querySelector('span'), close = tab.querySelector('.fw-tab-close'), tr = tab.getBoundingClientRect(), cr = close.getBoundingClientRect();
      const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
      return {name: span.textContent, title: b.title, selected: b.getAttribute('aria-selected') === 'true', tab: {left: tr.left, right: tr.right, width: tr.width},
        span: {client: span.clientWidth, scroll: span.scrollWidth, overflow: getComputedStyle(span).overflow, textOverflow: getComputedStyle(span).textOverflow},
        close: {left: cr.left, right: cr.right, width: cr.width, height: cr.height, inViewport: cr.left >= 0 && cr.right <= innerWidth && cr.top >= 0 && cr.bottom <= innerHeight, hitIsClose: hit?.closest('.fw-tab-close') === close, label: close.getAttribute('aria-label')}};
    })};
  });
  const scrollTo = (label) => ev((l) => document.querySelector(`[aria-label=${JSON.stringify(l)}]`).scrollIntoView({inline: 'nearest', block: 'nearest'}), label);
  for (const mode of ['light', 'dark']) for (const [w, h] of [[1400, 900], [700, 500]]) {
    setStage(`${mode}:${w}:mount`); await resize(w, h); await app.waitFor(`innerWidth===${w}`); await mount({theme: mode, files});
    setStage(`${mode}:${w}:pin`); await pinAll();
    setStage(`${mode}:${w}:measure`); const m = await measure(); r.lastMeasure = {mode, w, m};
    assert.equal(m.tabs.length, 3, 'expected three pinned tabs'); assert.equal(m.tabs.filter((t) => t.selected).length, 1, 'exactly one active tab indicator');
    for (const t of m.tabs) {
      assert(t.close.inViewport || m.list.scrollWidth > m.list.clientWidth, `${t.name}: close neither visible nor reachable by scroll`);
      assert(t.title.includes('/synthetic/') && t.title.endsWith('/' + t.name), `${t.name}: full path title missing: ${t.title}`);
      assert(t.close.width >= 16 && t.close.height >= 16, `${t.name}: close hit area too small`);
      assert(t.tab.width < m.viewport.w, `${t.name}: tab wider than window`);
    }
    for (const t of m.tabs.filter((x) => x.name !== short)) assert(t.span.scroll > t.span.client, `${t.name}: long title not clipped`);
    if (w >= 1400) { const s = m.tabs.find((x) => x.name === short); assert(s.span.scroll <= s.span.client + 1, 'short title unexpectedly clipped at the wide window'); }
    const reach = [];
    for (const t of m.tabs) { await scrollTo(t.close.label); await ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      const hit = await ev((l) => { const c = document.querySelector(`[aria-label=${JSON.stringify(l)}]`), b = c.getBoundingClientRect(), h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return {hitIsClose: h?.closest('.fw-tab-close') === c, inViewport: b.left >= 0 && b.right <= innerWidth}; }, t.close.label);
      assert(hit.hitIsClose && hit.inViewport, `${t.name}: close not clickable after scrolling the strip`); reach.push({name: t.name, ...hit}); }
    r.checks.push({mode, window: [w, h], scenario: 'long CJK / 128-char English / short pinned tabs: clipped titles, one active indicator, full path title, close reachable', measure: m, reach});
    setStage(`${mode}:${w}:close`); const label = m.tabs.find((t) => t.name === longZh).close.label, target = `[aria-label=${JSON.stringify(label)}]`;
    await scrollTo(label); await click(target); await app.waitFor('!' + exists(target));
    const after = await measure(); assert.equal(after.tabs.length, 2); assert.equal(after.tabs.filter((t) => t.selected).length, 1);
    r.checks.push({mode, window: [w, h], scenario: 'real click on the long CJK tab close removes only that tab; one active tab remains', remaining: after.tabs.map((t) => t.name)});
  }
}});
