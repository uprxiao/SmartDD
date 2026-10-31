// N11 (A, human in the loop): real system IME composition while pressing save / find / go-to-line; a read-only recorder plus disk polling judge it.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {mouse, point, runNCase} from './n-case-kit.mjs';

await runNCase({caseId: 'M9-T-N11', tag: 'n11-ime', files: {'keep.txt': 'keep\n'}, terminal: true, run: async ({app, fixture, r, root, scratch}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const path = join(root, 'n11.txt'); const initial = 'base line\nsecond line\n'; await writeFile(path, initial);
  await fixture.show('T1'); await app.waitFor(app.exists(app.tree('n11.txt'))); await app.open('n11.txt'); await app.waitFor(`document.querySelector('.fw-tab.selected button[role=tab]')?.title?.endsWith('/n11.txt')`);
  await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()===${JSON.stringify(initial)}`);
  const base = await (async () => { const end = Date.now() + 15000; for (;;) { try { return await fixture.receiver('T1'); } catch (e) { if (e.code !== 'ENOENT' || Date.now() > end) throw e; await new Promise((x) => setTimeout(x, 100)); } } })(); r.receiverBefore = base;
  await ev(() => {
    const rec = window.__n11 = {ev: [], ui: []}; const now = () => performance.timeOrigin + performance.now();
    const snap = () => { const v = document.querySelector('.cm-content')?.cmTile?.root?.view; if (!v) return null; const h = v.state.selection.main.head, l = v.state.doc.lineAt(h); return {len: v.state.doc.length, line: l.number, col: h - l.from + 1, text: v.state.doc.toString()}; };
    for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(t, (e) => rec.ev.push({t: now(), type: t, data: e.data, trusted: e.isTrusted, snap: snap()}), {capture: true, passive: true});
    for (const t of ['keydown', 'keyup']) document.addEventListener(t, (e) => rec.ev.push({t: now(), type: t, key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, composing: e.isComposing, keyCode: e.keyCode, trusted: e.isTrusted, snap: snap()}), {capture: true, passive: true});
    document.addEventListener('keydown', (e) => setTimeout(() => { const last = rec.ev.findLast((x) => x.type === 'keydown' && x.key === e.key); if (last) last.defaultPrevented = e.defaultPrevented; }, 0), {passive: true});
    for (const t of ['beforeinput', 'input']) document.addEventListener(t, (e) => rec.ev.push({t: now(), type: t, inputType: e.inputType, data: e.data, composing: e.isComposing, trusted: e.isTrusted, snap: snap()}), {capture: true, passive: true});
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; const e = n.matches?.('.fw-find,.fw-line-navigation,[role=menu],[role=dialog]') ? n : n.querySelector?.('.fw-find,.fw-line-navigation,[role=menu],[role=dialog]'); if (e) rec.ui.push({t: now(), kind: e.classList.contains('fw-line-navigation') ? 'goto' : e.classList.contains('fw-find') ? (e.querySelector('input')?.getAttribute('aria-label') ?? 'find') : e.getAttribute('role') ?? 'ui', label: e.getAttribute('aria-label')}); } }).observe(document.body, {childList: true, subtree: true});
  });
  // disk polling (Node side), same epoch clock
  const disk = []; let last = await readFile(path, 'utf8'); let lastM = (await stat(path, {bigint: true})).mtimeNs; const timer = setInterval(async () => { try { const s = (await stat(path, {bigint: true})).mtimeNs; if (s !== lastM) { const c = await readFile(path, 'utf8'); disk.push({t: Date.now(), content: c, changed: c !== last}); last = c; lastM = s; } } catch {} }, 100);
  const done = join(scratch, 'DONE'); r.doneFile = done;
  console.log('READY ' + JSON.stringify({done}));
  if (process.env.N11_SELFTEST) { // pipeline preflight only: synthetic CDP IME events, NOT real system IME evidence
    const key = (k, code, vk, mod = 4) => app.cdp('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod}).then(() => app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod}));
    await mouse(app, await point(app, '.cm-content')); await app.key('End', 'End').catch(() => {});
    await app.cdp('Input.imeSetComposition', {text: 'zhong', selectionStart: 5, selectionEnd: 5}); await new Promise((x) => setTimeout(x, 150)); await key('s', 'KeyS', 83); await new Promise((x) => setTimeout(x, 150));
    await app.cdp('Input.imeSetComposition', {text: 'zhongwen', selectionStart: 8, selectionEnd: 8}); await new Promise((x) => setTimeout(x, 150)); await key('f', 'KeyF', 70); await new Promise((x) => setTimeout(x, 150));
    await app.cdp('Input.insertText', {text: '中文'}); await new Promise((x) => setTimeout(x, 300));
    await key('s', 'KeyS', 83); await new Promise((x) => setTimeout(x, 800)); await key('f', 'KeyF', 70); await new Promise((x) => setTimeout(x, 400)); await key('Escape', 'Escape', 27, 0); await new Promise((x) => setTimeout(x, 300));
    await mouse(app, await point(app, '[aria-label="跳转到行"]')); await new Promise((x) => setTimeout(x, 400)); await app.cdp('Input.insertText', {text: '2'}); await key('Enter', 'Enter', 13, 0); await new Promise((x) => setTimeout(x, 400));
    await writeFile(done, 'selftest');
  }
  const end = Date.now() + 40 * 60 * 1000; while (!existsSync(done) && Date.now() < end) await new Promise((x) => setTimeout(x, 1000));
  r.timedOut = !existsSync(done);
  // leave the buffer clean so the App can quit normally; the driver saves only if the user left it dirty (recorded)
  const modelNow = await ev(() => document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()); const diskNow = await readFile(path, 'utf8');
  r.endState = {modelEqualsDisk: modelNow === diskNow}; if (modelNow !== diskNow) { for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', {type, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 4}); await new Promise((x) => setTimeout(x, 1500)); r.endState.driverSaved = true; r.endState.modelEqualsDiskAfter = (await readFile(path, 'utf8')) === (await ev(() => document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString())); }
  clearInterval(timer);
  const rec = await ev(() => window.__n11); r.raw = {...rec, disk}; const receiverAfter = await fixture.receiver('T1'); r.receiverAfter = receiverAfter;
  // ---- analysis ----
  const E = rec.ev, sessions = []; let cur = null;
  for (const x of E) { if (x.type === 'compositionstart') cur = {start: x.t, events: [], keys: []}; else if (cur) { cur.events.push(x); if ((x.type === 'keydown') && (x.meta || x.ctrl)) cur.keys.push(x); if (x.type === 'compositionend') { cur.end = x.t; sessions.push(cur); cur = null; } } }
  if (cur) { cur.end = cur.events.at(-1)?.t ?? cur.start; sessions.push(cur); }
  const inSession = (t) => sessions.some((s) => t >= s.start && t <= s.end + 30);
  const violations = []; const shortcutsDuring = [];
  for (const s of sessions) {
    for (const k of s.keys) { shortcutsDuring.push({key: k.key, meta: k.meta, defaultPrevented: k.defaultPrevented});
      const before = [...s.events].filter((x) => x.type === 'compositionupdate' && x.t < k.t).at(-1)?.data, after = s.events.find((x) => x.type === 'compositionupdate' && x.t > k.t)?.data;
      const sq = (s) => String(s).replace(/\s+/g, ''); // preedit syllables are space separated
      if (before != null && after != null && /^[a-z]$/i.test(k.key) && sq(after) === sq(before) + k.key.toLowerCase()) violations.push({kind: 'letter appended to the preedit by a shortcut', key: k.key, before, after}); }
    for (const d of disk) if (d.t >= s.start && d.t <= s.end + 30) violations.push({kind: 'disk written during composition', at: d.t - s.start});
    for (const u of rec.ui) if (u.t >= s.start && u.t <= s.end && /find|查找|goto|menu|dialog/i.test(u.kind + (u.label ?? ''))) violations.push({kind: 'UI opened during composition', ui: u.kind});
  }
  const outsideSaves = E.filter((x) => x.type === 'keydown' && x.key === 's' && x.meta && !inSession(x.t)), outsideFinds = E.filter((x) => x.type === 'keydown' && x.key === 'f' && x.meta && !inSession(x.t));
  const findOpens = rec.ui.filter((u) => /查找/.test(u.kind) && !inSession(u.t)), gotoOpens = rec.ui.filter((u) => u.kind === 'goto'), diskChangesOutside = disk.filter((d) => d.changed && !inSession(d.t));
  r.analysis = {sessions: sessions.length, trustedSessions: sessions.filter((s) => s.events.filter((x) => x.type === 'compositionupdate').every((x) => x.trusted) && s.events.some((x) => x.type === 'compositionupdate')).length, sessionData: sessions.map((s) => ({updates: s.events.filter((x) => x.type === 'compositionupdate').map((x) => x.data), end: s.events.find((x) => x.type === 'compositionend')?.data, shortcuts: s.keys.map((k) => `${k.meta ? 'Cmd+' : ''}${k.ctrl ? 'Ctrl+' : ''}${k.key}`)})),
    shortcutsDuringComposition: shortcutsDuring, violations, outsideSaves: outsideSaves.length, outsideFinds: outsideFinds.length, findPanelsOpenedOutside: findOpens.length, gotoPanelsOpened: gotoOpens.length, diskWrites: disk.length, diskWritesOutsideComposition: diskChangesOutside.length,
    finalLine: E.findLast((x) => x.snap)?.snap?.line, terminal: {rawHexBefore: base.rawHex ?? '', rawHexAfter: receiverAfter.rawHex ?? '', executedBefore: base.executedCommands ?? 0, executedAfter: receiverAfter.executedCommands ?? 0}};
  assert(sessions.length > 0, 'no composition session was recorded (is a Chinese IME active?)');
  if (!process.env.N11_SELFTEST) assert(r.analysis.trustedSessions > 0, 'composition events were not trusted: not a real system IME session');
  assert.deepEqual(violations, [], 'composition violations: ' + JSON.stringify(violations));
  assert.equal(receiverAfter.rawHex ?? '', base.rawHex ?? '', 'terminal received bytes'); assert.equal(receiverAfter.executedCommands ?? 0, base.executedCommands ?? 0, 'terminal executed commands');
}});
