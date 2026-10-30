import test from 'node:test';
import assert from 'node:assert/strict';
import { officeCapabilities } from '../src/file-office-model.mjs';

test('PPTX annotations have their own suppression gate without changing source editing', () => {
  const host = { sourceBytes: true, canRead: true, canWrite: true, manualEditing: true, annotationsEnabled: true };
  const suppressed = officeCapabilities('pptx', { ...host, disableAnnotations: true });
  assert.equal(suppressed.editable, true);
  assert.equal(suppressed.annotate, false);
  const preview = officeCapabilities('pptx', { ...host, manualEditing: false });
  assert.equal(preview.editable, false);
  assert.equal(preview.annotate, true);
  assert.equal(officeCapabilities('pptx', { ...host, template: true }).annotate, false);
  assert.equal(officeCapabilities('pptx', { ...host, annotationsEnabled: false }).annotate, false);
  const unavailable = officeCapabilities('pptx', { ...host, interactionsDisabled: true });
  assert.equal(unavailable.editable, false);
  assert.equal(unavailable.annotate, false);
});
