// N07: menu position and focus restore in the packaged App with a live PTY receiver (genuine trusted input).
import assert from 'node:assert/strict';
import {mouse, point, runNCase} from './n-case-kit.mjs';

const filler = Object.fromEntries(Array.from({length: 40}, (_, i) => ['f-' + String(i).padStart(2, '0') + '.txt', 'filler ' + i + '\n']));
const files = {'a07-first.txt': 'N07 file A 中文\nline 2\n', 'a08-second.txt': 'N07 file B\n', ...filler};

await runNCase({caseId: 'M9-T-N07', tag: 'n07-menu', files, terminal: true, run: async ({app, fixture, r, root, setStage, theme}) => {
  const menu = '[role=menu]', ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const exists = (s) => app.exists(s);
  await fixture.show('T1');
  const keyRaw = (key, code, vk, modifiers = 0) => app.cdp('Input.dispatchKeyEvent', {type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers})
    .then(() => app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers}));
  const row = (name) => app.tree(name);
  const menuBox = () => ev(() => { const m = document.querySelector('[role=menu]'); if (!m) return null; const b = m.getBoundingClientRect(); return {left: b.left, top: b.top, right: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight}; });
  const inViewport = (b) => b && b.left >= 0 && b.top >= 0 && b.right <= b.vw && b.bottom <= b.vh;
  const closed = () => app.waitFor('!' + exists(menu));
  const focusOn = (selector) => ev((s) => { const e = document.querySelector(s), a = document.activeElement; return !!e && !!a && (a === e || e.contains(a)); }, selector);
  const crumbText = () => ev(() => document.querySelector('.fw-breadcrumb')?.textContent ?? '');
  const toolbar = '[aria-label="文件菜单"]';
  const receiver = async () => fixture.receiver('T1');
  const base = await (async () => { const end = Date.now() + 15000; for (;;) { try { return await receiver(); } catch (e) { if (e.code !== 'ENOENT' || Date.now() > end) throw e; await new Promise(x => setTimeout(x, 100)); } } })(); r.receiverBefore = base;

  for (const mode of ['light', 'dark']) {
    await theme(mode);
    await app.open('a07-first.txt'); await app.waitFor('document.querySelector(".fw-breadcrumb")?.textContent.includes("a07-first.txt")');

    setStage(mode + ':tree-mouse');
    let p = await point(app, row('a07-first.txt')); await mouse(app, p, 'right'); await app.waitFor(exists(menu));
    let box = await menuBox(); assert(inViewport(box), 'tree context menu left the viewport');
    await app.key('Escape', 'Escape'); await closed(); assert(await focusOn(row('a07-first.txt')), 'focus did not return to the tree row after Escape');
    r.checks.push({mode, scenario: 'tree mouse right-click: in viewport, Esc closes, focus returns to row', box});

    setStage(mode + ':tree-edge');
    const rows = await ev(() => [...document.querySelectorAll('[role=treeitem]')].map(e => { const b = e.getBoundingClientRect(); return {path: e.getAttribute('data-file-path'), bottom: b.bottom, right: b.right, top: b.top}; }).filter(x => x.top >= 0 && x.bottom <= innerHeight));
    const last = rows.at(-1); assert(last, 'no visible tree row');
    p = await point(app, `[role=treeitem][data-file-path=${JSON.stringify(last.path)}]`); p.x = p.right - 4;
    await mouse(app, p, 'right'); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box), 'menu near the bottom-right edge left the viewport');
    await app.key('Escape', 'Escape'); await closed();
    r.checks.push({mode, scenario: 'tree right-click on bottom-right visible row stays inside viewport', row: last.path, box});

    setStage(mode + ':tree-outside-next-click');
    p = await point(app, row('a07-first.txt')); await mouse(app, p, 'right'); await app.waitFor(exists(menu));
    const out = await ev(() => { const c = document.querySelector('.fw-breadcrumb')?.getBoundingClientRect(); if (!c) return null; const x = c.right - 8, y = c.top + c.height / 2, t = document.elementFromPoint(x, y); return {x, y, interactive: !!t?.closest('button,a,input,[role=treeitem],[role=menuitem],[role=menu]'), tag: t?.tagName}; });
    assert(out && !out.interactive, 'no neutral outside point beside the breadcrumb: ' + JSON.stringify(out));
    await mouse(app, out); await closed();
    p = await point(app, row('a08-second.txt')); await mouse(app, p); await app.waitFor('document.querySelector(".fw-breadcrumb")?.textContent.includes("a08-second.txt")');
    r.checks.push({mode, scenario: 'outside click closes menu without action; the very next normal click opens the other file', outside: out, crumb: await crumbText()});
    await app.open('a07-first.txt'); await app.waitFor('document.querySelector(".fw-breadcrumb")?.textContent.includes("a07-first.txt")');

    setStage(mode + ':tree-keyboard');
    p = await point(app, row('a07-first.txt')); await mouse(app, p); assert(await focusOn(row('a07-first.txt')), 'row not focused after click');
    await keyRaw('F10', 'F10', 121, 8); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box));
    await app.key('Escape', 'Escape'); await closed(); assert(await focusOn(row('a07-first.txt')), 'focus not restored after Shift+F10 menu Esc');
    r.checks.push({mode, scenario: 'Shift+F10 on focused tree row opens menu; Esc closes and focus returns', box});

    setStage(mode + ':toolbar');
    await app.click(toolbar); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box), 'toolbar menu left the viewport');
    await app.key('Escape', 'Escape'); await closed(); assert(await focusOn(toolbar), 'focus did not return to the toolbar trigger');
    await ev((s) => document.querySelector(s).focus(), toolbar); await app.key('Enter', 'Enter'); await app.waitFor(exists(menu));
    await app.key('Escape', 'Escape'); await closed(); assert(await focusOn(toolbar), 'focus not restored after keyboard-opened toolbar menu');
    await app.click(toolbar); await app.waitFor(exists(menu)); await mouse(app, out); await closed();
    await app.click(toolbar); await app.waitFor(exists(menu)); await app.key('Escape', 'Escape'); await closed();
    r.checks.push({mode, scenario: 'toolbar menu mouse+keyboard open, Esc/outside close, focus returns to trigger, next click reopens', box});

    setStage(mode + ':breadcrumb');
    const crumb = '.fw-breadcrumb button.current';
    p = await point(app, crumb); await mouse(app, p, 'right'); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box), 'breadcrumb menu left the viewport');
    await app.key('Escape', 'Escape'); await closed(); assert(await focusOn(crumb), 'focus did not return to the breadcrumb trigger after Escape');
    await ev((s) => document.querySelector(s).focus(), crumb); await keyRaw('F10', 'F10', 121, 8); await app.waitFor(exists(menu));
    await app.key('Escape', 'Escape'); await closed(); assert(await focusOn(crumb), 'focus not restored after keyboard-opened breadcrumb menu');
    p = await point(app, crumb); await mouse(app, p, 'right'); await app.waitFor(exists(menu)); await mouse(app, out); await closed();
    r.checks.push({mode, scenario: 'breadcrumb menu (right-click and Shift+F10): in viewport, Esc/outside close, focus returns to crumb', box});
  }

  setStage('terminal-clean');
  const end = await receiver(); r.receiverAfter = end;
  assert.equal(end.rawHex ?? '', base.rawHex ?? '', 'terminal received bytes during menu interaction');
  assert.equal(end.executedCommands ?? 0, base.executedCommands ?? 0, 'terminal executed commands');
}});
