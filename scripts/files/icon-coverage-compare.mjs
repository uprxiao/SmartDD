// N04: compare icon shapes (lucide name) per owner label between A and P; sizes/strokes that differ are listed with both values.
import {readFileSync} from 'node:fs';
const [aPath, pPath] = process.argv.slice(2), A = JSON.parse(readFileSync(aPath)), P = JSON.parse(readFileSync(pPath));
const norm = (s) => s.replace(/\s+/g, '').replace(/^\/.*\//, '').slice(0, 12);
const out = {shapeMismatch: [], sizeStroke: [], aOnly: [], pOnly: [], matched: 0, undoRedo: {A: A.checks[0].undoRedo, P: P.checks[0].undoRedo}};
const collect = (R, mode) => { const m = new Map(); for (const st of R.checks.find((c) => c.mode === mode).states) for (const i of st.icons) { if (i.fileIcon || !i.lucide) continue; const k = i.owner ? norm(i.owner) + '|' + i.lucide : '|' + i.lucide; if (!m.has(k)) m.set(k, {owner: i.owner, lucide: i.lucide, w: i.width, stroke: i.strokeWidthAttr, state: st.name}); } return m; };
const shapesA = new Map(), shapesP = new Map(); // owner label -> set of lucide shapes (a label can own several icons, e.g. a split button)
const addShapes = (R, M) => { for (const st of R.checks.find((c) => c.mode === 'light').states) for (const i of st.icons) { if (i.fileIcon || !i.lucide || !i.owner) continue; const k = norm(i.owner); if (!M.has(k)) M.set(k, new Set()); M.get(k).add(i.lucide); } }; addShapes(A, shapesA); addShapes(P, shapesP);
const byOwnerA = new Map(), byOwnerP = new Map();
for (const mode of ['light']) {
  const a = collect(A, mode), p = collect(P, mode);
  for (const v of a.values()) if (v.owner) byOwnerA.set(norm(v.owner), v); for (const v of p.values()) if (v.owner) byOwnerP.set(norm(v.owner), v);
}
// Same function (owner label) in A and P must use the same shape; sizes/strokes are reported.
const aliases = [['隐藏目录树', '切换文件目录'], ['文件全屏', '聚焦文件工作区'], ['隐藏文件区域', '隐藏文件工作区'], ['文件菜单', '文件查看选项']].map(([a, p]) => [norm(a), norm(p)]);
const pairs = new Map([...byOwnerA.keys()].filter((k) => byOwnerP.has(k)).map((k) => [k, k])); for (const [a, p] of aliases) if (byOwnerA.has(a) && byOwnerP.has(p)) pairs.set(a, p);
for (const [ka, kp] of pairs) { const a = byOwnerA.get(ka), p = byOwnerP.get(kp); out.matched++;
  const sa = shapesA.get(ka), sp = shapesP.get(kp); if (![...sa].some((s) => sp.has(s))) out.shapeMismatch.push({function: a.owner, A: [...sa], P: [...sp]});
  if (a.w !== p.w || a.stroke !== p.stroke) out.sizeStroke.push({function: a.owner, A: {w: a.w, stroke: a.stroke}, P: {w: p.w, stroke: p.stroke}}); }
out.aOnly = [...byOwnerA.keys()].filter((k) => ![...pairs.keys()].includes(k)).map((k) => byOwnerA.get(k).owner); out.pOnly = [...byOwnerP.keys()].filter((k) => ![...pairs.values()].includes(k)).map((k) => byOwnerP.get(k).owner);
console.log(JSON.stringify(out, null, 1));
