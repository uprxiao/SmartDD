// N05 (A): control states in the packaged App.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mouse, point, runNCase} from './n-case-kit.mjs';
import {runControlStates, STYLE} from './control-states-lib.mjs';

const files = {'doc.md': '# 标题\n\n正文 中文\n', 'code.txt': 'const value = 1\nline 2\n', 'sub/x.txt': 'x\n'};
await runNCase({caseId: 'M9-T-N05', tag: 'n05-states', files, run: async ({app, r, root, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const style = (sel) => app.evaluate(`(${STYLE})(document.querySelector(${JSON.stringify(sel)}))`);
  const dbl = async (p) => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); for (const n of [1, 2]) { await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: n}); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: n}); } };
  const away = async () => { await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1, y: 1}); await ev(() => new Promise((x) => setTimeout(x, 80))); };
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    setStage(mode + ':open'); await app.open('code.txt'); await app.waitFor(`!!document.querySelector('.cm-line')`);
    const tabSel = (n) => `.fw-tab:has(button[role=tab][title=${JSON.stringify(join(root, n))}])`;
    const result = await runControlStates({app, ev, scope: '[data-testid=file-workspace]',
      tabs: async () => {
        for (const n of ['doc.md', 'code.txt']) { await app.open(n); await app.waitFor(`document.querySelector('.fw-tab.selected button[role=tab]')?.title===${JSON.stringify(join(root, n))}`); await dbl(await point(app, tabSel(n) + ' button[role=tab]')); await app.waitFor(`!document.querySelector(${JSON.stringify(tabSel(n))})?.classList.contains('preview')`); }
        await away(); const selected = await style(tabSel('code.txt')), unselectedDefault = await style(tabSel('doc.md'));
        await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', ...(await point(app, tabSel('doc.md')))}); await ev(() => new Promise((x) => setTimeout(x, 80))); const unselectedHover = await style(tabSel('doc.md')); await away();
        return {selected, unselectedDefault, unselectedHover};
      },
      openTreeRow: async () => { const sel = `[role=treeitem][data-file-path=${JSON.stringify(join(root, 'sub'))}]`; await away(); const def = await style(sel); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', ...(await point(app, sel))}); await ev(() => new Promise((x) => setTimeout(x, 80))); const hover = await style(sel); await away();
        await ev((s) => document.querySelector(s).focus({focusVisible: true}), sel); const focus = await style(sel); await ev(() => document.activeElement.blur());
        const file = `[role=treeitem][data-file-path=${JSON.stringify(join(root, 'code.txt'))}]`; await mouse(app, await point(app, file)); await app.waitFor(`document.querySelector(${JSON.stringify(file)})?.getAttribute('aria-selected')==='true'`); await away(); const selected = await style(file);
        const fileDefault = await style(`[role=treeitem][data-file-path=${JSON.stringify(join(root, 'sub'))}]`); return {default: fileDefault, hover, selected, focus}; },
      noopProbe: async () => { const dis = '[aria-label="语义导航后退"]:disabled'; await app.open('code.txt'); await app.waitFor(`!!document.querySelector(${JSON.stringify(dis)})`);
        const state = () => ev(() => ({crumb: document.querySelector('.fw-breadcrumb')?.textContent, tabs: document.querySelectorAll('.fw-tab').length, active: document.querySelector('.fw-tab.selected button[role=tab]')?.title}));
        const before = await state(); await mouse(app, await point(app, dis)); await ev(() => new Promise((x) => setTimeout(x, 300))); const after = await state(); return {control: '语义导航后退', before, after, unchanged: JSON.stringify(before) === JSON.stringify(after)}; }});
    r.checks.push({mode, ...result});
  }
}});
