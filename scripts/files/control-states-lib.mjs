// N05: four-state audit (default / hover / selected / focus-visible / disabled) with assertions, shared by the A and P drivers.
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {auditControls} from './visual-audit-lib.mjs';

const STYLE = `(e)=>{const cs=getComputedStyle(e),b=e.getBoundingClientRect();return{color:cs.color,bg:cs.backgroundColor,shadow:cs.boxShadow,outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,opacity:cs.opacity,cursor:cs.cursor,w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,focusVisible:e.matches(':focus-visible')}}`;
const differs = (a, b) => ['color', 'bg', 'shadow', 'opacity'].some((k) => a[k] !== b[k]);
const hasRing = (s) => /^(solid|auto)/.test(s.outline) && !/ 0px /.test(s.outline);

export async function runControlStates({app, scope, ev, tabs, openTreeRow, noopProbe, allowNoFocus = {}}) {
  const out = {};
  // 1) enumerated controls
  const controls = await auditControls(app, scope, {maxTree: 3}); out.controlCount = controls.length;
  const problems = [];
  for (const c of controls) {
    const name = c.label || c.tag;
    if (!c.label && c.tag !== 'textarea') problems.push(`${c.tag}: no accessible name`);
    if (c.flags.disabled) { assert(Number(c.default.opacity) < 1 || c.default.color !== c.hover.color, `${name}: disabled not visually distinct`); continue; }
    if (!c.focus || !(hasRing(c.focus) || differs(c.default, c.focus))) {
      const reason = c.tag === 'textarea' ? 'editor surface: caret instead of a ring' : allowNoFocus[c.label];
      if (reason) (out.exceptions ??= []).push({label: c.label, tag: c.tag, reason}); else problems.push(`${name}: no focus-visible indicator`);
    }
    const isIconButton = c.tag === 'button' && !c.role && c.default.w <= 40;
    if (isIconButton && (c.default.w < 22 || c.default.h < 22)) problems.push(`${name}: hit area ${c.default.w}x${c.default.h} < 22`);
    if (c.tag === 'button' && !c.role && !c.hover.hover) problems.push(`${name}: hover not applied`);
  }
  out.problems = problems; out.controls = controls.map((c) => ({label: c.label, tag: c.tag, role: c.role, flags: c.flags, w: c.default.w, h: c.default.h, hoverChanged: differs(c.default, c.hover), focusRing: c.focus ? c.focus.outline : null, opacityDefault: c.default.opacity}));
  assert.deepEqual(problems, [], 'control state problems:\n' + problems.join('\n'));
  // 2) tab container states (needs two pinned tabs)
  const t = await tabs(); out.tabs = t;
  assert(differs(t.selected, t.unselectedDefault) || t.selected.bg !== t.unselectedDefault.bg, 'selected tab not distinguishable from unselected');
  out.tabHoverFeedback = differs(t.unselectedDefault, t.unselectedHover); // approved design may have none: A must not have less than P (checked in the compare step)
  // 3) tree row states
  const row = await openTreeRow(); out.treeRow = row;
  assert(differs(row.default, row.hover), 'tree row shows no hover feedback'); assert(differs(row.default, row.selected), 'selected tree row not distinguishable'); assert(hasRing(row.focus) || differs(row.default, row.focus), 'tree row has no focus indicator');
  // 4) disabled controls do nothing when clicked with the real mouse
  const noop = await noopProbe(); out.disabledClick = noop; assert(noop.unchanged, 'clicking a disabled control changed state: ' + JSON.stringify(noop));
  return out;
}
export {STYLE};
