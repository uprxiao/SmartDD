// N10 (P): keyboard-only path directory -> tab -> toolbar -> editor -> menu/popover with accessibility checks, prototype.
import assert from 'node:assert/strict';
import {runPCase} from './p-case-kit.mjs';
import {assertStops, axOfActive, press, tabWalk} from './keyboard-ax-lib.mjs';

const files = [{path: 'd/main.ts', kind: 'code', text: 'const alpha = 1;\nconst beta = 2;\nexport {alpha, beta};\n'}, {path: 'd/notes.md', kind: 'markdown', text: '# Notes\n\nbody\n'}, {path: 'a.txt', kind: 'code', text: 'plain\n'}];
await runPCase({caseId: 'M9-T-N10', tag: 'n10-keyboard', run: async ({app, r, ev, mount, setStage}) => {
  const exists = (s) => `Boolean(document.querySelector(${JSON.stringify(s)}))`;
  const row = (p) => `#p-host [role=treeitem][data-path=${JSON.stringify(p)}]`;
  const focusInfo = () => ev(() => { const e = document.activeElement; return {label: e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 24), path: e.getAttribute('data-path')}; });
  const caret = () => ev(() => { const t = document.querySelector('#p-host textarea'); if (!t) return null; const v = t.value, h = t.selectionStart; const before = v.slice(0, h).split('\n'); return {line: before.length, col: before.at(-1).length + 1}; });
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files});
    const entry = {mode, steps: []};
    setStage(mode + ':tab-walk'); const stops = await tabWalk(app); assertStops(stops, mode + ' tab walk');
    const ws = stops.filter((s) => s.inWorkspace); assert(ws.length >= 4, 'few stops inside the prototype workspace: ' + ws.length);
    entry.tabWalk = {stops: stops.length, cycled: !!stops.cycled, workspaceStops: ws.map((s) => `${s.role}:${s.name.slice(0, 24)}`)};
    setStage(mode + ':tree'); await app.waitFor(exists(row('d'))); await ev((s) => document.querySelector(s).focus(), row('d')); assert.equal((await axOfActive(app)).role, 'treeitem');
    if ((await ev((s) => document.querySelector(s).getAttribute('aria-expanded'), row('d'))) !== 'true') { await press(app, 'ArrowRight'); await app.waitFor(exists(row('d/main.ts')), 8000); }
    for (let i = 0; i < 6 && !(await focusInfo()).path?.endsWith('d/main.ts'); i++) await press(app, 'ArrowDown');
    const rowAx = await axOfActive(app); assert.equal(rowAx.role, 'treeitem'); assert(rowAx.name.includes('main.ts'), 'tree row name: ' + rowAx.name);
    await press(app, 'Enter'); await app.waitFor(`document.querySelector('#p-host .fw-tab.selected button[role=tab]')?.title?.endsWith('/d/main.ts')`); await app.waitFor(exists('#p-host textarea'));
    entry.steps.push({tree: {row: rowAx.name, role: rowAx.role}});
    setStage(mode + ':tabs-toolbar-editor'); await ev(() => document.querySelector('#p-host .fw-tab.selected button[role=tab]').focus()); const tab = await axOfActive(app); assert.equal(tab.role, 'tab'); assert(tab.name.includes('main.ts'), 'tab name: ' + tab.name);
    const chain = []; for (let i = 0; i < 40; i++) { await press(app, 'Tab'); const s = await axOfActive(app); chain.push(`${s.role}:${s.name.slice(0, 20)}`); if (await ev(() => document.activeElement?.tagName === 'TEXTAREA')) break; }
    entry.steps.push({tabToEditorChain: chain}); assert(await ev(() => document.activeElement?.tagName === 'TEXTAREA'), 'Tab chain did not reach the editor: ' + JSON.stringify(chain));
    setStage(mode + ':editor-caret'); await ev(() => { const t = document.querySelector('#p-host textarea'); t.setSelectionRange(0, 0); }); const seq = [];
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) { await press(app, k); const ax = await axOfActive(app), c = await caret(); seq.push({key: k, caret: c, role: ax.role, name: ax.name, description: ax.description});
      assert(ax.description.includes(String(c.line)) && ax.description.includes(String(c.col)), `caret description "${ax.description}" does not match real caret ${c.line}:${c.col}`); }
    assert.equal(seq[0].role, 'textbox'); entry.steps.push({editorCaret: seq});
    setStage(mode + ':menu'); await ev(() => document.querySelector('#p-host [aria-label="文件查看选项"]').focus()); await press(app, 'Enter'); await app.waitFor(exists('.fw-menu'));
    const items = await ev(() => [...document.querySelectorAll('.fw-menu button')].map((e) => e.textContent.trim()).filter(Boolean)); assert(items.length >= 2, 'menu has too few named items: ' + JSON.stringify(items));
    await press(app, 'ArrowDown'); const m1 = await axOfActive(app); assert(m1.name, 'menu item has no name'); await press(app, 'ArrowDown'); const m2 = await axOfActive(app); assert.notEqual(m1.name, m2.name, 'ArrowDown did not move through the menu');
    await press(app, 'Escape'); await app.waitFor('!' + exists('.fw-menu')); const back = await axOfActive(app); assert.equal(back.name, '文件查看选项', 'focus did not return to the menu trigger: ' + back.name);
    entry.steps.push({menu: {items, first: m1.name, second: m2.name, focusReturnedTo: back.name}});
    setStage(mode + ':popover'); const ok = await ev(() => { const b = [...document.querySelectorAll('#p-host .fw-breadcrumb button')].find((x) => x.textContent.trim() === 'd'); if (!b) return false; b.setAttribute('data-n10-crumb', '1'); b.focus(); return true; }); assert(ok, 'no directory crumb "d"');
    const crumbAx = await axOfActive(app); assert.equal(crumbAx.role, 'button'); await press(app, 'Enter'); await app.waitFor(exists('.fw-menu, .fw-breadcrumb-directory')); await ev(() => new Promise((x) => setTimeout(x, 300)));
    const popAx = await axOfActive(app); entry.steps.push({popover: {focusAfterOpen: `${popAx.role}:${popAx.name}`, inMenu: popAx.inMenu}});
    await press(app, 'Escape'); await app.waitFor('!' + exists('.fw-menu, .fw-breadcrumb-directory')); entry.steps.push({popoverFocusAfterEsc: await ev(() => document.activeElement?.getAttribute('data-n10-crumb') === '1')});
    r.checks.push(entry);
  }
}});
