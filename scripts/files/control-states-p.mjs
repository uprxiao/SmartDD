// N05 (P): control states on the prototype workspace.
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';
import {runControlStates, STYLE} from './control-states-lib.mjs';

const files = [{path: 'doc.md', kind: 'markdown', text: '# 标题\n\n正文 中文\n'}, {path: 'code.txt', kind: 'code', text: 'const value = 1\nline 2\n'}, {path: 'sub/x.txt', kind: 'code', text: 'x\n'}];
await runPCase({caseId: 'M9-T-N05', tag: 'n05-states', run: async ({app, r, ev, mount, setStage}) => {
  const style = (sel) => app.evaluate(`(${STYLE})(document.querySelector(${JSON.stringify(sel)}))`);
  const rowSel = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`;
  const tabSel = (n) => `#p-host .fw-tab:has(button[role=tab][title$=${JSON.stringify('/' + n)}])`;
  const openRow = async (n) => { await app.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(n))})`); const p = await point(app, rowSel(n)); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n)})`); await ev(() => new Promise((x) => setTimeout(x, 300))); };
  const dbl = async (p) => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); for (const n of [1, 2]) { await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: n}); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: n}); } };
  const away = async () => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1, y: 1}); await ev(() => new Promise((x) => setTimeout(x, 80))); };
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files}); await openRow('code.txt');
    const result = await runControlStates({app, ev, scope: '#p-host .file-workspace', allowNoFocus: {'筛选文件': 'prototype gap: neither the input nor its .fw-filter wrapper changes on focus (A shows an outline)'},
      tabs: async () => {
        for (const n of ['doc.md', 'code.txt']) { await openRow(n); await dbl(await point(app, tabSel(n) + ' button[role=tab]')); await app.waitFor(`!document.querySelector(${JSON.stringify(tabSel(n))})?.classList.contains('preview')`); }
        await away(); const selected = await style(tabSel('code.txt')), unselectedDefault = await style(tabSel('doc.md'));
        await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', ...(await point(app, tabSel('doc.md')))}); await ev(() => new Promise((x) => setTimeout(x, 80))); const unselectedHover = await style(tabSel('doc.md')); await away();
        return {selected, unselectedDefault, unselectedHover};
      },
      openTreeRow: async () => { const sel = rowSel('sub'); await away(); const def = await style(sel); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', ...(await point(app, sel))}); await ev(() => new Promise((x) => setTimeout(x, 80))); const hover = await style(sel); await away();
        await ev((s) => document.querySelector(s).focus({focusVisible: true}), sel); const focus = await style(sel); await ev(() => document.activeElement.blur());
        const file = rowSel('code.txt'); const p = await point(app, file); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector(${JSON.stringify(file)})?.getAttribute('aria-selected')==='true'`); await away(); const selected = await style(file);
        return {default: def, hover, selected, focus}; },
      noopProbe: async () => { await openRow('code.txt'); const dis = '#p-host button:disabled'; await app.waitFor(`!!document.querySelector(${JSON.stringify(dis)})`);
        const state = () => ev(() => ({crumb: document.querySelector('#p-host .fw-breadcrumb')?.textContent, tabs: document.querySelectorAll('#p-host .fw-tab').length, active: document.querySelector('#p-host .fw-tab.selected button[role=tab]')?.title, text: document.querySelector('#p-host textarea')?.value}));
        const label = await ev((s) => document.querySelector(s).getAttribute('aria-label') || document.querySelector(s).textContent.trim(), dis);
        const before = await state(); await mouse(app, await point(app, dis)); await ev(() => new Promise((x) => setTimeout(x, 300))); const after = await state(); return {control: label, before, after, unchanged: JSON.stringify(before) === JSON.stringify(after)}; }});
    r.checks.push({mode, ...result});
  }
}});
