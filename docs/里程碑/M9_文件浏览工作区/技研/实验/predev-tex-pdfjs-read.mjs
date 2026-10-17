import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const engineRoot = path.join(repo, 'prototypes/m6-codex/node_modules/pdfjs-dist')
const pdfjs = await import(pathToFileURL(path.join(engineRoot, 'legacy/build/pdf.mjs')))
const loading = pdfjs.getDocument({
  data: new Uint8Array(await fs.readFile(process.argv[2])),
  cMapUrl: path.join(engineRoot, 'cmaps') + '/', cMapPacked: true,
  standardFontDataUrl: path.join(engineRoot, 'standard_fonts') + '/',
  useSystemFonts: false, isEvalSupported: false,
})
const document = await loading.promise
const pages = []
try {
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i)
    const text = await page.getTextContent()
    pages.push({ index: i - 1, text: text.items.map(item => item.str).join('') })
    page.cleanup()
  }
} finally { await loading.destroy() }
await fs.writeFile(process.argv[3], JSON.stringify({ reader: 'PDF.js ' + pdfjs.version, pages, count: pages.length }, null, 2) + '\n')
