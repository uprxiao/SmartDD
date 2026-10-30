// N10: keyboard-only traversal with a per-stop accessibility check (CDP Accessibility domain), shared by the A and P drivers.
import assert from 'node:assert/strict';

const VK = {Tab: 9, Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, Space: 32};
export async function press(app, key, {shift = false} = {}) {
  const base = {key, code: key === 'Space' ? 'Space' : key, windowsVirtualKeyCode: VK[key], modifiers: shift ? 8 : 0};
  const activation = key === 'Enter' || key === 'Space'; // activation keys need a real keyDown with text so the browser fires the button click
  await app.cdp('Input.dispatchKeyEvent', {type: activation ? 'keyDown' : 'rawKeyDown', ...base, ...(key === 'Enter' ? {text: '\r'} : key === 'Space' ? {text: ' '} : {})});
  await app.cdp('Input.dispatchKeyEvent', {type: 'keyUp', ...base});
  await app.evaluate('new Promise(r=>setTimeout(r,50))');
}

// Accessibility role/name/description of the element that has focus, plus where it is.
export async function axOfActive(app) {
  const obj = await app.cdp('Runtime.evaluate', {expression: 'document.activeElement', returnByValue: false});
  if (!obj.result.objectId) return null;
  const node = await app.cdp('DOM.describeNode', {objectId: obj.result.objectId});
  const ax = await app.cdp('Accessibility.getPartialAXTree', {backendNodeId: node.node.backendNodeId, fetchRelatives: false});
  const n = ax.nodes[0] ?? {}; const pick = (k) => n[k]?.value ?? '';
  const where = await app.evaluate(`(()=>{const e=document.activeElement;return{tag:e.tagName.toLowerCase(),cls:(e.className||'').toString().slice(0,40),inWorkspace:!!e.closest('[data-testid=file-workspace],#p-host .file-workspace'),inMenu:!!e.closest('[role=menu],.fw-menu,[role=dialog]'),editable:e.isContentEditable||e.tagName==='TEXTAREA'||e.tagName==='INPUT'}})()`);
  return {role: pick('role'), name: pick('name'), description: pick('description'), ...where};
}

export const sig = (s) => `${s.role}|${s.name}|${s.tag}|${s.cls}`;

// Tab forward from <body> until the focus order cycles; return every stop with its accessibility info.
export async function tabWalk(app, {limit = 120} = {}) {
  await app.evaluate('document.activeElement?.blur()');
  const stops = []; const seen = new Set();
  for (let i = 0; i < limit; i++) {
    await press(app, 'Tab'); const s = await axOfActive(app); if (!s) continue; const k = sig(s);
    if (stops.length && seen.has(k) && k === sig(stops[0])) { stops.cycled = true; break; }
    if (stops.length >= 3 && sig(stops.at(-1)) === k && sig(stops.at(-2)) === k) { stops.trapped = true; break; }
    seen.add(k); stops.push(s);
  }
  return stops;
}
export function assertStops(stops, name) {
  assert(stops.length > 3, `${name}: too few Tab stops (${stops.length})`); assert(!stops.trapped, `${name}: focus trap detected`);
  const bad = stops.filter((s) => !s.role || (!s.name && !s.editable)); assert.deepEqual(bad.map((s) => s.cls), [], `${name}: stops without role/name: ${JSON.stringify(bad)}`);
}
