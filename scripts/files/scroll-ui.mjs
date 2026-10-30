// N08 (A): wheel, edge and scrollbar-thumb drag per scroll container in the packaged App.
import assert from 'node:assert/strict';
import {mouse, point, runNCase} from './n-case-kit.mjs';
import {multiPagePdf, scenario, wheelToEdge} from './scroll-lib.mjs';

const files = {
  'a-long.md': Array.from({length: 300}, (_, i) => `段落 ${i} Paragraph body text 中文内容\n`).join('\n'),
  'a-wide.txt': 'WIDE ' + 'x'.repeat(3000) + '\nsecond line\n',
  'a-doc.pdf': multiPagePdf(10),
};
for (let i = 0; i < 80; i++) files[`f-${String(i).padStart(2, '0')}.txt`] = 'filler ' + i + '\n';
for (let i = 0; i < 60; i++) files[`sub/s-${String(i).padStart(2, '0')}.txt`] = 'sibling ' + i + '\n';

await runNCase({caseId: 'M9-T-N08', tag: 'n08-scroll', files, run: async ({app, r, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const scope = '[data-testid=file-workspace]';
  await theme('light'); await app.waitFor(`document.documentElement.classList.contains('ylight')`);
  const open = async (name, ready) => { await wheelToEdge(app, '.fw-tree-scroll', 'y', -1); await app.open(name); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(name.split('/').pop())})`); await app.waitFor(ready); await ev(() => new Promise((x) => setTimeout(x, 500))); };
  setStage('tree'); await open('a-long.md', `!!document.querySelector('.fw-md-paragraph')`);
  r.checks.push(await scenario(app, {name: 'tree', selector: '.fw-tree-scroll', scope}));
  setStage('body'); r.checks.push(await scenario(app, {name: 'body (Markdown)', selector: '.cm-scroller', scope}));
  setStage('code-horizontal'); await open('a-wide.txt', `!!document.querySelector('.cm-line')`); await ev(() => document.querySelector('.cm-content').classList.remove('cm-lineWrapping'));
  const wrap = await ev(() => { const s = document.querySelector('.cm-scroller'); return {scrollWidth: s.scrollWidth, clientWidth: s.clientWidth}; }); assert(wrap.scrollWidth > wrap.clientWidth, 'wide.txt does not overflow horizontally (wrapping on?): ' + JSON.stringify(wrap));
  r.checks.push(await scenario(app, {name: 'code (horizontal)', selector: '.cm-scroller', scope, axis: 'x', dragBy: 60}));
  setStage('pdf'); await open('a-doc.pdf', `(()=>{const c=document.querySelectorAll('.fw-pdf-page canvas');return c.length>0&&c[0].width>0})()`);
  r.checks.push(await scenario(app, {name: 'PDF', selector: '.fw-pdf-scroll', scope}));
  setStage('popover'); await open('sub/s-00.txt', `!!document.querySelector('.cm-line')`);
  const crumbs = await ev(() => [...document.querySelectorAll('.fw-breadcrumb button')].map((b) => b.textContent)); r.crumbs = crumbs;
  await app.click('.fw-breadcrumb button', 'sub'); await ev(() => new Promise((x) => setTimeout(x, 600)));
  const found = await ev(() => { const cand = [...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1 && e.closest('[role=menu],[role=dialog],[role=listbox],.fw-breadcrumb-menu,[class*=menu],[class*=popover]')); const e = cand.at(-1); if (!e) return null; e.setAttribute('data-n08-target', '1'); return {cls: (e.className || '').toString().slice(0, 60), tag: e.tagName, role: e.closest('[role]')?.getAttribute('role'), sh: e.scrollHeight, ch: e.clientHeight}; });
  assert(found, 'directory popover with a scrollable list not found after clicking the "sub" crumb; crumbs: ' + JSON.stringify(crumbs)); r.popoverTarget = found;
  r.checks.push(await scenario(app, {name: 'popover (breadcrumb directory)', selector: '[data-n08-target]', scope: 'body'}));
  await app.key('Escape', 'Escape');
}});
