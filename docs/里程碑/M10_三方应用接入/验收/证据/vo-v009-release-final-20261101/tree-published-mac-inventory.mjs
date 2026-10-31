import assert from 'node:assert/strict';
import { lstat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { installationTree } from './private-drivers-v009/dmg-install-ui.mjs';

const [input, output] = process.argv.slice(2).map(value => resolve(value));
const root = dirname(dirname(input));
assert(/^\/private\/tmp\/willyou-m10-vf-install-[A-Za-z0-9]+$/.test(root));
assert.equal(basename(input), 'WillYou.app');
assert.equal(dirname(output), root);
assert(['source-bundle-tree.json', 'installed-bundle-tree.json'].includes(basename(output)));
const stat = await lstat(input);
assert(stat.isDirectory() && !stat.isSymbolicLink());
await writeFile(output, JSON.stringify(await installationTree(input), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
