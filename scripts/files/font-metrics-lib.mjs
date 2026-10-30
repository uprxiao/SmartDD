// N03: typography measurement shared by the A and P drivers.
import assert from 'node:assert/strict';

export const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];

export async function measureDomain(app, selector) {
  const m = await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const cs=getComputedStyle(e);const b=e.getBoundingClientRect();return{text:e.textContent.slice(0,24),fontFamily:cs.fontFamily,fontSize:cs.fontSize,fontWeight:cs.fontWeight,lineHeight:cs.lineHeight,letterSpacing:cs.letterSpacing,visible:b.width>0&&b.height>0}})()`);
  assert(m && m.visible, 'missing or hidden typography target: ' + selector);
  return m;
}

// Mixed Latin/CJK line: with the element's font settings, line height and baseline must not shift between scripts.
export async function baselineCheck(app, style) {
  const out = await app.evaluate(`((style)=>{const mk=(text)=>{const d=document.createElement('div');Object.assign(d.style,{position:'fixed',left:'0',top:'0',whiteSpace:'nowrap',visibility:'hidden'},style);const s=document.createElement('span');s.textContent=text;const m=document.createElement('span');m.style.cssText='display:inline-block;width:0;height:0';d.append(s,m);document.body.append(d);const dr=d.getBoundingClientRect(),mr=m.getBoundingClientRect(),o={height:dr.height,baseline:mr.bottom-dr.top};d.remove();return o};return{latin:mk('Latin Only 0123'),cjk:mk('中文测试文字'),mixed:mk('Latin 中文 mixed 0123')}})(${JSON.stringify(style)})`);
  const hs = [out.latin.height, out.cjk.height, out.mixed.height], bs = [out.latin.baseline, out.cjk.baseline, out.mixed.baseline];
  assert(Math.max(...hs) - Math.min(...hs) <= 0.5, 'line height shifts between scripts: ' + JSON.stringify(out));
  assert(Math.max(...bs) - Math.min(...bs) <= 1, 'baseline shifts between scripts: ' + JSON.stringify(out));
  return out;
}

// Platform fonts actually used (Latin vs CJK fallback) via the DevTools CSS domain.
export async function platformFonts(app, selector) {
  // The CSS domain only reports fonts for elements that directly own a text node: mark the first such element under the target.
  const marked = await app.evaluate(`(()=>{document.querySelectorAll('[data-n03-probe]').forEach(e=>e.removeAttribute('data-n03-probe'));const root=document.querySelector(${JSON.stringify(selector)});if(!root)return false;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(n.textContent.trim()&&n.parentElement){n.parentElement.setAttribute('data-n03-probe','1');return true}}return false})()`);
  if (!marked) return [];
  await app.cdp('DOM.enable'); await app.cdp('CSS.enable');
  try {
    const doc = await app.cdp('DOM.getDocument', {depth: 0}), node = await app.cdp('DOM.querySelector', {nodeId: doc.root.nodeId, selector: '[data-n03-probe="1"]'});
    assert(node.nodeId, 'no node for ' + selector);
    const res = await app.cdp('CSS.getPlatformFontsForNode', {nodeId: node.nodeId});
    return res.fonts.map((f) => ({family: f.familyName, glyphs: f.glyphCount, custom: f.isCustomFont}));
  } finally { await app.cdp('CSS.disable'); await app.cdp('DOM.disable'); await app.evaluate(`document.querySelectorAll('[data-n03-probe]').forEach(e=>e.removeAttribute('data-n03-probe'))`); }
}

export async function measureAll(app, domains) {
  const rows = {};
  for (const [name, spec] of Object.entries(domains)) {
    const selector = typeof spec === 'string' ? spec : spec.selector, fontsSelector = typeof spec === 'string' ? spec : spec.fontsSelector;
    const m = await measureDomain(app, selector); const style = {fontFamily: m.fontFamily, fontSize: m.fontSize, fontWeight: m.fontWeight, lineHeight: m.lineHeight, letterSpacing: m.letterSpacing};
    rows[name] = {selector, ...m, baseline: await baselineCheck(app, style), fonts: await platformFonts(app, fontsSelector), fontsSource: fontsSelector};
    assert(rows[name].fonts.length > 0, name + ': no platform font reported');
    assert(!/^normal$/.test(m.lineHeight), name + ': line-height is "normal" (not pinned)');
  }
  return rows;
}
