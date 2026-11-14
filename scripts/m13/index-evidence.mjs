import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const root = join(repository, 'docs/里程碑/M13_应用Skill与MCP插件化重构/验收/证据');
const indexPath = join(dirname(root), '本地运行产物索引_20261112.json');
const mode = process.argv[2];
if (!['--write', '--check'].includes(mode)) throw new Error('Use --write or --check');
const files = [];
async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) {
      const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
      files.push({ path: relative(root, path), bytes: (await stat(path)).size, sha256: hash.digest('hex') });
    }
  }
}
await visit(root);
if (mode === '--write') {
  await writeFile(indexPath, JSON.stringify({ schema: 1, at: new Date().toISOString(), root: relative(repository, root),
    policy: 'User-approved local-only generated acceptance artifacts. Source, tests, necessary docs and this index are committed; original raw manifests/artifacts remain unchanged on this machine. Symlinks are not followed.', files }, null, 2) + '\n');
} else {
  const previous = JSON.parse(await readFile(indexPath, 'utf8'));
  const old = new Map(previous.files.map((item) => [item.path, item]));
  if (old.size !== files.length || files.some((item) => JSON.stringify(old.get(item.path)) !== JSON.stringify(item))) throw new Error('Local evidence index differs; review additions/changes before --write');
}
console.log(JSON.stringify({ mode, files: files.length, bytes: files.reduce((sum, item) => sum + item.bytes, 0), localOnly: true }));
