// N03 (A): typography of body / code / tree / breadcrumb / tab in the packaged App, light and dark.
import assert from 'node:assert/strict';
import {runNCase} from './n-case-kit.mjs';
import {measureAll} from './font-metrics-lib.mjs';

const files = {'doc.md': '# 标题 Title\n\n正文 Body text 中文 mixed 0123.\n', 'code.txt': 'const value = 1 // 中文 mixed 0123\n'};
await runNCase({caseId: 'M9-T-N03', tag: 'n03-fonts', files, run: async ({app, r, setStage, theme}) => {
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    setStage(mode + ':open'); await app.open('doc.md'); await app.waitFor(`document.querySelector('.fw-md-paragraph')?.textContent.includes('Body text')`);
    const body = await measureAll(app, {body: '.fw-md-paragraph', tree: '.fw-tree-name', breadcrumb: '.fw-breadcrumb button.current', tab: '.fw-tab.selected button[role=tab] span'});
    await app.open('code.txt'); await app.waitFor(`document.querySelector('.cm-line')?.textContent.includes('const value')`);
    const code = await measureAll(app, {code: '.cm-line'});
    r.checks.push({mode, domains: {...body, ...code}});
  }
}});
