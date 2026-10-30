// N04: icon inventory per UI state with assertions (undo/redo pair, accessible owner), shared by the A and P drivers.
import assert from 'node:assert/strict';
import {auditIcons} from './visual-audit-lib.mjs';

export async function collectState(app, scope, name, {requireIcons = true} = {}) {
  const icons = await auditIcons(app, scope); assert(icons, `${name}: scope missing`);
  const lucide = icons.filter((i) => !i.fileIcon && i.width > 0);
  if (requireIcons) assert(lucide.length + icons.filter((i) => i.fileIcon).length > 0, `${name}: no icons found`);
  for (const i of lucide) assert(i.width > 0 && i.height > 0, `${name}: zero-size icon ${i.lucide}`);
  return {name, icons};
}
// The redo control must be the mirrored counterpart of undo: same size, and either distinct mirrored lucide shapes or a transform mirror.
export function assertUndoRedo(state) {
  const undo = state.icons.find((i) => /撤销|undo/i.test(i.owner)), redo = state.icons.find((i) => /重做|redo/i.test(i.owner));
  assert(undo && redo, 'undo/redo icons missing in the dirty state: ' + JSON.stringify(state.icons.map((i) => i.owner)));
  assert.equal(undo.width, redo.width); assert.equal(undo.height, redo.height); assert.equal(undo.strokeWidthAttr, redo.strokeWidthAttr);
  const pair = (undo.lucide || '').replace(/undo/, 'X') === (redo.lucide || '').replace(/redo/, 'X') || redo.mirror !== undo.mirror;
  assert(pair, `undo/redo are not a mirrored pair: ${undo.lucide} / ${redo.lucide} mirror ${undo.mirror}/${redo.mirror}`);
  return {undo: {lucide: undo.lucide, w: undo.width, stroke: undo.strokeWidthAttr, mirror: undo.mirror}, redo: {lucide: redo.lucide, w: redo.width, stroke: redo.strokeWidthAttr, mirror: redo.mirror}};
}
