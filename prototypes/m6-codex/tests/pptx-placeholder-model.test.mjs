import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeHistory, editOffice, officeCapabilities, serializeOffice, createOfficeDocument } from '../src/file-office-model.mjs';

test('authored empty picture preserves genuine placeholder/frame through serialization and history', () => {
  const before = createOfficeHistory('pptx'), slideId = before.doc.slides[0].id;
  const frame = { x: 31.25, y: 42.5, width: 200, height: 125 }, caps = officeCapabilities('pptx', { manualEditing: true });
  const after = editOffice(before, { type: 'image-placeholder', slideId, frame }, caps);
  assert.deepEqual(after.doc.slides[0].elements.slice(0, -1), before.doc.slides[0].elements);
  assert.deepEqual(after.doc.slides.slice(1), before.doc.slides.slice(1));
  assert.deepEqual(after.doc.slides[0].elements.at(-1), { id: after.doc.slides[0].elements.at(-1).id, kind: 'image', isPlaceholder: true, text: '', ...frame, rotation: 0 });
  assert.deepEqual(createOfficeDocument('pptx', serializeOffice(after.doc)), after.doc);
  assert.deepEqual(editOffice(after, { type: 'undo' }, caps).doc, before.doc);
});
test('readonly and invalid placeholder bounds leave the original synthetic document unchanged', () => {
  const before = createOfficeHistory('pptx'), slideId = before.doc.slides[0].id;
  for (const [frame, caps] of [
    [{ x: 0, y: 0, width: 100, height: 100 }, { editable: false }],
    [{ x: 679, y: 0, width: 100, height: 100 }, { editable: true }],
    [{ x: 0, y: 0, width: 100, height: NaN }, { editable: true }],
  ]) assert.deepEqual(editOffice(before, { type: 'image-placeholder', slideId, frame }, caps).doc, before.doc);
});
