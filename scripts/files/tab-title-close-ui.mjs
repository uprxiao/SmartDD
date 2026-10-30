// N06: long tab titles and close entry in the packaged App (genuine trusted pointer, real window resize).
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mouse, point, runNCase} from './n-case-kit.mjs';

const longZh = '这是一个非常长的中文文件名用于验证标签标题裁剪与关闭入口是否仍然可达测试文件.txt', longEn = 'a'.repeat(120) + '.txt', short = 'short.txt';
const files = {[longZh]: 'zh\n', [longEn]: 'en\n', [short]: 'short\n'};

await runNCase({caseId: 'M9-T-N06', tag: 'n06-tabs', files, run: async ({app, r, root, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const resize = (w, h) => app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const win=e.BrowserWindow.getAllWindows()[0];win.setContentSize(${w},${h});return win.getContentSize()})()`);
  const dbl = async (p) => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); for (const n of [1, 2]) { await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: n}); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: n}); } };
  const tabSel = (name) => `.fw-tab:has(button[role=tab][title=${JSON.stringify(join(root, name))}]) button[role=tab]`;
  const pinAll = async () => { for (const n of [longZh, longEn, short]) {
    await app.open(n); await app.waitFor(`document.querySelector('.fw-tab.selected button[role=tab]')?.title===${JSON.stringify(join(root, n))}`);
    await dbl(await point(app, tabSel(n))); await app.waitFor(`!document.querySelector('.fw-tab:has(button[role=tab][title=${JSON.stringify(join(root, n))}])')?.classList.contains('preview')`);
  } };
  const measure = () => ev(() => {
    const list = document.querySelector('.fw-tabs'), lr = list.getBoundingClientRect();
    return {viewport: {w: innerWidth, h: innerHeight}, list: {left: lr.left, right: lr.right, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth}, tabs: [...document.querySelectorAll('.fw-tab')].map((tab) => {
      const b = tab.querySelector('button[role=tab]'), span = b.querySelector('span'), close = tab.querySelector('.fw-tab-close'), tr = tab.getBoundingClientRect(), cr = close.getBoundingClientRect();
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, hit = document.elementFromPoint(cx, cy);
      return {name: span.textContent, title: b.title, selected: b.getAttribute('aria-selected') === 'true', preview: tab.classList.contains('preview'), tab: {left: tr.left, right: tr.right, width: tr.width},
        span: {client: span.clientWidth, scroll: span.scrollWidth, overflow: getComputedStyle(span).overflow, textOverflow: getComputedStyle(span).textOverflow, mask: getComputedStyle(span).maskImage},
        close: {left: cr.left, right: cr.right, width: cr.width, height: cr.height, inViewport: cr.left >= 0 && cr.right <= innerWidth && cr.top >= 0 && cr.bottom <= innerHeight, hitIsClose: !!hit?.closest('.fw-tab-close') && hit.closest('.fw-tab-close') === close, label: close.getAttribute('aria-label')}};
    })};
  });
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    for (const [w, h] of [[1400, 900], [700, 500]]) {
      setStage(`${mode}:${w}:pin`); await resize(w, h); await app.waitFor(`innerWidth===${w}`); await pinAll();
      setStage(`${mode}:${w}:measure`);
      const m = await measure(); r.lastMeasure = {mode, w, m}; assert.equal(m.tabs.length, 3, 'expected three pinned tabs');
      assert.equal(m.tabs.filter((t) => t.selected).length, 1, 'exactly one active tab indicator');
      for (const t of m.tabs) {
        assert(t.close.inViewport || m.list.scrollWidth > m.list.clientWidth, `${t.name}: close neither in viewport nor reachable by tab-strip scroll`);
        assert(t.title.endsWith(t.name === short ? short : t.name) || t.title.includes(root), `${t.name}: full path title missing`);
        assert(t.close.width >= 16 && t.close.height >= 16, `${t.name}: close hit area too small ${t.close.width}x${t.close.height}`);
      }
      const long = m.tabs.filter((t) => t.name !== short), shortTab = m.tabs.find((t) => t.name === short);
      for (const t of long) assert(t.span.scroll > t.span.client, `${t.name}: long title not clipped`);
      if (w >= 1400) assert(shortTab.span.scroll <= shortTab.span.client + 1, 'short title unexpectedly clipped at the wide window');
      for (const t of m.tabs) assert(t.tab.width < m.viewport.w, `${t.name}: tab wider than the window`);
      // Reachability: scroll the strip so each close button becomes visible, then require it to be the hit target.
      const reach = [];
      for (const t of m.tabs) {
        await ev((label) => document.querySelector(`[aria-label=${JSON.stringify(label)}]`).scrollIntoView({inline: 'nearest', block: 'nearest'}), t.close.label);
        await ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
        const hit = await ev((label) => { const c = document.querySelector(`[aria-label=${JSON.stringify(label)}]`), b = c.getBoundingClientRect(), h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return {hitIsClose: h?.closest('.fw-tab-close') === c, inViewport: b.left >= 0 && b.right <= innerWidth}; }, t.close.label);
        assert(hit.hitIsClose && hit.inViewport, `${t.name}: close not clickable after scrolling the strip: ${JSON.stringify(hit)}`); reach.push({name: t.name, ...hit});
      }
      r.checks.push({mode, window: [w, h], scenario: 'long CJK / 128-char English / short pinned tabs: clipped titles, single active indicator, full path title, close reachable', measure: m, reach});

      setStage(`${mode}:${w}:close`);
      const label = m.tabs.find((t) => t.name === longZh).close.label;
      const target = `[aria-label=${JSON.stringify(label)}]`; await ev((l) => document.querySelector(`[aria-label=${JSON.stringify(l)}]`).scrollIntoView({inline: 'nearest'}), label);
      await mouse(app, await point(app, target)); await app.waitFor('!' + app.exists(target));
      const after = await measure(); assert.equal(after.tabs.length, 2); assert.equal(after.tabs.filter((t) => t.selected).length, 1);
      await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(after.tabs.find((t) => t.selected).name.slice(0, 8))})`);
      r.checks.push({mode, window: [w, h], scenario: 'real click on the long CJK tab close removes only that tab; one active tab remains with its document shown', remaining: after.tabs.map((t) => t.name)});
      for (const t of after.tabs) { const c = `[aria-label=${JSON.stringify(t.close.label)}]`; await ev((l) => document.querySelector(`[aria-label=${JSON.stringify(l)}]`).scrollIntoView({inline: 'nearest'}), t.close.label); await mouse(app, await point(app, c)); await app.waitFor('!' + app.exists(c)); }
    }
  }
}});
