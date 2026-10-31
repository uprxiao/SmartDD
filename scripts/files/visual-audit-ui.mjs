// N01/N02/N04/N05 (A): collect icon inventory, control states and region contrast in the packaged App, light/dark.
import {runNCase} from './n-case-kit.mjs';
import {auditControls, auditIcons, regionContrast} from './visual-audit-lib.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=', 'base64');
const files = {'doc.md': '# 标题 Title\n\n正文 Body text 中文.\n\n- item\n', 'code.txt': 'const value = 1 // 中文\nline 2\n', 'pixel.png': png, 'blob.bin': Buffer.from([0, 1, 2, 255, 128, 0, 3]), 'sub/x.txt': 'x\n'};
await runNCase({caseId: 'M9-T-N0x', tag: 'audit', files, run: async ({app, r, setStage, theme}) => {
  const scope = '[data-testid=file-workspace]';
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    const entry = {mode, files: {}};
    for (const [name, ready] of [['doc.md', `!!document.querySelector('.fw-md-paragraph')`], ['code.txt', `!!document.querySelector('.cm-line')`], ['pixel.png', `(()=>{const i=document.querySelector('.fw-image img');return !!i&&i.complete&&i.naturalWidth>0})()`], ['blob.bin', `document.body.innerText.length>0`]]) {
      setStage(`${mode}:${name}`); await app.open(name); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(name)})`); await app.waitFor(ready); await app.evaluate('new Promise(r=>setTimeout(r,400))');
      entry.files[name] = {icons: await auditIcons(app, scope), controls: await auditControls(app, scope)};
    }
    entry.contrast = {};
    for (const [k, s] of Object.entries({tree: '.fw-tree-name', crumb: '.fw-breadcrumb button.current', tab: '.fw-tab.selected button[role=tab] span'})) entry.contrast[k] = await regionContrast(app, s);
    r.checks.push(entry);
  }
}});
