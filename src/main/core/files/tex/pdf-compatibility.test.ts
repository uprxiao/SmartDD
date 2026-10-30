import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { normalizeBlankPdfPages } from './pdf-compatibility';

describe('private TeX blank PDF compatibility', () => {
  it('does not serialize a PDF whose pages already have content', async () => {
    const document = await PDFDocument.create(); document.addPage().drawText('Existing vector content');
    expect(await normalizeBlankPdfPages(await document.save())).toBeNull();
  });
  it('adds an empty stream only to missing Contents pages and preserves page attributes, existing content and original bytes', async () => {
    const document = await PDFDocument.create(); document.setTitle('Original fixture title');
    const blank = document.addPage([200, 100]); blank.setRotation(degrees(90));
    document.addPage([300, 200]).drawText('Keep this vector text');
    const original = await document.save({ useObjectStreams: false }), hash = createHash('sha256').update(original).digest('hex');
    const before = await PDFDocument.load(original), existing = before.getPage(1).node.get(PDFName.of('Contents'))!.toString();
    const result = await normalizeBlankPdfPages(original); expect(result).not.toBeNull();
    const restored = await PDFDocument.load(result!); expect(restored.getPageCount()).toBe(2); expect(restored.getTitle()).toBe('Original fixture title');
    expect(restored.getPage(0).getSize()).toEqual({ width: 200, height: 100 }); expect(restored.getPage(0).getRotation().angle).toBe(90);
    expect(restored.getPage(0).node.Contents()).toBeTruthy(); expect(restored.getPage(1).node.get(PDFName.of('Contents'))!.toString()).toBe(existing);
    expect(createHash('sha256').update(original).digest('hex')).toBe(hash); expect(await normalizeBlankPdfPages(result!)).toBeNull();
  });
  it('rejects malformed input instead of replacing source data', async () => {
    await expect(normalizeBlankPdfPages(new TextEncoder().encode('not a PDF'))).rejects.toThrow();
  });
});
