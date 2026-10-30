// Independent, read-only PDF.js inspection for synthetic native integration tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url), root = path.dirname(require.resolve('pdfjs-dist/package.json'));
const pdfjs = await import(pathToFileURL(path.join(root, 'legacy/build/pdf.mjs')).href);
const task = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(process.argv[2])), cMapUrl: path.join(root, 'cmaps') + '/', cMapPacked: true, standardFontDataUrl: path.join(root, 'standard_fonts') + '/', useSystemFonts: false, isEvalSupported: false });
try {
  const doc = await task.promise, pages = [];
  for (let number = 1; number <= doc.numPages; number++) { const page = await doc.getPage(number), content = await page.getTextContent(); pages.push({ number, text: content.items.map((item) => item.str).join('') }); page.cleanup(); }
  await fs.writeFile(process.argv[3], JSON.stringify({ reader: `PDF.js ${pdfjs.version}`, pages }) + '\n');
} finally { await task.destroy(); }
