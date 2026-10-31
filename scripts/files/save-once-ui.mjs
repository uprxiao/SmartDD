// N11 (A, app-controlled part, no IME): in a dirty buffer a real Cmd+S saves exactly once; Cmd+F opens find once; go-to-line works; model == disk.
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {mouse, point, runNCase} from './n-case-kit.mjs';

await runNCase({caseId: 'M9-T-N11', tag: 'n11-save-once', files: {'keep.txt': 'keep\n'}, run: async ({app, r, root, setStage}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const path = join(root, 'n11-save.txt'); const {writeFile} = await import('node:fs/promises'); await writeFile(path, 'one\ntwo\nthree\n');
  await app.waitFor(app.exists(app.tree('n11-save.txt'))); await app.open('n11-save.txt'); await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='one\\ntwo\\nthree\\n'`);
  const writes = []; let lastM = (await stat(path, {bigint: true})).mtimeNs; const timer = setInterval(async () => { try { const s = (await stat(path, {bigint: true})).mtimeNs; if (s !== lastM) { writes.push({t: Date.now(), content: await readFile(path, 'utf8')}); lastM = s; } } catch {} }, 50);
  const key = (k, code, vk, mod) => app.cdp('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod}).then(() => app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod}));
  const model = () => ev(() => document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString());
  const dirtyDot = () => ev(() => !!document.querySelector('.fw-tab.selected .fw-dirty, .fw-tab.selected [data-dirty=true], .fw-tab.selected [aria-label*="未保存"]'));
  for (let round = 1; round <= 3; round++) {
    setStage('round' + round); await mouse(app, await point(app, '.cm-content')); const before = writes.length;
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', {type, key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, ...(type === 'keyDown' ? {text: 'x'} : {})});
    await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString().includes('x'.repeat(${round}))`);
    await key('s', 'KeyS', 83, 4); await app.waitFor(`true`); await new Promise((x) => setTimeout(x, 2500));
    const made = writes.slice(before); (r.rounds ??= []).push({round, writes: made.length, tail: made.at(-1)?.content.slice(-12)});
    assert.equal(made.length, 1, `round ${round}: expected exactly one disk write after Cmd+S on a dirty buffer, got ${made.length}`);
    assert.equal(made[0].content, await model(), `round ${round}: disk != model`);
  }
  setStage('find+goto'); await key('f', 'KeyF', 70, 4); await app.waitFor(app.exists('.fw-find input[aria-label="在文件中查找"]')); const findOnce = await ev(() => document.querySelectorAll('.fw-find input[aria-label="在文件中查找"]').length); assert.equal(findOnce, 1);
  await app.key('Escape', 'Escape'); await app.waitFor('!' + app.exists('.fw-find input[aria-label="在文件中查找"]'));
  await mouse(app, await point(app, '[aria-label="跳转到行"]')); await app.waitFor(app.exists('.fw-line-navigation')); await app.cdp('Input.insertText', {text: '2'}); await app.key('Enter', 'Enter'); await app.waitFor('!' + app.exists('.fw-line-navigation'));
  const line = await ev(() => { const v = document.querySelector('.cm-content').cmTile.root.view; return v.state.doc.lineAt(v.state.selection.main.head).number; }); assert.equal(line, 2); r.gotoLine = line;
  clearInterval(timer); r.totalWrites = writes.length; assert.equal(r.totalWrites, 3, 'unexpected extra writes: ' + writes.length);
}});
