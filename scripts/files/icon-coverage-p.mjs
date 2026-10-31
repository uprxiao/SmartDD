// N04 (P): icon inventory across states on the prototype workspace.
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';
import {assertUndoRedo, collectState} from './icon-coverage-lib.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=';
const files = [{path: 'doc.md', kind: 'markdown', text: '# 标题\n\n正文 中文\n'}, {path: 'code.txt', kind: 'code', text: 'const value = 1\n'}, {path: 'pixel.png', kind: 'image', text: png}, {path: 'doc.pdf', kind: 'pdf', text: 'N04'}, {path: 'blob.bin', kind: 'unsupported', text: ''}, {path: 'sub/x.txt', kind: 'code', text: 'x\n'}];
await runPCase({caseId: 'M9-T-N04', tag: 'icons', run: async ({app, r, ev, mount, setStage}) => {
  const scope = '#p-host .file-workspace', rowSel = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`;
  const open = async (n, ready) => { await app.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(n))})`); const p = await point(app, rowSel(n)); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n.split('/').pop())})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files, expanded: ['sub']});
    const states = [];
    await open('sub/x.txt', `!!document.querySelector('#p-host textarea')`); states.push(await collectState(app, scope, 'folder-expanded'));
    await open('doc.md', `!!document.querySelector('#p-host .fw-markdown p, #p-host article p, #p-host [class*=markdown] p')`); states.push(await collectState(app, scope, 'markdown'));
    await open('pixel.png', `(()=>{const i=document.querySelector('#p-host .fw-image img');return !!i&&i.complete&&i.naturalWidth>0})()`); states.push(await collectState(app, scope, 'image'));
    await open('doc.pdf', `(()=>{const c=document.querySelector('#p-host .fw-pdf-page canvas');return !!c&&c.width>0})()`); states.push(await collectState(app, scope, 'pdf'));
    await open('blob.bin', `!!document.querySelector('#p-host .fw-empty')`); states.push(await collectState(app, scope, 'error'));
    await open('code.txt', `!!document.querySelector('#p-host textarea')`); states.push(await collectState(app, scope, 'code-clean'));
    setStage(mode + ':dirty'); await mouse(app, await point(app, '#p-host textarea'));
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', {type, key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, ...(type === 'keyDown' ? {text: 'x'} : {})});
    await app.waitFor(`document.querySelector('#p-host textarea')?.value.includes('x')`); await ev(() => new Promise((x) => setTimeout(x, 400)));
    const dirty = await collectState(app, scope, 'code-dirty'); const pair = assertUndoRedo(dirty); states.push(dirty);
    setStage(mode + ':menu'); const p = await point(app, rowSel('code.txt')); p.x = p.left + 60; await mouse(app, p, 'right'); await app.waitFor("!!document.querySelector('.fw-menu')"); states.push(await collectState(app, '.fw-menu', 'context-menu', {requireIcons: false}));
    await app.cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27}); await app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27}); await app.waitFor("!document.querySelector('.fw-menu')");
    r.checks.push({mode, states, undoRedo: pair});
  }
}});
