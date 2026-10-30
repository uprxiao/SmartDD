// N07 (P): menu position and focus restore on the prototype workspace (synthetic; no real PTY).
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';

const filler = Array.from({length: 40}, (_, i) => ({path: 'f-' + String(i).padStart(2, '0') + '.txt', kind: 'code', text: 'filler ' + i + '\n'}));
const files = [{path: 'a07-first.txt', kind: 'code', text: 'N07 file A\nline 2\n'}, {path: 'a08-second.txt', kind: 'code', text: 'N07 file B\n'}, ...filler];

await runPCase({caseId: 'M9-T-N07', tag: 'n07-menu', run: async ({app, r, ev, mount, setStage}) => {
  const menu = '.fw-menu,[role=menu]', exists = (s) => `Boolean(document.querySelector(${JSON.stringify(s)}))`;
  const row = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`, toolbar = '#p-host [aria-label="文件查看选项"]', crumb = '#p-host .fw-breadcrumb button.current';
  const keyRaw = (key, code, vk, modifiers = 0) => app.cdp('Input.dispatchKeyEvent', {type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers}).then(() => app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers}));
  const key = (k, c, vk) => app.cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: k, code: c, windowsVirtualKeyCode: vk, ...(k === 'Enter' ? {text: '\r'} : {})}).then(() => app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code: c, windowsVirtualKeyCode: vk}));
  const click = async (s) => mouse(app, await point(app, s)), rclick = async (s, dx) => { const p = await point(app, s); if (dx !== undefined) p.x = p.right + dx; await mouse(app, p, 'right'); };
  const menuBox = () => ev((m) => { const e = document.querySelector(m); if (!e) return null; const b = e.getBoundingClientRect(); return {left: b.left, top: b.top, right: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight}; }, menu);
  const inViewport = (b) => b && b.left >= 0 && b.top >= 0 && b.right <= b.vw && b.bottom <= b.vh;
  const closed = () => app.waitFor('!' + exists(menu));
  const focusOn = (s) => ev((s) => { const e = document.querySelector(s), a = document.activeElement; return !!e && !!a && (a === e || e.contains(a)); }, s);
  const crumbText = () => ev(() => document.querySelector('#p-host .fw-breadcrumb')?.textContent ?? '');
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files});
    await app.waitFor(exists(row('a07-first.txt')));
    await click(row('a07-first.txt')); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes('a07-first.txt')`);

    setStage(mode + ':tree-mouse'); await rclick(row('a07-first.txt')); await app.waitFor(exists(menu));
    let box = await menuBox(); assert(inViewport(box), 'tree context menu left the viewport'); await key('Escape', 'Escape', 27); await closed();
    assert(await focusOn(row('a07-first.txt')), 'focus did not return to the tree row');
    r.checks.push({mode, scenario: 'tree right-click: in viewport, Esc closes, focus returns', box});

    setStage(mode + ':tree-edge');
    const last = (await ev(() => [...document.querySelectorAll('#p-host [role=treeitem]')].map((e) => { const b = e.getBoundingClientRect(); return {path: e.getAttribute('data-path'), top: b.top, bottom: b.bottom}; }).filter((x) => x.top >= 0 && x.bottom <= innerHeight))).at(-1);
    assert(last, 'no visible tree row'); await rclick(row(last.path), -4); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box), 'menu near the bottom-right edge left the viewport');
    await key('Escape', 'Escape', 27); await closed(); r.checks.push({mode, scenario: 'right-click on the last visible row stays in viewport', row: last.path, box});

    setStage(mode + ':outside-next-click'); await rclick(row('a07-first.txt')); await app.waitFor(exists(menu));
    const out = await ev(() => { const c = document.querySelector('#p-host .fw-breadcrumb')?.getBoundingClientRect(); if (!c) return null; const x = c.right - 8, y = c.top + c.height / 2, t = document.elementFromPoint(x, y); return {x, y, interactive: !!t?.closest('button,a,input,[role=treeitem],[role=menuitem],[role=menu],.fw-menu'), tag: t?.tagName}; });
    assert(out && !out.interactive, 'no neutral outside point: ' + JSON.stringify(out)); await mouse(app, out); await closed();
    await click(row('a08-second.txt')); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes('a08-second.txt')`);
    r.checks.push({mode, scenario: 'outside click closes without action; next normal click opens the other file', outside: out, crumb: await crumbText()});
    await click(row('a07-first.txt')); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes('a07-first.txt')`);

    setStage(mode + ':tree-keyboard'); await click(row('a07-first.txt')); assert(await focusOn(row('a07-first.txt')), 'row not focused after click');
    await keyRaw('F10', 'F10', 121, 8); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box)); await key('Escape', 'Escape', 27); await closed();
    assert(await focusOn(row('a07-first.txt')), 'focus not restored after Shift+F10 menu'); r.checks.push({mode, scenario: 'Shift+F10 on focused tree row opens menu; Esc restores focus', box});

    setStage(mode + ':toolbar'); await click(toolbar); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box), 'toolbar menu left the viewport');
    await key('Escape', 'Escape', 27); await closed(); assert(await focusOn(toolbar), 'focus did not return to the toolbar trigger');
    await ev((s) => document.querySelector(s).focus(), toolbar); await key('Enter', 'Enter', 13); await app.waitFor(exists(menu)); await key('Escape', 'Escape', 27); await closed();
    assert(await focusOn(toolbar), 'focus not restored after keyboard-opened toolbar menu');
    await click(toolbar); await app.waitFor(exists(menu)); await mouse(app, out); await closed(); await click(toolbar); await app.waitFor(exists(menu)); await key('Escape', 'Escape', 27); await closed();
    r.checks.push({mode, scenario: 'toolbar menu mouse+keyboard open, Esc/outside close, focus returns, next click reopens', box});

    setStage(mode + ':breadcrumb-mouse'); await rclick(crumb); await app.waitFor(exists(menu)); box = await menuBox(); assert(inViewport(box), 'breadcrumb menu left the viewport');
    await key('Escape', 'Escape', 27); await closed(); assert(await focusOn(crumb), 'focus did not return to the breadcrumb trigger');
    setStage(mode + ':breadcrumb-keyboard'); await ev((s) => document.querySelector(s).focus(), crumb);
    let route = 'Shift+F10'; await keyRaw('F10', 'F10', 121, 8);
    if (!await app.waitFor(exists(menu), 1500).then(() => true, () => false)) { route = 'Enter (native button click; no Shift+F10 branch in the prototype)'; await key('Enter', 'Enter', 13); await app.waitFor(exists(menu)); }
    const kbox = await menuBox(); assert(inViewport(kbox), 'keyboard-opened breadcrumb menu left the viewport'); await key('Escape', 'Escape', 27); await closed();
    assert(await focusOn(crumb), 'focus not restored after keyboard-opened breadcrumb menu');
    r.checks.push({mode, scenario: 'breadcrumb: right-click menu and a keyboard route open in viewport, Esc closes, focus returns', box, keyboardRoute: route, keyboardBox: kbox});
  }
  r.terminal = 'P has no real PTY; terminal-input claim is covered only by the A layer receiver';
}});
