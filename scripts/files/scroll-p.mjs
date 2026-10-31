// N08 (P): wheel, edge and scrollbar-thumb drag per scroll container on the prototype workspace.
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';
import {scenario, wheelToEdge} from './scroll-lib.mjs';

const files = [{path: 'a-long.md', kind: 'markdown', text: Array.from({length: 300}, (_, i) => `段落 ${i} Paragraph body text 中文内容\n`).join('\n')}, {path: 'a-wide.txt', kind: 'code', text: 'WIDE ' + 'x'.repeat(3000) + '\nsecond line\n'}, {path: 'a-doc.pdf', kind: 'pdf', text: 'N08'},
  ...Array.from({length: 80}, (_, i) => ({path: `f-${String(i).padStart(2, '0')}.txt`, kind: 'code', text: 'filler ' + i + '\n'})), ...Array.from({length: 60}, (_, i) => ({path: `sub/s-${String(i).padStart(2, '0')}.txt`, kind: 'code', text: 'sibling ' + i + '\n'}))];
await runPCase({caseId: 'M9-T-N08', tag: 'n08-scroll', run: async ({app, r, ev, mount, setStage}) => {
  const scope = '#p-host .file-workspace', rowSel = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`;
  await mount({theme: 'light', files});
  const open = async (n, ready) => { await wheelToEdge(app, '#p-host .fw-tree-scroll', 'y', -1); await app.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(n))})`); const p = await point(app, rowSel(n)); p.x = p.left + 60; await mouse(app, p); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n.split('/').pop())})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  const mark = (js) => ev(js);
  setStage('tree'); await open('a-long.md', `!!document.querySelector('#p-host .fw-markdown p, #p-host article p, #p-host [class*=markdown] p')`);
  r.checks.push(await scenario(app, {name: 'tree', selector: '#p-host .fw-tree-scroll', scope}));
  setStage('body'); const body = await mark(() => { let e = document.querySelector('#p-host .fw-markdown p, #p-host article p, #p-host [class*=markdown] p'); while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)) e = e.parentElement; if (!e) return null; e.setAttribute('data-n08-target', 'body'); return {cls: (e.className || '').toString().slice(0, 50), tag: e.tagName}; });
  assert(body, 'no scrollable ancestor of the Markdown body in P'); r.bodyTarget = body;
  r.checks.push(await scenario(app, {name: 'body (Markdown)', selector: '[data-n08-target=body]', scope}));
  setStage('code-horizontal'); await open('a-wide.txt', `!!document.querySelector('#p-host textarea')`);
  r.checks.push(await scenario(app, {name: 'code (horizontal)', selector: '#p-host textarea', scope, axis: 'x', dragBy: 60, companions: ['#p-host .fw-code-overlay > pre']}));
  setStage('pdf'); await open('a-doc.pdf', `(()=>{const c=document.querySelectorAll('#p-host .fw-pdf-page canvas');return c.length>0&&c[0].width>0})()`);
  r.checks.push(await scenario(app, {name: 'PDF', selector: '#p-host .fa-pdf-scroll', scope}));
  setStage('popover'); await wheelToEdge(app, '#p-host .fw-tree-scroll', 'y', -1); await app.waitFor(`!!document.querySelector(${JSON.stringify(rowSel('sub'))})`); { const p = await point(app, rowSel('sub')); p.x = p.left + 60; await mouse(app, p); }
  await app.waitFor(`!!document.querySelector(${JSON.stringify(rowSel('sub/s-00.txt'))})`); await open('sub/s-00.txt', `!!document.querySelector('#p-host textarea')`);
  r.crumbs = await ev(() => [...document.querySelectorAll('#p-host .fw-breadcrumb button')].map((b) => b.textContent));
  await mouse(app, await point(app, `#p-host .fw-breadcrumb button[title$="/sub"], #p-host .fw-breadcrumb button:nth-of-type(2)`)); await ev(() => new Promise((x) => setTimeout(x, 600)));
  const found = await mark(() => { const cand = [...document.querySelectorAll('.fw-menu, .fw-menu *, .fw-breadcrumb-list, [role=dialog] *')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1); const e = cand.at(-1); if (!e) return null; e.setAttribute('data-n08-target', 'popover'); return {cls: (e.className || '').toString().slice(0, 60), tag: e.tagName, sh: e.scrollHeight, ch: e.clientHeight}; });
  assert(found, 'P directory popover with a scrollable list not found; crumbs: ' + JSON.stringify(r.crumbs)); r.popoverTarget = found;
  r.checks.push(await scenario(app, {name: 'popover (breadcrumb directory)', selector: '[data-n08-target=popover]', scope: 'body'}));
}});
