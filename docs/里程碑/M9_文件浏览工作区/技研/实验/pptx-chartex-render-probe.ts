// Research only. Render supplied synthetic PPTX fixtures through the production
// fixed runtime verification, native broker and restricted Office workspace.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { LibreOfficeEngine } from '../../../../../src/main/core/files/office/libreoffice-engine';
import { NativeFileBroker } from '../../../../../src/main/core/files/native-broker';
import { FileHeavyJobs } from '../../../../../src/main/core/files/heavy-jobs';

async function main() {
  const [input, output, runtime, executable] = process.argv.slice(2).map(path => resolve(path));
  if (!input || !output || !runtime || !executable) throw new Error('Expected input, output, fixed runtime and native helper');
  mkdirSync(output, { recursive: true });
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-chartex-probe-')));
  const broker = new NativeFileBroker(executable);
  const engine = new LibreOfficeEngine(broker, { userData, directory: runtime }, new FileHeavyJobs());
  const results: unknown[] = [];
  try {
    for (const name of readdirSync(input).filter(name => name.endsWith('.pptx')).sort()) {
      const bytes = readFileSync(join(input, name)), inputHash = createHash('sha256').update(bytes).digest('hex');
      try {
        const result = await engine.render(bytes, 'pptx', new AbortController().signal);
        const stem = join(output, name.slice(0, -5));
        writeFileSync(stem + '.pdf', result.bytes);
        execFileSync('/opt/homebrew/bin/pdftoppm', ['-f', '1', '-singlefile', '-r', '72', '-png', stem + '.pdf', stem], { timeout: 15000 });
        execFileSync('/opt/homebrew/bin/pdftotext', [stem + '.pdf', stem + '.txt'], { timeout: 15000 });
        results.push({ name, inputHash, ...result, bytes: result.bytes.length, text: readFileSync(stem + '.txt', 'utf8') });
      } catch (error) {
        results.push({ name, inputHash, error: String(error) });
      }
      console.log(JSON.stringify(results.at(-1)));
      writeFileSync(join(output, 'render.json'), JSON.stringify(results, null, 2) + '\n');
    }
  } finally {
    engine.dispose(); broker.dispose(); rmSync(userData, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
