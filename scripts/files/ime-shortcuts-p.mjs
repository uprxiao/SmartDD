// N11 (P, human in the loop): real system IME composition on the prototype editor; app-controlled behaviour only (platform IME letter append is accepted).
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';

await runPCase({caseId: 'M9-T-N11', tag: 'n11-ime', run: async ({app, r, ev, mount}) => {
  await mount({theme: 'light', files: [{path: 'n11.txt', kind: 'code', text: 'base line\nsecond line\n'}]});
  const sel = '#p-host [role=treeitem][data-path="n11.txt"]'; await app.waitFor(`!!document.querySelector(${JSON.stringify(sel)})`); const p = await point(app, sel); p.x = p.left + 60; await mouse(app, p);
  await app.waitFor("!!document.querySelector('#p-host textarea')"); await ev(() => new Promise((x) => setTimeout(x, 500)));
  await ev(() => {
    const rec = window.__n11p = {ev: [], ui: []}; const now = () => performance.timeOrigin + performance.now();
    for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(t, (e) => rec.ev.push({t: now(), type: t, data: e.data, trusted: e.isTrusted, value: document.querySelector('#p-host textarea')?.value}), {capture: true, passive: true});
    for (const t of ['keydown']) document.addEventListener(t, (e) => rec.ev.push({t: now(), type: t, key: e.key, meta: e.metaKey, composing: e.isComposing, keyCode: e.keyCode, trusted: e.isTrusted}), {capture: true, passive: true});
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; const e = n.matches?.('.fw-find,.fw-line-navigation,.fw-menu') ? n : n.querySelector?.('.fw-find,.fw-line-navigation,.fw-menu'); if (e) rec.ui.push({t: now(), kind: e.classList.contains('fw-line-navigation') ? 'goto' : e.classList.contains('fw-menu') ? 'menu' : (e.querySelector('input')?.getAttribute('aria-label') ?? 'find')}); } }).observe(document.body, {childList: true, subtree: true});
  });
  const done = join(r.scratch, 'DONE'); console.log('READY ' + JSON.stringify({done}));
  const end = Date.now() + 40 * 60 * 1000; while (!existsSync(done) && Date.now() < end) await new Promise((x) => setTimeout(x, 1000));
  const rec = await ev(() => window.__n11p); r.raw = rec; const E = rec.ev, sessions = []; let cur = null;
  for (const x of E) { if (x.type === 'compositionstart') cur = {start: x.t, events: [], keys: []}; else if (cur) { cur.events.push(x); if (x.type === 'keydown' && x.meta) cur.keys.push(x); if (x.type === 'compositionend') { cur.end = x.t; sessions.push(cur); cur = null; } } }
  if (cur) { cur.end = cur.events.at(-1)?.t ?? cur.start; sessions.push(cur); }
  const inSession = (t) => sessions.some((s) => t >= s.start && t <= s.end + 30);
  const uiDuring = rec.ui.filter((u) => inSession(u.t) && u.t >= sessions.find((s) => u.t >= s.start && u.t <= s.end + 30).start && u.t <= sessions.find((s) => u.t >= s.start && u.t <= s.end + 30).end);
  const findOutside = rec.ui.filter((u) => /查找|find/i.test(u.kind) && !inSession(u.t)), gotoOutside = rec.ui.filter((u) => u.kind === 'goto' && !inSession(u.t));
  r.analysis = {sessions: sessions.length, trusted: sessions.filter((s) => s.events.filter((x) => x.type === 'compositionupdate').length && s.events.filter((x) => x.type === 'compositionupdate').every((x) => x.trusted)).length,
    sessionData: sessions.map((s) => ({updates: s.events.filter((x) => x.type === 'compositionupdate').map((x) => x.data), end: s.events.find((x) => x.type === 'compositionend')?.data, shortcuts: s.keys.map((k) => 'Cmd+' + k.key)})),
    uiOpenedDuringComposition: uiDuring.map((u) => u.kind), findOpenedOutside: findOutside.length, gotoOpenedOutside: gotoOutside.length, finalValue: E.findLast((x) => x.value != null)?.value ?? null,
    platformLetterAppend: sessions.flatMap((s) => s.keys.map((k) => { const u = s.events.filter((x) => x.type === 'compositionupdate'); const before = u.filter((x) => x.t < k.t).at(-1)?.data, after = u.find((x) => x.t > k.t)?.data; const sq = (v) => String(v ?? '').replace(/\s+/g, ''); return {key: k.key, before, after, appended: before != null && after != null && sq(after) === sq(before) + String(k.key).toLowerCase()}; }))};
  assert(sessions.length > 0, 'no composition session recorded (is a Chinese IME active?)'); assert(r.analysis.trusted > 0, 'composition events were not trusted: not a real IME session');
  assert.deepEqual(r.analysis.uiOpenedDuringComposition, [], 'UI opened during composition: ' + JSON.stringify(r.analysis.uiOpenedDuringComposition));
}});
