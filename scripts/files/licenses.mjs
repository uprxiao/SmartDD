import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const seeds = ['@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/merge', 'markdown-it', 'markdown-it-texmath', 'katex', 'mermaid', 'js-yaml', 'highlight.js', 'pdfjs-dist', 'pdf-lib', '@parcel/watcher', 'picomatch', 'parse5', 'saxes', 'papaparse', 'parse5-sax-parser', 'postcss', 'postcss-value-parser', 'es-module-lexer', 'yauzl', 'yazl', 'ssf'];
const output = resolve('licenses/M9');
mkdirSync(output, { recursive: true });
const manifests = [], seen = new Set(), missing = [];
// saxes' published 6.0.0 tarball omits its LICENSE. Keep the exact upstream tag
// notice in source control and verify it before accepting the fallback.
const upstreamNotices = { 'saxes@6.0.0': { file: 'saxes@6.0.0__LICENSE.txt', sha256: '0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e', source: 'https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE' } };
function visit(name, from, optional = false) {
  const resolver = createRequire(from);
  const file = (resolver.resolve.paths(name) ?? []).map((directory) => join(directory, name, 'package.json')).find(existsSync);
  if (!file) { if (optional) return; throw new Error(`Cannot locate installed dependency: ${name}`); }
  const physical = realpathSync(file);
  if (seen.has(physical)) return;
  seen.add(physical);
  const data = JSON.parse(readFileSync(physical, 'utf8')), directory = resolve(physical, '..');
  const notices = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)(?:[.-]|$)/i.test(entry.name)).map((entry) => entry.name).sort();
  const saved = [];
  for (const notice of notices) {
    const bytes = readFileSync(join(directory, notice));
    const filename = `${data.name.replaceAll('/', '__')}@${data.version}__${notice}.txt`;
    writeFileSync(join(output, filename), bytes);
    saved.push({ file: filename, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  if (!notices.length) {
    const fallback = upstreamNotices[`${data.name}@${data.version}`];
    if (fallback && existsSync(join(output, fallback.file)) && createHash('sha256').update(readFileSync(join(output, fallback.file))).digest('hex') === fallback.sha256) saved.push(fallback);
    else missing.push(`${data.name}@${data.version}`);
  }
  manifests.push({ name: data.name, version: data.version, license: data.license, repository: data.repository, notices: saved });
  for (const dependency of Object.keys(data.dependencies ?? {})) visit(dependency, physical);
  // PDF.js is bundled for the browser; its optional Node canvas is not shipped.
  if (data.name === '@parcel/watcher') for (const dependency of Object.keys(data.optionalDependencies ?? {})) visit(dependency, physical, true);
}
for (const seed of seeds) visit(seed, resolve('package.json'));
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify({ source: 'Installed packages pinned by pnpm-lock.yaml; runtime dependencies only', packages: manifests.sort((a, b) => a.name.localeCompare(b.name)), missingNoticeFiles: missing }, null, 2)}\n`);
process.stdout.write(`${manifests.length} installed package license records; ${missing.length} missing notice files\n`);
if (missing.length) process.stdout.write(`${missing.join('\n')}\n`);
