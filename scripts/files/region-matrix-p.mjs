// N01/N02 (P): nine regions x light/dark on the prototype workspace.
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';
import {assertRegion, assertTheme, captureRegion, themeProof} from './region-matrix-lib.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=';
const files = [{path: 'doc.md', kind: 'markdown', text: '# 标题 Title\n\n正文 Body text 中文.\n'}, {path: 'code.txt', kind: 'code', text: 'const value = 1 // 中文\n'}, {path: 'pixel.png', kind: 'image', text: png}, {path: 'doc.pdf', kind: 'pdf', text: 'N02'}, {path: 'blob.bin', kind: 'unsupported', text: ''}];

await runPCase({caseId: 'M9-T-N0x', tag: 'matrix', run: async ({app, r, ev, mount, setStage}) => {
  const rowSel = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`;
  const open = async (n, ready) => { await app.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(n))})`); const p = await point(app, rowSel(n)); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n)})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files});
    const entry = {mode, proof: await themeProof(app), regions: []}; assertTheme(entry.proof, mode);
    const cap = async (key, spec) => { setStage(`${mode}:${key}`); const rec = await captureRegion(app, r.scratch, `${mode}-${key}`, spec); assertRegion(rec, mode); entry.regions.push({key, ...rec}); };
    const mdP = '#p-host .fw-markdown p, #p-host article p, #p-host [class*=markdown] p';
    await open('doc.md', `!!document.querySelector(${JSON.stringify(mdP)})`);
    await cap('tree', {root: '#p-host [role=tree]', text: '#p-host .fw-tree-name'});
    await cap('tabs', {root: '#p-host .fw-tabs', text: '#p-host .fw-tab.selected button[role=tab] span', icon: '#p-host .fw-tab-close svg'});
    await cap('markdown', {root: '#p-host .fw-content', text: mdP});
    await open('code.txt', `!!document.querySelector('#p-host textarea')`);
    await cap('code', {root: '#p-host .fw-content', text: '#p-host .fw-code-overlay > pre'}); // visible text is the pre layer; the textarea above it paints no glyphs of its own color
    await open('pixel.png', `(()=>{const i=document.querySelector('#p-host .fw-image img');return !!i&&i.complete&&i.naturalWidth>0})()`);
    await cap('image', {root: '#p-host .fw-image', icon: '#p-host .fw-tools button svg'});
    await open('doc.pdf', `(()=>{const c=document.querySelector('#p-host .fw-pdf-page canvas');return !!c&&c.width>0})()`);
    await cap('pdf', {root: '#p-host .fw-pdf', icon: '#p-host .fw-tools button svg'});
    await open('blob.bin', `!!document.querySelector('#p-host .fw-empty')`);
    await cap('error', {root: '#p-host .fw-empty', text: '#p-host .fw-empty'});
    setStage(mode + ':menu'); await open('code.txt', `!!document.querySelector('#p-host textarea')`);
    const p = await point(app, rowSel('code.txt')); p.x = p.left + 60; await mouse(app, p, 'right'); await app.waitFor("!!document.querySelector('.fw-menu')");
    await cap('menu', {root: '.fw-menu', text: '.fw-menu button'}); await app.cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27}); await app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27}); await app.waitFor("!document.querySelector('.fw-menu')");
    setStage(mode + ':conflict');
    if (!await ev(() => !!document.querySelector('#p-host [data-testid=error-scenario-conflict]'))) await mouse(app, await point(app, '#p-host .fw-footer button'));
    await app.waitFor("!!document.querySelector('#p-host [data-testid=error-scenario-conflict]')"); await mouse(app, await point(app, '#p-host [data-testid=error-scenario-conflict]'));
    await app.waitFor("!!document.querySelector('#p-host .fw-conflict-source')", 15000);
    await cap('conflict', {root: '#p-host .fw-conflict-source', text: '#p-host .fw-conflict-source'});
    r.checks.push(entry);
  }
}});
