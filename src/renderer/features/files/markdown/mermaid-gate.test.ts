import { describe, expect, it } from 'vitest';
import { analyze, renderWindow } from './model.mjs';
import { codeBody } from './file-markdown-model.mjs';
import { mermaidGateCases } from '../../../../../scripts/files/markdown-mermaid-gate-fixtures.mjs';

describe('X09 actual Markdown-it Mermaid fence grammar', () => {
  it.each(mermaidGateCases)('$id keeps exact source and strictly gates the full fence', fixture => {
    const { parsed, index } = analyze(fixture.source), rawBlocks = (parsed as { blocks: { type: string; raw: string }[] }).blocks, blocks = rawBlocks.filter(block => block.type === 'code' || block.type === 'mermaid');
    expect(blocks).toHaveLength(1); expect(blocks[0].type === 'mermaid').toBe(fixture.diagram); expect(blocks[0].raw).toContain(fixture.block);
    expect(rawBlocks.map(block => block.raw).join('')).toBe(fixture.source); expect(index.at(-3)).toBe(fixture.source.length);
    const item = renderWindow(parsed, 0, 60).find(item => item.type === blocks[0].type)!;
    if (fixture.diagram) expect(item.source).toBe(codeBody(blocks[0])); else { expect(item.source).toBeUndefined(); expect(item.html).toContain('<pre><code>'); }
  });
});
