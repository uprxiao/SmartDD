// N04 (A): icon inventory across states in the packaged App.
import {mouse, point, runNCase} from './n-case-kit.mjs';
import {assertUndoRedo, collectState} from './icon-coverage-lib.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=', 'base64');
const stream = '0.1 0.5 0.8 rg 20 20 100 60 re f BT /F1 18 Tf 30 130 Td (N04) Tj ET';
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n`;
const files = {'doc.md': '# 标题\n\n正文 中文\n', 'code.txt': 'const value = 1\n', 'pixel.png': png, 'doc.pdf': pdf, 'blob.bin': Buffer.from([0, 1, 2, 255, 128, 0, 3]), 'sub/x.txt': 'x\n'};
await runNCase({caseId: 'M9-T-N04', tag: 'icons', files, run: async ({app, r, root, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const scope = '[data-testid=file-workspace]';
  const open = async (name, ready) => { await app.open(name); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(name)})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    const states = [];
    setStage(mode + ':folder'); await app.open('sub/x.txt'); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes('x.txt')`); states.push(await collectState(app, scope, 'folder-expanded'));
    await open('doc.md', `!!document.querySelector('.fw-md-paragraph')`); states.push(await collectState(app, scope, 'markdown'));
    await open('pixel.png', `(()=>{const i=document.querySelector('.fw-image img');return !!i&&i.complete&&i.naturalWidth>0})()`); states.push(await collectState(app, scope, 'image'));
    await open('doc.pdf', `(()=>{const c=document.querySelector('.fw-pdf-page canvas');return !!c&&c.width>0})()`); states.push(await collectState(app, scope, 'pdf'));
    await open('blob.bin', `!!document.querySelector('.fw-empty')`); states.push(await collectState(app, scope, 'error'));
    await open('code.txt', `!!document.querySelector('.cm-line')`); states.push(await collectState(app, scope, 'code-clean'));
    setStage(mode + ':dirty'); await mouse(app, await point(app, '.cm-content'));
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', {type, key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, ...(type === 'keyDown' ? {text: 'x'} : {})});
    await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString().includes('x')`); await ev(() => new Promise((x) => setTimeout(x, 400)));
    const dirty = await collectState(app, scope, 'code-dirty'); const pair = assertUndoRedo(dirty); states.push(dirty);
    // restore: undo the edit through the real UI so the App can quit with a clean buffer
    await app.click('[aria-label*="撤销"]'); await app.waitFor(`!document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString().includes('x')`);
    setStage(mode + ':menu'); const p = await point(app, app.tree('code.txt')); await mouse(app, p, 'right'); await app.waitFor(app.exists('[role=menu]')); states.push(await collectState(app, '[role=menu]', 'context-menu', {requireIcons: false})); await app.key('Escape', 'Escape'); await app.waitFor('!' + app.exists('[role=menu]'));
    r.checks.push({mode, states, undoRedo: pair});
  }
}});
