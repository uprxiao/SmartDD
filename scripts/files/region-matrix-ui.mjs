// N01/N02 (A): nine regions x light/dark in the packaged App.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {mouse, point, runNCase} from './n-case-kit.mjs';
import {assertRegion, assertTheme, captureRegion, themeProof} from './region-matrix-lib.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=', 'base64');
const stream = '0.1 0.5 0.8 rg 20 20 100 60 re f BT /F1 18 Tf 30 130 Td (N02) Tj ET';
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n`;
const files = {'doc.md': '# 标题 Title\n\n正文 Body text 中文.\n', 'code.txt': 'const value = 1 // 中文\n', 'pixel.png': png, 'doc.pdf': pdf, 'blob.bin': Buffer.from([0, 1, 2, 255, 128, 0, 3])};

await runNCase({caseId: 'M9-T-N0x', tag: 'matrix', files, run: async ({app, r, root, scratch, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const open = async (name, ready) => { await app.open(name); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(name)})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    const entry = {mode, proof: await themeProof(app), regions: []}; assertTheme(entry.proof, mode);
    const cap = async (key, spec) => { setStage(`${mode}:${key}`); const rec = await captureRegion(app, scratch, `${mode}-${key}`, spec); assertRegion(rec, mode); entry.regions.push({key, ...rec}); };
    await open('doc.md', `!!document.querySelector('.fw-md-paragraph')`);
    await cap('tree', {root: '[role=tree]', text: '.fw-tree-name'});
    await cap('tabs', {root: '.fw-tabs', text: '.fw-tab.selected button[role=tab] span', icon: '.fw-tab-close svg'});
    await cap('markdown', {root: '.fw-editor-host', text: '.fw-md-paragraph'});
    await open('code.txt', `!!document.querySelector('.cm-line')`);
    await cap('code', {root: '.cm-content', text: '.cm-line'});
    await open('pixel.png', `(()=>{const i=document.querySelector('.fw-image img');return !!i&&i.complete&&i.naturalWidth>0})()`);
    await cap('image', {root: '.fw-image', icon: '.fw-tools button svg'});
    await open('doc.pdf', `(()=>{const c=document.querySelector('.fw-pdf-page canvas');return !!c&&c.width>0})()`);
    await cap('pdf', {root: '.fw-pdf', icon: '.fw-tools button svg'});
    await open('blob.bin', `!!document.querySelector('.fw-empty')`);
    await cap('error', {root: '.fw-empty', text: '.fw-empty'});
    // menu
    setStage(`${mode}:menu`); await open('code.txt', `!!document.querySelector('.cm-line')`);
    const p = await point(app, app.tree('code.txt')); await mouse(app, p, 'right'); await app.waitFor(app.exists('[role=menu]'));
    await cap('menu', {root: '[role=menu]', text: '[role=menu] [role=menuitem]'}); await app.key('Escape', 'Escape'); await app.waitFor('!' + app.exists('[role=menu]'));
    // conflict: dirty edit, then an external write to a separate file created here
    setStage(`${mode}:conflict-setup`);
    const name = `conflict-${mode}.txt`, path = join(root, name); await writeFile(path, 'original\n'); await app.waitFor(app.exists(app.tree(name)));
    await app.open(name); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(name)})`); await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='original\\n'`);
    await mouse(app, await point(app, '.cm-content')); for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', {type, key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, ...(type === 'keyDown' ? {text: 'x'} : {})}); await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString().includes('x')`);
    await writeFile(path, 'external change\n'); await app.waitFor(`!!document.querySelector('.fw-conflict-strip')`, 20000); await ev(() => new Promise((x) => setTimeout(x, 400)));
    await cap('conflict', {root: '.fw-conflict-strip', text: '.fw-conflict-strip'});
    // resolve through the real UI so the App can quit normally with a clean buffer
    setStage(`${mode}:conflict-resolve`); await app.click('.fw-conflict-strip button', '使用磁盘版本'); await app.waitFor('!' + app.exists('.fw-conflict-strip'));
    await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='external change\\n'`);
    r.checks.push(entry);
  }
}});
