// N08 (human in the loop): the user scrolls with a real trackpad; an in-page read-only recorder judges which scroller moved.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {mouse, point, runNCase} from './n-case-kit.mjs';
import {multiPagePdf} from './scroll-lib.mjs';

const files = {
  'a-long.md': Array.from({length: 300}, (_, i) => `段落 ${i} Paragraph body text 中文内容\n`).join('\n'),
  'a-wide.txt': ('WIDE LINE ' + 'x'.repeat(40) + ' ').repeat(80) + '\nsecond line\n',
  'a-doc.pdf': multiPagePdf(10),
};
for (let i = 0; i < 80; i++) files[`f-${String(i).padStart(2, '0')}.txt`] = 'filler ' + i + '\n';
for (let i = 0; i < 60; i++) files[`sub/s-${String(i).padStart(2, '0')}.txt`] = 'sibling ' + i + '\n';

await runNCase({caseId: 'M9-T-N08', tag: 'n08-trackpad', files, run: async ({app, r, scratch, root}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const dbl = async (p) => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); for (const n of [1, 2]) { await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: n}); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: n}); } };
  const NAMES = process.env.N08_POPOVER_ONLY ? ['sub/s-00.txt'] : ['a-long.md', 'a-wide.txt', 'a-doc.pdf'];
  for (const n of NAMES) { await app.open(n); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(n.split('/').pop())})`); await ev(() => new Promise((x) => setTimeout(x, 600))); const tab = `.fw-tab:has(button[role=tab][title$=${JSON.stringify('/' + n)}]) button[role=tab]`; await dbl(await point(app, tab)); await app.waitFor(`!document.querySelector(${JSON.stringify(`.fw-tab:has(button[role=tab][title$="/${n}"])`)})?.classList.contains('preview')`); }
  r.wideOverflowsAtSetup = null;
  // read-only recorder (capture phase, passive): wheel with its nearest scroller + every scroll event + window scroll
  await ev(() => {
    const scrollable = (e) => { const cs = getComputedStyle(e); return (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1); };
    const nearest = (e) => { for (let x = e; x && x !== document.documentElement; x = x.parentElement) if (x.nodeType === 1 && scrollable(x)) return x; return null; };
    const name = (e) => !e ? 'none' : e === document.documentElement ? 'window' : (e.tagName + '.' + (e.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.'));
    const rec = window.__n08rec = {wheels: [], scrolls: [], t0: performance.now(), crumb: () => document.querySelector('.fw-breadcrumb')?.textContent ?? ''};
    document.addEventListener('wheel', (e) => { const s = nearest(e.target); rec.wheels.push({t: performance.now(), trusted: e.isTrusted, dx: e.deltaX, dy: e.deltaY, scroller: name(s), top: s?.scrollTop ?? null, left: s?.scrollLeft ?? null, maxTop: s ? s.scrollHeight - s.clientHeight : null, maxLeft: s ? s.scrollWidth - s.clientWidth : null, crumb: rec.crumb(), popover: !!document.querySelector('.fw-breadcrumb-list'), overscroll: s ? getComputedStyle(s).overscrollBehavior : null}); }, {capture: true, passive: true});
    document.addEventListener('scroll', (e) => { const t = e.target === document ? document.documentElement : e.target; rec.scrolls.push({t: performance.now(), el: name(t), top: t.scrollTop, left: t.scrollLeft}); }, {capture: true, passive: true});
    window.addEventListener('scroll', () => rec.scrolls.push({t: performance.now(), el: 'window', top: scrollY, left: scrollX}), {passive: true});
  });
  const wide = await ev(() => { const s = document.querySelector('.cm-scroller'); return s ? {sw: s.scrollWidth, cw: s.clientWidth, wrap: document.querySelector('.cm-content')?.classList.contains('cm-lineWrapping')} : null; });
  const done = join(scratch, 'DONE'); r.doneFile = done; r.setup = {tabs: NAMES, wide};
  console.log('READY ' + JSON.stringify({done, setup: r.setup}));
  const end = Date.now() + 25 * 60 * 1000; while (!existsSync(done) && Date.now() < end) await new Promise((x) => setTimeout(x, 1000));
  r.timedOut = !existsSync(done);
  const rec = await ev(() => ({wheels: window.__n08rec.wheels, scrolls: window.__n08rec.scrolls})); r.recorded = {wheels: rec.wheels.length, scrolls: rec.scrolls.length}; r.raw = rec;
  // group wheel events into bursts (gap > 250ms starts a new burst; momentum keeps a burst open) and compare with the scroll events inside it
  const bursts = []; for (const w of rec.wheels) { const last = bursts.at(-1); if (last && w.t - last.end < 250) { last.end = w.t; last.n++; last.dx += w.dx; last.dy += w.dy; } else bursts.push({start: w.t, end: w.t, n: 1, dx: w.dx, dy: w.dy, scroller: w.scroller, first: w}); }
  r.bursts = bursts.map((b) => { const inside = rec.scrolls.filter((s) => s.t >= b.start - 5 && s.t <= b.end + 400); const moved = [...new Set(inside.map((s) => s.el))]; const f = b.first;
    const atEdge = f.maxTop != null && ((f.dy > 0 && f.top >= f.maxTop - 1) || (f.dy < 0 && f.top <= 1)); const atEdgeX = f.maxLeft != null && ((f.dx > 0 && f.left >= f.maxLeft - 1) || (f.dx < 0 && f.left <= 1));
    return {scroller: b.scroller, crumb: f.crumb, popover: f.popover, n: b.n, dx: Math.round(b.dx), dy: Math.round(b.dy), trusted: f.trusted, movedElements: moved, chained: moved.filter((m) => m !== b.scroller), windowMoved: moved.includes('window'), startedAtEdge: atEdge || atEdgeX, overscroll: f.overscroll}; });
  const COMPANIONS = {'DIV.fw-pdf-scroll': ['DIV.fw-pdf-thumb-scroll']}; // the PDF thumbnail rail follows the current page by design (preview.tsx effect on page change)
  for (const b of r.bursts) b.chained = b.movedElements.filter((m) => m !== b.scroller && !(COMPANIONS[b.scroller] ?? []).includes(m));
  r.chainedBursts = r.bursts.filter((b) => b.chained.length || b.windowMoved);
  r.edgeBursts = r.bursts.filter((b) => b.startedAtEdge);
  r.edgeChained = r.edgeBursts.filter((b) => b.movedElements.length > 0 && b.movedElements.some((m) => m !== b.scroller));
  const kinds = new Set(r.bursts.map((b) => b.popover ? 'popover' : /cm-scroller/.test(b.scroller) ? (b.dx && Math.abs(b.dx) > Math.abs(b.dy) ? 'code-horizontal' : (b.crumb.includes('.md') ? 'markdown' : 'cm')) : /fw-tree-scroll/.test(b.scroller) ? 'tree' : /pdf/.test(b.scroller) ? 'pdf' : b.scroller));
  r.coveredKinds = [...kinds];
  assert(r.bursts.length > 0 && r.bursts.every((b) => b.trusted), 'no trusted real wheel/trackpad bursts were recorded');
  assert.equal(r.chainedBursts.length, 0, 'a trackpad burst moved another scroller or the window: ' + JSON.stringify(r.chainedBursts));
}});
