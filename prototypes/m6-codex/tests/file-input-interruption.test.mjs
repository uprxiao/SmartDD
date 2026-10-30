import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, editDraft, fileScenario, setFileScenario, commitDraft } from '../src/file-workspace-model.mjs';
const roots = [{ id: 'main', path: '/fixture', hostId: 'local' }];
for (const recovery of ['edit', 'undo']) test(`interrupted candidate cannot save until explicit ${recovery}`, () => {
  const base = initialWorkspace(), key = base.active;
  const pending = setFileScenario(editDraft(base,key,'candidate','base'),key,'input-interrupted');
  const store = { task: pending };
  for (const override of [false,true]) { const result = commitDraft(store,'task',roots,key,{override}); assert.equal(result.result,'input-interrupted'); assert.equal(result.store,store); }
  assert.equal(pending.drafts[key].text,'candidate');
  const resumed = editDraft(pending,key,recovery === 'undo' ? 'base' : 'confirmed','base');
  assert.equal(fileScenario(resumed,key),'ready');
  const saved = commitDraft({task:resumed},'task',roots,key);
  assert.equal(saved.result,recovery === 'undo' ? 'clean' : 'saved');
});
