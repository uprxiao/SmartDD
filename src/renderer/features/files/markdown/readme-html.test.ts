import { expect, it } from 'vitest';
import { analyze, renderWindow } from './model.mjs';
import { renderMarkdownReadOnly } from './file-markdown-model.mjs';

it('previews README pictures, links and tables while preserving source ranges', () => {
  const source = [
    '<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg"><img src="docs/logo.svg" width="260" alt="Project"></picture></p>',
    '',
    '<table><tr><td width="180"><a href="https://example.org"><img src="docs/sponsor.svg"></a></td><td>Text<br>next line</td></tr></table>',
    '',
    '# After the table',
  ].join('\r\n');
  const { parsed, index } = analyze(source);
  const items = renderWindow(parsed, 0, 60);
  const html = items.map(item => item.html).join('');
  expect(index.at(-3)).toBe(source.length);
  expect(items.map(item => source.slice(item.from, item.to)).join('')).toBe(source);
  expect(html).toContain('data-md-src="docs/logo.svg"');
  expect(html).toContain('data-md-src-dark="docs/logo-dark.svg"');
  expect(html).toContain('<table>');
  expect(html).toContain('data-md-href="https://example.org"');
  expect(html).toContain('Text<br>next line');
  expect(html).not.toContain('&lt;table');
  expect(renderMarkdownReadOnly(source)).toContain('&lt;table');
});

it('drops executable tags, untrusted attributes and automatic picture requests', () => {
  const source = '<div onclick="bad()" style="background:red"><script>bad()</script><iframe src="https://example.org"></iframe><svg><foreignObject>unsafe</foreignObject></svg><img src="https://example.org/badge.svg" srcset="https://example.org/auto.svg" onerror="bad()"><a href="jav&#x61;script:bad()" class="fw-system">link</a><p>Visible</p></div>';
  const [item] = renderWindow(analyze(source).parsed, 0, 60);
  expect(item.html).toContain('data-md-src="https://example.org/badge.svg"');
  expect(item.html).toContain('<p>Visible</p>');
  expect(item.html).not.toMatch(/<(?:script|iframe|svg)|\ssrc=|srcset|on(?:click|error)|style=|javascript:|fw-system|bad\(\)/i);
});
