// N12 (P): SVG / PDF / icons / dividers under host zoom 100/125/150% and DPR 2 (real display) / DPR 1 (CDP-emulated) on the prototype.
import assert from 'node:assert/strict';
import {mouse, point} from './n-case-kit.mjs';
import {runPCase} from './p-case-kit.mjs';

const files = [{path: 'a-note.txt', kind: 'code', text: 'N12 note\n'}, {path: 'shape.svg', kind: 'svg', text: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#fff"/><rect x="10" y="10" width="100" height="60" fill="none" stroke="#1a85d4" stroke-width="2"/><circle cx="60" cy="40" r="20" fill="#d52c36"/></svg>'}, {path: 'doc.pdf', kind: 'pdf', text: 'N12 记录'}];

await runPCase({caseId: 'M9-T-N12', tag: 'n12-zoom', run: async ({app, r, ev, mount, setStage}) => {
  const exists = (s) => `Boolean(document.querySelector(${JSON.stringify(s)}))`;
  const click = async (s) => mouse(app, await point(app, s));
  const row = (n) => `#p-host [role=treeitem][data-path=${JSON.stringify(n)}]`;
  const settle = () => ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 200)))));
  const hostZoom = (zoom) => app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),w=e.BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(${zoom});return{zoom:w.webContents.getZoomFactor(),content:w.getContentBounds()}})()`);
  const emulateDpr = async (dpr) => { if (dpr === 'real') { await app.cdp('Emulation.clearDeviceMetricsOverride'); return; } const v = await ev(() => ({w: innerWidth, h: innerHeight})); await app.cdp('Emulation.setDeviceMetricsOverride', {width: v.w, height: v.h, deviceScaleFactor: dpr, mobile: false}); };
  const env = () => ev(() => ({dpr: devicePixelRatio, inner: [innerWidth, innerHeight]}));
  const openRow = async (n, ready) => { await app.waitFor(exists(row(n))); await click(row(n)); await app.waitFor(`document.querySelector('#p-host .fw-breadcrumb')?.textContent.includes(${JSON.stringify(n)})`); await app.waitFor(ready); };
  const widths = () => ev(() => { const e = document.querySelector('#p-host .fw-tree-resizer'); return {min: Number(e.getAttribute('aria-valuemin')), max: Number(e.getAttribute('aria-valuemax')), now: Number(e.getAttribute('aria-valuenow'))}; });
  const left = () => ev(() => document.querySelector('#p-host .fw-tree-resizer').getBoundingClientRect().left);
  const dragBy = async (dx) => { const b0 = await left(), p = await point(app, '#p-host .fw-tree-resizer'); assert(await ev((x, y) => !!document.elementFromPoint(x, y)?.closest('.fw-tree-resizer'), p.x, p.y), 'resizer hit target occluded');
    await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1});
    for (let i = 1; i <= 8; i++) await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x + dx * i / 8, y: p.y, button: 'left', buttons: 1});
    await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x + dx, y: p.y, button: 'left', buttons: 0, clickCount: 1}); await settle(); const a = await left(); return {dx, before: b0, after: a, moved: a - b0}; };
  await emulateDpr('real'); await hostZoom(1); await settle(); const baseDpr = (await env()).dpr; r.baseDpr = baseDpr;
  for (const mode of ['light', 'dark']) {
    setStage(mode + ':mount'); await emulateDpr('real'); await hostZoom(1); await settle(); await mount({theme: mode, files});
    for (const dpr of ['real', 1]) for (const zoom of [1, 1.25, 1.5]) {
      const tag = `${mode}:dpr-${dpr}:zoom-${zoom}`; setStage(tag + ':setup');
      await emulateDpr('real'); const z = await hostZoom(zoom); await settle(); await emulateDpr(dpr); await settle(); const e = await env();
      const expected = (dpr === 'real' ? baseDpr : dpr) * zoom; assert(Math.abs(e.dpr - expected) < 0.01, `effective DPR ${e.dpr} != ${expected}`);
      setStage(tag + ':svg'); await openRow('shape.svg', `(()=>{const i=document.querySelector('#p-host .fw-image img, #p-host img[alt]');return !!i&&i.complete&&i.naturalWidth>0})()`);
      const img = await ev(() => { const i = document.querySelector('#p-host .fw-image img, #p-host img[alt]'), b = i.getBoundingClientRect(), box = i.parentElement.getBoundingClientRect(); return {natural: [i.naturalWidth, i.naturalHeight], css: [b.width, b.height], box: [box.width, box.height], inside: b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1, objectFit: getComputedStyle(i).objectFit}; });
      assert(img.css[0] > 0 && img.inside, 'SVG not inside its container: ' + JSON.stringify(img)); assert(Math.abs(img.css[0] / img.css[1] - img.natural[0] / img.natural[1]) < 0.02 || img.objectFit === 'contain', 'SVG aspect distorted');
      setStage(tag + ':pdf'); await openRow('doc.pdf', `(()=>{const c=document.querySelector('#p-host .fw-pdf-page canvas');return !!c&&c.width>0&&c.height>0})()`); await settle();
      const canvas = await ev(() => { const c = document.querySelector('#p-host .fw-pdf-page canvas'), b = c.getBoundingClientRect(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) ink++; return {backing: [c.width, c.height], css: [b.width, b.height], ratioX: c.width / b.width, ratioY: c.height / b.height, ink}; });
      assert(canvas.ink > 0, 'PDF canvas blank'); assert(canvas.ratioX >= e.dpr * 0.95, `PDF backing store under-sampled for DPR ${e.dpr}: ${JSON.stringify(canvas)}`); assert(Math.abs(canvas.ratioX - canvas.ratioY) / canvas.ratioX < 0.02, 'PDF canvas aspect distorted');
      setStage(tag + ':icon+divider');
      const icon = await ev(() => { const i = document.querySelector('#p-host .fw-file-icon'), b = i?.getBoundingClientRect(); return i ? {cssW: b.width, cssH: b.height} : null; }); assert(icon && icon.cssW === 16 && icon.cssH === 16, 'icon CSS size changed: ' + JSON.stringify(icon));
      const divider = await ev(() => { const el = document.querySelector('#p-host .fw-tree-resizer'), b = el?.getBoundingClientRect(); return el ? {cssW: b.width, cssH: b.height, left: b.left} : null; }); assert(divider && divider.cssW > 0 && divider.cssH > 0, '1px divider vanished: ' + JSON.stringify(divider));
      setStage(tag + ':drag'); let drag = await dragBy(-40); const dragNotes = [];
      if (Math.abs(drag.moved + 40) > 3) { const w = await widths(); dragNotes.push({clampedLeft: drag, widths: w}); assert(Number.isFinite(w.max) && w.now >= w.max - 1 && drag.moved <= 0.5, 'left drag fell short of 40px but not clamped at the aria max: ' + JSON.stringify({drag, w})); drag = await dragBy(40); assert(Math.abs(drag.moved - 40) <= 3, 'right drag did not follow: ' + JSON.stringify(drag)); }
      r.checks.push({mode, dpr, zoom, scenario: 'SVG inside container & undistorted; PDF canvas non-blank, backing store >= DPR, aspect kept; 16px icon; divider present and follows a 40px real drag', env: e, host: z, img, canvas, icon, divider, drag, dragNotes});
    }
  }
  await emulateDpr('real'); await hostZoom(1);
  r.boundary2 = 'DPR 2 is the real display; DPR 1 is CDP emulation; host zoom is real webContents zoom; P is the prototype dev server; darwin/arm64 only';
}});
