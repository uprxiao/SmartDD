import { describe, expect, it } from 'vitest';
import { analyze, renderWindow } from '../renderer/features/files/markdown/model.mjs';
import { markdownMarkerRevealed, markdownNodeRevealed } from './markdown-inline-plan.mjs';

// R2 M02: archived raw 52f1dc3d…1150, ar/1673–1764. These literal
// boundary expectations distinguish the reference from our former broad rule.
const plans = (source: string) => renderWindow(analyze(source).parsed, 0, 60).flatMap(item => item.inline ?? []);
const caret = (at: number) => [{ from: at, to: at }];

describe('X03 archived node selection and focus contract', () => {
  it.each([1, 2, 3, 4, 5, 6])('reveals heading %i only at its own marker, including one following space', level => {
    const source = '  ' + '#'.repeat(level) + '  Title &amp;\r\n';
    const heading = plans(source).find(node => node.kind === 'heading')!;
    expect(markdownNodeRevealed(heading, caret(2), true)).toBe(true);
    expect(markdownNodeRevealed(heading, caret(2 + level + 1), true)).toBe(true);
    expect(markdownNodeRevealed(heading, caret(source.indexOf('Title') + 2), true)).toBe(false);
    expect(markdownNodeRevealed(heading, [{ from: 0, to: 2 }], true)).toBe(false);
    expect(markdownNodeRevealed(heading, caret(2), false)).toBe(false);
  });

  it('keeps formatting, link and inline-code markers hidden for merely touching selections', () => {
    for (const node of plans('A **bold** [link](target.txt) `code` Z\n').filter(node => ['format', 'link', 'code'].includes(node.kind))) {
      expect(markdownNodeRevealed(node, caret(node.from), true)).toBe(false);
      expect(markdownNodeRevealed(node, caret(node.to), true)).toBe(false);
      expect(markdownNodeRevealed(node, [{ from: 0, to: node.from }], true)).toBe(false);
      expect(markdownNodeRevealed(node, [{ from: node.to, to: node.to + 1 }], true)).toBe(false);
      expect(markdownNodeRevealed(node, caret(node.from + 1), true)).toBe(true);
    }
  });

  it('uses inclusive entity carets and strict nonempty selection overlap', () => {
    const node = plans('A &amp; Z\n').find(node => node.kind === 'entity')!;
    expect(markdownNodeRevealed(node, caret(node.from), true)).toBe(true);
    expect(markdownNodeRevealed(node, caret(node.to), true)).toBe(true);
    expect(markdownNodeRevealed(node, [{ from: 0, to: node.from }], true)).toBe(false);
    expect(markdownNodeRevealed(node, [{ from: node.to, to: node.to + 1 }], true)).toBe(false);
  });

  it('reveals an entity while editing enclosing emphasis, even outside the entity itself', () => {
    const source = '**left &amp; right**\n', node = plans(source).find(node => node.kind === 'entity')!;
    expect(markdownNodeRevealed(node, caret(source.indexOf('left') + 1), true)).toBe(true);
    expect(markdownNodeRevealed(node, caret(0), true)).toBe(false);
    expect(markdownNodeRevealed(node, caret(source.indexOf('left') + 1), false)).toBe(false);
  });

  it('keeps entities in titled and reference-style links literal even without editor focus', () => {
    for (const source of ['[&amp;](target.txt "Title")\n', '[&amp;][target]\n\n[target]: target.txt\n']) {
      const node = plans(source).find(node => node.kind === 'entity')!;
      expect(markdownNodeRevealed(node, [], false)).toBe(true);
    }
  });

  it('reveals a heading entity at the heading marker, rather than elsewhere in its text', () => {
    const source = '#### Title &amp; tail\n', node = plans(source).find(node => node.kind === 'entity')!;
    expect(markdownNodeRevealed(node, caret(2), true)).toBe(true);
    expect(markdownNodeRevealed(node, caret(source.indexOf('Title') + 1), true)).toBe(false);
  });

  it('preserves extra heading whitespace and the newline before a Setext marker', () => {
    const source = '  ##  Title ##  \r\n\r\nSetext\r\n===\r\n';
    const headings = plans(source).filter(node => node.kind === 'heading');
    expect(headings[0].parts!.map(([from, to]) => source.slice(from, to))).toEqual(['## ', '## ']);
    expect(headings[1].parts!.map(([from, to]) => source.slice(from, to))).toEqual(['===']);
  });

  it('reveals opening and closing heading marks independently', () => {
    const source = '## Title ##  \n', node = plans(source).find(node => node.kind === 'heading')!;
    expect(markdownMarkerRevealed(node, 0, caret(1), true)).toBe(true);
    expect(markdownMarkerRevealed(node, 1, caret(1), true)).toBe(false);
    expect(markdownMarkerRevealed(node, 0, caret(10), true)).toBe(false);
    expect(markdownMarkerRevealed(node, 1, caret(10), true)).toBe(true);
    expect(markdownMarkerRevealed(node, 0, [{ from: 2, to: 3 }], true)).toBe(false);
    expect(markdownMarkerRevealed(node, 1, [{ from: 11, to: 12 }], true)).toBe(false);
  });

  it('keeps titled and reference-link marks visible without focus but preserves ordinary link behavior', () => {
    for (const source of ['[label](target.txt "")\n', '[label][target]\n\n[target]: target.txt\n']) {
      const node = plans(source).find(node => node.kind === 'link')!;
      expect(markdownMarkerRevealed(node, 0, [], false)).toBe(true);
      expect(markdownMarkerRevealed(node, 1, [], false)).toBe(true);
    }
    const node = plans('[label](target.txt)\n').find(node => node.kind === 'link')!;
    expect(markdownMarkerRevealed(node, 0, [], false)).toBe(false);
  });

  it.each(['`X03Code`', '``a ` b``', '` code `'])('keeps inline-code body in source while hiding only CodeMark: %s', raw => {
    const source = 'A ' + raw + ' Z\r\n', node = plans(source).find(node => node.kind === 'code')!;
    const marker = raw.match(/^`+/)![0];
    expect(node.parts?.map(([from, to]) => source.slice(from, to))).toEqual([marker, marker]);
    expect(source.slice(node.contentFrom, node.contentTo)).toBe(raw.slice(marker.length, -marker.length));
    expect(markdownMarkerRevealed(node, 0, caret(node.from), true)).toBe(false);
    expect(markdownMarkerRevealed(node, 0, caret(node.contentFrom!), true)).toBe(true);
  });
});
