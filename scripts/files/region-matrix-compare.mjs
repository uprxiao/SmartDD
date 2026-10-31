// N01: per-region A vs P comparison of colors and box model (padding/margin/border/radius/shadow); differences are listed, not hidden.
import {readFileSync} from 'node:fs';
const [aPath, pPath] = process.argv.slice(2), A = JSON.parse(readFileSync(aPath)), P = JSON.parse(readFileSync(pPath));
const rows = [];
for (const mode of ['light', 'dark']) {
  const a = Object.fromEntries(A.checks.find((c) => c.mode === mode).regions.map((g) => [g.key.replace(mode + '-', ''), g])), p = Object.fromEntries(P.checks.find((c) => c.mode === mode).regions.map((g) => [g.key.replace(mode + '-', ''), g]));
  for (const k of Object.keys(a)) {
    const x = a[k], y = p[k]; const diffs = [];
    if (!y) { rows.push({mode, region: k, missingInP: true}); continue; }
    const visibleBorder = (s) => !/^0px /.test(s); // zero-width borders are not visible: do not report none vs solid noise
    for (const f of ['padding', 'margin', 'border', 'radius', 'shadow', 'bg']) { if (x.box[f] === y.box[f]) continue; if (f === 'border' && !visibleBorder(x.box[f]) && !visibleBorder(y.box[f])) continue; diffs.push({field: f, A: x.box[f], P: y.box[f]}); }
    for (const f of ['text', 'icon']) if (x[f] && y[f]) { if (x[f].fg !== y[f].fg) diffs.push({field: f + '.fg', A: x[f].fg, P: y[f].fg}); if (x[f].bg !== y[f].bg) diffs.push({field: f + '.bg', A: x[f].bg, P: y[f].bg}); }
    rows.push({mode, region: k, sizeA: [x.box.w, x.box.h], sizeP: [y.box.w, y.box.h], ratioA: x.text?.ratio ?? x.icon?.ratio, ratioP: y.text?.ratio ?? y.icon?.ratio, diffs});
  }
}
console.log(JSON.stringify({rows, diffRegions: rows.filter((r) => r.diffs?.length).length, total: rows.length}, null, 1));
