// N14 (P): approved icon rules in light/dark on the prototype tree; synthetic directory events for the txt -> json rename.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';

const map = JSON.parse(await readFile(new URL('../../src/renderer/features/files/icon-map.json', import.meta.url), 'utf8'));
function expectedType(name) { const lower = name.toLowerCase(), parts = lower.split('.').slice(1); let type = map.fileNameTokens[lower]; for (let i = 0; !type && i < parts.length; i++) { const key = parts.slice(i).join('.'); type = map.completeExtensionOverrides[key] ?? map.extensionTokens[key]; } return type ?? map.defaultType; }
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const dir = 'icon-samples-中文', names = ['Dockerfile', 'config.env.local', 'unknown.g205unknown', 'rename.txt'];

await runPCase({caseId: 'M9-T-N14', tag: 'n14-icons', run: async ({app, r, ev, mount, setStage}) => {
  const exists = (s) => `Boolean(document.querySelector(${JSON.stringify(s)}))`;
  const click = async (selector) => mouse(app, await point(app, selector));
  const row = (p) => `#p-host [role=treeitem][data-path=${JSON.stringify(p)}]`;
  const info = (p) => ev((s) => { const e = document.querySelector(s); const i = e?.querySelector('.fw-file-icon'); if (!i) return null; const use = i.querySelector('use'), b = i.getBoundingClientRect(); return {href: use?.getAttribute('href') ?? null, color: getComputedStyle(i).color, w: b.width, h: b.height}; }, row(p));
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files: []});
    await app.waitFor("!!document.querySelector('#p-host .fw-footer button')");
    if (!await ev(() => !!document.querySelector('#p-host [data-testid=icon-samples-load]'))) await mouse(app, await point(app, '#p-host .fw-footer button'));
    await app.waitFor("!!document.querySelector('#p-host [data-testid=icon-samples-load]')");
    setStage(mode + ':load'); await click('#p-host [data-testid=icon-samples-load]'); await app.waitFor(exists(row(dir)));
    const state = () => ev((s) => document.querySelector(s)?.getAttribute('aria-expanded'), row(dir));
    if ((await state()) !== 'true') await click(row(dir)); await app.waitFor(exists(row(dir + '/Dockerfile')));
    setStage(mode + ':rules'); const rows = [];
    for (const n of names) {
      const i = await info(dir + '/' + n); assert(i, 'no icon for ' + n);
      const type = expectedType(n), role = map.colorRoles[type], hex = map.palette[role]?.[mode];
      assert.equal((i.href ?? '').split('#').pop(), map.idPrefix + type, `${n}: sprite id`);
      assert.equal(i.w, 16); assert.equal(i.h, 16);
      if (hex) assert.equal(i.color, rgb(hex), `${n}: ${mode} color for role ${role}`);
      rows.push({name: n, type, role, expectedColor: hex ? rgb(hex) : 'inherit', actual: i});
    }
    assert.equal(rows[0].type, 'docker'); assert.equal(rows[2].type, map.defaultType);
    r.checks.push({mode, scenario: 'filename special / compound / default icons: approved sprite id, 16x16, palette color', rows});
    setStage(mode + ':folder'); const expandedBefore = await state(); await click(row(dir)); await app.waitFor(`document.querySelector(${JSON.stringify(row(dir))})?.getAttribute('aria-expanded')!==${JSON.stringify(expandedBefore)}`);
    const expandedAfter = await state(); assert.notEqual(expandedBefore, expandedAfter); await click(row(dir)); await app.waitFor(exists(row(dir + '/Dockerfile')));
    r.checks.push({mode, scenario: 'folder toggles aria-expanded and children follow', expandedBefore, expandedAfter});
    setStage(mode + ':rename'); const before = await info(dir + '/rename.txt');
    await click('#p-host [data-testid=icon-samples-rename]'); await app.waitFor(exists(row(dir + '/rename.json')) + '&&!' + exists(row(dir + '/rename.txt')));
    const after = await info(dir + '/rename.json'); assert.equal((after.href ?? '').split('#').pop(), map.idPrefix + expectedType('rename.json')); assert.notEqual(before.href, after.href);
    r.checks.push({mode, scenario: 'synthetic txt -> json rename updates the row and icon', before, after});
  }
}});
