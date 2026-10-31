// N03 (P): typography of body / code / tree / breadcrumb / tab on the prototype workspace, light and dark.
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';
import {measureAll} from './font-metrics-lib.mjs';

const files = [{path: 'doc.md', kind: 'markdown', text: '# 标题 Title\n\n正文 Body text 中文 mixed 0123.\n'}, {path: 'code.txt', kind: 'code', text: 'const value = 1 // 中文 mixed 0123\n'}];
await runPCase({caseId: 'M9-T-N03', tag: 'n03-fonts', run: async ({app, r, ev, mount, setStage}) => {
  const openRow = async (n, ready) => { const sel = `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`; await app.waitFor(`!!document.querySelector(${JSON.stringify(sel)})`); const p = await point(app, sel); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n)})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 300))); };
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await mount({theme: mode, files});
    setStage(mode + ':open'); await openRow('doc.md', `!!document.querySelector('#p-host .fw-markdown p, #p-host article p, #p-host [class*=markdown] p')`);
    const body = await measureAll(app, {body: '#p-host .fw-markdown p, #p-host article p, #p-host [class*=markdown] p', tree: '#p-host .fw-tree-name', breadcrumb: '#p-host .fw-breadcrumb button.current', tab: '#p-host .fw-tab.selected button[role=tab] span'});
    await openRow('code.txt', `!!document.querySelector('#p-host textarea')`);
    const code = await measureAll(app, {code: {selector: '#p-host textarea', fontsSelector: '#p-host pre'}}); // textarea UA text is not queryable: fonts come from the pre mirror
    r.checks.push({mode, domains: {...body, ...code}});
  }
}});
