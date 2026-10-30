import { expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
import { PptxBuffer } from './pptx-buffer';

it('invalidates the old generation selection even when selection returns to the same object, without coupling zoom', () => {
  const host = { pdfPosition: { page: 1, zoom: 100 }, notify: vi.fn() };
  const buffer = new PptxBuffer(host as unknown as FileBuffer);
  buffer.result = { id: 'selection', sourceHash: 'public', state: { version: 0, dirty: false, canUndo: false, canRedo: false, protected: false,
    info: { kind: 'pptx', signed: false, externalLinks: 0, hasRevisions: false, slides: [
      { id: '256', title: '', notes: '', hidden: false, elements: [{ id: '1', name: 'Placeholder', kind: 'image', hidden: false }, { id: '2', name: 'Chart', kind: 'chart', hidden: false }] },
      { id: '257', title: '', notes: '', hidden: false, elements: [] },
    ] } } };
  buffer.selectElement('256', '1'); const captured = buffer.selectionRevision;
  buffer.selectElement('256', '1'); expect(buffer.selectionRevision).toBe(captured);
  host.pdfPosition.zoom = 200; buffer.selectElement('256', '1'); expect(buffer.selectionRevision).toBe(captured);
  buffer.selectElement('256', '2'); buffer.selectElement('256', '1');
  expect(buffer.selection).toEqual({ slideId: '256', elementId: '1' }); expect(buffer.selectionRevision).toBe(captured + 2);
  buffer.selectElement('257'); expect(buffer.selectionRevision).toBe(captured + 3);
});
