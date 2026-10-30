// N12: SVG / PDF / icons / dividers under host zoom 100/125/150% and DPR 2 (real display) / DPR 1 (CDP-emulated), packaged App.
import assert from 'node:assert/strict';
import {point, runNCase} from './n-case-kit.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#fff"/><rect x="10" y="10" width="100" height="60" fill="none" stroke="#1a85d4" stroke-width="2"/><circle cx="60" cy="40" r="20" fill="#d52c36"/></svg>\n';
const stream = '0.1 0.5 0.8 rg 20 20 100 60 re f BT /F1 18 Tf 30 130 Td (N12 zoom DPR) Tj ET';
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n`;
const files = {'shape.svg': svg, 'doc.pdf': pdf, 'a-note.txt': 'N12 note\n'};

await runNCase({caseId: 'M9-T-N12', tag: 'n12-zoom', files, run: async ({app, r, setStage, theme}) => {
  const ev = (f, ...a) => app.evaluate('(' + f.toString() + ')(...' + JSON.stringify(a) + ')');
  const settle = () => ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 150)))));
  const hostZoom = (zoom) => app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));w.webContents.setZoomFactor(${zoom});return{zoom:w.webContents.getZoomFactor(),content:w.getContentBounds()}})()`);
  const emulateDpr = async (dpr) => {
    if (dpr === 'real') { await app.cdp('Emulation.clearDeviceMetricsOverride'); return; }
    const v = await ev(() => ({w: innerWidth, h: innerHeight})); await app.cdp('Emulation.setDeviceMetricsOverride', {width: v.w, height: v.h, deviceScaleFactor: dpr, mobile: false});
  };
  const env = () => ev(() => ({dpr: devicePixelRatio, inner: [innerWidth, innerHeight], visualScale: visualViewport.scale}));
  const iconInfo = () => ev(() => { const i = document.querySelector('.fw-file-icon'); const b = i?.getBoundingClientRect(); return i ? {cssW: b.width, cssH: b.height, devW: b.width * devicePixelRatio, devH: b.height * devicePixelRatio} : null; });
  const dividerInfo = () => ev(() => { const el = document.querySelector('.fw-tree-resizer'); if (!el) return null; const b = el.getBoundingClientRect(), cs = getComputedStyle(el), before = getComputedStyle(el, '::before'); return {cssW: b.width, cssH: b.height, left: b.left, borderLeft: cs.borderLeftWidth, beforeW: before.width, beforeBg: before.backgroundColor, bg: cs.backgroundColor}; });
  const openFile = async (name, ready) => { await app.open(name); await app.waitFor(`document.querySelector('.fw-breadcrumb')?.textContent.includes(${JSON.stringify(name)})`); await app.waitFor(ready); };

  await emulateDpr('real'); await hostZoom(1); await settle(); const baseDpr = (await env()).dpr; r.baseDpr = baseDpr;
  for (const mode of ['light', 'dark']) {
    await theme(mode); await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(mode === 'dark' ? 'ydark' : 'ylight')})`);
    for (const dpr of ['real', 1]) for (const zoom of [1, 1.25, 1.5]) {
      const tag = `${mode}:dpr-${dpr}:zoom-${zoom}`; setStage(tag + ':setup');
      await emulateDpr('real'); const z = await hostZoom(zoom); await settle(); await emulateDpr(dpr); await settle();
      const e = await env();
      const expectedDpr = (dpr === 'real' ? baseDpr : dpr) * zoom; // Chromium effective DPR = base device scale x host zoom
      assert(Math.abs(e.dpr - expectedDpr) < 0.01, `effective DPR ${e.dpr} != base ${dpr === 'real' ? baseDpr : dpr} x zoom ${zoom}`);

      setStage(tag + ':svg');
      await openFile('shape.svg', `(()=>{const i=document.querySelector('.fw-image img');return !!i&&i.complete&&i.naturalWidth>0})()`);
      const img = await ev(() => { const i = document.querySelector('.fw-image img'), b = i.getBoundingClientRect(), box = i.parentElement.getBoundingClientRect(); return {natural: [i.naturalWidth, i.naturalHeight], css: [b.width, b.height], box: [box.width, box.height], inside: b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1, objectFit: getComputedStyle(i).objectFit}; });
      assert(img.css[0] > 0 && img.css[1] > 0 && img.inside, 'SVG not fully inside its container: ' + JSON.stringify(img));
      assert(Math.abs(img.css[0] / img.css[1] - img.natural[0] / img.natural[1]) < 0.02 || img.objectFit === 'contain', 'SVG aspect distorted: ' + JSON.stringify(img));

      setStage(tag + ':pdf');
      await openFile('doc.pdf', `(()=>{const c=document.querySelector('.fw-pdf-page canvas');return !!c&&c.width>0&&c.height>0})()`);
      await settle();
      const canvas = await ev(() => { const c = document.querySelector('.fw-pdf-page canvas'), b = c.getBoundingClientRect(); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) ink++; return {backing: [c.width, c.height], css: [b.width, b.height], ratioX: c.width / b.width, ratioY: c.height / b.height, ink}; });
      assert(canvas.ink > 0, 'PDF canvas blank');
      assert(canvas.ratioX >= e.dpr * 0.95, `PDF backing store under-sampled for DPR ${e.dpr}: ${JSON.stringify(canvas)}`);
      assert(Math.abs(canvas.ratioX - canvas.ratioY) / canvas.ratioX < 0.02, 'PDF canvas aspect distorted');

      setStage(tag + ':icon+divider');
      const icon = await iconInfo(); assert(icon && icon.cssW === 16 && icon.cssH === 16, 'tree icon CSS size changed: ' + JSON.stringify(icon));
      const divider = await dividerInfo(); assert(divider && divider.cssH > 0, 'tree divider missing');
      assert(divider.cssW > 0, '1px divider vanished: ' + JSON.stringify(divider));

      setStage(tag + ':drag');
      const left = () => ev(() => document.querySelector('.fw-tree-resizer').getBoundingClientRect().left);
      const dragBy = async (dx) => {
        const b0 = await left(), p = await point(app, '.fw-tree-resizer'); const hit = await ev((x, y) => !!document.elementFromPoint(x, y)?.closest('.fw-tree-resizer'), p.x, p.y); assert(hit, 'resizer hit target occluded');
        await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); await app.cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1});
        for (let i = 1; i <= 8; i++) await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x + dx * i / 8, y: p.y, button: 'left', buttons: 1});
        await app.cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x + dx, y: p.y, button: 'left', buttons: 0, clickCount: 1}); await settle();
        return {dx, before: b0, after: await left(), moved: (await left()) - b0};
      };
      const widths = () => ev(() => { const e = document.querySelector('.fw-tree-resizer'); return {min: Number(e.getAttribute('aria-valuemin')), max: Number(e.getAttribute('aria-valuemax')), now: Number(e.getAttribute('aria-valuenow')), treeCss: document.querySelector('[role=tree]')?.getBoundingClientRect().width}; });
      let drag = await dragBy(-40); const dragNotes = [];
      if (Math.abs(drag.moved + 40) > 3) {
        const w = await widths(); dragNotes.push({clampedLeft: drag, widths: w});
        assert(Number.isFinite(w.max) && w.now >= w.max - 1 && drag.moved <= 0.5, 'left drag fell short of 40px but the tree is not clamped at its aria max: ' + JSON.stringify({drag, w}));
        drag = await dragBy(40); assert(Math.abs(drag.moved - 40) <= 3, 'right drag did not follow the pointer: ' + JSON.stringify(drag));
      }
      r.checks.push({mode, dpr, zoom, scenario: 'SVG inside container & undistorted; PDF canvas non-blank, backing store >= DPR, aspect kept; 16px icon; divider present and follows a 40px real drag', env: e, host: z, img, canvas, icon, divider, drag, dragNotes});
    }
  }
  await emulateDpr('real'); await hostZoom(1);
  r.boundary = 'DPR 2 is the real display; DPR 1 is CDP Emulation.setDeviceMetricsOverride (renderer emulation, not a physical 1x display). Host zoom is real webContents zoom. darwin/arm64 only.';
}});
