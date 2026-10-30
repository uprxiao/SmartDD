// N01/N02/N04/N05 (P): same collection on the prototype workspace, light/dark.
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';
import {auditControls, auditIcons, regionContrast} from './visual-audit-lib.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=';
const files = [{path: 'doc.md', kind: 'markdown', text: '# 标题 Title\n\n正文 Body text 中文.\n\n- item\n'}, {path: 'code.txt', kind: 'code', text: 'const value = 1 // 中文\nline 2\n'}, {path: 'pixel.png', kind: 'image', text: png}, {path: 'sub/x.txt', kind: 'code', text: 'x\n'}];
await runPCase({caseId: 'M9-T-N0x', tag: 'audit', run: async ({app, r, ev, mount, setStage}) => {
  const scope = '#p-host .file-workspace';
  const openRow = async (n) => { const sel = `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`; await app.waitFor(`!!document.querySelector(${JSON.stringify(sel)})`); const p = await point(app, sel); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n)})`); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files});
    const entry = {mode, files: {}};
    for (const name of ['doc.md', 'code.txt', 'pixel.png']) { setStage(`${mode}:${name}`); await openRow(name); entry.files[name] = {icons: await auditIcons(app, scope), controls: await auditControls(app, scope)}; }
    entry.contrast = {};
    for (const [k, s] of Object.entries({tree: '#p-host .fw-tree-name', crumb: '#p-host .fw-breadcrumb button.current', tab: '#p-host .fw-tab.selected button[role=tab] span'})) entry.contrast[k] = await regionContrast(app, s);
    r.checks.push(entry);
  }
}});
