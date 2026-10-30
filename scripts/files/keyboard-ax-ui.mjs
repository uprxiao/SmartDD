// N10 (A): keyboard-only path directory -> tab -> toolbar -> editor -> menu/popover with accessibility checks, packaged App.
import assert from 'node:assert/strict';
import {chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {runNCase} from './n-case-kit.mjs';
import {assertStops, axOfActive, press, tabWalk} from './keyboard-ax-lib.mjs';

const files = {'d/main.ts': 'const alpha = 1;\nconst beta = 2;\nexport {alpha, beta};\n', 'd/notes.md': '# Notes\n\nbody\n', 'a.txt': 'plain\n', 'ro.txt': 'read only body\n'};
await runNCase({caseId: 'M9-T-N10', tag: 'n10-keyboard', files, run: async ({app, r, root, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const exists = (s) => `Boolean(document.querySelector(${JSON.stringify(s)}))`;
  const focusInfo = () => ev(() => { const e = document.activeElement; return {label: e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 24), role: e.getAttribute('role'), path: e.getAttribute('data-file-path')}; });
  const caret = () => ev(() => { const v = document.querySelector('.cm-content')?.cmTile?.root?.view; if (!v) return null; const h = v.state.selection.main.head, l = v.state.doc.lineAt(h); return {line: l.number, col: h - l.from + 1}; });
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    const entry = {mode, steps: []};
    // 1) whole-window Tab walk: names/roles on every stop, no trap
    setStage(mode + ':tab-walk'); const stops = await tabWalk(app); assertStops(stops, mode + ' tab walk');
    const ws = stops.filter((s) => s.inWorkspace); assert(ws.length >= 4, 'few stops inside the file workspace: ' + ws.length);
    entry.tabWalk = {stops: stops.length, cycled: !!stops.cycled, workspaceStops: ws.map((s) => `${s.role}:${s.name.slice(0, 24)}`)};
    // 2) tree by keyboard: land on the roving tab stop, expand with Right, descend with Down, open with Enter
    setStage(mode + ':tree');
    await ev(() => document.querySelector('[role=treeitem]').focus()); const dir = `[role=treeitem][data-file-path=${JSON.stringify(join(root, 'd'))}]`;
    await app.waitFor(exists(dir)); await ev((s) => document.querySelector(s).focus(), dir); assert.equal((await axOfActive(app)).role, 'treeitem');
    if ((await ev((s) => document.querySelector(s).getAttribute('aria-expanded'), dir)) !== 'true') { await press(app, 'ArrowRight'); await app.waitFor(exists(`[role=treeitem][data-file-path=${JSON.stringify(join(root, 'd/main.ts'))}]`), 8000); }
    await press(app, 'ArrowDown'); const f1 = await focusInfo(); assert(f1.path?.endsWith('/d/main.ts') || f1.path?.endsWith('/d/notes.md'), 'ArrowDown did not land on a child: ' + JSON.stringify(f1));
    while (!(await focusInfo()).path?.endsWith('/d/main.ts')) await press(app, 'ArrowDown');
    const row = await axOfActive(app); assert.equal(row.role, 'treeitem'); assert(row.name.includes('main.ts'), 'tree row name: ' + row.name);
    await press(app, 'Enter'); await app.waitFor(`document.querySelector('.fw-tab.selected button[role=tab]')?.title?.endsWith('/d/main.ts')`); await app.waitFor(exists('.cm-content'));
    entry.steps.push({tree: {row: row.name, role: row.role}});
    // 3) tab strip -> toolbar -> editor by Tab/Shift+Tab with AX names
    setStage(mode + ':tabs-toolbar-editor');
    await ev(() => document.querySelector('.fw-tab.selected button[role=tab]').focus()); const tab = await axOfActive(app); assert.equal(tab.role, 'tab'); assert(tab.name.includes('main.ts'), 'tab name: ' + tab.name);
    const chain = []; for (let i = 0; i < 40; i++) { await press(app, 'Tab'); const s = await axOfActive(app); chain.push(`${s.role}:${s.name.slice(0, 20)}`); if (s.cls.includes('cm-content') || s.tag === 'div' && s.editable) break; }
    entry.steps.push({tabToEditorChain: chain}); assert(await ev(() => !!document.activeElement.closest('.cm-content')), 'Tab chain did not reach the editor: ' + JSON.stringify(chain));
    // 4) editor: caret description must equal the real caret line:col after arrow moves
    setStage(mode + ':editor-caret'); const seq = [];
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) { await press(app, k); const ax = await axOfActive(app), c = await caret(); seq.push({key: k, caret: c, role: ax.role, name: ax.name, description: ax.description});
      assert(ax.description.includes(String(c.line)) && ax.description.includes(String(c.col)), `caret description "${ax.description}" does not match real caret ${c.line}:${c.col}`); }
    assert.equal(seq[0].role, 'textbox'); entry.steps.push({editorCaret: seq});
    // 5) toolbar menu by keyboard: open, navigate, Esc returns focus to the trigger
    setStage(mode + ':menu'); await ev(() => document.querySelector('[aria-label="文件菜单"]').focus()); await press(app, 'Enter'); await app.waitFor(exists('[role=menu]'));
    await press(app, 'ArrowDown'); const m1 = await axOfActive(app); assert(m1.role.startsWith('menuitem'), 'menu item role: ' + m1.role); assert(m1.name, 'menu item has no name');
    const items = await ev(() => [...document.querySelectorAll('[role=menu] [role^=menuitem]')].map((e) => e.textContent.trim()).filter(Boolean)); assert(items.length >= 2, 'menu has too few named items: ' + JSON.stringify(items));
    await press(app, 'ArrowDown'); const m2 = await axOfActive(app); assert.notEqual(m1.name, m2.name, 'ArrowDown did not move through the menu');
    await press(app, 'Escape'); await app.waitFor('!' + exists('[role=menu]')); const back = await axOfActive(app); assert.equal(back.name, '文件菜单', 'focus did not return to the menu trigger: ' + back.name);
    entry.steps.push({menu: {items, first: m1.name, second: m2.name, focusReturnedTo: back.name}});
    // 6) breadcrumb directory popover by keyboard
    setStage(mode + ':popover'); const crumb = '.fw-breadcrumb button'; const dirCrumb = await ev(() => { const b = [...document.querySelectorAll('.fw-breadcrumb button')].find((x) => x.textContent.trim() === 'd'); if (!b) return false; b.setAttribute('data-n10-crumb', '1'); b.focus(); return true; }); assert(dirCrumb, 'no directory crumb "d"');
    const crumbAx = await axOfActive(app); assert.equal(crumbAx.role, 'button'); assert(crumbAx.name.includes('d'), 'crumb name ' + crumbAx.name);
    await press(app, 'Enter'); await app.waitFor(exists('.fw-breadcrumb-list')); await ev(() => new Promise((x) => setTimeout(x, 300)));
    const popAx = await axOfActive(app); entry.steps.push({popover: {focusAfterOpen: `${popAx.role}:${popAx.name}`, inMenu: popAx.inMenu}});
    await press(app, 'Escape'); await app.waitFor('!' + exists('.fw-breadcrumb-list')); const crumbBack = await ev(() => document.activeElement?.getAttribute('data-n10-crumb')); assert.equal(crumbBack, '1', 'focus did not return to the breadcrumb trigger after Esc');
    entry.steps.push({popoverFocusReturned: true});
    // 7) regression: a read-only body must still be reachable in the sequential Tab path (fixed 2026-10-26)
    setStage(mode + ':readonly'); await chmod(join(root, 'ro.txt'), 0o444); await app.open('ro.txt'); await app.waitFor(`document.querySelector('.fw-tab.selected button[role=tab]')?.title?.endsWith('/ro.txt')`); await app.waitFor(exists('.cm-content')); await ev(() => new Promise((x) => setTimeout(x, 500)));
    await ev(() => document.querySelector('.fw-tab.selected button[role=tab]').focus()); let roReached = false; const roChain = [];
    for (let i = 0; i < 40 && !roReached; i++) { await press(app, 'Tab'); const s = await axOfActive(app); roChain.push(`${s.role}:${s.name.slice(0, 18)}`); roReached = await ev(() => !!document.activeElement?.closest('.cm-content')); }
    assert(roReached, 'read-only body is not reachable by Tab: ' + JSON.stringify(roChain)); const roAx = await axOfActive(app); assert.equal(roAx.role, 'textbox'); assert(roAx.name.includes('ro.txt'), 'read-only editor name: ' + roAx.name);
    const roAttr = await ev(() => ({ariaReadonly: document.querySelector('.cm-content').getAttribute('aria-readonly'), editable: document.querySelector('.cm-content').getAttribute('contenteditable')})); assert(roAttr.ariaReadonly === 'true' || roAttr.editable === 'false', 'read-only editor not marked read-only: ' + JSON.stringify(roAttr));
    entry.steps.push({readonlyReachableByTab: {reached: roReached, name: roAx.name, marks: roAttr, stops: roChain.length}}); await chmod(join(root, 'ro.txt'), 0o644); r.checks.push(entry);
  }
}});
