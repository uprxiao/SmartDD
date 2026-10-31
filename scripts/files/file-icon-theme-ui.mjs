// N14: file-type icon rules in light/dark in the packaged App (genuine tree, external rename via the real watcher).
import assert from 'node:assert/strict';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runNCase} from './n-case-kit.mjs';

const map = JSON.parse(await readFile(new URL('../../src/renderer/features/files/icon-map.json', import.meta.url), 'utf8'));
// Independent re-implementation of the approved resolution order (icon-map.json "resolution").
function expectedType(name) {
  const lower = name.toLowerCase(), parts = lower.split('.').slice(1);
  let type = map.fileNameTokens[lower];
  for (let i = 0; !type && i < parts.length; i++) { const key = parts.slice(i).join('.'); type = map.completeExtensionOverrides[key] ?? map.extensionTokens[key]; }
  return type ?? map.defaultType;
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const names = ['Dockerfile', 'config.env.local', 'notes.txt', 'app.config.json', 'pipeline.gitignore', 'unknownfile.zzz', 'photo.PNG', 'view.tsx', 'style.scss'];
const files = Object.fromEntries([...names.map((n) => [n, 'N14 ' + n + '\n']), ['src/main.ts', 'export {}\n']]);

await runNCase({caseId: 'M9-T-N14', tag: 'n14-icons', files, run: async ({app, r, root, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const iconInfo = (selector) => ev((s) => {
    const row = document.querySelector(s); if (!row) return null; const icon = row.querySelector('.fw-file-icon'); if (!icon) return {noIcon: true, html: row.innerHTML.slice(0, 300)};
    const use = icon.querySelector('use'), cs = getComputedStyle(icon);
    return {href: use?.getAttribute('href') ?? use?.getAttribute('xlink:href') ?? null, color: cs.color, fill: cs.fill, width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height,
      vars: {light: icon.style.getPropertyValue('--file-light'), dark: icon.style.getPropertyValue('--file-dark')}};
  }, selector);
  const row = (n) => app.tree(n);
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    setStage(mode + ':theme-active');
    await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    const themeState = await ev(() => ({htmlClass: document.documentElement.className, dataTheme: document.documentElement.dataset.theme ?? null, bodyBg: getComputedStyle(document.body).backgroundColor, bodyColor: getComputedStyle(document.body).color, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches}));
    r.checks.push({mode, scenario: 'theme state before icon rules', themeState});
    setStage(mode + ':rules');
    const rows = [];
    for (const n of names) {
      await app.waitFor(app.exists(row(n)));
      const info = await iconInfo(row(n)); assert(info && !info.noIcon, 'no icon for ' + n + ': ' + JSON.stringify(info));
      const type = expectedType(n), role = map.colorRoles[type], hex = map.palette[role]?.[mode];
      assert.equal((info.href ?? '').split('#').pop(), map.idPrefix + type, `${n}: sprite id`);
      assert.equal(info.width, 16); assert.equal(info.height, 16);
      if (hex) assert.equal(info.color, rgb(hex), `${n}: ${mode} color for role ${role}`);
      rows.push({name: n, type, role, expectedColor: hex ? rgb(hex) : 'inherit', actual: info});
    }
    assert(new Set(rows.map((x) => x.type)).size >= 6, 'rule coverage too narrow');
    assert.equal(rows.find((x) => x.name === 'Dockerfile').type, 'docker');
    assert.equal(rows.find((x) => x.name === 'unknownfile.zzz').type, map.defaultType);
    r.checks.push({mode, scenario: 'filename special / compound / default / image / react / sass icons use approved sprite id, 16x16, palette color', rows});

    setStage(mode + ':folder');
    const folder = row('src'); await app.waitFor(app.exists(folder));
    const state = () => ev((s) => { const e = document.querySelector(s); return e ? {expanded: e.getAttribute('aria-expanded')} : null; }, folder);
    if ((await state()).expanded === 'true') await app.click(folder);
    assert.equal((await state()).expanded, 'false'); const collapsedHasChild = await app.evaluate(app.exists(row('src/main.ts')));
    await app.click(folder); await app.waitFor(app.exists(row('src/main.ts')));
    assert.equal((await state()).expanded, 'true'); const childIcon = await iconInfo(row('src/main.ts')); assert.equal((childIcon.href ?? '').split('#').pop(), map.idPrefix + expectedType('main.ts'));
    r.checks.push({mode, scenario: 'folder collapsed -> expanded switches aria-expanded and reveals typed child icon', collapsedHasChild, childIcon});
    await app.click(folder);

    setStage(mode + ':rename');
    const a = join(root, 'rename-me.txt'), b = join(root, 'rename-me.json');
    await writeFile(a, 'N14 rename source\n'); await app.waitFor(app.exists(row('rename-me.txt')));
    const before = await iconInfo(row('rename-me.txt')); assert.equal((before.href ?? '').split('#').pop(), map.idPrefix + expectedType('rename-me.txt'));
    await rename(a, b); await app.waitFor(app.exists(row('rename-me.json')) + '&&!' + app.exists(row('rename-me.txt')));
    const after = await iconInfo(row('rename-me.json')); assert.equal((after.href ?? '').split('#').pop(), map.idPrefix + expectedType('rename-me.json'));
    assert.notEqual(before.href, after.href, 'icon did not change with the suffix');
    r.checks.push({mode, scenario: 'external txt -> json rename updates row and icon through the real watcher', before, after});
    await rename(b, a); await app.waitFor(app.exists(row('rename-me.txt')));
  }
}});
