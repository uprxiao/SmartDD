// N03: compare the P (approved prototype) and A typography tables from two result.json files; print and exit 1 on any difference.
import {readFileSync} from 'node:fs';
const [aPath, pPath] = process.argv.slice(2), A = JSON.parse(readFileSync(aPath)), P = JSON.parse(readFileSync(pPath));
const props = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'], rows = [], diffs = [];
for (const mode of ['light', 'dark']) {
  const a = A.checks.find((c) => c.mode === mode).domains, p = P.checks.find((c) => c.mode === mode).domains;
  for (const d of Object.keys(a)) {
    const row = {mode, domain: d, A: Object.fromEntries(props.map((k) => [k, a[d][k]])), P: Object.fromEntries(props.map((k) => [k, p[d]?.[k]])), diff: props.filter((k) => a[d][k] !== p[d]?.[k]),
      fontsA: a[d].fonts.map((f) => `${f.family}:${f.glyphs}`), fontsP: p[d]?.fonts.map((f) => `${f.family}:${f.glyphs}`)};
    rows.push(row); if (row.diff.length) diffs.push(row);
  }
}
console.log(JSON.stringify({rows, diffs}, null, 2));
process.exitCode = diffs.length ? 1 : 0;
