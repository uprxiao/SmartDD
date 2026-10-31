// N08: genuine wheel and scrollbar-thumb drag with a "only the target scrolls" snapshot of every scrollable element.
import assert from 'node:assert/strict';

export function multiPagePdf(pages) {
  const objs = []; const kids = Array.from({length: pages}, (_, i) => `${3 + i} 0 R`).join(' ');
  objs.push('<</Type/Catalog/Pages 2 0 R>>', `<</Type/Pages/Kids[${kids}]/Count ${pages}>>`);
  for (let i = 0; i < pages; i++) objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]/Contents ${3 + pages + i} 0 R/Resources<</Font<</F1 ${3 + 2 * pages} 0 R>>>>>>`);
  for (let i = 0; i < pages; i++) { const s = `BT /F1 24 Tf 30 350 Td (N08 page ${i + 1}) Tj ET 0.1 0.5 0.8 rg 20 20 100 60 re f`; objs.push(`<</Length ${s.length}>>stream\n${s}\nendstream`); }
  objs.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  return '%PDF-1.4\n' + objs.map((o, i) => `${i + 1} 0 obj${o}endobj\n`).join('') + `trailer<</Root 1 0 R/Size ${objs.length + 1}>>\n%%EOF\n`;
}

// Freeze the list of scrollable elements for a scenario so before/after reads the same nodes.
export const freeze = (app, scope) => app.evaluate(`((scope)=>{const root=document.querySelector(scope)||document.body;const ok=e=>{const cs=getComputedStyle(e);return(/(auto|scroll)/.test(cs.overflowY)&&e.scrollHeight>e.clientHeight+1)||(/(auto|scroll)/.test(cs.overflowX)&&e.scrollWidth>e.clientWidth+1)};window.__n08=[...document.querySelectorAll('*')].filter(ok);window.__n08.push(document.documentElement);return window.__n08.map((e,i)=>({i,tag:e.tagName,cls:(e.className||'').toString().slice(0,40)}))})(${JSON.stringify(scope)})`);
export const snap = (app) => app.evaluate(`(()=>({els:window.__n08.map(e=>[e.scrollTop,e.scrollLeft]),win:[scrollX,scrollY]}))()`);
export const indexOf = (app, selector) => app.evaluate(`window.__n08.findIndex(e=>e===document.querySelector(${JSON.stringify(selector)}))`);

export async function wheelAt(app, selector, dx, dy) {
  const p = await app.evaluate(`((s)=>{const e=document.querySelector(s);e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect(),x0=Math.max(b.left,0),x1=Math.min(b.right,innerWidth),y0=Math.max(b.top,0),y1=Math.min(b.bottom,innerHeight);return{x:(x0+x1)/2,y:(y0+y1)/2}})(${JSON.stringify(selector)})`);
  await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y});
  await app.cdp('Input.dispatchMouseEvent', {type: 'mouseWheel', x: p.x, y: p.y, deltaX: dx, deltaY: dy});
  await app.evaluate('new Promise(r=>setTimeout(r,250))');
}
const settle = (app) => app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,120))))');
export const changed = (a, b) => b.els.map((v, i) => (v[0] !== a.els[i][0] || v[1] !== a.els[i][1]) ? i : -1).filter((i) => i >= 0).concat(b.win[0] !== a.win[0] || b.win[1] !== a.win[1] ? ['window'] : []);

// Wheel down in steps until the container stops moving (edge), return the final position.
export async function wheelToEdge(app, selector, axis, sign = 1) {
  const key = axis === 'x' ? 'scrollLeft' : 'scrollTop';
  for (let i = 0; i < 60; i++) { const before = await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).${key}`); await wheelAt(app, selector, axis === 'x' ? sign * 800 : 0, axis === 'y' ? sign * 800 : 0); const after = await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).${key}`); if (after === before) return after; }
  throw new Error('did not reach the scroll edge');
}

// Compute the overlay thumb from metrics and drag it by `by` px along the axis; returns before/after positions.
export async function dragThumb(app, selector, axis, by) {
  const m = await app.evaluate(`((s,axis)=>{const e=document.querySelector(s);e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect(),v=axis==='y';return{pos:v?e.scrollTop:e.scrollLeft,sz:v?e.scrollHeight:e.scrollWidth,cl:v?e.clientHeight:e.clientWidth,left:b.left,top:b.top,right:b.right,bottom:b.bottom,gx:e.offsetWidth-e.clientWidth,gy:e.offsetHeight-e.clientHeight}})(${JSON.stringify(selector)},${JSON.stringify(axis)})`);
  const len = Math.max(24, m.cl * m.cl / m.sz), off = m.pos / (m.sz - m.cl) * (m.cl - len);
  const gutter = axis === 'y' ? m.gx : m.gy; assert(gutter > 2, `no scrollbar gutter on ${selector} (${axis}): ${gutter}`);
  const fixed = axis === 'y' ? m.right - gutter / 2 : m.bottom - gutter / 2, start = (axis === 'y' ? m.top : m.left) + off + len / 2;
  const at = (s) => axis === 'y' ? {x: fixed, y: s} : {x: s, y: fixed};
  await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', ...at(start)}); await app.evaluate('new Promise(r=>setTimeout(r,200))');
  await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', ...at(start), button: 'left', buttons: 1, clickCount: 1});
  for (let i = 1; i <= 8; i++) await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', ...at(start + by * i / 8), button: 'left', buttons: 1});
  await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', ...at(start + by), button: 'left', buttons: 0, clickCount: 1}); await settle(app);
  const pos = await app.evaluate(`((s,axis)=>{const e=document.querySelector(s);return axis==='y'?e.scrollTop:e.scrollLeft})(${JSON.stringify(selector)},${JSON.stringify(axis)})`);
  const expected = by * (m.sz - m.cl) / (m.cl - len);
  return {before: m.pos, after: pos, moved: pos - m.pos, expected, thumbLen: len, gutter, selection: await app.evaluate('String(getSelection()).length')};
}

export async function scenario(app, {name, selector, scope, axis = 'y', dragBy = 80, companions = []}) {
  const out = {name, selector, axis}; out.frozen = await freeze(app, scope); const idx = await indexOf(app, selector);
  const comp = []; for (const c of companions) { const i = await indexOf(app, c); assert(i >= 0, `${name}: companion not scrollable: ${c}`); comp.push(i); } out.companions = companions;
  const only = (list) => list.filter((i) => i !== idx && !comp.includes(i)); // anything besides the target and its declared mirror layers
  assert(idx >= 0, `${name}: target is not a scrollable element (${selector}); scrollables: ${JSON.stringify(out.frozen)}`);
  out.overscroll = await app.evaluate(`((s)=>{const e=document.querySelector(s);return{target:getComputedStyle(e).overscrollBehavior,html:getComputedStyle(document.documentElement).overscrollBehavior,body:getComputedStyle(document.body).overscrollBehavior}})(${JSON.stringify(selector)})`);
  const s0 = await snap(app); await wheelAt(app, selector, axis === 'x' ? 240 : 0, axis === 'y' ? 240 : 0); const s1 = await snap(app);
  const ch = changed(s0, s1); assert(ch.includes(idx), `${name}: wheel did not move the target`); assert.deepEqual(only(ch), [], `${name}: wheel must move only the target (moved ${JSON.stringify(ch)}, target ${idx}, companions ${JSON.stringify(comp)})`);
  assert(s1.els[idx][axis === 'x' ? 1 : 0] > s0.els[idx][axis === 'x' ? 1 : 0], `${name}: wheel did not advance the target`);
  out.wheel = {before: s0.els[idx], after: s1.els[idx]};
  const edge = await wheelToEdge(app, selector, axis); const e0 = await snap(app); await wheelAt(app, selector, axis === 'x' ? 800 : 0, axis === 'y' ? 800 : 0); await wheelAt(app, selector, axis === 'x' ? 800 : 0, axis === 'y' ? 800 : 0); const e1 = await snap(app);
  assert.deepEqual(changed(e0, e1), [], `${name}: wheel at the edge chained to another scroller/window: ${JSON.stringify(changed(e0, e1))}`);
  out.edge = {position: edge, extraWheelChanged: changed(e0, e1)};
  // scroll back to the start by wheel, then drag the thumb forward
  await wheelToEdge(app, selector, axis, -1);
  const d0 = await snap(app); const drag = await dragThumb(app, selector, axis, dragBy); const d1 = await snap(app);
  assert(drag.moved > 0, `${name}: thumb drag did not scroll (${JSON.stringify(drag)})`); assert(Math.abs(drag.moved - drag.expected) / drag.expected < 0.15, `${name}: thumb drag moved ${drag.moved} but expected ~${drag.expected}`);
  assert.equal(drag.selection, 0, `${name}: drag selected text instead of grabbing the thumb`);
  assert(changed(d0, d1).includes(idx)); assert.deepEqual(only(changed(d0, d1)), [], `${name}: thumb drag moved other scrollers: ${JSON.stringify(changed(d0, d1))}`);
  out.drag = drag; return out;
}
